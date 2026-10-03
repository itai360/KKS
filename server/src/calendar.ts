// Google Calendar, both ways, without a Google account for the server:
// - out: every user has a secret link to the schedule in iCal format, which
//   Google Calendar (or any calendar app) subscribes to.
// - in: the commander adds a calendar's iCal address (in Google Calendar:
//   the calendar's settings, "Secret address in iCal format"), and its events
//   appear in the schedule, read-only.

import { randomBytes } from 'node:crypto';
import ICAL from 'ical.js';
import type { CalendarFeed, CalendarSource, CalendarWeek, CalendarWeeksPreview, ExternalEvent, ScheduleEvent, Week } from '../../shared/types';
import { addDays, diffDays, localDateKey, localTime, zonedToUtc } from '../../shared/dates';
import type { UserRow } from './auth';
import { badRequest, clock, getSettings, notFound, nowIso, tz, updateSettings } from './core';
import { safeFetch } from './netguard';
import { db } from './db';
import { listEvents } from './schedule';
import { createWeek, inferWeekNumber, listWeeks, updateWeek } from './weeks';

// ---------------- out: the schedule as an iCal feed ----------------

/** The user's feed token, created on first use. */
function feedToken(userId: number): string {
  const row = db().get<{ calendar_token: string | null }>('SELECT calendar_token FROM users WHERE id = ?', userId);
  if (row?.calendar_token) return row.calendar_token;
  return rotateFeedToken(userId);
}

/** A new link; the old one stops working. */
export function rotateFeedToken(userId: number): string {
  const token = randomBytes(24).toString('base64url');
  db().run('UPDATE users SET calendar_token = ? WHERE id = ?', token, userId);
  return token;
}

export function calendarFeed(userId: number, origin: string, rotate = false): CalendarFeed {
  const token = rotate ? rotateFeedToken(userId) : feedToken(userId);
  const url = `${origin}/api/ics/${token}.ics`;
  return { url, googleUrl: `https://calendar.google.com/calendar/r?cid=${encodeURIComponent(url.replace(/^https?:/, 'webcal:'))}` };
}

export function userForFeedToken(token: string): UserRow | undefined {
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) return undefined;
  return db().get<UserRow>('SELECT * FROM users WHERE calendar_token = ? AND active = 1', token);
}

const escapeText = (s: string) => s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
const utcStamp = (d: Date) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');

/** Lines longer than 75 bytes continue on the next line after a space (RFC 5545), never inside a letter. */
function fold(line: string): string {
  if (Buffer.byteLength(line) <= 75) return line;
  const parts: string[] = [];
  let cur = '';
  let bytes = 0;
  for (const ch of line) {
    const b = Buffer.byteLength(ch);
    if (bytes + b > (parts.length ? 74 : 75)) {
      parts.push(cur);
      cur = '';
      bytes = 0;
    }
    cur += ch;
    bytes += b;
  }
  parts.push(cur);
  return parts.join('\r\n ');
}

function eventLines(e: ScheduleEvent, origin: string, zone: string, stamp: string): string[] {
  const start = zonedToUtc(e.date, e.startTime, zone);
  let end = e.endTime ? zonedToUtc(e.date, e.endTime, zone) : new Date(start.getTime() + 3600_000);
  if (end <= start) end = new Date(end.getTime() + 86_400_000); // ends after midnight
  const link = `${origin}/schedule?date=${e.date}&event=${e.id}`;
  const description = [e.notes, e.ownerName ? `אחראי: ${e.ownerName}` : '', link].filter(Boolean).join('\n');
  return [
    'BEGIN:VEVENT',
    `UID:kks-event-${e.id}@${new URL(origin).host}`,
    `DTSTAMP:${stamp}`,
    `DTSTART:${utcStamp(start)}`,
    `DTEND:${utcStamp(end)}`,
    `SUMMARY:${escapeText(e.cancelled ? `(בוטל) ${e.title}` : e.title)}`,
    ...(e.location ? [`LOCATION:${escapeText(e.location)}`] : []),
    `DESCRIPTION:${escapeText(description)}`,
    `URL:${link}`,
    `STATUS:${e.cancelled ? 'CANCELLED' : 'CONFIRMED'}`,
    'END:VEVENT',
  ];
}

/** The course schedule from two months back to a year ahead. */
export function scheduleIcs(origin: string): string {
  const zone = tz();
  const today = localDateKey(clock.now(), zone);
  const s = getSettings();
  const stamp = utcStamp(clock.now());
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//KKS//Course schedule//HE',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeText(`${s.courseSymbol || s.courseName || 'קורס'} - לו"ז`)}`,
    `X-WR-TIMEZONE:${zone}`,
    'REFRESH-INTERVAL;VALUE=DURATION:PT1H',
    'X-PUBLISHED-TTL:PT1H',
    ...listEvents(addDays(today, -60), addDays(today, 365)).flatMap((e) => eventLines(e, origin, zone, stamp)),
    'END:VCALENDAR',
  ];
  return lines.map(fold).join('\r\n') + '\r\n';
}

// ---------------- in: calendars shown in the schedule ----------------

const MAX_SOURCES = 8;
const REFRESH_MS = 10 * 60_000;
const MAX_BYTES = 5_000_000;

interface SourceRow {
  id: number;
  name: string;
  url: string;
}

/** https only, and never a local or private address. */
export function normalizeCalendarUrl(raw: string): string {
  let u: URL;
  try {
    u = new URL(raw.trim().replace(/^webcals?:\/\//i, 'https://'));
  } catch {
    throw badRequest('כתובת היומן אינה תקינה');
  }
  if (u.protocol === 'http:') u.protocol = 'https:';
  if (u.protocol !== 'https:') throw badRequest('כתובת היומן צריכה להתחיל ב-https');
  const host = u.hostname.toLowerCase();
  const ipLiteral = /^\d+\.\d+\.\d+\.\d+$/.test(host) || host.includes(':') || host.startsWith('[');
  if (ipLiteral || host === 'localhost' || !host.includes('.') || /\.(local|internal|localhost)$/.test(host)) {
    throw badRequest('כתובת היומן צריכה להיות כתובת אינטרנט ציבורית');
  }
  return u.toString();
}

interface Cached {
  at: number;
  root: ICAL.Component | null;
  error: string | null;
}
const cache = new Map<string, Cached>(); // by address; each server instance keeps its own

let fetcher = async (url: string): Promise<string> => {
  // an address the commander pasted: it may not lead into the server's own network, redirects included
  const res = await safeFetch(url, { headers: { Accept: 'text/calendar' }, signal: AbortSignal.timeout(6000) });
  if (!res.ok) throw new Error(res.status === 404 ? 'היומן לא נמצא בכתובת הזו' : `שרת היומן החזיר שגיאה ${res.status}`);
  if (Number(res.headers.get('content-length')) > MAX_BYTES) throw new Error('היומן גדול מדי');
  const text = await res.text();
  if (text.length > MAX_BYTES) throw new Error('היומן גדול מדי');
  return text;
};

/** Tests replace the network. */
export function setCalendarFetcher(fn: typeof fetcher): void {
  fetcher = fn;
  cache.clear();
}

function parseCalendar(text: string): ICAL.Component {
  let root: ICAL.Component;
  try {
    root = new ICAL.Component(ICAL.parse(text));
  } catch {
    throw new Error('הקובץ בכתובת הזו אינו יומן בפורמט iCal');
  }
  if (root.name !== 'vcalendar') throw new Error('הקובץ בכתובת הזו אינו יומן בפורמט iCal');
  for (const vtz of root.getAllSubcomponents('vtimezone')) {
    const id = String(vtz.getFirstPropertyValue('tzid') ?? '');
    if (id && !ICAL.TimezoneService.has(id)) ICAL.TimezoneService.register(vtz);
  }
  return root;
}

async function loadSource(url: string, force = false): Promise<Cached> {
  const hit = cache.get(url);
  if (hit && !force && Date.now() - hit.at < REFRESH_MS) return hit;
  let entry: Cached;
  try {
    entry = { at: Date.now(), root: parseCalendar(await fetcher(url)), error: null };
  } catch (e) {
    const message = e instanceof Error && /[֐-׿]/.test(e.message) ? e.message : 'לא ניתן לקרוא את היומן כרגע';
    // keep showing the last good copy while the calendar cannot be reached
    entry = { at: Date.now(), root: hit?.root ?? null, error: message };
  }
  cache.set(url, entry);
  return entry;
}

const validZones = new Map<string, boolean>();
function isZone(id: string): boolean {
  if (!validZones.has(id)) {
    try {
      new Intl.DateTimeFormat('en', { timeZone: id });
      validZones.set(id, true);
    } catch {
      validZones.set(id, false);
    }
  }
  return validZones.get(id)!;
}

const pad = (n: number) => String(n).padStart(2, '0');
const keyOf = (t: ICAL.Time) => `${t.year}-${pad(t.month)}-${pad(t.day)}`;

/** The moment a calendar time stands for. */
function instant(t: ICAL.Time, fallbackZone: string): Date {
  const id = t.zone?.tzid ?? '';
  if (id === 'UTC' || (id && id !== 'floating' && ICAL.TimezoneService.has(id))) return t.toJSDate();
  // floating, or a zone the file does not describe: the wall clock in that zone when it is a known one, else the course's
  const named = (t as unknown as { timezone?: string }).timezone ?? id;
  const zone = named && named !== 'floating' && isZone(named) ? named : fallbackZone;
  return zonedToUtc(keyOf(t), `${pad(t.hour)}:${pad(t.minute)}`, zone);
}

function expand(source: SourceRow, root: ICAL.Component, from: string, to: string, zone: string): ExternalEvent[] {
  const out: ExternalEvent[] = [];
  const windowStart = zonedToUtc(from, '00:00', zone);
  const windowEnd = zonedToUtc(addDays(to, 1), '00:00', zone);
  const masters = new Map<string, ICAL.Event>();
  const exceptions: ICAL.Component[] = [];
  for (const ve of root.getAllSubcomponents('vevent')) {
    if (ve.hasProperty('recurrence-id')) exceptions.push(ve);
    else masters.set(String(ve.getFirstPropertyValue('uid') ?? `noid-${masters.size}`), new ICAL.Event(ve));
  }
  for (const ex of exceptions) {
    const master = masters.get(String(ex.getFirstPropertyValue('uid') ?? ''));
    if (master) master.relateException(ex);
    else masters.set(`orphan-${masters.size}`, new ICAL.Event(ex));
  }

  const emit = (ev: ICAL.Event, start: ICAL.Time, end: ICAL.Time | null) => {
    if (String(ev.component.getFirstPropertyValue('status') ?? '').toUpperCase() === 'CANCELLED') return;
    const base = { sourceId: source.id, sourceName: source.name, title: ev.summary?.trim() || '(ללא כותרת)', location: ev.location?.trim() ?? '' };
    if (start.isDate) {
      const first = keyOf(start);
      const last = end && end.isDate ? addDays(keyOf(end), -1) : first; // the end date of an all-day event is not included
      for (let d = first, n = 0; d <= last && n < 62; d = addDays(d, 1), n++) {
        if (d >= from && d <= to) out.push({ ...base, id: `${source.id}:${ev.uid}:${d}`, date: d, startTime: null, endTime: null });
      }
      return;
    }
    const s = instant(start, zone);
    const e = end ? instant(end, zone) : s;
    if (e < windowStart || s >= windowEnd) return;
    const date = localDateKey(s, zone);
    if (date < from || date > to) return;
    out.push({
      ...base,
      id: `${source.id}:${ev.uid}:${s.toISOString()}`,
      date,
      startTime: localTime(s, zone),
      endTime: e > s && localDateKey(e, zone) === date ? localTime(e, zone) : null,
    });
  };

  for (const ev of masters.values()) {
    try {
      if (!ev.isRecurring()) {
        emit(ev, ev.startDate, ev.endDate);
        continue;
      }
      const it = ev.iterator();
      for (let next = it.next(), n = 0; next && n < 20_000; next = it.next(), n++) {
        if (instant(next, zone) >= windowEnd) break;
        const d = ev.getOccurrenceDetails(next);
        emit(d.item, d.startDate, d.endDate);
      }
    } catch {
      /* one malformed event does not hide the rest */
    }
  }
  return out;
}

export function listCalendarSources(asCommander: boolean): CalendarSource[] {
  return db()
    .all<SourceRow>('SELECT id, name, url FROM calendar_sources ORDER BY id')
    .map((r) => ({ id: r.id, name: r.name, url: asCommander ? r.url : null, error: cache.get(r.url)?.error ?? null }));
}

/** Checks the address right away, so a wrong one is reported while adding it. */
export async function addCalendarSource(actor: UserRow, name: string, rawUrl: string): Promise<void> {
  const url = normalizeCalendarUrl(rawUrl);
  if (db().get<{ n: number }>('SELECT count(*) AS n FROM calendar_sources')!.n >= MAX_SOURCES) throw badRequest(`אפשר לחבר עד ${MAX_SOURCES} יומנים`);
  if (db().get('SELECT 1 FROM calendar_sources WHERE url = ?', url)) throw badRequest('היומן הזה כבר מחובר');
  const loaded = await loadSource(url, true);
  if (!loaded.root) throw badRequest(loaded.error ?? 'לא ניתן לקרוא את היומן');
  db().run('INSERT INTO calendar_sources(name, url, created_by, created_at) VALUES (?, ?, ?, ?)', name.trim() || 'יומן Google', url, actor.id, nowIso());
}

export function removeCalendarSource(id: number): void {
  const row = db().get<SourceRow>('SELECT id, name, url FROM calendar_sources WHERE id = ?', id);
  if (!row) throw notFound('היומן לא נמצא');
  db().run('DELETE FROM calendar_sources WHERE id = ?', id);
  cache.delete(row.url);
}

/** Events of the connected calendars between two dates (up to two months). */
export async function externalEvents(from: string, to: string): Promise<ExternalEvent[]> {
  if (diffDays(to, from) > 62) to = addDays(from, 62);
  const zone = tz();
  const sources = db().all<SourceRow>('SELECT id, name, url FROM calendar_sources ORDER BY id');
  const loaded = await Promise.all(sources.map(async (s) => ({ s, c: await loadSource(s.url) })));
  return loaded
    .flatMap(({ s, c }) => (c.root ? expand(s, c.root, from, to, zone) : []))
    .sort((a, b) => a.date.localeCompare(b.date) || (a.startTime ?? '').localeCompare(b.startTime ?? ''));
}

// ---------------- course weeks from a calendar ----------------
// A week is an event whose title starts with "שבוע" (a one-day marker covers
// the days until the next week), or any event of 3 to 14 days. Events inside
// another week are not weeks of their own. Repeating events are left out.

const WEEKS_URL_KEY = 'weeks_calendar_url';
const STARTS_WITH_WEEK = /^\s*שבוע(?![\u0590-\u05FF])/; // not "שבועות" (the holiday)

interface Candidate {
  uid: string;
  name: string;
  startDate: string;
  endDate: string;
  number: number | null;
  strong: boolean;
  marker: boolean; // one day: stands for the week that starts there
}

function weekCandidates(root: ICAL.Component, zone: string): { found: Candidate[]; total: number } {
  const all: Candidate[] = [];
  let total = 0;
  for (const ve of root.getAllSubcomponents('vevent')) {
    if (ve.hasProperty('recurrence-id')) continue;
    total++;
    if (ve.hasProperty('rrule') || String(ve.getFirstPropertyValue('status') ?? '').toUpperCase() === 'CANCELLED') continue;
    try {
      const ev = new ICAL.Event(ve);
      const name = ev.summary?.trim() ?? '';
      if (!name || !ev.startDate) continue;
      let start: string;
      let end: string;
      if (ev.startDate.isDate) {
        start = keyOf(ev.startDate);
        end = ev.endDate?.isDate ? addDays(keyOf(ev.endDate), -1) : start; // the end date of an all-day event is not included
      } else {
        const s = instant(ev.startDate, zone);
        const e = ev.endDate ? instant(ev.endDate, zone) : s;
        start = localDateKey(s, zone);
        end = localDateKey(new Date(Math.max(s.getTime(), e.getTime() - 1)), zone); // ending at midnight belongs to the day before
      }
      if (end < start) end = start;
      const days = diffDays(end, start) + 1;
      const strong = STARTS_WITH_WEEK.test(name);
      if (strong ? days > 21 : days < 3 || days > 14) continue;
      const n = /שבוע\s*(\d{1,3})/.exec(name);
      all.push({ uid: ev.uid || `${start}:${name}`, name: name.slice(0, 80), startDate: start, endDate: end, number: n ? Number(n[1]) : null, strong, marker: strong && days === 1 });
    } catch {
      /* a malformed event is skipped */
    }
  }
  all.sort((a, b) => a.startDate.localeCompare(b.startDate) || a.endDate.localeCompare(b.endDate));
  // a one-day "שבוע" marker runs until the day before the next week, at most a week
  const strongStarts = [...new Set(all.filter((c) => c.strong).map((c) => c.startDate))];
  for (const c of all) {
    if (!c.marker) continue;
    const next = strongStarts.find((d) => d > c.startDate);
    const limit = addDays(c.startDate, 6);
    c.endDate = next && addDays(next, -1) < limit ? addDays(next, -1) : limit;
  }
  const overlaps = (a: Candidate, b: Candidate) => a.startDate <= b.endDate && b.startDate <= a.endDate;
  // inside another week (a three-day exercise in week 3), or the same dates twice: not a week of its own
  const outermost = (list: Candidate[]) =>
    list.filter(
      (c, i) =>
        !list.some(
          (o, j) => j !== i && o.startDate <= c.startDate && o.endDate >= c.endDate && (o.startDate !== c.startDate || o.endDate !== c.endDate || j < i),
        ),
    );
  // events named "שבוע" define the weeks; a long event only counts where there are none
  const strong = outermost(all.filter((c) => c.strong));
  const weak = outermost(all.filter((c) => !c.strong && !strong.some((o) => overlaps(o, c))));
  const found = [...strong, ...weak].sort((a, b) => a.startDate.localeCompare(b.startDate));
  return { found, total };
}

function matchWeeks(found: Candidate[]): CalendarWeek[] {
  const weeks = db().all<{ id: number; number: number; name: string; start_date: string; end_date: string; calendar_uid: string | null }>(
    'SELECT id, number, name, start_date, end_date, calendar_uid FROM weeks',
  );
  // strongest evidence first for every week: imported from this event, then the same start day, then the same number
  const match = new Map<Candidate, (typeof weeks)[number]>();
  const used = new Set<number>();
  const tests: ((c: Candidate, w: (typeof weeks)[number]) => boolean)[] = [
    (c, w) => w.calendar_uid === c.uid,
    (c, w) => !w.calendar_uid && w.start_date === c.startDate,
    (c, w) => !w.calendar_uid && c.number !== null && w.number === c.number,
  ];
  for (const test of tests) {
    for (const c of found) {
      if (match.has(c)) continue;
      const w = weeks.find((x) => !used.has(x.id) && test(c, x));
      if (w) {
        match.set(c, w);
        used.add(w.id);
      }
    }
  }
  return found.map((c) => {
    const w = match.get(c);
    if (!w) return { uid: c.uid, name: c.name, startDate: c.startDate, endDate: c.endDate, number: c.number, weekId: null, action: 'create' as const, changes: [] };
    const changes = [
      ...(w.name !== c.name ? [`שם: ${w.name} ← ${c.name}`] : []),
      ...(w.start_date !== c.startDate || w.end_date !== c.endDate ? ['תאריכים'] : []),
    ];
    return { uid: c.uid, name: c.name, startDate: c.startDate, endDate: c.endDate, number: c.number, weekId: w.id, action: changes.length ? ('update' as const) : ('same' as const), changes };
  });
}

/** The calendar the weeks were last imported from (the commander's). */
export function weeksCalendarUrl(): string | null {
  return db().get<{ value: string }>('SELECT value FROM meta WHERE key = ?', WEEKS_URL_KEY)?.value ?? null;
}

export async function previewCalendarWeeks(rawUrl: string): Promise<CalendarWeeksPreview> {
  const url = normalizeCalendarUrl(rawUrl);
  const loaded = await loadSource(url, true);
  if (!loaded.root) throw badRequest(loaded.error ?? 'לא ניתן לקרוא את היומן');
  const { found, total } = weekCandidates(loaded.root, tz());
  return { weeks: matchWeeks(found), ignored: total - found.length };
}

export interface ApplyWeek {
  uid: string;
  name: string;
  startDate: string;
  endDate: string;
  number: number | null;
  weekId: number | null;
}

/** Creates and updates the chosen weeks, each linked to its event for the next update. */
export function applyCalendarWeeks(actor: UserRow, rawUrl: string, items: ApplyWeek[]): Week[] {
  const url = normalizeCalendarUrl(rawUrl);
  // a week whose name has no number ("שבוע סף") is numbered from its neighbours that have one
  // ("שבוע 39 ..." a week later -> 38), not as the next after all the others
  const numbered = items.filter((it) => it.number !== null).map((it) => ({ number: it.number!, startDate: it.startDate }));
  if (numbered.length) items = items.map((it) => (it.number === null ? { ...it, number: inferWeekNumber(it.startDate, numbered) } : it));
  db().tx(() => {
    for (const it of items) {
      let id = it.weekId;
      if (id) {
        updateWeek(actor, id, { name: it.name, startDate: it.startDate, endDate: it.endDate, ...(it.number !== null ? { number: it.number } : {}) });
      } else {
        id = createWeek(actor, { name: it.name, startDate: it.startDate, endDate: it.endDate, ...(it.number !== null ? { number: it.number } : {}) });
      }
      db().run('UPDATE weeks SET calendar_uid = NULL WHERE calendar_uid = ? AND id <> ?', it.uid, id);
      db().run('UPDATE weeks SET calendar_uid = ? WHERE id = ?', it.uid, id);
    }
    db().run('INSERT INTO meta(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', WEEKS_URL_KEY, url);
    // the course dates cover every week
    const range = db().get<{ a: string | null; b: string | null }>('SELECT min(start_date) AS a, max(end_date) AS b FROM weeks');
    const s = getSettings();
    if (range?.a && range.b) {
      updateSettings({ startDate: s.startDate && s.startDate < range.a ? s.startDate : range.a, endDate: s.endDate && s.endDate > range.b ? s.endDate : range.b });
    }
  });
  return listWeeks();
}
