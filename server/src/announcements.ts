// Announcements to the staff (like a company "update"): the commander posts one, it stays
// pinned at the top of everyone's home screen until they confirm "read", and the commander
// sees who has and who has not - and can remind the rest.

import { z } from 'zod';
import type { Announcement } from '../../shared/types';
import type { UserRow } from './auth';
import { forbidden, notFound, nowIso } from './core';
import { db } from './db';
import { changed, notify } from './journal';
import { isCommander } from './taskRepo';

interface Row {
  id: number;
  title: string;
  body: string;
  require_ack: number;
  urgent: number;
  created_by: number | null;
  created_by_name: string | null;
  created_at: string;
  read_at: string | null;
  acked_at: string | null;
}

/** who an announcement goes to: everyone active but its author */
const audienceIds = (authorId: number | null) => db().all<{ id: number }>('SELECT id FROM users WHERE active = 1 AND id IS NOT ?', authorId).map((u) => u.id);

function toAnnouncement(actor: UserRow, r: Row): Announcement {
  const out: Announcement = {
    id: r.id,
    title: r.title,
    body: r.body,
    requireAck: !!r.require_ack,
    urgent: !!r.urgent,
    createdBy: r.created_by,
    createdByName: r.created_by_name,
    createdAt: r.created_at,
    readAt: r.read_at,
    ackedAt: r.acked_at,
  };
  if (isCommander(actor) || r.created_by === actor.id) {
    out.audience = db().all<{ id: number; name: string; read_at: string | null; acked_at: string | null }>(
      `SELECT u.id, u.display_name AS name, x.read_at, x.acked_at FROM users u
       LEFT JOIN announcement_reads x ON x.user_id = u.id AND x.announcement_id = ?
       WHERE u.active = 1 AND u.id IS NOT ? ORDER BY x.acked_at IS NOT NULL, u.display_name`,
      r.id,
      r.created_by,
    ).map((a) => ({ userId: a.id, name: a.name, readAt: a.read_at, ackedAt: a.acked_at }));
  }
  return out;
}

const BASE = `SELECT a.*, u.display_name AS created_by_name, x.read_at, x.acked_at
FROM announcements a LEFT JOIN users u ON u.id = a.created_by
LEFT JOIN announcement_reads x ON x.announcement_id = a.id AND x.user_id = ?`;

export function listAnnouncements(actor: UserRow, f: { pending?: boolean } = {}): Announcement[] {
  const where = f.pending ? 'WHERE a.require_ack = 1 AND x.acked_at IS NULL AND a.created_by IS NOT ?' : '';
  const params: (number | null)[] = f.pending ? [actor.id, actor.id] : [actor.id];
  return db()
    .all<Row>(`${BASE} ${where} ORDER BY a.created_at DESC LIMIT 100`, ...params)
    .map((r) => toAnnouncement(actor, r));
}

export const announcementSchema = z.object({
  title: z.string().trim().min(1, 'חובה לתת כותרת').max(160),
  body: z.string().trim().max(5000).optional().default(''),
  requireAck: z.boolean().optional().default(true),
  urgent: z.boolean().optional().default(false),
});

export function postAnnouncement(actor: UserRow, raw: z.input<typeof announcementSchema>): number {
  if (!isCommander(actor)) throw forbidden('הודעה לכל הסגל מפרסם מפקד הקורס');
  const a = announcementSchema.parse(raw);
  const id = db().run(
    'INSERT INTO announcements(title, body, require_ack, urgent, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    a.title,
    a.body,
    a.requireAck ? 1 : 0,
    a.urgent ? 1 : 0,
    actor.id,
    nowIso(),
  ).id;
  notify(
    audienceIds(actor.id),
    {
      type: 'announcement',
      category: a.urgent ? 'exception' : a.requireAck ? 'action' : 'info',
      title: `${a.urgent ? 'דחוף - ' : ''}הודעה לסגל: ${a.title}`,
      body: a.body.slice(0, 200),
      link: '/announcements',
    },
    actor.id,
  );
  changed('announcements');
  return id;
}

function row(id: number): { id: number; title: string; created_by: number | null; require_ack: number } {
  const r = db().get<{ id: number; title: string; created_by: number | null; require_ack: number }>('SELECT id, title, created_by, require_ack FROM announcements WHERE id = ?', id);
  if (!r) throw notFound('ההודעה לא נמצאה');
  return r;
}

/** seen on screen (read), or confirmed ("קראתי") */
export function markAnnouncement(actor: UserRow, id: number, ack: boolean): void {
  row(id);
  const at = nowIso();
  db().run(
    `INSERT INTO announcement_reads(announcement_id, user_id, read_at, acked_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(announcement_id, user_id) DO UPDATE SET acked_at = coalesce(announcement_reads.acked_at, excluded.acked_at)`,
    id,
    actor.id,
    at,
    ack ? at : null,
  );
  changed('announcements');
}

/** a reminder to everyone who has not confirmed yet */
export function remindAnnouncement(actor: UserRow, id: number): number {
  const a = row(id);
  if (!isCommander(actor) && a.created_by !== actor.id) throw forbidden();
  const waiting = db()
    .all<{ id: number }>(
      `SELECT u.id FROM users u LEFT JOIN announcement_reads x ON x.user_id = u.id AND x.announcement_id = ?
       WHERE u.active = 1 AND u.id IS NOT ? AND x.acked_at IS NULL`,
      id,
      a.created_by,
    )
    .map((u) => u.id);
  notify(waiting, { type: 'announcement', category: 'action', title: `תזכורת: נא לאשר קריאה - ${a.title}`, link: '/announcements' }, actor.id);
  return waiting.length;
}

export function deleteAnnouncement(actor: UserRow, id: number): void {
  const a = row(id);
  if (!isCommander(actor) && a.created_by !== actor.id) throw forbidden();
  db().run('DELETE FROM announcements WHERE id = ?', id);
  changed('announcements');
}
