// A week's activity file (תיק פעילות, shared/activityFiles.ts): its link and where it stands - built, waiting for the
// company commander's approval, sent on to headquarters, approved. It is filled in by the people who look after
// the activity files (chosen in the course, settings.activityFileOwners) with the week's lead; they and the
// commander move it on. Waiting for approval tells the commander; approved, or sent back to be built, tells them.

import { z } from 'zod';
import { ACTIVITY_FILE_STATUS_LABELS, ACTIVITY_FILE_STATUSES, type ActivityFileStatus } from '../../shared/activityFiles';
import type { ActivityFile, ActivityFilesWeek } from '../../shared/types';
import { commanderIds, type UserRow } from './auth';
import { badRequest, forbidden, getSettings, notFound, nowIso } from './core';
import { db } from './db';
import { changed, logActivity, notify } from './journal';

interface FileRow {
  id: number;
  week_id: number;
  title: string;
  status: ActivityFileStatus;
  link: string;
  note: string;
  status_at: string | null;
  status_by_name: string | null;
}

interface WeekRow {
  id: number;
  number: number;
  name: string;
  start_date: string;
  end_date: string;
  lead_id: number | null;
  lead_name: string | null;
}

/** the people who look after the activity files - those still on the staff */
function keepers(): { id: number; name: string }[] {
  const ids = getSettings().activityFileOwners ?? [];
  if (!ids.length) return [];
  const names = new Map(db().all<{ id: number; display_name: string }>(`SELECT id, display_name FROM users WHERE active = 1 AND id IN (${ids.map(() => '?').join(',')})`, ...ids).map((u) => [u.id, u.display_name]));
  return ids.filter((id) => names.has(id)).map((id) => ({ id, name: names.get(id)! }));
}

/** who fills a week's activity file in: the activity files' people and the week's lead */
function ownersOf(week: Pick<WeekRow, 'lead_id' | 'lead_name'>, keep = keepers()): { id: number; name: string }[] {
  const out = [...keep];
  if (week.lead_id && week.lead_name && !out.some((o) => o.id === week.lead_id)) out.push({ id: week.lead_id, name: week.lead_name });
  return out;
}

/** may open and move on a week's activity file: its people and the commander */
const mayEdit = (actor: UserRow, week: Pick<WeekRow, 'lead_id'>) => actor.role === 'commander' || (getSettings().activityFileOwners ?? []).includes(actor.id) || week.lead_id === actor.id;

const WEEKS = 'SELECT w.id, w.number, w.name, w.start_date, w.end_date, w.lead_id, u.display_name AS lead_name FROM weeks w LEFT JOIN users u ON u.id = w.lead_id';

function weekRow(id: number): WeekRow {
  const w = db().get<WeekRow>(`${WEEKS} WHERE w.id = ?`, id);
  if (!w) throw notFound('השבוע לא נמצא');
  return w;
}

const FILES =
  'SELECT f.id, f.week_id, f.title, f.status, f.link, f.note, f.status_at, u.display_name AS status_by_name FROM activity_files f LEFT JOIN users u ON u.id = f.status_by';

function toFile(f: FileRow, week: WeekRow, actor: UserRow, keep: { id: number; name: string }[]): ActivityFile {
  return {
    id: f.id,
    weekId: f.week_id,
    title: f.title,
    status: f.status,
    link: f.link,
    note: f.note,
    statusAt: f.status_at,
    statusByName: f.status_by_name,
    owners: ownersOf(week, keep),
    canEdit: mayEdit(actor, week),
  };
}

/** the course's weeks, each with its activity files (one week only, when asked) */
export function activityFiles(actor: UserRow, weekId?: number): ActivityFilesWeek[] {
  const weeks = weekId ? [weekRow(weekId)] : db().all<WeekRow>(`${WEEKS} ORDER BY w.start_date, w.number`);
  const files = weekId ? db().all<FileRow>(`${FILES} WHERE f.week_id = ? ORDER BY f.id`, weekId) : db().all<FileRow>(`${FILES} ORDER BY f.id`);
  const keep = keepers();
  return weeks.map((w) => ({
    id: w.id,
    number: w.number,
    name: w.name,
    startDate: w.start_date,
    endDate: w.end_date,
    leadId: w.lead_id,
    leadName: w.lead_name,
    canAdd: mayEdit(actor, w),
    files: files.filter((f) => f.week_id === w.id).map((f) => toFile(f, w, actor, keep)),
  }));
}

const link = z
  .string()
  .trim()
  .max(1000)
  .refine((v) => !v || /^https?:\/\//i.test(v), 'קישור צריך להתחיל ב-https://');

export const newFileSchema = z.object({
  weekId: z.number().int().positive(),
  title: z.string().trim().max(120).optional(),
  link: link.optional(),
});

export function createActivityFile(actor: UserRow, raw: unknown): ActivityFile {
  const p = newFileSchema.parse(raw);
  const w = weekRow(p.weekId);
  if (!mayEdit(actor, w)) throw forbidden('תיק פעילות פותחים מי שאחראים על תיקי הפעילות, אחראי השבוע ומפקד הקורס');
  const now = nowIso();
  const id = db().run(
    'INSERT INTO activity_files(week_id, title, link, created_by, created_at, updated_at, status_at, status_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    w.id,
    p.title || 'תיק פעילות',
    p.link ?? '',
    actor.id,
    now,
    now,
    now,
    actor.id,
  ).id;
  logActivity({ userId: actor.id, action: 'activity_file', text: `${actor.display_name} פתח תיק פעילות ל${w.name}` });
  changed('weeks');
  return fileOf(actor, id);
}

function fileOf(actor: UserRow, id: number): ActivityFile {
  const f = db().get<FileRow>(`${FILES} WHERE f.id = ?`, id);
  if (!f) throw notFound('תיק הפעילות לא נמצא');
  return toFile(f, weekRow(f.week_id), actor, keepers());
}

export const fileSchema = z
  .object({
    status: z.enum(ACTIVITY_FILE_STATUSES),
    title: z.string().trim().min(1, 'חסר שם לתיק').max(120),
    link,
    note: z.string().trim().max(500),
  })
  .partial();

export function updateActivityFile(actor: UserRow, id: number, raw: unknown): ActivityFile {
  const p = fileSchema.parse(raw);
  const f = db().get<FileRow>(`${FILES} WHERE f.id = ?`, id);
  if (!f) throw notFound('תיק הפעילות לא נמצא');
  const w = weekRow(f.week_id);
  if (!mayEdit(actor, w)) throw forbidden('את תיק הפעילות מעדכנים מי שאחראים עליו ומפקד הקורס');
  const now = nowIso();
  db().run(
    'UPDATE activity_files SET title = coalesce(?, title), link = coalesce(?, link), note = coalesce(?, note), updated_at = ? WHERE id = ?',
    p.title ?? null,
    p.link ?? null,
    p.note ?? null,
    now,
    id,
  );
  if (p.status && p.status !== f.status) {
    db().run('UPDATE activity_files SET status = ?, status_at = ?, status_by = ? WHERE id = ?', p.status, now, actor.id, id);
    logActivity({ userId: actor.id, action: 'activity_file', text: `${actor.display_name}: ${f.title} של ${w.name} - ${ACTIVITY_FILE_STATUS_LABELS[p.status]}` });
    tell(actor, { ...f, status: p.status }, f.status, w);
  }
  changed('weeks');
  return fileOf(actor, id);
}

/** who hears of a step: the commander when it waits for them; its people when it is approved or sent back */
function tell(actor: UserRow, f: FileRow, was: ActivityFileStatus, w: WeekRow): void {
  const link = `/weeks/${w.id}`;
  const ref = `activity-file:${f.id}`;
  const people = ownersOf(w).map((o) => o.id);
  if (f.status === 'awaiting') {
    notify(commanderIds(), { type: 'activity_file', category: 'action', title: `${f.title} של ${w.name} ממתין לאישורך`, link, ref }, actor.id);
  } else if (f.status === 'approved') {
    notify(people, { type: 'approved', category: 'info', title: `${f.title} של ${w.name} אושר`, link, ref }, actor.id);
  } else if (f.status === 'building' && was === 'awaiting') {
    notify(people, { type: 'activity_file', category: 'info', title: `${f.title} של ${w.name} הוחזר לבנייה`, body: f.note || undefined, link, ref }, actor.id);
  }
}

export function deleteActivityFile(actor: UserRow, id: number): void {
  const f = db().get<FileRow>(`${FILES} WHERE f.id = ?`, id);
  if (!f) throw notFound('תיק הפעילות לא נמצא');
  if (!mayEdit(actor, weekRow(f.week_id))) throw forbidden();
  db().run('DELETE FROM activity_files WHERE id = ?', id);
  changed('weeks');
}

export const weekIdOf = (raw: unknown): number | undefined => {
  if (raw === undefined || raw === '') return undefined;
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) throw badRequest('שבוע לא תקין');
  return n;
};
