// Section 31 (documents): procedures, orders, presentations, training material, links.

import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import type { CourseDocument } from '../../shared/types';
import type { UserRow } from './auth';
import { badRequest, config, forbidden, notFound, nowIso, patchSchema } from './core';
import { db } from './db';
import { changed, logActivity } from './journal';
import { isCommander } from './taskRepo';

interface DocRow {
  id: number;
  title: string;
  category: string;
  description: string;
  kind: 'link' | 'file';
  url: string | null;
  file_name: string | null;
  mime: string | null;
  size: number | null;
  week_id: number | null;
  week_name: string | null;
  restricted: number;
  pinned: number;
  uploaded_by: number | null;
  uploaded_by_name: string | null;
  created_at: string;
}

const BASE = `
SELECT d.*, w.name AS week_name, u.display_name AS uploaded_by_name
FROM documents d LEFT JOIN weeks w ON w.id = d.week_id LEFT JOIN users u ON u.id = d.uploaded_by
`;

export const uploadsDir = (): string => {
  const dir = join(config.dataDir, 'uploads');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
};

const canSee = (actor: UserRow, d: Pick<DocRow, 'restricted'>) => isCommander(actor) || !d.restricted;
const canEditDoc = (actor: UserRow, d: Pick<DocRow, 'uploaded_by'>) => isCommander(actor) || d.uploaded_by === actor.id;

function toDoc(actor: UserRow, d: DocRow): CourseDocument {
  return {
    id: d.id,
    title: d.title,
    category: d.category,
    description: d.description,
    kind: d.kind,
    url: d.kind === 'file' ? `/api/documents/${d.id}/file` : (d.url ?? ''),
    fileName: d.file_name,
    size: d.size,
    weekId: d.week_id,
    weekName: d.week_name,
    restricted: !!d.restricted,
    pinned: !!d.pinned,
    uploadedBy: d.uploaded_by,
    uploadedByName: d.uploaded_by_name,
    createdAt: d.created_at,
    canEdit: canEditDoc(actor, d),
  };
}

export function documentRow(actor: UserRow, id: number): DocRow {
  const d = db().get<DocRow>(`${BASE} WHERE d.id = ?`, id);
  if (!d || !canSee(actor, d)) throw notFound('המסמך לא נמצא');
  return d;
}

export function listDocuments(actor: UserRow, f: { category?: string; weekId?: number; q?: string } = {}): CourseDocument[] {
  const q = f.q?.trim().toLowerCase();
  return db()
    .all<DocRow>(`${BASE} ORDER BY d.pinned DESC, d.created_at DESC`)
    .filter((d) => canSee(actor, d))
    .filter((d) => !f.category || d.category === f.category)
    .filter((d) => !f.weekId || d.week_id === f.weekId)
    .filter((d) => !q || [d.title, d.description, d.category, d.file_name].some((x) => x && x.toLowerCase().includes(q)))
    .map((d) => toDoc(actor, d));
}

const metaSchema = z.object({
  title: z.string().trim().min(1, 'חובה לתת שם למסמך').max(200),
  category: z.string().trim().min(1).max(60),
  description: z.string().max(2000).optional().default(''),
  weekId: z.number().int().positive().nullable().optional().default(null),
  restricted: z.boolean().optional().default(false),
  pinned: z.boolean().optional().default(false),
});

export const linkDocSchema = metaSchema.extend({
  url: z.string().trim().url('קישור לא תקין').refine((u) => /^https?:\/\//i.test(u), 'קישור חייב להתחיל ב-http'),
});

function checkMeta(actor: UserRow, m: { weekId: number | null; restricted: boolean; pinned: boolean }) {
  if ((m.restricted || m.pinned) && !isCommander(actor)) throw forbidden('הצמדה והגבלת צפייה שמורות למפקד הקורס');
  if (m.weekId && !db().get('SELECT 1 FROM weeks WHERE id = ?', m.weekId)) throw badRequest('השבוע לא נמצא');
}

export function createLinkDocument(actor: UserRow, raw: z.input<typeof linkDocSchema>): number {
  const d = linkDocSchema.parse(raw);
  checkMeta(actor, d);
  const id = db().run(
    `INSERT INTO documents(title, category, description, kind, url, week_id, restricted, pinned, uploaded_by, created_at)
     VALUES (?, ?, ?, 'link', ?, ?, ?, ?, ?, ?)`,
    d.title,
    d.category,
    d.description,
    d.url,
    d.weekId,
    d.restricted,
    d.pinned,
    actor.id,
    nowIso(),
  ).id;
  logActivity({ userId: actor.id, action: 'document', text: `${actor.display_name} הוסיף לספריית המסמכים: ${d.title}` });
  changed('documents');
  return id;
}

export function createFileDocument(actor: UserRow, meta: unknown, file: { buf: Buffer; name: string; mime: string }): number {
  const d = metaSchema.parse(meta);
  checkMeta(actor, d);
  if (!file.buf.length) throw badRequest('הקובץ ריק');
  const stored = randomUUID();
  writeFileSync(join(uploadsDir(), stored), file.buf);
  const id = db().run(
    `INSERT INTO documents(title, category, description, kind, url, file_name, mime, size, week_id, restricted, pinned, uploaded_by, created_at)
     VALUES (?, ?, ?, 'file', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    d.title,
    d.category,
    d.description,
    stored,
    file.name,
    file.mime,
    file.buf.length,
    d.weekId,
    d.restricted,
    d.pinned,
    actor.id,
    nowIso(),
  ).id;
  logActivity({ userId: actor.id, action: 'document', text: `${actor.display_name} העלה לספריית המסמכים: ${d.title}` });
  changed('documents');
  return id;
}

export function updateDocument(actor: UserRow, id: number, raw: unknown): void {
  const cur = documentRow(actor, id);
  if (!canEditDoc(actor, cur)) throw forbidden();
  const p = patchSchema(metaSchema).parse(raw);
  const next = {
    title: p.title ?? cur.title,
    category: p.category ?? cur.category,
    description: p.description ?? cur.description,
    weekId: p.weekId !== undefined ? p.weekId : cur.week_id,
    restricted: p.restricted ?? !!cur.restricted,
    pinned: p.pinned ?? !!cur.pinned,
  };
  if ((next.restricted !== !!cur.restricted || next.pinned !== !!cur.pinned) && !isCommander(actor)) {
    throw forbidden('הצמדה והגבלת צפייה שמורות למפקד הקורס');
  }
  db().run(
    'UPDATE documents SET title = ?, category = ?, description = ?, week_id = ?, restricted = ?, pinned = ? WHERE id = ?',
    next.title,
    next.category,
    next.description,
    next.weekId,
    next.restricted,
    next.pinned,
    id,
  );
  changed('documents');
}

export function deleteDocument(actor: UserRow, id: number): void {
  const d = documentRow(actor, id);
  if (!canEditDoc(actor, d)) throw forbidden();
  db().run('DELETE FROM documents WHERE id = ?', id);
  if (d.kind === 'file' && d.url) {
    try {
      unlinkSync(join(uploadsDir(), d.url));
    } catch {
      /* already gone */
    }
  }
  logActivity({ userId: actor.id, action: 'document', text: `${actor.display_name} הסיר מספריית המסמכים: ${d.title}` });
  changed('documents');
}
