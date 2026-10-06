// Course tracks (צירים בקורס): the course's lines of work alongside its weeks - אימון גופני, שטח,
// מסע פתיחה... Each has a lead and goals, and its tasks: a task belongs to a track by its "ציר" field
// (a task in an area of the same name goes there unless told otherwise, taskService). Readiness, what
// is overdue and what comes next are counted from those tasks, as for a week.

import { z } from 'zod';
import { readinessPct } from '../../shared/taskLogic';
import { byHe } from '../../shared/sort';
import type { Track, TrackDetail } from '../../shared/types';
import { getUserRow, type UserRow } from './auth';
import { badRequest, forbidden, notFound, nowIso, patchSchema } from './core';
import { db } from './db';
import { changed, logActivity, notify } from './journal';
import { isCommander, visibleTasks } from './taskRepo';
import { domainReadiness } from './weeks';

interface TrackRow {
  id: number;
  name: string;
  lead_id: number | null;
  lead_name: string | null;
  goals: string;
  total_tasks: number;
  done_tasks: number;
  overdue_tasks: number;
  blocked_tasks: number;
  next_deadline: string | null;
}

// as for a week: routine recurring tasks are not preparation, and do not count
const BASE = `
SELECT tr.*, u.display_name AS lead_name,
  (SELECT count(*) FROM tasks t WHERE t.track_id = tr.id AND t.status <> 'cancelled' AND t.recurring_rule_id IS NULL) AS total_tasks,
  (SELECT count(*) FROM tasks t WHERE t.track_id = tr.id AND t.status = 'done' AND t.recurring_rule_id IS NULL) AS done_tasks,
  (SELECT count(*) FROM tasks t WHERE t.track_id = tr.id AND t.status NOT IN ('done', 'cancelled') AND t.deadline < ?) AS overdue_tasks,
  (SELECT count(*) FROM tasks t WHERE t.track_id = tr.id AND t.status = 'blocked') AS blocked_tasks,
  (SELECT min(t.deadline) FROM tasks t WHERE t.track_id = tr.id AND t.status NOT IN ('done', 'cancelled') AND t.deadline >= ?) AS next_deadline
FROM tracks tr
LEFT JOIN users u ON u.id = tr.lead_id
`;

function toTrack(r: TrackRow): Track {
  return {
    id: r.id,
    name: r.name,
    leadId: r.lead_id,
    leadName: r.lead_name,
    goals: r.goals,
    totalTasks: r.total_tasks,
    doneTasks: r.done_tasks,
    overdueTasks: r.overdue_tasks,
    blockedTasks: r.blocked_tasks,
    nextDeadline: r.next_deadline,
    readiness: readinessPct(r.done_tasks, r.total_tasks),
  };
}

/** every track, in alphabetical order */
export function listTracks(): Track[] {
  const now = nowIso();
  return db()
    .all<TrackRow>(BASE, now, now)
    .map(toTrack)
    .sort((a, b) => byHe(a.name, b.name));
}

export function getTrack(id: number): Track {
  const now = nowIso();
  const r = db().get<TrackRow>(`${BASE} WHERE tr.id = ?`, now, now, id);
  if (!r) throw notFound('הציר לא נמצא');
  return toTrack(r);
}

const canManage = (actor: UserRow, t: Pick<Track, 'leadId'>) => isCommander(actor) || t.leadId === actor.id;

export const trackSchema = z.object({
  name: z.string().trim().min(1, 'חובה לתת שם לציר').max(60),
  leadId: z.number().int().positive().nullable().optional().default(null),
  goals: z.string().max(4000).optional().default(''),
});

function checkLead(id: number | null | undefined): void {
  if (!id) return;
  const u = getUserRow(id);
  if (!u || !u.active) throw badRequest('איש הסגל שנבחר אינו פעיל');
}

function checkName(name: string, except = 0): void {
  if (db().get('SELECT 1 FROM tracks WHERE name = ? AND id <> ?', name, except)) throw badRequest(`כבר יש ציר בשם "${name}"`);
}

function notifyLead(actor: UserRow, id: number, leadId: number, name: string): void {
  notify([leadId], { type: 'track_lead', category: 'action', title: `מונית לאחראי על ציר ${name}`, link: `/tracks/${id}` }, actor.id);
}

export function createTrack(actor: UserRow, raw: z.input<typeof trackSchema>): number {
  if (!isCommander(actor)) throw forbidden('רק מפקד הקורס מוסיף צירים');
  const t = trackSchema.parse(raw);
  checkName(t.name);
  checkLead(t.leadId);
  const id = db().run('INSERT INTO tracks(name, lead_id, goals, created_at) VALUES (?, ?, ?, ?)', t.name, t.leadId, t.goals, nowIso()).id;
  logActivity({ userId: actor.id, action: 'track_created', text: `${actor.display_name} הוסיף את הציר "${t.name}"` });
  if (t.leadId) notifyLead(actor, id, t.leadId, t.name);
  changed('weeks');
  return id;
}

export function updateTrack(actor: UserRow, id: number, raw: Partial<z.input<typeof trackSchema>>): void {
  const cur = getTrack(id);
  if (!canManage(actor, cur)) throw forbidden();
  const patch = patchSchema(trackSchema).parse(raw);
  // the lead writes the goals; the name and the lead belong to the commander
  if (!isCommander(actor) && (patch.name !== undefined || patch.leadId !== undefined)) throw forbidden('רק מפקד הקורס יכול לשנות את שם הציר ואת האחראי');
  if (patch.name !== undefined) checkName(patch.name, id);
  checkLead(patch.leadId);
  const next = { name: patch.name ?? cur.name, leadId: patch.leadId !== undefined ? patch.leadId : cur.leadId, goals: patch.goals ?? cur.goals };
  db().run('UPDATE tracks SET name = ?, lead_id = ?, goals = ? WHERE id = ?', next.name, next.leadId, next.goals, id);
  logActivity({ userId: actor.id, action: 'track_updated', text: `${actor.display_name} עדכן את הציר "${next.name}"` });
  if (next.leadId && next.leadId !== cur.leadId) notifyLead(actor, id, next.leadId, next.name);
  changed('weeks', 'tasks');
}

/** A track goes; its tasks stay, without a track. */
export function deleteTrack(actor: UserRow, id: number): void {
  if (!isCommander(actor)) throw forbidden('רק מפקד הקורס מוחק צירים');
  const t = getTrack(id);
  db().run('DELETE FROM tracks WHERE id = ?', id);
  logActivity({ userId: actor.id, action: 'track_deleted', text: `${actor.display_name} מחק את הציר "${t.name}"` });
  changed('weeks', 'tasks');
}

/** A track's page: its readiness by area and by course week, and its tasks. */
export function trackDetail(actor: UserRow, id: number): TrackDetail {
  const track = getTrack(id);
  const byWeek = db()
    .all<{ week_id: number | null; name: string | null; number: number | null; start_date: string | null; total: number; done: number }>(
      `SELECT t.week_id, w.name, w.number, w.start_date, count(*) AS total, sum(CASE WHEN t.status = 'done' THEN 1 ELSE 0 END) AS done
       FROM tasks t LEFT JOIN weeks w ON w.id = t.week_id
       WHERE t.track_id = ? AND t.status <> 'cancelled' AND t.recurring_rule_id IS NULL
       GROUP BY t.week_id ORDER BY w.start_date IS NULL, w.start_date`,
      id,
    )
    .map((r) => ({ weekId: r.week_id, name: r.name ?? 'ללא שבוע', number: r.number, startDate: r.start_date, total: r.total, done: r.done, readiness: readinessPct(r.done, r.total) }));
  return {
    track,
    canManage: canManage(actor, track),
    byDomain: domainReadiness('t.track_id = ?', id),
    byWeek,
    tasks: visibleTasks(actor, 't.track_id = ?', id),
  };
}
