// The weekly (שבועי): the staff's meeting of a course week. It goes over the week's schedule, the
// professional closures and the topics the team commanders raise during the week, and ends with the
// commander's points. Anyone on the staff adds to it during the week (from the bottom bar's "+" too);
// the commander's points are seen by the one who wrote them alone, also after. Holding it sends the summary to
// the staff, and what was not yet discussed or closed moves on to the next week's weekly.

import { z } from 'zod';
import { localDateKey, isDateKey } from '../../shared/dates';
import { WEEKLY_KINDS, type WeeklyHoldResult, type WeeklyItem, type WeeklyKind, type WeeklyTarget, type WeeklyView, type WeeklyWeek } from '../../shared/weekly';
import { activeUsers, getUserRow, type UserRow } from './auth';
import { badRequest, clock, forbidden, notFound, nowIso, tz } from './core';
import { db } from './db';
import { changed, logActivity, notify } from './journal';
import { listEvents } from './schedule';
import { isCommander, visibleTasks } from './taskRepo';

interface WeekRow {
  id: number;
  number: number;
  name: string;
  start_date: string;
  end_date: string;
  lead_id: number | null;
  lead_name: string | null;
  held_at: string | null;
  held_by_name: string | null;
}

interface ItemRow {
  id: number;
  week_id: number;
  kind: WeeklyKind;
  title: string;
  details: string;
  event_ref: string | null;
  event_date: string | null;
  owner_id: number | null;
  owner_name: string | null;
  done: number;
  outcome: string;
  task_id: number | null;
  task_title: string | null;
  carried_from: number | null;
  carried_name: string | null;
  created_by: number | null;
  created_by_name: string | null;
  created_at: string;
}

const WEEKS = `
SELECT w.id, w.number, w.name, w.start_date, w.end_date, w.lead_id, u.display_name AS lead_name, wl.held_at, h.display_name AS held_by_name
FROM weeks w
LEFT JOIN users u ON u.id = w.lead_id
LEFT JOIN weeklies wl ON wl.week_id = w.id
LEFT JOIN users h ON h.id = wl.held_by
`;

const ITEMS = `
SELECT i.*, o.display_name AS owner_name, t.title AS task_title, cw.name AS carried_name, c.display_name AS created_by_name
FROM weekly_items i
LEFT JOIN users o ON o.id = i.owner_id
LEFT JOIN tasks t ON t.id = i.task_id
LEFT JOIN weeks cw ON cw.id = i.carried_from
LEFT JOIN users c ON c.id = i.created_by
`;

const toWeek = (r: WeekRow): WeeklyWeek => ({
  id: r.id,
  number: r.number,
  name: r.name,
  startDate: r.start_date,
  endDate: r.end_date,
  leadId: r.lead_id,
  leadName: r.lead_name,
  heldAt: r.held_at,
});

function allWeeks(): WeeklyWeek[] {
  return db().all<WeekRow>(`${WEEKS} ORDER BY w.start_date, w.number`).map(toWeek);
}

function weekRow(id: number): WeekRow {
  const r = db().get<WeekRow>(`${WEEKS} WHERE w.id = ?`, id);
  if (!r) throw notFound('השבוע לא נמצא');
  return r;
}

const today = () => localDateKey(clock.now(), tz());

/** where what comes up now goes: the weekly of the week on now (or the next one) until it is held, then the next */
function targetWeekId(): number | null {
  const weeks = allWeeks();
  if (!weeks.length) return null;
  const t = today();
  return (weeks.find((w) => w.endDate >= t && !w.heldAt) ?? weeks.find((w) => w.endDate >= t) ?? weeks[weeks.length - 1]).id;
}

const canManage = (actor: UserRow, w: Pick<WeekRow, 'lead_id'>) => isCommander(actor) || w.lead_id === actor.id;
// a point is its writer's alone
const canEdit = (actor: UserRow, i: Pick<ItemRow, 'created_by' | 'kind'>) => (i.kind === 'point' ? i.created_by === actor.id : isCommander(actor) || i.created_by === actor.id);
const canSettle = (actor: UserRow, w: Pick<WeekRow, 'lead_id'>, i: Pick<ItemRow, 'created_by' | 'kind' | 'owner_id'>) =>
  i.kind === 'point' ? i.created_by === actor.id : canManage(actor, w) || i.created_by === actor.id || (i.kind === 'closure' && i.owner_id === actor.id);

function toItem(actor: UserRow, w: WeekRow, r: ItemRow): WeeklyItem {
  return {
    id: r.id,
    weekId: r.week_id,
    kind: r.kind,
    title: r.title,
    details: r.details,
    eventRef: r.event_ref,
    eventDate: r.event_date,
    ownerId: r.owner_id,
    ownerName: r.owner_name,
    done: !!r.done,
    outcome: r.outcome,
    taskId: r.task_id,
    taskTitle: r.task_title,
    carriedFrom: r.carried_from ? { id: r.carried_from, name: r.carried_name ?? '' } : null,
    createdBy: r.created_by,
    createdByName: r.created_by_name,
    createdAt: r.created_at,
    canEdit: canEdit(actor, r) && (!w.held_at || isCommander(actor)),
    canSettle: canSettle(actor, w, r) && (!w.held_at || isCommander(actor)),
  };
}

/** the items the one asking may see: the commander's points to the one who wrote them alone - before the weekly and after */
function itemsOf(actor: UserRow, w: WeekRow): ItemRow[] {
  return db().all<ItemRow>(`${ITEMS} WHERE i.week_id = ? AND (i.kind <> 'point' OR i.created_by = ?) ORDER BY i.created_at, i.id`, w.id, actor.id);
}

/** the commander's home: what is still open on the coming weekly, by kind - and how many are settled */
export function weeklyTarget(actor: UserRow): WeeklyTarget & { name: string | null; heldAt: string | null; counts: Record<WeeklyKind, number> & { open: number; settled: number } } {
  const weekId = targetWeekId();
  const counts = { schedule: 0, closure: 0, topic: 0, point: 0, open: 0, settled: 0 };
  let name: string | null = null;
  let heldAt: string | null = null;
  if (weekId) {
    const w = weekRow(weekId);
    name = w.name;
    heldAt = w.held_at;
    for (const i of itemsOf(actor, w)) {
      if (i.done) counts.settled++;
      else {
        counts[i.kind]++;
        if (i.kind === 'topic' || i.kind === 'closure') counts.open++;
      }
    }
  }
  return { weekId, weeks: allWeeks(), name, heldAt, counts };
}

export function weeklyView(actor: UserRow, weekId: number): WeeklyView {
  const w = weekRow(weekId);
  const weeks = allWeeks();
  const at = weeks.findIndex((x) => x.id === w.id);
  const next = weeks[at + 1];
  return {
    week: toWeek(w),
    weeks,
    heldAt: w.held_at,
    heldByName: w.held_by_name,
    items: itemsOf(actor, w).map((r) => toItem(actor, w, r)),
    pointsHidden: !isCommander(actor),
    canManage: canManage(actor, w),
    canHold: isCommander(actor),
    events: listEvents(w.start_date, w.end_date),
    openTasks: visibleTasks(actor, "t.week_id = ? AND t.status NOT IN ('done', 'cancelled')", w.id),
    next: next ? { id: next.id, name: next.name } : null,
  };
}

export const weeklyItemSchema = z.object({
  weekId: z.number().int().positive().optional(),
  kind: z.enum(WEEKLY_KINDS),
  title: z.string().trim().min(1, 'חובה לכתוב על מה מדובר').max(300),
  details: z.string().trim().max(4000).optional().default(''),
  ownerId: z.number().int().positive().nullable().optional().default(null),
  eventRef: z
    .string()
    .regex(/^[ex]:.{1,180}$/, 'אירוע לא תקין')
    .nullable()
    .optional()
    .default(null),
  eventDate: z.string().refine(isDateKey, 'תאריך לא תקין').nullable().optional().default(null),
});

function checkOwner(id: number | null | undefined): void {
  if (!id) return;
  const u = getUserRow(id);
  if (!u || !u.active) throw badRequest('איש הסגל שנבחר אינו פעיל');
}

function notifyOwner(actor: UserRow, w: WeekRow, itemId: number, ownerId: number | null, title: string): void {
  if (ownerId) notify([ownerId], { type: 'weekly_closure', category: 'action', title: `סגירה מקצועית לשבועי: ${title}`, body: w.name, link: `/weekly/${w.id}`, ref: `weekly-item:${itemId}` }, actor.id);
}

export function addWeeklyItem(actor: UserRow, raw: z.input<typeof weeklyItemSchema>): { id: number; weekId: number } {
  const p = weeklyItemSchema.parse(raw);
  const weekId = p.weekId ?? targetWeekId();
  if (!weekId) throw badRequest('אין עדיין שבועות בקורס - מוסיפים שבועות במסך "שבועות הקורס"');
  const w = weekRow(weekId);
  if (p.kind === 'point' && !isCommander(actor)) throw forbidden('דגשים בסוף השבועי כותב מפקד הקורס');
  if (w.held_at && !isCommander(actor)) throw badRequest(`השבועי של ${w.name} כבר התקיים - הוסיפו לשבועי הבא`);
  const ownerId = p.kind === 'closure' ? p.ownerId : null;
  checkOwner(ownerId);
  const now = nowIso();
  const id = db().run(
    `INSERT INTO weekly_items(week_id, kind, title, details, event_ref, event_date, owner_id, created_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    weekId,
    p.kind,
    p.title,
    p.details,
    p.kind === 'schedule' ? p.eventRef : null,
    p.kind === 'schedule' ? p.eventDate : null,
    ownerId,
    actor.id,
    now,
    now,
  ).id;
  if (ownerId) notifyOwner(actor, w, id, ownerId, p.title);
  changed('weekly');
  return { id, weekId };
}

export const weeklyPatchSchema = z
  .object({
    title: z.string().trim().min(1, 'חובה לכתוב על מה מדובר').max(300),
    details: z.string().trim().max(4000),
    ownerId: z.number().int().positive().nullable(),
    done: z.boolean(),
    outcome: z.string().trim().max(4000),
    taskId: z.number().int().positive().nullable(),
  })
  .partial();

/** someone else's point is not there at all for the one asking */
function itemRow(actor: UserRow, id: number): ItemRow {
  const r = db().get<ItemRow>(`${ITEMS} WHERE i.id = ?`, id);
  if (!r || (r.kind === 'point' && r.created_by !== actor.id)) throw notFound('הפריט לא נמצא');
  return r;
}

export function updateWeeklyItem(actor: UserRow, id: number, raw: z.input<typeof weeklyPatchSchema>): void {
  const p = weeklyPatchSchema.parse(raw);
  const cur = itemRow(actor, id);
  const w = weekRow(cur.week_id);
  if (w.held_at && !isCommander(actor)) throw forbidden('השבועי כבר התקיים');
  const editing = p.title !== undefined || p.details !== undefined || p.ownerId !== undefined;
  const settling = p.done !== undefined || p.outcome !== undefined || p.taskId !== undefined;
  if (editing && !canEdit(actor, cur)) throw forbidden('רק מי שהעלה את הפריט או מפקד הקורס יכולים לשנות אותו');
  if (settling && !canSettle(actor, w, cur)) throw forbidden('רק מפקד הקורס, המפק"צ האחראי על השבוע או מי שהעלה את הפריט מסמנים אותו');
  const ownerId = cur.kind === 'closure' && p.ownerId !== undefined ? p.ownerId : cur.owner_id;
  checkOwner(p.ownerId);
  if (p.taskId && !db().get('SELECT 1 FROM tasks WHERE id = ?', p.taskId)) throw badRequest('המשימה לא נמצאה');
  db().run(
    'UPDATE weekly_items SET title = ?, details = ?, owner_id = ?, done = ?, outcome = ?, task_id = ?, updated_at = ? WHERE id = ?',
    p.title ?? cur.title,
    p.details ?? cur.details,
    ownerId,
    p.done === undefined ? cur.done : p.done ? 1 : 0,
    p.outcome ?? cur.outcome,
    p.taskId !== undefined ? p.taskId : cur.task_id,
    nowIso(),
    id,
  );
  if (ownerId && ownerId !== cur.owner_id) notifyOwner(actor, w, id, ownerId, p.title ?? cur.title);
  changed('weekly');
}

export function deleteWeeklyItem(actor: UserRow, id: number): void {
  const cur = itemRow(actor, id);
  const w = weekRow(cur.week_id);
  if (!canEdit(actor, cur) || (w.held_at && !isCommander(actor))) throw forbidden('רק מי שהעלה את הפריט או מפקד הקורס יכולים למחוק אותו');
  db().run('DELETE FROM weekly_items WHERE id = ?', id);
  changed('weekly');
}

export const holdSchema = z.object({ carry: z.boolean().optional().default(true) });

/**
 * The weekly was held: the summary goes to the staff (the commander's points stay the commander's), and the topics
 * not discussed and the closures not closed move on to the next week's weekly.
 */
export function holdWeekly(actor: UserRow, weekId: number, raw: z.input<typeof holdSchema>): WeeklyHoldResult {
  if (!isCommander(actor)) throw forbidden('את השבועי מסכם מפקד הקורס');
  const { carry } = holdSchema.parse(raw ?? {});
  const w = weekRow(weekId);
  if (w.held_at) throw badRequest('השבועי הזה כבר סוכם');
  const weeks = allWeeks();
  const next = weeks[weeks.findIndex((x) => x.id === w.id) + 1] ?? null;
  const now = nowIso();
  const staff = activeUsers()
    .map((u) => u.id)
    .filter((id) => id !== actor.id);
  let carried = 0;
  db().tx(() => {
    db().run(
      'INSERT INTO weeklies(week_id, held_at, held_by, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(week_id) DO UPDATE SET held_at = excluded.held_at, held_by = excluded.held_by, updated_at = excluded.updated_at',
      w.id,
      now,
      actor.id,
      now,
    );
    if (carry && next) {
      carried = db().run(
        "UPDATE weekly_items SET week_id = ?, carried_from = ?, updated_at = ? WHERE week_id = ? AND done = 0 AND kind IN ('topic', 'closure')",
        next.id,
        w.id,
        now,
        w.id,
      ).changes;
    }
    // the points are not counted: what the commander writes is not shown to anyone, not even as a number
    const n = db().get<{ topics: number; closures: number }>(
      `SELECT sum(kind = 'topic') AS topics, sum(kind = 'closure') AS closures FROM weekly_items WHERE week_id = ?`,
      w.id,
    ) ?? { topics: 0, closures: 0 };
    const parts = [`${n.topics ?? 0} נושאים`, `${n.closures ?? 0} סגירות`];
    logActivity({ weekId: w.id, userId: actor.id, action: 'weekly_held', text: `${actor.display_name} סיכם את השבועי של ${w.name}: ${parts.join(', ')}${carried ? ` - ${carried} עברו לשבועי הבא` : ''}` });
    notify(staff, { type: 'weekly_summary', category: 'info', title: `סיכום השבועי - ${w.name}`, body: parts.join(' · '), link: `/weekly/${w.id}` }, actor.id);
  });
  changed('weekly', 'weeks');
  return { carried, notified: staff.length, nextWeekId: next?.id ?? null };
}

/** back to preparation: everything can be changed again */
export function reopenWeekly(actor: UserRow, weekId: number): void {
  if (!isCommander(actor)) throw forbidden('את השבועי פותח מחדש מפקד הקורס');
  weekRow(weekId);
  db().run('UPDATE weeklies SET held_at = NULL, held_by = NULL, updated_at = ? WHERE week_id = ?', nowIso(), weekId);
  changed('weekly', 'weeks');
}
