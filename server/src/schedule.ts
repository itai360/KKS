// The calendar's events (22) and their link to tasks (23, 66, 67), kept as Google Calendar keeps them:
// - an event is one day with its hours, or all day over one day or several; a colour of its own;
// - a repeating event is a recurrence rule (shared/rrule.ts) on a series, and each of its days is a row
//   of its own up to a rolling horizon - its own preparation tasks, files and debrief. A day changed on
//   its own keeps what was changed in it when the whole series changes (as Google keeps an exception);
// - guests from the staff with their answers; reminders; the course's calendar or one's own; busy or
//   free; private; and the trash, from which an event comes back for 30 days.

import { z } from 'zod';
import { CAL_COLORS } from '../../shared/calendarLayers';
import { isOpenStatus } from '../../shared/constants';
import { addDays, diffDays, isDateKey, localDateKey, shortDate, zonedToUtc } from '../../shared/dates';
import { REPEAT_FREQS } from '../../shared/eventSeries';
import { matchesSearch, searchKey } from '../../shared/search';
import { countBefore, describeRRule, endBefore, expandRRule, formatRRule, lastOccurrence, parseRRule, placeInMonth, rruleFromRepeat, WEEKDAYS, type RRule } from '../../shared/rrule';
import { followEvent } from './cadets';
import type { EventCalendar, EventDetail, EventGuest, EventReminder, GuestResponse, ScheduleEvent, Task, TrashedEvent } from '../../shared/types';
import { getUserRow, type UserRow } from './auth';
import { badRequest, clock, forbidden, notFound, nowIso, patchSchema, tz } from './core';
import { db } from './db';
import { changed, logActivity, notificationsChanged, notify } from './journal';
import { queryTasks, toTask, visibleTasks } from './taskRepo';
import { listAttachments, updateTask, weekForDate } from './taskService';
import { listDebriefs } from './debriefs';
import { may } from './abilities';

const timeRe = /^([01]\d|2[0-3]):[0-5]\d$/;

/** the days of a series kept as rows ahead of today (and grown day by day) */
export const HORIZON_DAYS = 366;
/** how long a deleted event waits in the trash */
export const TRASH_DAYS = 30;
/** the longest reminder: four weeks before */
export const MAX_REMINDER_MINUTES = 4 * 7 * 24 * 60;
/** a reminder is sent until the event starts; one found later than this past its time is dropped */
const REMINDER_LATE_MS = 15 * 60_000;

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
  created_by_name: string | null;
  created_at: string;
  updated_at: string;
  end_date: string | null;
  all_day: number;
  color: string | null;
  series_id: number | null;
  recurrence_id: number | null;
  original_date: string | null;
  detached: number;
  calendar: EventCalendar;
  transparency: 'opaque' | 'transparent';
  visibility: 'default' | 'public' | 'private';
  reminders: string | null;
  guests_can_modify: number;
  guests_can_invite: number;
  guests_can_see: number;
  deleted_at: string | null;
  deleted_by: number | null;
  rrule: string | null;
  rrule_start: string | null;
  task_total: number;
  task_done: number;
}

const EVENT_BASE = `
SELECT e.*, u.display_name AS owner_name, c.display_name AS created_by_name, r.rrule AS rrule, r.dtstart AS rrule_start,
  (SELECT count(*) FROM tasks t WHERE t.event_id = e.id AND t.status <> 'cancelled') AS task_total,
  (SELECT count(*) FROM tasks t WHERE t.event_id = e.id AND t.status = 'done') AS task_done
FROM events e LEFT JOIN users u ON u.id = e.owner_id LEFT JOIN users c ON c.id = e.created_by LEFT JOIN event_recurrences r ON r.id = e.recurrence_id
`;
/** not in the trash */
const LIVE = 'e.deleted_at IS NULL';

/** what a day of a series changed on its own (the bits of `detached`) - a change to the whole series passes them by */
const OWN = { time: 1, title: 2, location: 4, notes: 8, owner: 16, color: 32, guests: 64, reminders: 128, other: 256 } as const;

function parseReminders(raw: string | null): EventReminder[] | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as EventReminder[];
    return Array.isArray(v) ? v.filter((r) => Number.isInteger(r?.minutes) && r.minutes >= 0) : null;
  } catch {
    return null;
  }
}

function recurrenceText(rrule: string | null, start: string | null): string | null {
  if (!rrule || !start) return null;
  const rule = parseRRule(rrule, tz());
  return rule ? describeRRule(rule, start) : null;
}

function toEvent(r: EventRow, guests: EventGuest[] = []): ScheduleEvent {
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
    seriesId: r.recurrence_id,
    recurrence: r.rrule,
    recurrenceText: recurrenceText(r.rrule, r.rrule_start),
    detached: !!r.detached,
    calendar: r.calendar,
    transparency: r.transparency,
    visibility: r.visibility,
    reminders: parseReminders(r.reminders),
    guests,
    guestsCanModify: !!r.guests_can_modify,
    guestsCanInvite: !!r.guests_can_invite,
    guestsCanSee: !!r.guests_can_see,
    createdBy: r.created_by,
    createdByName: r.created_by_name,
  };
}

interface GuestRow {
  event_id: number;
  user_id: number;
  name: string;
  response: GuestResponse;
  optional: number;
}

/** the guests of the events of some days, by event */
function guestsInRange(from: string, to: string): Map<number, EventGuest[]> {
  const out = new Map<number, EventGuest[]>();
  const rows = db().all<GuestRow>(
    `SELECT g.event_id, g.user_id, u.display_name AS name, g.response, g.optional FROM event_guests g
     JOIN events e ON e.id = g.event_id JOIN users u ON u.id = g.user_id
     WHERE e.date <= ? AND COALESCE(e.end_date, e.date) >= ? ORDER BY g.event_id, u.display_name`,
    to,
    from,
  );
  for (const g of rows) {
    const list = out.get(g.event_id) ?? [];
    list.push({ userId: g.user_id, name: g.name, response: g.response, ...(g.optional ? { optional: true } : {}) });
    out.set(g.event_id, list);
  }
  return out;
}

function guestsOf(eventId: number): EventGuest[] {
  return db()
    .all<GuestRow>('SELECT g.event_id, g.user_id, u.display_name AS name, g.response, g.optional FROM event_guests g JOIN users u ON u.id = g.user_id WHERE g.event_id = ? ORDER BY u.display_name', eventId)
    .map((g) => ({ userId: g.user_id, name: g.name, response: g.response, ...(g.optional ? { optional: true } : {}) }));
}

/** The course's events of some days: those that start in them, and those of several days that run into them. */
export function listEvents(from: string, to: string, includeCancelled = true): ScheduleEvent[] {
  return db()
    .all<EventRow>(
      `${EVENT_BASE} WHERE ${LIVE} AND e.calendar = 'course' AND e.date <= ? AND COALESCE(e.end_date, e.date) >= ? ${includeCancelled ? '' : 'AND e.cancelled = 0'} ORDER BY e.date, e.all_day DESC, e.start_time`,
      to,
      from,
    )
    .map((r) => toEvent(r));
}

const isCommanderish = (actor: UserRow) => may(actor, 'schedule');

/** an event as one person reads it: their answer, whether they may change it, and - private - only "busy" */
function forReader(actor: UserRow, r: EventRow, guests: EventGuest[]): ScheduleEvent {
  const mine = guests.find((g) => g.userId === actor.id);
  const editor = canEditRow(actor, r, !!mine);
  const inside = editor || !!mine || r.owner_id === actor.id || r.created_by === actor.id || isCommanderish(actor);
  const shownGuests = r.guests_can_see || editor ? guests : guests.filter((g) => g.userId === actor.id);
  const e = toEvent(r, shownGuests);
  const out: ScheduleEvent = { ...e, myResponse: mine?.response ?? null, canEdit: editor };
  if (r.visibility === 'private' && !inside) {
    // as Google shows another's private event: busy, and nothing of it
    return { ...out, title: 'עסוק', location: '', notes: '', guests: [], ownerName: null, hidden: true, canEdit: false };
  }
  return out;
}

/**
 * The events of some days as one person reads them: the course's, their own calendar's and those they
 * are invited to - each with their answer, and how many of its preparation tasks are theirs (in charge
 * or taking part), so "only mine" finds an event they prepare for as well as one they run.
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
  const guests = guestsInRange(from, to);
  return db()
    .all<EventRow>(
      `${EVENT_BASE} WHERE ${LIVE} AND e.date <= ? AND COALESCE(e.end_date, e.date) >= ?
         AND (e.calendar = 'course' OR e.created_by = ? OR EXISTS (SELECT 1 FROM event_guests g WHERE g.event_id = e.id AND g.user_id = ?))
       ORDER BY e.date, e.all_day DESC, e.start_time`,
      to,
      from,
      actor.id,
      actor.id,
    )
    .map((r) => ({ ...forReader(actor, r, guests.get(r.id) ?? []), myTasks: mine.get(r.id) ?? 0 }));
}

/**
 * The search over the events, as Google Calendar's: every word typed somewhere in the title, the place,
 * the notes, who is in charge or a guest's name - the way the app searches everywhere (final letters,
 * quote marks and case aside). Only what the reader may see, and not what a private event keeps from
 * them; by date, at most 500.
 */
export function searchEvents(actor: UserRow, q: string, from: string, to: string): ScheduleEvent[] {
  if (!searchKey(q)) return [];
  return listEventsFor(actor, from, to)
    .filter((e) => !e.hidden && matchesSearch(q, e.title, e.location, e.notes, e.ownerName, ...(e.guests ?? []).map((g) => g.name)))
    .slice(0, 500);
}

function eventRow(id: number, withTrash = false): EventRow {
  const r = db().get<EventRow>(`${EVENT_BASE} WHERE e.id = ? ${withTrash ? '' : `AND ${LIVE}`}`, id);
  if (!r) throw notFound('הפעילות לא נמצאה');
  return r;
}

/** one may see it: the course's, or of one's own calendar, or invited to it */
function canSeeRow(actor: UserRow, r: EventRow): boolean {
  return r.calendar === 'course' || r.created_by === actor.id || !!db().get('SELECT 1 FROM event_guests WHERE event_id = ? AND user_id = ?', r.id, actor.id);
}

export function eventDetail(actor: UserRow, id: number): EventDetail {
  const r = eventRow(id);
  if (!canSeeRow(actor, r)) throw notFound('הפעילות לא נמצאה');
  const event = forReader(actor, r, guestsOf(id));
  if (event.hidden) return { event, tasks: [], attachments: [], debriefs: [] };
  return {
    event,
    tasks: visibleTasks(actor, 't.event_id = ?', id),
    attachments: listAttachments('a.event_id = ?', id),
    debriefs: listDebriefs(actor, { eventId: id }),
  };
}

function weekLeadOn(dateKey: string): number | null {
  const wid = weekForDate(dateKey);
  return wid ? (db().get<{ lead_id: number | null }>('SELECT lead_id FROM weeks WHERE id = ?', wid)?.lead_id ?? null) : null;
}

/**
 * Who manages an event. The course's: the commander (and whoever has the schedule), the week's lead,
 * the event's owner or its maker. One's own calendar's: its maker. And a guest, when guests may change it.
 */
export function canManageEvent(actor: UserRow, e: { id?: number; date: string; owner_id: number | null; created_by: number | null; calendar?: EventCalendar; guests_can_modify?: number }): boolean {
  const guestMay = () => !!e.guests_can_modify && !!e.id && !!db().get('SELECT 1 FROM event_guests WHERE event_id = ? AND user_id = ?', e.id, actor.id);
  if ((e.calendar ?? 'course') === 'personal') return e.created_by === actor.id || guestMay();
  return may(actor, 'schedule') || e.owner_id === actor.id || e.created_by === actor.id || weekLeadOn(e.date) === actor.id || guestMay();
}

function canEditRow(actor: UserRow, r: EventRow, isGuest: boolean): boolean {
  if (r.calendar === 'personal') return r.created_by === actor.id || (isGuest && !!r.guests_can_modify);
  return may(actor, 'schedule') || r.owner_id === actor.id || r.created_by === actor.id || weekLeadOn(r.date) === actor.id || (isGuest && !!r.guests_can_modify);
}

/** an event of several days runs up to two months */
export const MAX_EVENT_DAYS = 62;

const reminderSchema = z.object({ minutes: z.number().int().min(0).max(MAX_REMINDER_MINUTES) });
const guestSchema = z.object({ userId: z.number().int().positive(), optional: z.boolean().optional() });

export const eventSchema = z.object({
  date: z.string().refine(isDateKey, 'תאריך לא תקין'),
  startTime: z.string().regex(timeRe, 'שעה לא תקינה'),
  endTime: z.string().regex(timeRe, 'שעה לא תקינה').nullable().optional().or(z.literal('')),
  title: z.string().trim().min(1, 'חובה למלא שם פעילות').max(200),
  location: z.string().max(200).optional().default(''),
  ownerId: z.number().int().positive().nullable().optional(),
  notes: z.string().max(8000).optional().default(''),
  /** all day: no hours of its own (stored as 00:00) */
  allDay: z.boolean().optional().default(false),
  /** all day over several days: the last of them */
  endDate: z.string().refine(isDateKey, 'תאריך סיום לא תקין').nullable().optional(),
  color: z.enum(CAL_COLORS).nullable().optional(),
  /** the course's calendar, or one's own */
  calendar: z.enum(['course', 'personal']).optional(),
  transparency: z.enum(['opaque', 'transparent']).optional(),
  visibility: z.enum(['default', 'public', 'private']).optional(),
  /** null: the default */
  reminders: z.array(reminderSchema).max(5).nullable().optional(),
  guests: z.array(guestSchema).max(300).optional(),
  guestsCanModify: z.boolean().optional(),
  guestsCanInvite: z.boolean().optional(),
  guestsCanSee: z.boolean().optional(),
  /** a recurrence rule (RRULE) - a new event, or a change to the series from this day on or to all of it */
  recurrence: z.string().trim().max(500).nullable().optional(),
});

/** repeating, the old way: how often and up to which day (a new event only) */
export const repeatSchema = z.object({
  freq: z.enum(REPEAT_FREQS),
  interval: z.number().int().min(1).max(12).optional().default(1),
  until: z.string().refine(isDateKey, 'תאריך סיום החזרה לא תקין'),
});

/** what changing or deleting one event of a series takes with it */
export const SERIES_SCOPES = ['one', 'following', 'all'] as const;
export type SeriesScope = (typeof SERIES_SCOPES)[number];

/** all day, its days, its hours: what is stored, after the checks */
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

const today = () => localDateKey(clock.now(), tz());

function readRule(raw: string): RRule {
  const rule = parseRRule(raw, tz());
  if (!rule) throw badRequest('חוק החזרה לא תקין');
  return rule;
}

/** the guests, as given: active staff, each once */
function cleanGuests(list: { userId: number; optional?: boolean }[] | undefined): { userId: number; optional: boolean }[] {
  const out = new Map<number, boolean>();
  for (const g of list ?? []) {
    if (out.has(g.userId)) continue;
    if (!getUserRow(g.userId)?.active) throw badRequest('אחד האורחים אינו פעיל');
    out.set(g.userId, !!g.optional);
  }
  return [...out].map(([userId, optional]) => ({ userId, optional }));
}

// ---------------- a series ----------------

/** what each new day of a series is made of */
interface Template {
  title: string;
  location: string;
  ownerId: number | null;
  notes: string;
  color: string | null;
  allDay: boolean;
  startTime: string;
  endTime: string | null;
  spanDays: number;
  calendar: EventCalendar;
  transparency: 'opaque' | 'transparent';
  visibility: 'default' | 'public' | 'private';
  reminders: EventReminder[] | null;
  guests: { userId: number; optional: boolean }[];
  /** answers given to the whole series, for its new days */
  responses: Record<string, GuestResponse>;
  guestsCanModify: boolean;
  guestsCanInvite: boolean;
  guestsCanSee: boolean;
}

interface RecurrenceRow {
  id: number;
  rrule: string;
  dtstart: string;
  exdates: string;
  horizon: string;
  template: string;
  created_by: number | null;
  created_at: string;
  deleted_at: string | null;
  prev_rrule: string | null;
}

function recurrence(id: number): RecurrenceRow {
  const r = db().get<RecurrenceRow>('SELECT * FROM event_recurrences WHERE id = ?', id);
  if (!r) throw notFound('הסדרה לא נמצאה');
  return r;
}
const exdatesOf = (r: RecurrenceRow): string[] => {
  try {
    return JSON.parse(r.exdates) as string[];
  } catch {
    return [];
  }
};
const templateOf = (r: RecurrenceRow): Template => JSON.parse(r.template) as Template;

/** where the rows of a series end: a year ahead of today (or of its start), no further than its last day */
function horizonFor(rule: RRule, start: string): string {
  const base = start > today() ? start : today();
  const far = addDays(base, HORIZON_DAYS);
  const last = lastOccurrence(rule, start);
  return last && last < far ? last : far;
}

/** inserts the days of a series from the day after its horizon up to `upTo`; returns the first new id */
function materialize(recId: number, upTo: string): number {
  const rec = recurrence(recId);
  if (rec.deleted_at) return 0;
  const rule = readRule(rec.rrule);
  const from = rec.horizon < rec.dtstart ? rec.dtstart : addDays(rec.horizon, 1);
  const t = templateOf(rec);
  let first = 0;
  if (from <= upTo) {
    const at = nowIso();
    for (const d of expandRRule(rule, rec.dtstart, from, upTo, exdatesOf(rec))) {
      const id = insertRow(t, d, rec.created_by, at, recId);
      first ||= id;
    }
  }
  if (upTo > rec.horizon) db().run('UPDATE event_recurrences SET horizon = ? WHERE id = ?', upTo, recId);
  return first;
}

/** one day of a series (or a single event) as a row, with its guests; 0 when that day is already there */
function insertRow(t: Template, d: string, createdBy: number | null, at: string, recId: number | null): number {
  const res = db().run(
    `INSERT OR IGNORE INTO events(date, start_time, end_time, title, location, owner_id, week_id, notes, created_by, created_at, updated_at, end_date, all_day, color,
       recurrence_id, original_date, calendar, transparency, visibility, reminders, guests_can_modify, guests_can_invite, guests_can_see)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    d,
    t.startTime,
    t.endTime,
    t.title,
    t.location,
    t.ownerId,
    weekForDate(d),
    t.notes,
    createdBy,
    at,
    at,
    t.spanDays ? addDays(d, t.spanDays) : null,
    t.allDay ? 1 : 0,
    t.color,
    recId,
    recId ? d : null,
    t.calendar,
    t.transparency,
    t.visibility,
    t.reminders ? JSON.stringify(t.reminders) : null,
    t.guestsCanModify ? 1 : 0,
    t.guestsCanInvite ? 1 : 0,
    t.guestsCanSee ? 1 : 0,
  );
  if (!res.changes) return 0;
  for (const g of t.guests) {
    const response = t.responses[String(g.userId)] ?? 'needsAction';
    db().run('INSERT OR IGNORE INTO event_guests(event_id, user_id, response, optional) VALUES (?, ?, ?, ?)', res.id, g.userId, response, g.optional ? 1 : 0);
  }
  return res.id;
}

/** Grows each open series up to the horizon (every day, from the scheduler). Returns the days added. */
export function extendRecurrences(): number {
  let added = 0;
  const recs = db().all<RecurrenceRow>('SELECT * FROM event_recurrences WHERE deleted_at IS NULL');
  for (const rec of recs) {
    const rule = parseRRule(rec.rrule, tz());
    if (!rule) continue;
    const upTo = horizonFor(rule, rec.dtstart);
    if (upTo <= rec.horizon) continue;
    const before = db().get<{ n: number }>('SELECT count(*) AS n FROM events WHERE recurrence_id = ?', rec.id)!.n;
    db().tx(() => materialize(rec.id, upTo));
    added += db().get<{ n: number }>('SELECT count(*) AS n FROM events WHERE recurrence_id = ?', rec.id)!.n - before;
  }
  if (added) changed('events');
  return added;
}

/** a day of a series still held by something of its own: tasks, files, a debrief, cadets' roles */
function heldDay(eventId: number): boolean {
  return !!db().get(
    `SELECT 1 WHERE EXISTS (SELECT 1 FROM tasks WHERE event_id = ?) OR EXISTS (SELECT 1 FROM attachments WHERE event_id = ?)
       OR EXISTS (SELECT 1 FROM debriefs WHERE event_id = ?) OR EXISTS (SELECT 1 FROM experiences WHERE event_id = ?)`,
    eventId,
    eventId,
    eventId,
    eventId,
  );
}

/**
 * The series' days after its rule changed: a day the rule no longer has goes (one with tasks, files, a
 * debrief or roles stays, as an event of its own); a day it now has is added.
 */
function regenerate(recId: number, keepId?: number): void {
  const rec = recurrence(recId);
  const rule = readRule(rec.rrule);
  const keep = new Set(expandRRule(rule, rec.dtstart, rec.dtstart, rec.horizon, exdatesOf(rec)));
  const rows = db().all<{ id: number; original_date: string }>(`SELECT id, original_date FROM events e WHERE recurrence_id = ? AND ${LIVE}`, recId);
  for (const r of rows) {
    if (keep.has(r.original_date)) continue;
    // the day being changed stays, as an event of its own, when the new rule leaves it out
    if (r.id === keepId || heldDay(r.id)) db().run('UPDATE events SET recurrence_id = NULL, original_date = NULL, detached = 0 WHERE id = ?', r.id);
    else db().run('DELETE FROM events WHERE id = ?', r.id);
  }
  // the horizon from its start again, so the days it now has are added
  const horizon = rec.horizon;
  db().run('UPDATE event_recurrences SET horizon = ? WHERE id = ?', addDays(rec.dtstart, -1), recId);
  materialize(recId, horizon > horizonFor(rule, rec.dtstart) ? horizon : horizonFor(rule, rec.dtstart));
}

/**
 * The rule when the series moves by some days: its days of the week move with it, and its place in the
 * month or its date in the year follow the new first day.
 */
function moveRule(rule: RRule, newStart: string, dayShift: number): RRule {
  if (!dayShift) return rule;
  const next: RRule = { ...rule };
  if (rule.freq === 'WEEKLY' || rule.freq === 'DAILY') {
    if (rule.byDay?.length) next.byDay = rule.byDay.map((b) => ({ day: WEEKDAYS[(((WEEKDAYS.indexOf(b.day) + dayShift) % 7) + 7) % 7] }));
  } else if (rule.freq === 'MONTHLY' || rule.freq === 'YEARLY') {
    const nth = rule.byDay?.find((b) => b.n);
    if (nth) {
      const { n, last } = placeInMonth(newStart);
      next.byDay = [{ day: WEEKDAYS[new Date(`${newStart}T00:00:00Z`).getUTCDay()], n: nth.n === -1 && last ? -1 : Math.min(n, 4) }];
    } else if (rule.byMonthDay?.length) next.byMonthDay = [Number(newStart.slice(8, 10))];
    if (rule.byMonth?.length) next.byMonth = [Number(newStart.slice(5, 7))];
  }
  // the same days, moved: its last day moves with it
  if (next.until) next.until = addDays(next.until, dayShift);
  if (next.until && next.until < newStart) next.until = newStart;
  return next;
}

/** splits a series at one of its days: from it on, a new series with the rest of the rule. Returns the new series' id. */
function splitAt(recId: number, day: string, actorId: number): number {
  const rec = recurrence(recId);
  const rule = readRule(rec.rrule);
  const rest: RRule = { ...rule };
  if (rule.count) rest.count = Math.max(1, rule.count - countBefore(rule, rec.dtstart, day));
  const at = nowIso();
  const exdates = exdatesOf(rec);
  const newId = db().run(
    'INSERT INTO event_recurrences(rrule, dtstart, exdates, horizon, template, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    formatRRule(rest),
    day,
    JSON.stringify(exdates.filter((d) => d >= day)),
    rec.horizon,
    rec.template,
    actorId,
    at,
    at,
  ).id;
  db().run('UPDATE event_recurrences SET rrule = ?, exdates = ?, horizon = ?, updated_at = ? WHERE id = ?', formatRRule(endBefore(rule, rec.dtstart, day)), JSON.stringify(exdates.filter((d) => d < day)), addDays(day, -1), at, recId);
  db().run('UPDATE events SET recurrence_id = ? WHERE recurrence_id = ? AND original_date >= ?', newId, recId, day);
  return newId;
}

// ---------------- making and changing ----------------

export function createEvent(actor: UserRow, raw: z.input<typeof eventSchema> & { repeat?: z.input<typeof repeatSchema> | null }): number {
  const e = eventSchema.parse(raw);
  const legacy = raw.repeat ? repeatSchema.parse(raw.repeat) : null;
  const rrule = e.recurrence || (legacy ? rruleFromRepeat(legacy) : null);
  const calendar: EventCalendar = e.calendar ?? 'course';
  if (calendar === 'course' && !may(actor, 'schedule') && weekLeadOn(e.date) !== actor.id && e.ownerId !== actor.id) {
    throw forbidden('רק מפקד הקורס או מפק"צ השבוע יכולים להוסיף אירועים ללו"ז הקורס - אפשר להוסיף ליומן האישי');
  }
  if (e.ownerId && !getUserRow(e.ownerId)?.active) throw badRequest('האחראי שנבחר אינו פעיל');
  const { endDate, startTime, endTime } = daysAndHours(e);
  const guests = cleanGuests(e.guests);
  const span = endDate ? diffDays(endDate, e.date) : 0;
  const t: Template = {
    title: e.title,
    location: e.location,
    ownerId: e.ownerId ?? null,
    notes: e.notes,
    color: e.color ?? null,
    allDay: e.allDay,
    startTime,
    endTime,
    spanDays: span,
    calendar,
    transparency: e.transparency ?? (e.allDay ? 'transparent' : 'opaque'),
    visibility: e.visibility ?? 'default',
    reminders: e.reminders ?? null,
    guests,
    responses: {},
    guestsCanModify: e.guestsCanModify ?? false,
    guestsCanInvite: e.guestsCanInvite ?? true,
    guestsCanSee: e.guestsCanSee ?? true,
  };
  const rule = rrule ? readRule(rrule) : null;
  if (rule?.until && rule.until < e.date) throw badRequest('תאריך סיום החזרה לפני האירוע הראשון');
  // a series in the course's calendar beyond one's own week: the commander's, or when one is its owner
  if (rule && calendar === 'course' && !may(actor, 'schedule') && e.ownerId !== actor.id) {
    const last = lastOccurrence(rule, e.date);
    const days = last ? expandRRule(rule, e.date, e.date, last) : null;
    if (!days || days.some((d) => weekLeadOn(d) !== actor.id)) throw forbidden('אירוע חוזר מחוץ לשבוע שלך - רק מפקד הקורס, או כשאתה האחראי עליו');
  }
  const at = nowIso();
  const id = db().tx(() => {
    let first: number;
    if (rule) {
      const recId = db().run(
        'INSERT INTO event_recurrences(rrule, dtstart, exdates, horizon, template, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        formatRRule(rule),
        e.date,
        '[]',
        addDays(e.date, -1),
        JSON.stringify(t),
        actor.id,
        at,
        at,
      ).id;
      first = materialize(recId, horizonFor(rule, e.date));
      if (!first) throw badRequest('אין אף יום שבו האירוע חוזר');
    } else {
      first = insertRow(t, e.date, actor.id, at, null);
    }
    const when = whenOf(e.date, e.allDay, startTime, endDate);
    const ruleText = rule ? describeRRule(rule, e.date) : '';
    logActivity({
      eventId: first,
      userId: actor.id,
      action: 'event_created',
      text: `${actor.display_name} הוסיף ${calendar === 'personal' ? 'ליומן האישי' : 'ללו"ז'}${rule ? ' אירוע חוזר' : ''}: ${e.title} (${rule ? `${ruleText}, מ-${shortDate(e.date)}` : when})`,
    });
    const link = `/?date=${e.date}&event=${first}`;
    if (e.ownerId) notify([e.ownerId], { type: 'event_owner', category: 'info', title: `מונית לאחראי על "${e.title}"`, body: rule ? ruleText : when, link: `/schedule?date=${e.date}&event=${first}` }, actor.id);
    if (guests.length) {
      notify(
        guests.map((g) => g.userId).filter((u) => u !== e.ownerId),
        { type: 'event_invite', category: 'action', title: `הוזמנת: ${e.title}`, body: `${rule ? ruleText : when}${e.location ? ` · ${e.location}` : ''} · מאת ${actor.display_name}`, link, ref: `event:${first}` },
        actor.id,
      );
    }
    return first;
  });
  changed('events');
  return id;
}

/** the rows a change or a deletion takes: this one, it and the later ones of its series, or the whole series */
function scopeRows(cur: EventRow, scope: SeriesScope): EventRow[] {
  if (scope === 'one' || !cur.recurrence_id) return [cur];
  return db().all<EventRow>(
    `${EVENT_BASE} WHERE e.recurrence_id = ? AND ${LIVE} ${scope === 'following' ? 'AND e.original_date >= ?' : ''} ORDER BY e.date`,
    ...(scope === 'following' ? [cur.recurrence_id, cur.original_date ?? cur.date] : [cur.recurrence_id]),
  );
}

/** replaces an event's guests, keeping the answers of those who stay; returns who was added */
function setGuests(eventId: number, guests: { userId: number; optional: boolean }[]): number[] {
  const before = new Map(db().all<{ user_id: number; response: GuestResponse }>('SELECT user_id, response FROM event_guests WHERE event_id = ?', eventId).map((g) => [g.user_id, g.response]));
  db().run('DELETE FROM event_guests WHERE event_id = ?', eventId);
  const added: number[] = [];
  for (const g of guests) {
    db().run('INSERT INTO event_guests(event_id, user_id, response, optional) VALUES (?, ?, ?, ?)', eventId, g.userId, before.get(g.userId) ?? 'needsAction', g.optional ? 1 : 0);
    if (!before.has(g.userId)) added.push(g.userId);
  }
  return added;
}

/**
 * Section 66: returns the open tasks that may be affected by the change. One of a series: `scope` takes
 * the change to the series' later events too ("this and following" - the series is split there), or to
 * all of it. A move by days moves each of them by as many days; the rest of what changed is set on each,
 * except where a day changed that same thing on its own.
 */
export function updateEvent(actor: UserRow, id: number, raw: Partial<z.input<typeof eventSchema>>, scope: SeriesScope = 'one'): { affectedTasks: Task[]; deltaMinutes: number } {
  let cur = eventRow(id);
  const isGuest = !!db().get('SELECT 1 FROM event_guests WHERE event_id = ? AND user_id = ?', id, actor.id);
  if (!canEditRow(actor, cur, isGuest)) throw forbidden();
  const patch = patchSchema(eventSchema).parse(raw);
  if (patch.calendar === 'course' && cur.calendar === 'personal' && !may(actor, 'schedule') && weekLeadOn(patch.date ?? cur.date) !== actor.id) {
    throw forbidden('רק מפקד הקורס או מפק"צ השבוע מעבירים אירוע ללו"ז הקורס');
  }
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
    color: patch.color !== undefined ? patch.color : cur.color,
    title: patch.title ?? cur.title,
    location: patch.location ?? cur.location,
    ownerId: patch.ownerId !== undefined ? patch.ownerId : cur.owner_id,
    notes: patch.notes ?? cur.notes,
    calendar: patch.calendar ?? cur.calendar,
    transparency: patch.transparency ?? cur.transparency,
    visibility: patch.visibility ?? cur.visibility,
    reminders: patch.reminders !== undefined ? patch.reminders : parseReminders(cur.reminders),
    guestsCanModify: patch.guestsCanModify ?? !!cur.guests_can_modify,
    guestsCanInvite: patch.guestsCanInvite ?? !!cur.guests_can_invite,
    guestsCanSee: patch.guestsCanSee ?? !!cur.guests_can_see,
  };
  if (next.ownerId && next.ownerId !== cur.owner_id && !getUserRow(next.ownerId)?.active) throw badRequest('האחראי שנבחר אינו פעיל');
  const guests = patch.guests ? cleanGuests(patch.guests) : null;
  const before = zonedToUtc(cur.date, cur.start_time, tz()).getTime();
  const after = zonedToUtc(next.date, next.startTime, tz()).getTime();
  const deltaMinutes = Math.round((after - before) / 60000);
  const dayShift = diffDays(next.date, cur.date);
  const timeChanged = deltaMinutes !== 0 || next.allDay !== !!cur.all_day || next.endDate !== cur.end_date || next.endTime !== cur.end_time;
  // what changed, as the bits a day of a series keeps on its own
  let bits = 0;
  if (timeChanged) bits |= OWN.time;
  if (next.title !== cur.title) bits |= OWN.title;
  if (next.location !== cur.location) bits |= OWN.location;
  if (next.notes !== cur.notes) bits |= OWN.notes;
  if (next.ownerId !== cur.owner_id) bits |= OWN.owner;
  if ((next.color ?? null) !== cur.color) bits |= OWN.color;
  if (guests) bits |= OWN.guests;
  if (patch.reminders !== undefined) bits |= OWN.reminders;
  if (next.calendar !== cur.calendar || next.transparency !== cur.transparency || next.visibility !== cur.visibility || next.guestsCanModify !== !!cur.guests_can_modify || next.guestsCanInvite !== !!cur.guests_can_invite || next.guestsCanSee !== !!cur.guests_can_see) bits |= OWN.other;
  const newRule = patch.recurrence !== undefined ? (patch.recurrence ? readRule(patch.recurrence) : null) : undefined;
  // a new rule is for the series from here on, or all of it - never for one day
  let how: SeriesScope = cur.recurrence_id ? scope : 'one';
  if (cur.recurrence_id && newRule !== undefined && how === 'one') how = 'following';
  // "this and following" from the series' first day is all of it
  if (how === 'following' && cur.recurrence_id && cur.original_date === recurrence(cur.recurrence_id).dtstart) how = 'all';

  const addedGuests: number[] = [];
  db().tx(() => {
    const at = nowIso();
    if (how === 'following') {
      // split: from this day on is a series of its own, then changed as a whole
      splitAt(cur.recurrence_id!, cur.original_date!, actor.id);
      cur = eventRow(id);
      how = 'all';
    }
    if (!cur.recurrence_id || how === 'one') {
      writeRow(actor, cur, next, cur.date !== next.date ? next.date : cur.date, at);
      if (cur.recurrence_id) db().run('UPDATE events SET detached = detached | ? WHERE id = ?', bits, cur.id);
      if (guests) addedGuests.push(...setGuests(cur.id, guests));
      // an event becomes a series
      if (!cur.recurrence_id && newRule) {
        const t = templateFrom(next, guests ?? guestsOf(cur.id).map((g) => ({ userId: g.userId, optional: !!g.optional })));
        const recId = db().run(
          'INSERT INTO event_recurrences(rrule, dtstart, exdates, horizon, template, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
          formatRRule(newRule),
          next.date,
          '[]',
          next.date,
          JSON.stringify(t),
          cur.created_by ?? actor.id,
          at,
          at,
        ).id;
        db().run('UPDATE events SET recurrence_id = ?, original_date = ? WHERE id = ?', recId, next.date, cur.id);
        materialize(recId, horizonFor(newRule, next.date));
      }
      return;
    }
    // the whole series (or the part split off above)
    const recId = cur.recurrence_id;
    const rec = recurrence(recId);
    const t = templateOf(rec);
    const nt: Template = {
      ...t,
      title: bits & OWN.title ? next.title : t.title,
      location: bits & OWN.location ? next.location : t.location,
      notes: bits & OWN.notes ? next.notes : t.notes,
      ownerId: bits & OWN.owner ? next.ownerId : t.ownerId,
      color: bits & OWN.color ? (next.color ?? null) : t.color,
      reminders: bits & OWN.reminders ? next.reminders : t.reminders,
      guests: guests ?? t.guests,
      allDay: next.allDay,
      startTime: next.startTime,
      endTime: next.endTime,
      spanDays: next.endDate ? diffDays(next.endDate, next.date) : 0,
      calendar: next.calendar,
      transparency: next.transparency,
      visibility: next.visibility,
      guestsCanModify: next.guestsCanModify,
      guestsCanInvite: next.guestsCanInvite,
      guestsCanSee: next.guestsCanSee,
    };
    // the rule: as given, or moved with the series when this change moved it by days
    const curRule = readRule(rec.rrule);
    const startShift = dayShift;
    const dtstart = addDays(rec.dtstart, startShift);
    const rule = newRule === undefined ? moveRule(curRule, dtstart, startShift) : newRule;
    if (rule === null) {
      // no longer repeats: this day stays, as an event of its own; the rest of the series goes
      writeRow(actor, cur, next, next.date, at);
      if (guests) addedGuests.push(...setGuests(cur.id, guests));
      const others = db().all<{ id: number }>(`SELECT id FROM events e WHERE recurrence_id = ? AND id <> ? AND ${LIVE}`, recId, cur.id);
      for (const o of others) {
        if (heldDay(o.id)) db().run('UPDATE events SET recurrence_id = NULL, original_date = NULL WHERE id = ?', o.id);
        else db().run('DELETE FROM events WHERE id = ?', o.id);
      }
      db().run('UPDATE events SET recurrence_id = NULL, original_date = NULL, detached = 0 WHERE id = ?', cur.id);
      db().run('DELETE FROM event_recurrences WHERE id = ?', recId);
      return;
    }
    const ruleText = formatRRule(rule);
    const shiftDays = startShift;
    db().run('UPDATE event_recurrences SET rrule = ?, dtstart = ?, template = ?, updated_at = ? WHERE id = ?', ruleText, dtstart, JSON.stringify(nt), at, recId);
    // each day: moved with the series (unless moved on its own), and what changed - unless changed on its own.
    // Its place in the rule moves too - later days first when moving later, so no two share a place on the way.
    const rows = db().all<EventRow>(`${EVENT_BASE} WHERE e.recurrence_id = ? ORDER BY e.original_date ${shiftDays > 0 ? 'DESC' : 'ASC'}`, recId);
    for (const r of rows) {
      const own = r.detached;
      if (r.deleted_at) {
        // a day in the trash keeps its place in the moved rule, so it is not made again
        if (shiftDays && r.original_date) db().run('UPDATE events SET original_date = ? WHERE id = ?', addDays(r.original_date, shiftDays), r.id);
        continue;
      }
      const movedDay = r.id === cur.id ? next.date : shiftDays && !(own & OWN.time) ? addDays(r.date, shiftDays) : r.date;
      const keepTime = !!(own & OWN.time) && r.id !== cur.id;
      const rowNext = {
        date: movedDay,
        allDay: keepTime ? !!r.all_day : nt.allDay,
        startTime: keepTime ? r.start_time : nt.startTime,
        endTime: keepTime ? r.end_time : nt.endTime,
        endDate: keepTime ? r.end_date : nt.spanDays ? addDays(movedDay, nt.spanDays) : null,
        title: own & OWN.title && r.id !== cur.id ? r.title : nt.title,
        location: own & OWN.location && r.id !== cur.id ? r.location : nt.location,
        notes: own & OWN.notes && r.id !== cur.id ? r.notes : nt.notes,
        ownerId: own & OWN.owner && r.id !== cur.id ? r.owner_id : nt.ownerId,
        color: own & OWN.color && r.id !== cur.id ? r.color : nt.color,
        reminders: own & OWN.reminders && r.id !== cur.id ? parseReminders(r.reminders) : nt.reminders,
        calendar: nt.calendar,
        transparency: nt.transparency,
        visibility: nt.visibility,
        guestsCanModify: nt.guestsCanModify,
        guestsCanInvite: nt.guestsCanInvite,
        guestsCanSee: nt.guestsCanSee,
      };
      writeRow(actor, r, rowNext, movedDay, at, shiftDays && r.original_date ? addDays(r.original_date, shiftDays) : undefined);
      if (guests && !(own & OWN.guests && r.id !== cur.id)) {
        const added = setGuests(r.id, guests);
        if (r.id === cur.id) addedGuests.push(...added);
      }
    }
    if (shiftDays) {
      const ex = exdatesOf(recurrence(recId)).map((d) => addDays(d, shiftDays));
      db().run('UPDATE event_recurrences SET exdates = ? WHERE id = ?', JSON.stringify(ex), recId);
    }
    if (newRule !== undefined || shiftDays) regenerate(recId, cur.id);
  });
  cur = eventRow(id);
  const rows = scopeRows(cur, how === 'one' ? 'one' : 'all');
  const changes: string[] = [];
  if (timeChanged) changes.push(`הוזז ל-${whenOf(next.date, next.allDay, next.startTime, next.endDate)}`);
  if (bits & OWN.location) changes.push(`מיקום: ${next.location || 'ללא'}`);
  if (bits & OWN.owner) changes.push(`אחראי: ${next.ownerId ? getUserRow(next.ownerId)?.display_name : 'ללא'}`);
  if (bits & OWN.title) changes.push(`שם: ${next.title}`);
  if (newRule !== undefined) changes.push(newRule ? `חוזר: ${describeRRule(newRule, cur.original_date ?? cur.date)}` : 'כבר לא חוזר');
  const many = rows.length > 1 ? ` (${rows.length} אירועים בסדרה)` : '';
  db().tx(() => {
    logActivity({ eventId: id, userId: actor.id, action: 'event_updated', text: `${actor.display_name} עדכן את "${next.title}"${many}${changes.length ? `: ${changes.join(', ')}` : ''}` });
    const link = `/?date=${next.date}&event=${id}`;
    if (addedGuests.length) {
      notify(addedGuests, { type: 'event_invite', category: 'action', title: `הוזמנת: ${next.title}`, body: `${whenOf(next.date, next.allDay, next.startTime, next.endDate)} · מאת ${actor.display_name}`, link, ref: `event:${id}` }, actor.id);
    }
    if (timeChanged || bits & OWN.location || newRule !== undefined) {
      const owners = rows.flatMap((r) => queryTasks("t.event_id = ? AND t.status NOT IN ('done', 'cancelled')", r.id).map((t) => t.owner_id));
      const invited = guestsOf(id).filter((g) => g.response !== 'declined' && !addedGuests.includes(g.userId)).map((g) => g.userId);
      notify([next.ownerId, ...owners, ...invited], { type: 'event_changed', category: 'info', title: `שינוי בלו"ז: "${next.title}"${many}`, body: changes.join(', '), link: `/schedule?date=${next.date}&event=${id}` }, actor.id);
    }
  });
  changed('events', 'tasks');
  const affectedTasks = deltaMinutes !== 0 ? queryTasks('t.event_id = ?', id).filter((t) => isOpenStatus(t.status)).map((t) => toTask(t)) : [];
  return { affectedTasks, deltaMinutes };
}

interface RowValues {
  date: string;
  startTime: string;
  endTime: string | null;
  endDate: string | null;
  allDay: boolean;
  color: string | null | undefined;
  title: string;
  location: string;
  ownerId: number | null | undefined;
  notes: string;
  calendar: EventCalendar;
  transparency: 'opaque' | 'transparent';
  visibility: 'default' | 'public' | 'private';
  reminders: EventReminder[] | null;
  guestsCanModify: boolean;
  guestsCanInvite: boolean;
  guestsCanSee: boolean;
}

function writeRow(actor: UserRow, r: EventRow, v: RowValues, day: string, at: string, originalDate?: string): void {
  db().run(
    `UPDATE events SET date = ?, start_time = ?, end_time = ?, end_date = ?, all_day = ?, color = ?, title = ?, location = ?, owner_id = ?, week_id = ?, notes = ?,
       calendar = ?, transparency = ?, visibility = ?, reminders = ?, guests_can_modify = ?, guests_can_invite = ?, guests_can_see = ?, updated_at = ?
       ${originalDate ? ', original_date = ?' : ''} WHERE id = ?`,
    day,
    v.startTime,
    v.endTime,
    v.endDate ? addDays(day, diffDays(v.endDate, v.date)) : null,
    v.allDay ? 1 : 0,
    v.color ?? null,
    v.title,
    v.location,
    v.ownerId ?? null,
    weekForDate(day),
    v.notes,
    v.calendar,
    v.transparency,
    v.visibility,
    v.reminders ? JSON.stringify(v.reminders) : null,
    v.guestsCanModify ? 1 : 0,
    v.guestsCanInvite ? 1 : 0,
    v.guestsCanSee ? 1 : 0,
    at,
    ...(originalDate ? [originalDate] : []),
    r.id,
  );
  // the roles cadets hold in it (experiences) go with it to its new day
  if (day !== r.date) followEvent(actor, r.id, diffDays(day, r.date));
}

function templateFrom(v: RowValues, guests: { userId: number; optional: boolean }[]): Template {
  return {
    title: v.title,
    location: v.location,
    ownerId: v.ownerId ?? null,
    notes: v.notes,
    color: v.color ?? null,
    allDay: v.allDay,
    startTime: v.startTime,
    endTime: v.endTime,
    spanDays: v.endDate ? diffDays(v.endDate, v.date) : 0,
    calendar: v.calendar,
    transparency: v.transparency,
    visibility: v.visibility,
    reminders: v.reminders,
    guests,
    responses: {},
    guestsCanModify: v.guestsCanModify,
    guestsCanInvite: v.guestsCanInvite,
    guestsCanSee: v.guestsCanSee,
  };
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
      [ev.owner_id, ...open.map((t) => t.owner_id), ...guestsOf(id).filter((g) => g.response !== 'declined').map((g) => g.userId)],
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

// ---------------- the trash ----------------

/**
 * One event to the trash - or, of a series, it and the later ones (the series then ends before it), or
 * all of it. A deleted day of a series is not made again (it is one of the days the rule skips).
 */
export function deleteEvent(actor: UserRow, id: number, scope: SeriesScope = 'one'): number {
  const ev = eventRow(id);
  const isGuest = !!db().get('SELECT 1 FROM event_guests WHERE event_id = ? AND user_id = ?', id, actor.id);
  if (!canEditRow(actor, ev, isGuest)) throw forbidden();
  let how: SeriesScope = ev.recurrence_id ? scope : 'one';
  if (how === 'following' && ev.recurrence_id && ev.original_date === recurrence(ev.recurrence_id).dtstart) how = 'all';
  const rows = scopeRows(ev, how);
  for (const r of rows) if (!canManageEvent(actor, r) && r.id !== ev.id) throw forbidden('אין לך הרשאה למחוק חלק מהאירועים בסדרה');
  const at = nowIso();
  db().tx(() => {
    logActivity({
      userId: actor.id,
      action: 'event_deleted',
      text: rows.length > 1 ? `${actor.display_name} מחק ${rows.length} אירועים של "${ev.title}" מהלו"ז (מ-${shortDate(rows[0].date)})` : `${actor.display_name} מחק את "${ev.title}" מהלו"ז (${shortDate(ev.date)})`,
    });
    for (const r of rows) db().run('UPDATE events SET deleted_at = ?, deleted_by = ? WHERE id = ?', at, actor.id, r.id);
    if (ev.recurrence_id) {
      const rec = recurrence(ev.recurrence_id);
      if (how === 'one') {
        const ex = new Set(exdatesOf(rec));
        ex.add(ev.original_date ?? ev.date);
        db().run('UPDATE event_recurrences SET exdates = ?, updated_at = ? WHERE id = ?', JSON.stringify([...ex].sort()), at, rec.id);
      } else if (how === 'following') {
        db().run('UPDATE event_recurrences SET prev_rrule = rrule, rrule = ?, horizon = ?, updated_at = ? WHERE id = ?', formatRRule(endBefore(readRule(rec.rrule), rec.dtstart, ev.original_date!)), addDays(ev.original_date!, -1), at, rec.id);
      } else {
        db().run('UPDATE event_recurrences SET deleted_at = ?, updated_at = ? WHERE id = ?', at, at, rec.id);
      }
    }
    const invited = rows.flatMap((r) => guestsOf(r.id).filter((g) => g.response !== 'declined').map((g) => g.userId));
    if (invited.length) {
      notify(invited, { type: 'event_cancelled', category: 'info', title: `בוטל: ${ev.title}`, body: rows.length > 1 ? `${rows.length} אירועים, מ-${shortDate(rows[0].date)}` : whenOf(ev.date, !!ev.all_day, ev.start_time, ev.end_date), link: `/?date=${ev.date}` }, actor.id);
    }
  });
  changed('events', 'tasks');
  return rows.length;
}

/** the rows deleted together with this one (the days of a series deleted at once) */
function trashGroup(r: EventRow): EventRow[] {
  if (!r.recurrence_id || !r.deleted_at) return [r];
  return db().all<EventRow>(`${EVENT_BASE} WHERE e.recurrence_id = ? AND e.deleted_at = ? ORDER BY e.date`, r.recurrence_id, r.deleted_at);
}

/** What is in the trash that this person may bring back, newest first (30 days). */
export function listTrash(actor: UserRow): TrashedEvent[] {
  const since = new Date(clock.now().getTime() - TRASH_DAYS * 86_400_000).toISOString();
  const rows = db().all<EventRow & { deleted_by_name: string | null }>(
    `${EVENT_BASE.replace('FROM events e', ', d.display_name AS deleted_by_name FROM events e LEFT JOIN users d ON d.id = e.deleted_by')} WHERE e.deleted_at IS NOT NULL AND e.deleted_at >= ? ORDER BY e.deleted_at DESC, e.date`,
    since,
  );
  // the days of a series deleted together are one item, under its first day
  const groups = new Map<string, TrashedEvent>();
  for (const r of rows) {
    if (!canManageEvent(actor, r) && r.deleted_by !== actor.id) continue;
    const key = r.recurrence_id ? `${r.recurrence_id}|${r.deleted_at}` : `e${r.id}`;
    const hit = groups.get(key);
    if (hit) {
      hit.count++;
      if (r.date < hit.date) Object.assign(hit, { id: r.id, date: r.date, startTime: r.start_time });
      continue;
    }
    groups.set(key, { id: r.id, title: r.title, date: r.date, startTime: r.start_time, allDay: !!r.all_day, count: 1, deletedAt: r.deleted_at!, deletedByName: r.deleted_by_name, calendar: r.calendar });
  }
  return [...groups.values()];
}

/** Brings an event (and the days of its series deleted with it) back from the trash. Returns how many. */
export function untrashEvent(actor: UserRow, id: number): number {
  const r = eventRow(id, true);
  if (!r.deleted_at) return 0;
  if (!canManageEvent(actor, r) && r.deleted_by !== actor.id) throw forbidden();
  const group = trashGroup(r);
  db().tx(() => {
    for (const g of group) db().run('UPDATE events SET deleted_at = NULL, deleted_by = NULL, updated_at = ? WHERE id = ?', nowIso(), g.id);
    if (r.recurrence_id) {
      const rec = recurrence(r.recurrence_id);
      const days = new Set(group.map((g) => g.original_date ?? g.date));
      const ex = exdatesOf(rec).filter((d) => !days.has(d));
      const last = [...days].sort().pop()!;
      // "this and following" cut the rule before these days: back to the rule it had
      const cut = readRule(rec.rrule).until;
      const back = rec.prev_rrule && cut && last > cut ? rec.prev_rrule : rec.rrule;
      // the series as it was: undeleted, its days skipped no more
      db().run(
        'UPDATE event_recurrences SET deleted_at = NULL, exdates = ?, rrule = ?, prev_rrule = ?, horizon = MAX(horizon, ?), updated_at = ? WHERE id = ?',
        JSON.stringify(ex),
        back,
        back === rec.rrule ? rec.prev_rrule : null,
        last,
        nowIso(),
        rec.id,
      );
    }
    logActivity({ eventId: id, userId: actor.id, action: 'event_restored', text: `${actor.display_name} שחזר את "${r.title}" מהאשפה${group.length > 1 ? ` (${group.length} אירועים)` : ''}` });
  });
  changed('events', 'tasks');
  return group.length;
}

/** Deletes an event (and the days of its series deleted with it) from the trash for good. */
export function purgeEvent(actor: UserRow, id: number): number {
  const r = eventRow(id, true);
  if (!r.deleted_at) throw badRequest('האירוע לא באשפה');
  if (!canManageEvent(actor, r) && r.deleted_by !== actor.id) throw forbidden();
  const group = trashGroup(r);
  db().tx(() => {
    for (const g of group) db().run('DELETE FROM events WHERE id = ?', g.id);
    if (r.recurrence_id) dropEmptySeries(r.recurrence_id);
  });
  changed('events', 'tasks');
  return group.length;
}

function dropEmptySeries(recId: number): void {
  const left = db().get<{ n: number }>('SELECT count(*) AS n FROM events WHERE recurrence_id = ?', recId)!.n;
  const rec = db().get<{ deleted_at: string | null }>('SELECT deleted_at FROM event_recurrences WHERE id = ?', recId);
  if (!left && rec?.deleted_at) db().run('DELETE FROM event_recurrences WHERE id = ?', recId);
}

/** Empties what has waited in the trash longer than 30 days (housekeeping). Returns how many went. */
export function purgeOldTrash(now: Date): number {
  const before = new Date(now.getTime() - TRASH_DAYS * 86_400_000).toISOString();
  const rows = db().all<{ id: number; recurrence_id: number | null }>('SELECT id, recurrence_id FROM events WHERE deleted_at IS NOT NULL AND deleted_at < ?', before);
  if (!rows.length) return 0;
  db().tx(() => {
    for (const r of rows) db().run('DELETE FROM events WHERE id = ?', r.id);
    for (const rec of new Set(rows.map((r) => r.recurrence_id).filter((x): x is number => !!x))) dropEmptySeries(rec);
  });
  changed('events');
  return rows.length;
}

// ---------------- guests' answers ----------------

export const RESPONSES = ['accepted', 'declined', 'tentative'] as const;
const RESPONSE_WORDS: Record<(typeof RESPONSES)[number], string> = { accepted: 'מגיע/ה', declined: 'לא מגיע/ה', tentative: 'אולי' };

/** A guest's answer: to this day, or to the whole series (its new days too). */
export function respondEvent(actor: UserRow, id: number, response: (typeof RESPONSES)[number], scope: 'one' | 'all' = 'one'): void {
  const ev = eventRow(id);
  if (!db().get('SELECT 1 FROM event_guests WHERE event_id = ? AND user_id = ?', id, actor.id)) throw forbidden('לא הוזמנת לאירוע הזה');
  if (!RESPONSES.includes(response)) throw badRequest('תשובה לא תקינה');
  const at = nowIso();
  db().tx(() => {
    const ids = scope === 'all' && ev.recurrence_id ? db().all<{ id: number }>(`SELECT id FROM events e WHERE recurrence_id = ? AND ${LIVE}`, ev.recurrence_id).map((r) => r.id) : [id];
    for (const eid of ids) db().run('UPDATE event_guests SET response = ?, responded_at = ? WHERE event_id = ? AND user_id = ?', response, at, eid, actor.id);
    if (scope === 'all' && ev.recurrence_id) {
      const rec = recurrence(ev.recurrence_id);
      const t = templateOf(rec);
      t.responses = { ...t.responses, [String(actor.id)]: response };
      db().run('UPDATE event_recurrences SET template = ? WHERE id = ?', JSON.stringify(t), rec.id);
    }
    // (the invitation, answered, leaves the bell by itself - journal.ts FINISHED)
    notify(
      [ev.created_by, ev.owner_id],
      { type: 'event_response', category: 'info', title: `${actor.display_name}: ${RESPONSE_WORDS[response]}`, body: `${ev.title} · ${whenOf(ev.date, !!ev.all_day, ev.start_time, ev.end_date)}`, link: `/?date=${ev.date}&event=${id}` },
      actor.id,
    );
  });
  // the invitation, answered, leaves the bell (journal.ts FINISHED): the bell reads again
  notificationsChanged(actor.id);
  changed('events');
}

// ---------------- reminders ----------------

/** the reminders when an event has none of its own: 30 minutes before, as Google's default; all day: none */
export const DEFAULT_REMINDERS: EventReminder[] = [{ minutes: 30 }];
/** on, as in Google: an event left as it was reminds 30 minutes before (tests may turn it off) */
let defaultRemindersOn = true;
export const setDefaultReminders = (on: boolean) => {
  defaultRemindersOn = on;
};

/**
 * Sends the reminders that are due (from the scheduler, about every minute): to the event's owner, to
 * its guests who did not decline, and - one's own calendar - to its maker. Each reminder once for each
 * start time (an event moved later reminds again).
 */
export function sendEventReminders(now: Date): number {
  const zone = tz();
  const from = localDateKey(new Date(now.getTime() - 86_400_000), zone);
  const to = localDateKey(new Date(now.getTime() + MAX_REMINDER_MINUTES * 60_000 + 86_400_000), zone);
  const rows = db().all<EventRow>(`${EVENT_BASE} WHERE ${LIVE} AND e.cancelled = 0 AND e.date >= ? AND e.date <= ?`, from, to);
  let sent = 0;
  for (const r of rows) {
    const own = parseReminders(r.reminders);
    const reminders = own ?? (r.all_day || !defaultRemindersOn ? [] : DEFAULT_REMINDERS);
    if (!reminders.length) continue;
    const startsAt = zonedToUtc(r.date, r.all_day ? '00:00' : r.start_time, zone);
    if (startsAt.getTime() <= now.getTime() - REMINDER_LATE_MS) continue;
    const recipients = new Set<number>();
    if (r.owner_id) recipients.add(r.owner_id);
    if (r.calendar === 'personal' && r.created_by) recipients.add(r.created_by);
    for (const g of guestsOf(r.id)) if (g.response !== 'declined') recipients.add(g.userId);
    if (!recipients.size) continue;
    const startIso = startsAt.toISOString();
    for (const rem of reminders) {
      const due = startsAt.getTime() - rem.minutes * 60_000;
      if (now.getTime() < due || now.getTime() > startsAt.getTime() + REMINDER_LATE_MS) continue;
      // made after its reminder's time: that reminder is not owed (Google does not send it either)
      if (Date.parse(r.created_at) > due) continue;
      // the time actually left (the scheduler may come a little late), in round minutes; begun already: since when
      const left = Math.round((startsAt.getTime() - now.getTime()) / 60_000);
      const lead = r.all_day ? reminderLead(rem.minutes, true) : left < 0 ? `התחיל לפני ${-left === 1 ? 'דקה' : `${-left} דקות`}` : reminderLead(left < 10 ? left : Math.round(left / 5) * 5);
      for (const uid of recipients) {
        const ok = db().run('INSERT OR IGNORE INTO event_reminders_sent(event_id, user_id, minutes, starts_at, sent_at) VALUES (?, ?, ?, ?, ?)', r.id, uid, rem.minutes, startIso, now.toISOString()).changes;
        if (!ok) continue;
        notify([uid], { type: 'event_reminder', category: 'info', title: `${lead}: ${r.title}`, body: `${whenOf(r.date, !!r.all_day, r.start_time, r.end_date)}${r.location ? ` · ${r.location}` : ''}`, link: `/?date=${r.date}&event=${r.id}`, ref: `event:${r.id}` });
        sent++;
      }
    }
  }
  return sent;
}

/** "בעוד 30 דקות", "בעוד שעה", "מחר" */
export function reminderLead(minutes: number, allDay = false): string {
  if (allDay) return minutes <= 0 ? 'היום' : minutes <= 24 * 60 ? 'מחר' : `בעוד ${Math.round(minutes / (24 * 60))} ימים`;
  if (minutes === 0) return 'עכשיו';
  if (minutes < 60) return `בעוד ${minutes} דקות`;
  if (minutes === 60) return 'בעוד שעה';
  if (minutes < 24 * 60) return minutes % 60 ? `בעוד ${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')} שעות` : minutes === 120 ? 'בעוד שעתיים' : `בעוד ${minutes / 60} שעות`;
  if (minutes === 24 * 60) return 'מחר';
  if (minutes % (7 * 24 * 60) === 0) return minutes === 7 * 24 * 60 ? 'בעוד שבוע' : `בעוד ${minutes / (7 * 24 * 60)} שבועות`;
  return `בעוד ${Math.round(minutes / (24 * 60))} ימים`;
}

/** for tests and the API: the series' rule and first day */
export function seriesOf(id: number): { rrule: string; dtstart: string; exdates: string[] } | null {
  const r = db().get<RecurrenceRow>('SELECT * FROM event_recurrences WHERE id = ?', id);
  return r ? { rrule: r.rrule, dtstart: r.dtstart, exdates: exdatesOf(r) } : null;
}
