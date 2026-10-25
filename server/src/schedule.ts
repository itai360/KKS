// Daily schedule (22) and its link to tasks (23, 66, 67). An event is one day with its hours - or all day,
// over one day or several; it may have a colour of its own, and may be one of a repeating series, each
// of whose events is a whole event (shared/eventSeries.ts).

import { z } from 'zod';
import { CAL_COLORS } from '../../shared/calendarLayers';
import { isOpenStatus } from '../../shared/constants';
import { addDays, diffDays, isDateKey, shortDate, zonedToUtc } from '../../shared/dates';
import { REPEAT_FREQS, repeatText, seriesDates } from '../../shared/eventSeries';
import { followEvent } from './cadets';
import type { EventDetail, ScheduleEvent, Task } from '../../shared/types';
import { getUserRow, type UserRow } from './auth';
import { badRequest, forbidden, notFound, nowIso, patchSchema, tz } from './core';
import { db } from './db';
import { changed, logActivity, notify } from './journal';
import { queryTasks, toTask, visibleTasks } from './taskRepo';
import { listAttachments, updateTask, weekForDate } from './taskService';
import { listDebriefs } from './debriefs';
import { may } from './abilities';

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
  end_date: string | null;
  all_day: number;
  color: string | null;
  series_id: number | null;
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
    endDate: r.end_date,
    allDay: !!r.all_day,
    color: r.color,
    seriesId: r.series_id,
  };
}

/** The events of some days: those that start in them, and those of several days that run into them. */
export function listEvents(from: string, to: string, includeCancelled = true): ScheduleEvent[] {
  return db()
    .all<EventRow>(
      `${EVENT_BASE} WHERE e.date <= ? AND COALESCE(e.end_date, e.date) >= ? ${includeCancelled ? '' : 'AND e.cancelled = 0'} ORDER BY e.date, e.all_day DESC, e.start_time`,
      to,
      from,
    )
    .map(toEvent);
}

/**
 * The events of some days as one person reads them: each with how many of its preparation tasks are
 * theirs (in charge, or taking part) - so "only mine" in the schedule finds an event they prepare for
 * as well as one they run.
 */
export function listEventsFor(actor: UserRow, from: string, to: string): ScheduleEvent[] {
  const mine = new Map(
    db()
      .all<{ id: number; n: number }>(
        `SELECT t.event_id AS id, count(*) AS n FROM tasks t JOIN events e ON e.id = t.event_id
         WHERE e.date >= ? AND e.date <= ? AND t.status <> 'cancelled'
           AND (t.owner_id = ? OR EXISTS (SELECT 1 FROM task_participants p WHERE p.task_id = t.id AND p.user_id = ?))
         GROUP BY t.event_id`,
        from,
        to,
        actor.id,
        actor.id,
      )
      .map((r) => [r.id, r.n]),
  );
  return listEvents(from, to).map((e) => ({ ...e, myTasks: mine.get(e.id) ?? 0 }));
}

function eventRow(id: number): EventRow {
  const r = db().get<EventRow>(`${EVENT_BASE} WHERE e.id = ?`, id);
  if (!r) throw notFound('הפעילות לא נמצאה');
  return r;
}

export function eventDetail(actor: UserRow, id: number): EventDetail {
  const r = eventRow(id);
  return {
    event: toEvent(r),
    tasks: visibleTasks(actor, 't.event_id = ?', id),
    attachments: listAttachments('a.event_id = ?', id),
    debriefs: listDebriefs(actor, { eventId: id }),
  };
}

function weekLeadOn(dateKey: string): number | null {
  const wid = weekForDate(dateKey);
  return wid ? (db().get<{ lead_id: number | null }>('SELECT lead_id FROM weeks WHERE id = ?', wid)?.lead_id ?? null) : null;
}

/** Commander, the week's lead, the event owner or its creator manage an event. */
export function canManageEvent(actor: UserRow, e: Pick<EventRow, 'date' | 'owner_id' | 'created_by'>): boolean {
  return may(actor, 'schedule') || e.owner_id === actor.id || e.created_by === actor.id || weekLeadOn(e.date) === actor.id;
}

/** an event of several days runs up to two months */
export const MAX_EVENT_DAYS = 62;

export const eventSchema = z.object({
  date: z.string().refine(isDateKey, 'תאריך לא תקין'),
  startTime: z.string().regex(timeRe, 'שעה לא תקינה'),
  endTime: z.string().regex(timeRe, 'שעה לא תקינה').nullable().optional().or(z.literal('')),
  title: z.string().trim().min(1, 'חובה למלא שם פעילות').max(200),
  location: z.string().max(200).optional().default(''),
  ownerId: z.number().int().positive().nullable().optional(),
  notes: z.string().max(4000).optional().default(''),
  /** all day: no hours of its own (stored as 00:00) */
  allDay: z.boolean().optional().default(false),
  /** all day over several days: the last of them */
  endDate: z.string().refine(isDateKey, 'תאריך סיום לא תקין').nullable().optional(),
  color: z.enum(CAL_COLORS).nullable().optional(),
});

/** repeating: how often and up to which day (a new event only) */
export const repeatSchema = z.object({
  freq: z.enum(REPEAT_FREQS),
  interval: z.number().int().min(1).max(12).optional().default(1),
  until: z.string().refine(isDateKey, 'תאריך סיום החזרה לא תקין'),
});

/** what changing or deleting one event of a series takes with it */
export const SERIES_SCOPES = ['one', 'following', 'all'] as const;
export type SeriesScope = (typeof SERIES_SCOPES)[number];

/** all day, its days, its hours: what is stored, after the checks (null: as it was) */
function daysAndHours(e: { date: string; allDay: boolean; endDate?: string | null; startTime: string; endTime?: string | null }): { endDate: string | null; startTime: string; endTime: string | null } {
  if (!e.allDay) {
    if (e.endDate && e.endDate !== e.date) throw badRequest('אירוע של כמה ימים הוא אירוע של יום שלם - סמנו "כל היום"');
    return { endDate: null, startTime: e.startTime, endTime: e.endTime || null };
  }
  const end = e.endDate && e.endDate !== e.date ? e.endDate : null;
  if (end && end < e.date) throw badRequest('היום האחרון לפני היום הראשון');
  if (end && diffDays(end, e.date) > MAX_EVENT_DAYS) throw badRequest(`אירוע אחד נמשך עד ${MAX_EVENT_DAYS} ימים`);
  return { endDate: end, startTime: '00:00', endTime: null };
}

/** how an event's time reads in the log and in notifications */
const whenOf = (date: string, allDay: boolean, startTime: string, endDate: string | null) =>
  allDay ? `${shortDate(date)}${endDate ? ` - ${shortDate(endDate)}` : ''}, כל היום` : `${shortDate(date)} ${startTime}`;

export function createEvent(actor: UserRow, raw: z.input<typeof eventSchema> & { repeat?: z.input<typeof repeatSchema> | null }): number {
  const e = eventSchema.parse(raw);
  const repeat = raw.repeat ? repeatSchema.parse(raw.repeat) : null;
  if (!may(actor, 'schedule') && weekLeadOn(e.date) !== actor.id && e.ownerId !== actor.id) {
    throw forbidden('רק מפקד הקורס או מפק"צ השבוע יכולים להוסיף אירועים ללו"ז');
  }
  if (e.ownerId && !getUserRow(e.ownerId)?.active) throw badRequest('האחראי שנבחר אינו פעיל');
  const { endDate, startTime, endTime } = daysAndHours(e);
  const days = repeat ? seriesDates(e.date, repeat) : [e.date];
  if (repeat && repeat.until < e.date) throw badRequest('תאריך סיום החזרה לפני האירוע הראשון');
  if (!days.length) throw badRequest('אין אף יום שבו האירוע חוזר');
  // a series: each day (a week lead's own week, or anyone's own event, as for one) - checked for every day
  if (repeat && !may(actor, 'schedule') && e.ownerId !== actor.id && days.some((d) => weekLeadOn(d) !== actor.id)) {
    throw forbidden('אירוע חוזר מחוץ לשבוע שלך - רק מפקד הקורס, או כשאתה האחראי עליו');
  }
  const span = endDate ? diffDays(endDate, e.date) : 0;
  const at = nowIso();
  const id = db().tx(() => {
    const seriesId = repeat
      ? db().run('INSERT INTO event_series(freq, interval, until, created_by, created_at) VALUES (?, ?, ?, ?, ?)', repeat.freq, repeat.interval, days[days.length - 1], actor.id, at).id
      : null;
    let first = 0;
    for (const d of days) {
      const id = db().run(
        `INSERT INTO events(date, start_time, end_time, title, location, owner_id, week_id, notes, created_by, created_at, updated_at, end_date, all_day, color, series_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        d,
        startTime,
        endTime,
        e.title,
        e.location,
        e.ownerId ?? null,
        weekForDate(d),
        e.notes,
        actor.id,
        at,
        at,
        span ? addDays(d, span) : null,
        e.allDay ? 1 : 0,
        e.color ?? null,
        seriesId,
      ).id;
      first ||= id;
    }
    const when = whenOf(e.date, e.allDay, startTime, endDate);
    logActivity({
      eventId: first,
      userId: actor.id,
      action: 'event_created',
      text: repeat
        ? `${actor.display_name} הוסיף ללו"ז אירוע חוזר: ${e.title} (${repeatText(repeat)}, ${days.length} אירועים, מ-${shortDate(days[0])} עד ${shortDate(days[days.length - 1])})`
        : `${actor.display_name} הוסיף ללו"ז: ${e.title} (${when})`,
    });
    if (e.ownerId) {
      notify(
        [e.ownerId],
        { type: 'event_owner', category: 'info', title: `מונית לאחראי על "${e.title}"`, body: repeat ? `${repeatText(repeat)} · ${days.length} אירועים` : when, link: `/schedule?date=${e.date}&event=${first}` },
        actor.id,
      );
    }
    return first;
  });
  changed('events');
  return id;
}

/** the events a change or a deletion takes: this one, this one and the series' later ones, or the whole series */
function scopeRows(cur: EventRow, scope: SeriesScope): EventRow[] {
  if (scope === 'one' || !cur.series_id) return [cur];
  return db().all<EventRow>(`${EVENT_BASE} WHERE e.series_id = ? ${scope === 'following' ? 'AND e.date >= ?' : ''} ORDER BY e.date`, ...(scope === 'following' ? [cur.series_id, cur.date] : [cur.series_id]));
}

/**
 * Section 66: returns the open tasks that may be affected by the change. One of a series: `scope` takes
 * the change to the series' later events too, or to all of it - a move by days moves each of them by
 * as many days, and the rest of what changed is set on each.
 */
export function updateEvent(actor: UserRow, id: number, raw: Partial<z.input<typeof eventSchema>>, scope: SeriesScope = 'one'): { affectedTasks: Task[]; deltaMinutes: number } {
  const cur = eventRow(id);
  if (!canManageEvent(actor, cur)) throw forbidden();
  const patch = patchSchema(eventSchema).parse(raw);
  const allDay = patch.allDay ?? !!cur.all_day;
  const date = patch.date ?? cur.date;
  // the last day: as given, or as long as it was (a move keeps an event of days as long)
  const curSpan = cur.end_date ? diffDays(cur.end_date, cur.date) : 0;
  const endGiven = patch.endDate !== undefined ? patch.endDate : allDay && curSpan ? addDays(date, curSpan) : null;
  const hours = daysAndHours({
    date,
    allDay,
    endDate: endGiven,
    startTime: patch.startTime ?? (allDay === !!cur.all_day ? cur.start_time : '08:00'),
    endTime: patch.endTime !== undefined ? patch.endTime : allDay === !!cur.all_day ? cur.end_time : null,
  });
  const next = {
    date,
    startTime: hours.startTime,
    endTime: hours.endTime,
    endDate: hours.endDate,
    allDay,
    color: patch.color !== undefined ? patch.color : (cur.color as (typeof CAL_COLORS)[number] | null),
    title: patch.title ?? cur.title,
    location: patch.location ?? cur.location,
    ownerId: patch.ownerId !== undefined ? patch.ownerId : cur.owner_id,
    notes: patch.notes ?? cur.notes,
  };
  if (next.ownerId && next.ownerId !== cur.owner_id && !getUserRow(next.ownerId)?.active) throw badRequest('האחראי שנבחר אינו פעיל');
  const before = zonedToUtc(cur.date, cur.start_time, tz()).getTime();
  const after = zonedToUtc(next.date, next.startTime, tz()).getTime();
  const deltaMinutes = Math.round((after - before) / 60000);
  const dayShift = diffDays(next.date, cur.date);
  const rows = scopeRows(cur, scope);
  for (const r of rows) if (r.id !== cur.id && !canManageEvent(actor, r)) throw forbidden('אין לך הרשאה לשנות חלק מהאירועים בסדרה');
  db().tx(() => {
    for (const r of rows) {
      const d = r.id === cur.id ? next.date : addDays(r.date, dayShift);
      db().run(
        'UPDATE events SET date = ?, start_time = ?, end_time = ?, end_date = ?, all_day = ?, color = ?, title = ?, location = ?, owner_id = ?, week_id = ?, notes = ?, updated_at = ? WHERE id = ?',
        d,
        next.startTime,
        next.endTime,
        next.endDate ? addDays(d, diffDays(next.endDate, next.date)) : null,
        next.allDay ? 1 : 0,
        next.color ?? null,
        next.title,
        next.location,
        next.ownerId ?? null,
        weekForDate(d),
        next.notes,
        nowIso(),
        r.id,
      );
      // the roles cadets hold in it (experiences) go with it to its new day
      if (d !== r.date) followEvent(actor, r.id, diffDays(d, r.date));
    }
    const changes: string[] = [];
    if (deltaMinutes !== 0 || next.allDay !== !!cur.all_day || next.endDate !== cur.end_date) changes.push(`הוזז ל-${whenOf(next.date, next.allDay, next.startTime, next.endDate)}`);
    if (next.location !== cur.location) changes.push(`מיקום: ${next.location || 'ללא'}`);
    if (next.ownerId !== cur.owner_id) changes.push(`אחראי: ${next.ownerId ? getUserRow(next.ownerId)?.display_name : 'ללא'}`);
    if (next.title !== cur.title) changes.push(`שם: ${next.title}`);
    const many = rows.length > 1 ? ` (${rows.length} אירועים בסדרה)` : '';
    logActivity({ eventId: id, userId: actor.id, action: 'event_updated', text: `${actor.display_name} עדכן את "${next.title}"${many}${changes.length ? `: ${changes.join(', ')}` : ''}` });
    if (deltaMinutes !== 0 || next.location !== cur.location) {
      const owners = rows.flatMap((r) => queryTasks("t.event_id = ? AND t.status NOT IN ('done', 'cancelled')", r.id).map((t) => t.owner_id));
      notify(
        [next.ownerId, ...owners],
        { type: 'event_changed', category: 'info', title: `שינוי בלו"ז: "${next.title}"${many}`, body: changes.join(', '), link: `/schedule?date=${next.date}&event=${id}` },
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

/** One event - or, of a series, it and the later ones, or all of it. */
export function deleteEvent(actor: UserRow, id: number, scope: SeriesScope = 'one'): number {
  const ev = eventRow(id);
  if (!canManageEvent(actor, ev)) throw forbidden();
  const rows = scopeRows(ev, scope);
  for (const r of rows) if (!canManageEvent(actor, r)) throw forbidden('אין לך הרשאה למחוק חלק מהאירועים בסדרה');
  db().tx(() => {
    logActivity({
      userId: actor.id,
      action: 'event_deleted',
      text: rows.length > 1 ? `${actor.display_name} מחק ${rows.length} אירועים של "${ev.title}" מהלו"ז (מ-${shortDate(rows[0].date)})` : `${actor.display_name} מחק את "${ev.title}" מהלו"ז (${shortDate(ev.date)})`,
    });
    for (const r of rows) db().run('DELETE FROM events WHERE id = ?', r.id);
  });
  changed('events', 'tasks');
  return rows.length;
}
