// The course's calendar in the shape of the Google Calendar API (v3), under /api/calendar/v3: the same
// resources (calendarList, events, colors, freeBusy), the same field names and the same calls - list by a
// time range with or without the days of a series spread out, insert, get, patch, update, delete, move,
// instances and quickAdd. Two calendars: "course" (the course's) and "primary" (the reader's own).
// What KKS adds to an event (its owner, its course week, an activity called off, its preparation tasks)
// travels in extendedProperties.shared, as Google keeps an app's own fields.

import { Router, type Request } from 'express';
import { z } from 'zod';
import { CAL_COLOR_HEX, CAL_COLORS, GOOGLE_COLORS, type CalColor } from '../../shared/calendarLayers';
import { addDays, diffDays, localDateKey, localTime, zonedIso, zonedToUtc } from '../../shared/dates';
import { parseEventText } from '../../shared/eventParser';
import { parseRRule } from '../../shared/rrule';
import type { EventCalendar, GuestResponse, ScheduleEvent } from '../../shared/types';
import type { UserRow } from './auth';
import { badRequest, clock, getSettings, notFound, tz } from './core';
import { db } from './db';
import { createEvent, deleteEvent, eventDetail, eventSchema, listEventsFor, respondEvent, RESPONSES, SERIES_SCOPES, seriesOf, untrashEvent, updateEvent, type SeriesScope } from './schedule';

const me = (req: Request): UserRow => req.user!;
const origin = (req: Request) => `${req.protocol}://${req.host}`;

/** Google's event colour ids: 1 Lavender ... 11 Tomato, as KKS names them */
export const EVENT_COLOR_ID: Record<CalColor, string> = { lavender: '1', olive: '2', purple: '3', pink: '4', yellow: '5', orange: '6', teal: '7', graphite: '8', blue: '9', green: '10', red: '11' };
const COLOR_BY_ID = Object.fromEntries(Object.entries(EVENT_COLOR_ID).map(([k, v]) => [v, k])) as Record<string, CalColor>;
/** text on a colour: dark on the light ones, as Google draws them */
const LIGHT = new Set(['#f6bf26', '#e4c441', '#c0ca33', '#f09300', '#b39ddb']);
const fg = (hex: string) => (LIGHT.has(hex) ? '#1d1d1d' : '#ffffff');

type CalendarId = 'course' | 'primary';
function calendarOf(raw: string): CalendarId {
  if (raw === 'course' || raw === 'primary') return raw;
  throw notFound('יומן לא קיים');
}
const toCalendar = (id: CalendarId): EventCalendar => (id === 'course' ? 'course' : 'personal');

// ---------------- events in, events out ----------------

interface GoogleTime {
  date?: string;
  dateTime?: string;
  timeZone?: string;
}

function startOf(e: ScheduleEvent, zone: string): GoogleTime {
  return e.allDay ? { date: e.date } : { dateTime: zonedIso(e.date, e.startTime, zone), timeZone: zone };
}

function endOf(e: ScheduleEvent, zone: string): GoogleTime {
  // all day: the day after the last (as Google has it); hours: its end, the next day when past midnight
  if (e.allDay) return { date: addDays(e.endDate ?? e.date, 1) };
  const start = zonedToUtc(e.date, e.startTime, zone);
  let end = e.endTime ? zonedToUtc(e.date, e.endTime, zone) : new Date(start.getTime() + 3_600_000);
  if (end <= start) end = new Date(end.getTime() + 86_400_000);
  return { dateTime: end.toISOString(), timeZone: zone };
}

/** one event (one day of a series, or an event of its own) as Google's Event resource */
export function toGoogleEvent(e: ScheduleEvent, reader: UserRow, base: string): Record<string, unknown> {
  const zone = tz();
  const s = getSettings();
  const row = db().get<{ created_at: string; updated_at: string; original_date: string | null; deleted_at: string | null }>('SELECT created_at, updated_at, original_date, deleted_at FROM events WHERE id = ?', e.id);
  const updated = row?.updated_at ?? new Date(0).toISOString();
  const course = (e.calendar ?? 'course') === 'course';
  return {
    kind: 'calendar#event',
    etag: `"${Date.parse(updated)}"`,
    id: String(e.id),
    status: row?.deleted_at ? 'cancelled' : 'confirmed',
    htmlLink: `${base}/?date=${e.date}&event=${e.id}`,
    created: row?.created_at,
    updated,
    summary: e.title,
    description: e.notes,
    location: e.location,
    ...(e.color && (CAL_COLORS as readonly string[]).includes(e.color) ? { colorId: EVENT_COLOR_ID[e.color as CalColor] } : {}),
    creator: { id: String(e.createdBy ?? ''), displayName: e.createdByName ?? undefined, ...(e.createdBy === reader.id ? { self: true } : {}) },
    organizer: course ? { id: 'course', displayName: s.courseName } : { id: String(e.createdBy ?? ''), displayName: e.createdByName ?? undefined, ...(e.createdBy === reader.id ? { self: true } : {}) },
    start: startOf(e, zone),
    end: endOf(e, zone),
    ...(e.seriesId
      ? {
          recurringEventId: `r${e.seriesId}`,
          originalStartTime: e.allDay ? { date: row?.original_date ?? e.date } : { dateTime: zonedIso(row?.original_date ?? e.date, e.startTime, zone), timeZone: zone },
        }
      : {}),
    transparency: e.transparency ?? 'opaque',
    visibility: e.visibility ?? 'default',
    iCalUID: e.seriesId ? `kks-series-${e.seriesId}@kks` : `kks-event-${e.id}@kks`,
    sequence: 0,
    ...(e.guests?.length
      ? {
          attendees: e.guests.map((g) => ({
            id: String(g.userId),
            displayName: g.name,
            responseStatus: g.response,
            ...(g.optional ? { optional: true } : {}),
            ...(g.userId === reader.id ? { self: true } : {}),
          })),
        }
      : {}),
    guestsCanModify: !!e.guestsCanModify,
    guestsCanInviteOthers: e.guestsCanInvite ?? true,
    guestsCanSeeOtherGuests: e.guestsCanSee ?? true,
    reminders: e.reminders ? { useDefault: false, overrides: e.reminders.map((r) => ({ method: 'popup', minutes: r.minutes })) } : { useDefault: true },
    eventType: 'default',
    extendedProperties: {
      shared: {
        ...(e.ownerId ? { kksOwnerId: String(e.ownerId) } : {}),
        ...(e.weekId ? { kksWeekId: String(e.weekId) } : {}),
        ...(e.cancelled ? { kksCancelled: 'true' } : {}),
        kksTaskTotal: String(e.taskTotal),
        kksTaskDone: String(e.taskDone),
      },
    },
  };
}

/** a series as Google's recurring event: its first day's fields, its rule and the days it skips */
function toGoogleMaster(first: ScheduleEvent, reader: UserRow, base: string): Record<string, unknown> {
  const series = seriesOf(first.seriesId!);
  if (!series) return toGoogleEvent(first, reader, base);
  const zone = tz();
  const startDay = series.dtstart;
  const asFirst: ScheduleEvent = { ...first, date: startDay, endDate: first.endDate ? addDays(startDay, diffDays(first.endDate, first.date)) : null };
  const { recurringEventId: _r, originalStartTime: _o, ...rest } = toGoogleEvent(asFirst, reader, base);
  const exdates = series.exdates.map((d) => (first.allDay ? `EXDATE;VALUE=DATE:${d.replace(/-/g, '')}` : `EXDATE;TZID=${zone}:${d.replace(/-/g, '')}T${first.startTime.replace(':', '')}00`));
  return { ...rest, id: `r${first.seriesId}`, iCalUID: `kks-series-${first.seriesId}@kks`, recurrence: [`RRULE:${series.rrule}`, ...exdates] };
}

const googleTime = z.object({ date: z.string().optional(), dateTime: z.string().optional(), timeZone: z.string().optional() });
const googleEventSchema = z.object({
  summary: z.string().optional(),
  description: z.string().optional(),
  location: z.string().optional(),
  colorId: z.string().optional(),
  start: googleTime.optional(),
  end: googleTime.optional(),
  recurrence: z.array(z.string()).optional(),
  attendees: z.array(z.object({ id: z.string().optional(), email: z.string().optional(), optional: z.boolean().optional(), responseStatus: z.string().optional(), self: z.boolean().optional() })).optional(),
  reminders: z.object({ useDefault: z.boolean().optional(), overrides: z.array(z.object({ method: z.string().optional(), minutes: z.number() })).optional() }).optional(),
  transparency: z.enum(['opaque', 'transparent']).optional(),
  visibility: z.enum(['default', 'public', 'private', 'confidential']).optional(),
  guestsCanModify: z.boolean().optional(),
  guestsCanInviteOthers: z.boolean().optional(),
  guestsCanSeeOtherGuests: z.boolean().optional(),
  status: z.enum(['confirmed', 'tentative', 'cancelled']).optional(),
  extendedProperties: z.object({ shared: z.record(z.string(), z.string()).optional(), private: z.record(z.string(), z.string()).optional() }).optional(),
});
type GoogleEventInput = z.infer<typeof googleEventSchema>;

/** a staff member by Google's attendee: our id, or the email, or the user name */
function attendeeUser(a: { id?: string; email?: string }): number {
  if (a.id && /^\d+$/.test(a.id)) return Number(a.id);
  const email = (a.email ?? '').trim().toLowerCase();
  const u = email ? db().get<{ id: number }>('SELECT id FROM users WHERE active = 1 AND (lower(email) = ? OR lower(username) = ? OR lower(username) = ?)', email, email, email.split('@')[0]) : undefined;
  if (!u) throw badRequest(`אורח לא מוכר: ${a.email ?? a.id ?? ''}`);
  return u.id;
}

/** Google's fields as KKS's event fields (only those given: for insert and for patch alike) */
function fromGoogle(g: GoogleEventInput, zone: string): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (g.summary !== undefined) out.title = g.summary;
  if (g.description !== undefined) out.notes = g.description;
  if (g.location !== undefined) out.location = g.location;
  if (g.colorId !== undefined) out.color = COLOR_BY_ID[g.colorId] ?? null;
  if (g.start) {
    if (g.start.date) {
      out.date = g.start.date;
      out.allDay = true;
      out.startTime = '00:00';
      // the end is the day after the last (as Google has it)
      const last = g.end?.date ? addDays(g.end.date, -1) : g.start.date;
      out.endDate = last > g.start.date ? last : null;
    } else if (g.start.dateTime) {
      const start = new Date(g.start.dateTime);
      if (Number.isNaN(start.getTime())) throw badRequest('שעת התחלה לא תקינה');
      out.date = localDateKey(start, zone);
      out.startTime = localTime(start, zone);
      out.allDay = false;
      out.endDate = null;
      if (g.end?.dateTime) {
        const end = new Date(g.end.dateTime);
        if (Number.isNaN(end.getTime()) || end <= start) throw badRequest('שעת הסיום לפני ההתחלה');
        if (end.getTime() - start.getTime() > 24 * 3_600_000) throw badRequest('אירוע בשעות נמשך עד יממה - אירוע של כמה ימים הוא של יום שלם');
        out.endTime = localTime(end, zone);
      }
    }
  }
  if (g.recurrence !== undefined) {
    const rule = g.recurrence.find((r) => /^RRULE:/i.test(r));
    if (rule && !parseRRule(rule, zone)) throw badRequest('חוק החזרה לא תקין');
    out.recurrence = rule ? rule.replace(/^RRULE:/i, '') : null;
  }
  if (g.attendees !== undefined) out.guests = g.attendees.map((a) => ({ userId: attendeeUser(a), optional: a.optional }));
  if (g.reminders !== undefined) out.reminders = g.reminders.useDefault !== false ? null : (g.reminders.overrides ?? []).map((r) => ({ minutes: r.minutes }));
  if (g.transparency !== undefined) out.transparency = g.transparency;
  if (g.visibility !== undefined) out.visibility = g.visibility === 'confidential' ? 'private' : g.visibility;
  if (g.guestsCanModify !== undefined) out.guestsCanModify = g.guestsCanModify;
  if (g.guestsCanInviteOthers !== undefined) out.guestsCanInvite = g.guestsCanInviteOthers;
  if (g.guestsCanSeeOtherGuests !== undefined) out.guestsCanSee = g.guestsCanSeeOtherGuests;
  const owner = g.extendedProperties?.shared?.kksOwnerId;
  if (owner !== undefined) out.ownerId = owner ? Number(owner) : null;
  return out;
}

// ---------------- reading ----------------

/** the day keys a time range of Google's covers: RFC3339 moments, or plain days */
function rangeDays(timeMin: unknown, timeMax: unknown, zone: string): { from: string; to: string } {
  const day = (v: unknown, fallback: string) => {
    if (typeof v !== 'string' || !v) return fallback;
    if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
    const d = new Date(v);
    if (Number.isNaN(d.getTime())) throw badRequest('טווח זמן לא תקין');
    return localDateKey(d, zone);
  };
  const today = localDateKey(clock.now(), zone);
  const from = day(timeMin, addDays(today, -30));
  // timeMax is exclusive: the moment it names, not its day, when it is midnight
  let to = day(timeMax, addDays(from, 365));
  if (typeof timeMax === 'string' && timeMax.includes('T') && localTime(new Date(timeMax), zone) === '00:00') to = addDays(to, -1);
  if (to < from) throw badRequest('טווח זמן לא תקין');
  if (diffDays(to, from) > 3 * 366) throw badRequest('טווח של עד שלוש שנים');
  return { from, to };
}

function inCalendar(e: ScheduleEvent, cal: CalendarId, reader: UserRow): boolean {
  if (cal === 'course') return (e.calendar ?? 'course') === 'course';
  // one's own calendar: what one made there, and what one is invited to
  return e.calendar === 'personal' ? true : !!e.guests?.some((g) => g.userId === reader.id);
}

function matches(e: ScheduleEvent, q: string): boolean {
  const hay = `${e.title} ${e.location} ${e.notes} ${e.ownerName ?? ''} ${(e.guests ?? []).map((g) => g.name).join(' ')}`.toLowerCase();
  return q
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((w) => hay.includes(w));
}

function listFor(req: Request, cal: CalendarId): Record<string, unknown> {
  const zone = tz();
  const reader = me(req);
  const { from, to } = rangeDays(req.query.timeMin, req.query.timeMax, zone);
  const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
  const single = req.query.singleEvents === 'true';
  let events = listEventsFor(reader, from, to).filter((e) => inCalendar(e, cal, reader) && !e.hidden);
  if (q) events = events.filter((e) => matches(e, q));
  const base = origin(req);
  let items: Record<string, unknown>[];
  if (single) items = events.map((e) => toGoogleEvent(e, reader, base));
  else {
    // a series once, as its rule; a day of it changed on its own, besides; an event of its own as it is
    const seen = new Set<number>();
    items = [];
    for (const e of events) {
      if (!e.seriesId) items.push(toGoogleEvent(e, reader, base));
      else if (e.detached) items.push(toGoogleEvent(e, reader, base));
      if (e.seriesId && !seen.has(e.seriesId)) {
        seen.add(e.seriesId);
        items.push(toGoogleMaster(e, reader, base));
      }
    }
  }
  if (req.query.orderBy === 'updated') items.sort((a, b) => String(a.updated).localeCompare(String(b.updated)));
  const max = Math.min(2500, Math.max(1, Number(req.query.maxResults) || 250));
  const start = Math.max(0, Number(req.query.pageToken) || 0);
  const page = items.slice(start, start + max);
  const s = getSettings();
  return {
    kind: 'calendar#events',
    summary: cal === 'course' ? s.courseName : reader.display_name,
    timeZone: zone,
    updated: clock.now().toISOString(),
    accessRole: cal === 'primary' ? 'owner' : 'writer',
    defaultReminders: [{ method: 'popup', minutes: 30 }],
    items: page,
    ...(start + max < items.length ? { nextPageToken: String(start + max) } : {}),
  };
}

/** "123" is one event (or one day of a series); "r45" is series 45 as a whole */
function resolveId(raw: string): { id: number; series: boolean } {
  const m = /^(r?)(\d+)$/.exec(raw);
  if (!m) throw notFound('האירוע לא נמצא');
  if (!m[1]) return { id: Number(m[2]), series: false };
  // the series' first live day stands for it
  const first = db().get<{ id: number }>('SELECT id FROM events WHERE recurrence_id = ? AND deleted_at IS NULL ORDER BY original_date LIMIT 1', Number(m[2]));
  if (!first) throw notFound('האירוע לא נמצא');
  return { id: first.id, series: true };
}

function getFor(req: Request, raw: string): Record<string, unknown> {
  const { id, series } = resolveId(raw);
  const e = eventDetail(me(req), id).event;
  return series ? toGoogleMaster(e, me(req), origin(req)) : toGoogleEvent(e, me(req), origin(req));
}

// ---------------- the routes ----------------

export function gcalRouter(): Router {
  const r = Router();

  r.get('/colors', (_req, res) => {
    const calendar = Object.fromEntries(GOOGLE_COLORS.map((c, i) => [String(i + 1), { background: c.hex, foreground: fg(c.hex) }]));
    const event = Object.fromEntries(CAL_COLORS.map((c) => [EVENT_COLOR_ID[c], { background: CAL_COLOR_HEX[c], foreground: fg(CAL_COLOR_HEX[c]) }]));
    res.json({ kind: 'calendar#colors', updated: '2026-10-29T00:00:00.000Z', calendar, event });
  });

  r.get('/users/me/calendarList', (req, res) => {
    const s = getSettings();
    const u = me(req);
    const entry = (id: CalendarId, summary: string, color: string, extra: Record<string, unknown>) => ({
      kind: 'calendar#calendarListEntry',
      id,
      summary,
      timeZone: tz(),
      backgroundColor: color,
      foregroundColor: fg(color),
      selected: true,
      defaultReminders: [{ method: 'popup', minutes: 30 }],
      ...extra,
    });
    res.json({
      kind: 'calendar#calendarList',
      items: [entry('course', s.courseName, CAL_COLOR_HEX.blue, { accessRole: 'writer' }), entry('primary', u.display_name, CAL_COLOR_HEX.teal, { accessRole: 'owner', primary: true })],
    });
  });

  r.get('/calendars/:cal', (req, res) => {
    const cal = calendarOf(req.params.cal);
    res.json({ kind: 'calendar#calendar', id: cal, summary: cal === 'course' ? getSettings().courseName : me(req).display_name, timeZone: tz() });
  });

  r.get('/calendars/:cal/events', (req, res) => res.json(listFor(req, calendarOf(req.params.cal))));

  r.post('/calendars/:cal/events/quickAdd', (req, res) => {
    const cal = calendarOf(req.params.cal);
    const text = String(req.query.text ?? (req.body as { text?: string })?.text ?? '').trim();
    if (!text) throw badRequest('אין טקסט');
    const zone = tz();
    const users = db().all<{ id: number; display_name: string; title: string; username: string }>('SELECT id, display_name, title, username FROM users WHERE active = 1');
    const parsed = parseEventText(text, { users: users.map((u) => ({ id: u.id, displayName: u.display_name, title: u.title, username: u.username })), defaultDate: localDateKey(clock.now(), zone), now: clock.now(), tz: zone });
    const id = createEvent(me(req), {
      title: parsed.title || text,
      date: parsed.date,
      startTime: parsed.startTime ?? '00:00',
      endTime: parsed.endTime,
      allDay: !parsed.startTime,
      location: parsed.location,
      ownerId: parsed.ownerId,
      calendar: toCalendar(cal),
    });
    res.json(getFor(req, String(id)));
  });

  r.post('/calendars/:cal/events', (req, res) => {
    const cal = calendarOf(req.params.cal);
    const g = googleEventSchema.parse(req.body ?? {});
    const input = fromGoogle(g, tz());
    if (!input.date || !input.title) throw badRequest('חסרים כותרת (summary) או זמן (start)');
    const id = createEvent(me(req), { ...(input as z.input<typeof eventSchema>), calendar: toCalendar(cal) });
    // the maker's own answer, when they are among the guests
    const self = g.attendees?.find((a) => a.self && a.responseStatus && (RESPONSES as readonly string[]).includes(a.responseStatus));
    if (self) respondEvent(me(req), id, self.responseStatus as (typeof RESPONSES)[number]);
    res.json(getFor(req, String(id)));
  });

  r.get('/calendars/:cal/events/:eventId', (req, res) => {
    calendarOf(req.params.cal);
    res.json(getFor(req, req.params.eventId));
  });

  r.get('/calendars/:cal/events/:eventId/instances', (req, res) => {
    calendarOf(req.params.cal);
    const { id } = resolveId(req.params.eventId);
    const e = eventDetail(me(req), id).event;
    if (!e.seriesId) {
      res.json({ kind: 'calendar#events', items: [toGoogleEvent(e, me(req), origin(req))] });
      return;
    }
    const { from, to } = rangeDays(req.query.timeMin, req.query.timeMax, tz());
    const items = listEventsFor(me(req), from, to)
      .filter((x) => x.seriesId === e.seriesId)
      .map((x) => toGoogleEvent(x, me(req), origin(req)));
    res.json({ kind: 'calendar#events', timeZone: tz(), items });
  });

  const change = (req: Request) => {
    calendarOf(req.params.cal as string);
    const { id, series } = resolveId(req.params.eventId as string);
    const g = googleEventSchema.parse(req.body ?? {});
    const scopeParam = (SERIES_SCOPES as readonly string[]).includes(String(req.query.scope)) ? (req.query.scope as SeriesScope) : null;
    const scope: SeriesScope = scopeParam ?? (series ? 'all' : 'one');
    const u = me(req);
    // a guest's own answer, as Google takes it: the attendee that is "self", with its responseStatus
    const answer = g.attendees?.find((a) => (a.self || a.id === String(u.id)) && a.responseStatus);
    const others = Object.keys(g).filter((k) => k !== 'attendees');
    if (answer && !others.length && (RESPONSES as readonly string[]).includes(answer.responseStatus!)) {
      respondEvent(u, id, answer.responseStatus as GuestResponse & (typeof RESPONSES)[number], series ? 'all' : 'one');
      return getFor(req, req.params.eventId as string);
    }
    // back from the trash, as Google takes it: status "confirmed" on a deleted event
    if (db().get('SELECT 1 FROM events WHERE id = ? AND deleted_at IS NOT NULL', id)) {
      if (g.status !== 'confirmed') throw notFound('האירוע נמחק');
      untrashEvent(u, id);
      if (!others.some((k) => k !== 'status')) return getFor(req, req.params.eventId as string);
    }
    const input = fromGoogle(g, tz());
    updateEvent(u, id, input, scope);
    return getFor(req, req.params.eventId as string);
  };
  r.patch('/calendars/:cal/events/:eventId', (req, res) => res.json(change(req)));
  r.put('/calendars/:cal/events/:eventId', (req, res) => res.json(change(req)));

  r.delete('/calendars/:cal/events/:eventId', (req, res) => {
    calendarOf(req.params.cal);
    const { id, series } = resolveId(req.params.eventId);
    const scopeParam = (SERIES_SCOPES as readonly string[]).includes(String(req.query.scope)) ? (req.query.scope as SeriesScope) : null;
    deleteEvent(me(req), id, scopeParam ?? (series ? 'all' : 'one'));
    res.status(204).end();
  });

  r.post('/calendars/:cal/events/:eventId/move', (req, res) => {
    calendarOf(req.params.cal);
    const dest = calendarOf(String(req.query.destination ?? ''));
    const { id, series } = resolveId(req.params.eventId);
    updateEvent(me(req), id, { calendar: toCalendar(dest) }, series ? 'all' : 'one');
    res.json(getFor(req, req.params.eventId));
  });

  // who is busy when: the staff's events they run or are in (not declined, not "free")
  r.post('/freeBusy', (req, res) => {
    const body = z.object({ timeMin: z.string(), timeMax: z.string(), items: z.array(z.object({ id: z.string() })).max(50) }).parse(req.body ?? {});
    const zone = tz();
    const { from, to } = rangeDays(body.timeMin, body.timeMax, zone);
    const min = new Date(body.timeMin).getTime();
    const max = new Date(body.timeMax).getTime();
    const calendars: Record<string, { busy: { start: string; end: string }[] }> = {};
    for (const { id } of body.items) {
      const uid = id === 'primary' ? me(req).id : /^\d+$/.test(id) ? Number(id) : null;
      if (!uid) {
        calendars[id] = { busy: [] };
        continue;
      }
      const reader = db().get<UserRow>('SELECT * FROM users WHERE id = ?', uid);
      if (!reader) {
        calendars[id] = { busy: [] };
        continue;
      }
      const busy = listEventsFor(reader, from, to)
        .filter((e) => !e.cancelled && e.transparency !== 'transparent' && e.myResponse !== 'declined' && (e.ownerId === uid || e.createdBy === uid && e.calendar === 'personal' || !!e.guests?.some((g) => g.userId === uid)))
        .map((e) => {
          const s = startOf(e, zone);
          const en = endOf(e, zone);
          return { start: s.dateTime ?? zonedIso(s.date!, '00:00', zone), end: en.dateTime ?? zonedIso(en.date!, '00:00', zone) };
        })
        .filter((b) => Date.parse(b.end) > min && Date.parse(b.start) < max);
      calendars[id] = { busy };
    }
    res.json({ kind: 'calendar#freeBusy', timeMin: body.timeMin, timeMax: body.timeMax, calendars });
  });

  return r;
}
