// Daily schedule (22) and its link to tasks (23, 66, 67).

import { z } from 'zod';
import { isOpenStatus } from '../../shared/constants';
import { isDateKey, shortDate, zonedToUtc } from '../../shared/dates';
import type { EventDetail, ScheduleEvent, Task } from '../../shared/types';
import { getUserRow, type UserRow } from './auth';
import { badRequest, forbidden, notFound, nowIso, tz } from './core';
import { db } from './db';
import { changed, logActivity, notify } from './journal';
import { isCommander, queryTasks, toTask, visibleTasks } from './taskRepo';
import { listAttachments, updateTask, weekForDate } from './taskService';

const timeRe = /^([01]\d|2[0-3]):[0-5]\d$/;

interface EventRow {
  id: number;
  date: string;
  start_time: string;
  end_time: string | null;
  title: string;
  location: string;
  owner_id: number | null;
  owner_name: string | null;
  week_id: number | null;
  notes: string;
  cancelled: number;
  created_by: number | null;
  task_total: number;
  task_done: number;
}

const EVENT_BASE = `
SELECT e.*, u.display_name AS owner_name,
  (SELECT count(*) FROM tasks t WHERE t.event_id = e.id AND t.status <> 'cancelled') AS task_total,
  (SELECT count(*) FROM tasks t WHERE t.event_id = e.id AND t.status = 'done') AS task_done
FROM events e LEFT JOIN users u ON u.id = e.owner_id
`;

function toEvent(r: EventRow): ScheduleEvent {
  return {
    id: r.id,
    date: r.date,
    startTime: r.start_time,
    endTime: r.end_time,
    title: r.title,
    location: r.location,
    ownerId: r.owner_id,
    ownerName: r.owner_name,
    weekId: r.week_id,
    notes: r.notes,
    cancelled: !!r.cancelled,
    taskTotal: r.task_total,
    taskDone: r.task_done,
  };
}

export function listEvents(from: string, to: string, includeCancelled = true): ScheduleEvent[] {
  return db()
    .all<EventRow>(
      `${EVENT_BASE} WHERE e.date >= ? AND e.date <= ? ${includeCancelled ? '' : 'AND e.cancelled = 0'} ORDER BY e.date, e.start_time`,
      from,
      to,
    )
    .map(toEvent);
}

function eventRow(id: number): EventRow {
  const r = db().get<EventRow>(`${EVENT_BASE} WHERE e.id = ?`, id);
  if (!r) throw notFound('הפעילות לא נמצאה');
  return r;
}

export function eventDetail(actor: UserRow, id: number): EventDetail {
  const r = eventRow(id);
  return { event: toEvent(r), tasks: visibleTasks(actor, 't.event_id = ?', id), attachments: listAttachments('a.event_id = ?', id) };
}

function weekLeadOn(dateKey: string): number | null {
  const wid = weekForDate(dateKey);
  return wid ? (db().get<{ lead_id: number | null }>('SELECT lead_id FROM weeks WHERE id = ?', wid)?.lead_id ?? null) : null;
}

/** Commander, the week's lead, the event owner or its creator manage an event. */
export function canManageEvent(actor: UserRow, e: Pick<EventRow, 'date' | 'owner_id' | 'created_by'>): boolean {
  return isCommander(actor) || e.owner_id === actor.id || e.created_by === actor.id || weekLeadOn(e.date) === actor.id;
}

export const eventSchema = z.object({
  date: z.string().refine(isDateKey, 'תאריך לא תקין'),
  startTime: z.string().regex(timeRe, 'שעה לא תקינה'),
  endTime: z.string().regex(timeRe, 'שעה לא תקינה').nullable().optional().or(z.literal('')),
  title: z.string().trim().min(1, 'חובה למלא שם פעילות').max(200),
  location: z.string().max(200).optional().default(''),
  ownerId: z.number().int().positive().nullable().optional(),
  notes: z.string().max(4000).optional().default(''),
});

export function createEvent(actor: UserRow, raw: z.input<typeof eventSchema>): number {
  const e = eventSchema.parse(raw);
  if (!isCommander(actor) && weekLeadOn(e.date) !== actor.id && e.ownerId !== actor.id) {
    throw forbidden('רק מפקד הקורס או מפק"צ השבוע יכולים להוסיף אירועים ללו"ז');
  }
  if (e.ownerId && !getUserRow(e.ownerId)?.active) throw badRequest('האחראי שנבחר אינו פעיל');
  const at = nowIso();
  const id = db().tx(() => {
    const id = db().run(
      `INSERT INTO events(date, start_time, end_time, title, location, owner_id, week_id, notes, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      e.date,
      e.startTime,
      e.endTime || null,
      e.title,
      e.location,
      e.ownerId ?? null,
      weekForDate(e.date),
      e.notes,
      actor.id,
      at,
      at,
    ).id;
    logActivity({ eventId: id, userId: actor.id, action: 'event_created', text: `${actor.display_name} הוסיף ללו"ז: ${e.title} (${shortDate(e.date)} ${e.startTime})` });
    if (e.ownerId) {
      notify([e.ownerId], { type: 'event_owner', category: 'info', title: `מונית לאחראי על "${e.title}"`, body: `${shortDate(e.date)} ${e.startTime}`, link: `/schedule?date=${e.date}&event=${id}` }, actor.id);
    }
    return id;
  });
  changed('events');
  return id;
}

/** Section 66: returns the open tasks that may be affected by the change. */
export function updateEvent(actor: UserRow, id: number, raw: Partial<z.input<typeof eventSchema>>): { affectedTasks: Task[]; deltaMinutes: number } {
  const cur = eventRow(id);
  if (!canManageEvent(actor, cur)) throw forbidden();
  const patch = eventSchema.partial().parse(raw);
  const next = {
    date: patch.date ?? cur.date,
    startTime: patch.startTime ?? cur.start_time,
    endTime: patch.endTime !== undefined ? patch.endTime || null : cur.end_time,
    title: patch.title ?? cur.title,
    location: patch.location ?? cur.location,
    ownerId: patch.ownerId !== undefined ? patch.ownerId : cur.owner_id,
    notes: patch.notes ?? cur.notes,
  };
  const before = zonedToUtc(cur.date, cur.start_time, tz()).getTime();
  const after = zonedToUtc(next.date, next.startTime, tz()).getTime();
  const deltaMinutes = Math.round((after - before) / 60000);
  db().tx(() => {
    db().run(
      'UPDATE events SET date = ?, start_time = ?, end_time = ?, title = ?, location = ?, owner_id = ?, week_id = ?, notes = ?, updated_at = ? WHERE id = ?',
      next.date,
      next.startTime,
      next.endTime,
      next.title,
      next.location,
      next.ownerId ?? null,
      weekForDate(next.date),
      next.notes,
      nowIso(),
      id,
    );
    const changes: string[] = [];
    if (deltaMinutes !== 0) changes.push(`הוזז ל-${shortDate(next.date)} ${next.startTime}`);
    if (next.location !== cur.location) changes.push(`מיקום: ${next.location || 'ללא'}`);
    if (next.ownerId !== cur.owner_id) changes.push(`אחראי: ${next.ownerId ? getUserRow(next.ownerId)?.display_name : 'ללא'}`);
    if (next.title !== cur.title) changes.push(`שם: ${next.title}`);
    logActivity({ eventId: id, userId: actor.id, action: 'event_updated', text: `${actor.display_name} עדכן את "${next.title}"${changes.length ? `: ${changes.join(', ')}` : ''}` });
    if (deltaMinutes !== 0 || next.location !== cur.location) {
      const owners = queryTasks("t.event_id = ? AND t.status NOT IN ('done', 'cancelled')", id).map((t) => t.owner_id);
      notify(
        [next.ownerId, ...owners],
        { type: 'event_changed', category: 'info', title: `שינוי בלו"ז: "${next.title}"`, body: changes.join(', '), link: `/schedule?date=${next.date}&event=${id}` },
        actor.id,
      );
    }
  });
  changed('events', 'tasks');
  const affectedTasks = deltaMinutes !== 0 ? queryTasks('t.event_id = ?', id).filter((t) => isOpenStatus(t.status)).map((t) => toTask(t)) : [];
  return { affectedTasks, deltaMinutes };
}

export const shiftSchema = z.object({
  taskIds: z.array(z.number().int().positive()),
  deltaMinutes: z.number().int().min(-60 * 24 * 60).max(60 * 24 * 60),
});

export function shiftEventTasks(actor: UserRow, id: number, raw: z.input<typeof shiftSchema>): number {
  const ev = eventRow(id);
  if (!canManageEvent(actor, ev)) throw forbidden();
  const input = shiftSchema.parse(raw);
  let n = 0;
  db().tx(() => {
    for (const tid of input.taskIds) {
      const t = queryTasks('t.id = ? AND t.event_id = ?', tid, id)[0];
      if (!t || !isOpenStatus(t.status)) continue;
      const deadline = new Date(Date.parse(t.deadline) + input.deltaMinutes * 60000).toISOString();
      updateTask(actor, tid, { deadline }, true, `בעקבות שינוי בפעילות "${ev.title}"`);
      n++;
    }
  });
  return n;
}

export const cancelEventSchema = z.object({
  taskAction: z.enum(['cancel', 'move', 'keep']),
  newDate: z.string().refine(isDateKey).optional(),
  newStartTime: z.string().regex(timeRe).optional(),
  reason: z.string().trim().max(500).optional(),
});

/** Section 67: what happens to linked tasks when an activity is cancelled. */
export function cancelEvent(actor: UserRow, id: number, raw: z.input<typeof cancelEventSchema>): void {
  const ev = eventRow(id);
  if (!canManageEvent(actor, ev)) throw forbidden();
  const input = cancelEventSchema.parse(raw);
  const open = queryTasks("t.event_id = ? AND t.status NOT IN ('done', 'cancelled')", id);
  if (input.taskAction === 'move') {
    if (!input.newDate) throw badRequest('יש לבחור תאריך חדש');
    const { deltaMinutes } = updateEvent(actor, id, { date: input.newDate, startTime: input.newStartTime ?? ev.start_time });
    if (deltaMinutes !== 0) shiftEventTasks(actor, id, { taskIds: open.map((t) => t.id), deltaMinutes });
    return;
  }
  const reason = input.reason || `הפעילות "${ev.title}" בוטלה`;
  db().tx(() => {
    db().run('UPDATE events SET cancelled = 1, updated_at = ? WHERE id = ?', nowIso(), id);
    for (const t of open) {
      if (input.taskAction === 'cancel') {
        db().run("UPDATE tasks SET status = 'cancelled', cancel_reason = ?, needs_commander = 0 WHERE id = ?", reason, t.id);
        logActivity({ taskId: t.id, weekId: t.week_id, userId: actor.id, action: 'cancelled', text: `${actor.display_name} ביטל את המשימה: ${reason}` });
      } else {
        db().run('UPDATE tasks SET event_id = NULL WHERE id = ?', t.id);
        logActivity({ taskId: t.id, weekId: t.week_id, userId: actor.id, action: 'event', text: `הפעילות "${ev.title}" בוטלה - המשימה נשמרה כמשימה עצמאית` });
      }
    }
    logActivity({
      eventId: id,
      userId: actor.id,
      action: 'event_cancelled',
      text: `${actor.display_name} ביטל את "${ev.title}" (${shortDate(ev.date)})${open.length ? ` · ${open.length} משימות ${input.taskAction === 'cancel' ? 'בוטלו' : 'נשמרו כעצמאיות'}` : ''}`,
    });
    notify(
      [ev.owner_id, ...open.map((t) => t.owner_id)],
      { type: 'event_cancelled', category: 'info', title: `הפעילות "${ev.title}" בוטלה`, body: reason, link: `/schedule?date=${ev.date}` },
      actor.id,
    );
  });
  changed('events', 'tasks');
}

export function restoreEvent(actor: UserRow, id: number): void {
  const ev = eventRow(id);
  if (!canManageEvent(actor, ev)) throw forbidden();
  db().tx(() => {
    db().run('UPDATE events SET cancelled = 0, updated_at = ? WHERE id = ?', nowIso(), id);
    logActivity({ eventId: id, userId: actor.id, action: 'event_restored', text: `${actor.display_name} החזיר את "${ev.title}" ללו"ז` });
  });
  changed('events');
}

export function deleteEvent(actor: UserRow, id: number): void {
  const ev = eventRow(id);
  if (!canManageEvent(actor, ev)) throw forbidden();
  db().tx(() => {
    logActivity({ userId: actor.id, action: 'event_deleted', text: `${actor.display_name} מחק את "${ev.title}" מהלו"ז (${shortDate(ev.date)})` });
    db().run('DELETE FROM events WHERE id = ?', id);
  });
  changed('events', 'tasks');
}
