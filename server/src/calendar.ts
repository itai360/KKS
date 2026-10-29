// Google Calendar, both ways, without a Google account for the server:
// - out: every user has a secret link to the schedule in iCal format, which
//   Google Calendar (or any calendar app) subscribes to.
// - in: the commander adds a calendar's iCal address (in Google Calendar:
//   the calendar's settings, "Secret address in iCal format"), and its events
//   appear in the schedule, read-only.

import { createHash, randomBytes } from 'node:crypto';
import { gunzipSync, gzipSync } from 'node:zlib';
import ICAL from 'ical.js';
import type { CalendarFeed, CalendarSource, CalendarWeek, CalendarWeeksPreview, ExternalEvent, PlanCalendars, ScheduleEvent, Week } from '../../shared/types';
import { addDays, diffDays, localDateKey, localTime, zonedToUtc } from '../../shared/dates';
import { isGoogleColor, type GoogleColor } from '../../shared/calendarLayers';
import type { UserRow } from './auth';
import { badRequest, clock, getSettings, notFound, nowIso, tz, updateSettings } from './core';
import { readLimited, safeFetch } from './netguard';
import { db } from './db';
import { getFile, putFile, removeFile } from './files';
import { listEventsFor } from './schedule';
import { queryTasks, type TaskRow } from './taskRepo';
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

/** an all-day event's day as iCal writes it: 20261025 */
const icalDay = (d: string) => d.replace(/-/g, '');

function eventLines(e: ScheduleEvent, origin: string, zone: string, stamp: string): string[] {
  const link = `${origin}/schedule?date=${e.date}&event=${e.id}`;
  const description = [e.notes, e.ownerName ? `אחראי: ${e.ownerName}` : '', link].filter(Boolean).join('\n');
  // all day, over one day or several: calendar days, the end the day after the last (as iCal has it)
  let when: string[];
  if (e.allDay) {
    when = [`DTSTART;VALUE=DATE:${icalDay(e.date)}`, `DTEND;VALUE=DATE:${icalDay(addDays(e.endDate ?? e.date, 1))}`];
  } else {
    const start = zonedToUtc(e.date, e.startTime, zone);
    let end = e.endTime ? zonedToUtc(e.date, e.endTime, zone) : new Date(start.getTime() + 3600_000);
    if (end <= start) end = new Date(end.getTime() + 86_400_000); // ends after midnight
    when = [`DTSTART:${utcStamp(start)}`, `DTEND:${utcStamp(end)}`];
  }
  return [
    'BEGIN:VEVENT',
    `UID:kks-event-${e.id}@${new URL(origin).host}`,
    `DTSTAMP:${stamp}`,
    ...when,
    `SUMMARY:${escapeText(e.cancelled ? `(בוטל) ${e.title}` : e.title)}`,
    ...(e.location ? [`LOCATION:${escapeText(e.location)}`] : []),
    `DESCRIPTION:${escapeText(description)}`,
    `URL:${link}`,
    `STATUS:${e.cancelled ? 'CANCELLED' : 'CONFIRMED'}`,
    // free (not "busy") and private, as Google reads them
    ...(e.transparency === 'transparent' ? ['TRANSP:TRANSPARENT'] : []),
    ...(e.visibility === 'private' ? ['CLASS:PRIVATE'] : []),
    'END:VEVENT',
  ];
}

/** one of the feed's owner's tasks still open: half an hour that ends at its deadline - not "busy" time */
function taskLines(t: TaskRow, origin: string, stamp: string): string[] {
  const end = new Date(t.deadline);
  const start = new Date(end.getTime() - 30 * 60_000);
  const link = `${origin}/tasks/${t.id}`;
  const about = t.description.length > 400 ? `${t.description.slice(0, 400)}…` : t.description;
  return [
    'BEGIN:VEVENT',
    `UID:kks-task-${t.id}@${new URL(origin).host}`,
    `DTSTAMP:${stamp}`,
    `DTSTART:${utcStamp(start)}`,
    `DTEND:${utcStamp(end)}`,
    `SUMMARY:${escapeText(`משימה: ${t.title}`)}`,
    `DESCRIPTION:${escapeText([about, link].filter(Boolean).join('\n'))}`,
    `URL:${link}`,
    'TRANSP:TRANSPARENT',
    'END:VEVENT',
  ];
}

/** what is still open on someone - theirs, or one they take part in - from a month back (late) to a year ahead */
function openTasksOf(userId: number, today: string, zone: string): TaskRow[] {
  return queryTasks(
    `t.status NOT IN ('done', 'cancelled') AND t.deadline >= ? AND t.deadline < ?
     AND (t.owner_id = ? OR EXISTS (SELECT 1 FROM task_participants tp WHERE tp.task_id = t.id AND tp.user_id = ?))`,
    zonedToUtc(addDays(today, -30), '00:00', zone).toISOString(),
    zonedToUtc(addDays(today, 366), '00:00', zone).toISOString(),
    userId,
    userId,
  );
}

/** The course schedule from two months back to a year ahead, with the tasks of the one the link is theirs. */
export function scheduleIcs(origin: string, user: UserRow): string {
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
    `X-WR-CALNAME:${escapeText(`${s.courseSymbol || s.courseName || 'קורס'} - לו"ז ומשימות`)}`,
    `X-WR-TIMEZONE:${zone}`,
    'REFRESH-INTERVAL;VALUE=DURATION:PT1H',
    'X-PUBLISHED-TTL:PT1H',
    // the course's events, the person's own calendar's and those they are invited to - not the ones they declined
    ...listEventsFor(user, addDays(today, -60), addDays(today, 365))
      .filter((e) => e.myResponse !== 'declined')
      .flatMap((e) => eventLines(e, origin, zone, stamp)),
    ...openTasksOf(user.id, today, zone).flatMap((t) => taskLines(t, origin, stamp)),
    'END:VCALENDAR',
  ];
  return lines.map(fold).join('\r\n') + '\r\n';
}

// ---------------- in: calendars shown in the schedule ----------------

const MAX_SOURCES = 12;
const REFRESH_MS = 10 * 60_000;
/** a calendar that could not be read is tried again sooner */
const RETRY_MS = 60_000;
/** how often an instance looks again in the shared store for a calendar it found no copy of */
const SHARED_LOOK_MS = 10_000;
/** a big calendar (a company's, years of events) can take Google a good while to put together */
const MAX_BYTES = 20_000_000;
const FETCH_TIMEOUT_MS = 45_000;
/**
 * What is parsed of it: the events of about a year back and a year ahead (see trimCalendar). Parsed
 * whole, a calendar of many years ran a server instance out of memory.
 */
const KEEP_DAYS = 400;
const MAX_PARSE_BYTES = 3_000_000;
/** the time one calendar's events of some days may take to work out */
const EXPAND_BUDGET_MS = 2_000;
/** how long a page waits for a calendar never read before, before it shows without it (it keeps loading) */
let PAGE_WAIT_MS = 2_500;
/** choosing a calendar: long enough for a wrong address to be reported on the spot */
let CHOOSE_WAIT_MS = 5_000;
let CHECK_WAIT_MS = 8_000;

/** Tests wait less. */
export function setCalendarWaits(page: number, choose: number): void {
  PAGE_WAIT_MS = page;
  CHOOSE_WAIT_MS = CHECK_WAIT_MS = choose;
}

interface SourceRow {
  id: number;
  name: string;
  url: string;
  /** a Google calendar colour (shared/calendarLayers.ts GOOGLE_COLORS), or none chosen */
  color?: string | null;
}

/** https only, and never a local or private address. A Google link that only shows a calendar leads to its iCal. */
export function normalizeCalendarUrl(raw: string, depth = 0): string {
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
  return googleIcal(u, depth) ?? u.toString();
}

const CALENDAR_ID = /^[^\s@/]{1,200}@[^\s@/]{1,120}$/;

/** a "cid" of an "add this calendar" link: the calendar's id - as it is, or in base64 */
function calendarIdOf(cid: string): string | null {
  if (CALENDAR_ID.test(cid)) return cid;
  const decoded = Buffer.from(cid, 'base64').toString('utf8');
  return CALENDAR_ID.test(decoded) ? decoded : null;
}

/**
 * Google Calendar's links that show a calendar rather than give it - the embed link (src=) and the
 * "add this calendar" link (cid=) - lead to the calendar's public iCal address. It is read only if the
 * calendar is public; otherwise its secret address is needed (readError says so).
 */
function googleIcal(u: URL, depth: number): string | null {
  const host = u.hostname.toLowerCase();
  const google = host === 'calendar.google.com' || ((host === 'www.google.com' || host === 'google.com') && u.pathname.startsWith('/calendar'));
  if (!google || u.pathname.includes('/ical/')) return null;
  const srcs = u.searchParams.getAll('src');
  if (srcs.length > 1) throw badRequest('בקישור הזה יש כמה יומנים - חברו כל יומן בנפרד, בכתובת שלו');
  const cid = u.searchParams.get('cid');
  // an "add this calendar" link to a calendar from elsewhere: that calendar's own address
  if (!srcs.length && cid && /^(webcals?|https?):\/\//i.test(cid) && depth < 2) return normalizeCalendarUrl(cid, depth + 1);
  const id = srcs.length ? (CALENDAR_ID.test(srcs[0]) ? srcs[0] : null) : cid ? calendarIdOf(cid) : null;
  if (!id) throw badRequest('זה קישור לדף של Google Calendar ולא ליומן. ב-Google Calendar במחשב: ליד שם היומן ⋮ ← "הגדרות ושיתוף" ← "כתובת סודית בפורמט iCal" - והדביקו אותה כאן');
  return `https://calendar.google.com/calendar/ical/${encodeURIComponent(id)}/public/basic.ics`;
}

/** a Google calendar's iCal address: "public" or "private" (its secret one) */
function googleKind(url: string): 'public' | 'private' | null {
  const m = /^https:\/\/calendar\.google\.com\/calendar\/ical\/[^/]+\/(public|private-[^/]+)\/basic\.ics$/.exec(url);
  return m ? (m[1] === 'public' ? 'public' : 'private') : null;
}

interface Cached {
  at: number;
  root: ICAL.Component | null;
  error: string | null;
  /** the name the calendar has in Google Calendar (X-WR-CALNAME) */
  name: string | null;
  /** read for the first time, not there yet: it keeps loading in the background */
  loading?: boolean;
  /** brought by a reading the commander's last try stopped waiting for: the next try takes it */
  waited?: boolean;
}
const cache = new Map<string, Cached>(); // by address; each server instance keeps its own
/** the readings from Google under way, one per address */
const reading = new Map<string, Promise<Cached>>();
/** when this instance last looked for an address in the shared store */
const sharedLooked = new Map<string, number>();
/** readings under way that a try of the commander's stopped waiting for */
const awaited = new Set<string>();

let fetcher = async (url: string): Promise<string> => {
  // an address the commander pasted: it may not lead into the server's own network, redirects included
  const res = await safeFetch(url, { headers: { Accept: 'text/calendar' }, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!res.ok) throw Object.assign(new Error(res.status === 404 ? 'היומן לא נמצא בכתובת הזו' : `שרת היומן החזיר שגיאה ${res.status}`), { status: res.status });
  return (await readLimited(res, MAX_BYTES, () => new Error('היומן גדול מדי'))).toString('utf8');
};

/** tests: each network of their own keeps its shared copies apart from the others' (other runs included) */
let generation = '';

/** Tests replace the network. */
export function setCalendarFetcher(fn: typeof fetcher): void {
  fetcher = fn;
  generation = randomBytes(6).toString('hex');
  reading.clear();
  awaited.clear();
  forgetCalendarCopies();
}

/** tests: this instance forgets what it read, as a cold one would (the shared copies stay) */
export function forgetCalendarCopies(): void {
  cache.clear();
  sharedLooked.clear();
}

/** the readings still running when a request ends - the serverless platform keeps the instance up for them */
export const calendarReadsSettled = (): Promise<unknown> => Promise.allSettled([...reading.values()]);

const NOT_CALENDAR = 'הקובץ בכתובת הזו אינו יומן בפורמט iCal';

function parseCalendar(text: string): ICAL.Component {
  let root: ICAL.Component;
  try {
    root = new ICAL.Component(ICAL.parse(text));
  } catch {
    throw new Error(NOT_CALENDAR);
  }
  if (root.name !== 'vcalendar') throw new Error(NOT_CALENDAR);
  for (const vtz of root.getAllSubcomponents('vtimezone')) {
    const id = String(vtz.getFirstPropertyValue('tzid') ?? '');
    if (id && !ICAL.TimezoneService.has(id)) ICAL.TimezoneService.register(vtz);
  }
  return root;
}

/** an event of the file kept for parsing: within the days kept, or repeating into them */
function keepEvent(block: string, lo: string, hi: string): boolean {
  const start = /\nDTSTART[^:\r\n]*:(\d{8})/.exec(block)?.[1];
  if (!start) return true;
  if (start > hi) return false;
  if (/\nRRULE:/.test(block)) {
    const until = /\nRRULE:[^\r\n]*UNTIL=(\d{8})/.exec(block)?.[1];
    return !until || until >= lo;
  }
  const end = /\nDTEND[^:\r\n]*:(\d{8})/.exec(block)?.[1] ?? start;
  return end >= lo;
}

/** what the app reads of an event; descriptions, guests, reminders and the like are left out */
const EVENT_PROPS = new Set(['BEGIN', 'END', 'UID', 'DTSTART', 'DTEND', 'DURATION', 'RRULE', 'RDATE', 'EXDATE', 'EXRULE', 'RECURRENCE-ID', 'SUMMARY', 'LOCATION', 'STATUS']);

/** an event's text with only those properties (folded lines follow theirs; inner blocks such as reminders go) */
function slimEvent(block: string): string {
  const out: string[] = [];
  let keep = false;
  let depth = 0;
  for (const raw of block.split('\n')) {
    const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw;
    if (!line) {
      out.push(raw);
      continue;
    }
    if (line[0] === ' ' || line[0] === '\t') {
      if (keep) out.push(raw);
      continue;
    }
    keep = false;
    if (line.startsWith('BEGIN:') && line !== 'BEGIN:VEVENT') depth++;
    else if (line.startsWith('END:') && line !== 'END:VEVENT') depth--;
    else if (depth === 0) {
      keep = EVENT_PROPS.has((/^[A-Za-z0-9-]+/.exec(line)?.[0] ?? '').toUpperCase());
      if (keep) out.push(raw);
    }
  }
  return out.join('\n');
}

/**
 * A calendar's text with only the events of about a year back and a year ahead of `today` (and every
 * repeating one that may still repeat then), each with only what the app reads - straight from the
 * text, before anything is parsed. A company's calendar holds years of events; parsing them all filled
 * a server's memory.
 */
export function trimCalendar(text: string, today: string): string {
  const lo = addDays(today, -KEEP_DAYS).replace(/-/g, '');
  const hi = addDays(today, KEEP_DAYS).replace(/-/g, '');
  const out: string[] = [];
  let pos = 0;
  for (;;) {
    const begin = text.indexOf('\nBEGIN:VEVENT', pos);
    if (begin < 0) break;
    const end = text.indexOf('\nEND:VEVENT', begin);
    if (end < 0) break;
    const lineEnd = text.indexOf('\n', end + 1);
    const stop = lineEnd < 0 ? text.length : lineEnd;
    out.push(text.slice(pos, begin));
    const block = text.slice(begin, stop);
    if (keepEvent(block, lo, hi)) out.push(slimEvent(block));
    pos = stop;
  }
  out.push(text.slice(pos));
  return out.join('');
}

/**
 * A daily or weekly event repeating since long ago starts, as read, from about a year before today: moved
 * forward by whole weeks of its interval, so every occurrence falls where it did - only the years before
 * (never shown) are not walked through again on every page. Not one counted by COUNT, nor BYSETPOS.
 */
function fastForward(root: ICAL.Component, today: string): void {
  const lo = addDays(today, -KEEP_DAYS);
  for (const ve of root.getAllSubcomponents('vevent')) {
    try {
      const rule = ve.getFirstPropertyValue('rrule') as ICAL.Recur | null;
      if (!rule || ve.hasProperty('recurrence-id') || rule.count || (rule.freq !== 'DAILY' && rule.freq !== 'WEEKLY') || rule.parts.BYSETPOS) continue;
      // its time zone must stay as written: one the file does not describe is left as it is
      const tzid = ve.getFirstProperty('dtstart')?.getParameter('tzid');
      if (typeof tzid === 'string' && !ICAL.TimezoneService.has(tzid)) continue;
      const ev = new ICAL.Event(ve, { exceptions: [] });
      const step = 7 * (rule.interval || 1);
      const behind = diffDays(lo, keyOf(ev.startDate));
      if (behind < step) continue;
      const days = Math.floor(behind / step) * step;
      const start = ev.startDate.clone();
      start.adjust(days, 0, 0, 0);
      if (ve.hasProperty('dtend')) {
        const end = ev.endDate.clone();
        end.adjust(days, 0, 0, 0);
        ev.endDate = end;
      }
      ev.startDate = start;
    } catch {
      /* read as it is */
    }
  }
}

/** the text as parsed: trimmed, and refused when even that is too much */
function parseTrimmed(text: string): { root: ICAL.Component; text: string } {
  const today = localDateKey(clock.now(), tz());
  const trimmed = trimCalendar(text, today);
  if (trimmed.length > MAX_PARSE_BYTES) throw new Error('היומן גדול מדי - גם האירועים של השנה האחרונה והשנה הבאה לבדם הם יותר מדי');
  const root = parseCalendar(trimmed);
  fastForward(root, today);
  return { root, text: trimmed };
}

const nameOf = (root: ICAL.Component) => String(root.getFirstPropertyValue('x-wr-calname') ?? '').trim().slice(0, 80) || null;

function readError(e: unknown, url: string): string {
  const status = (e as { status?: number })?.status;
  const refused = status === 403 || status === 404;
  // Google answers so for a calendar that is not public, and for a secret address that was reset
  const kind = googleKind(url);
  if (kind === 'public' && (refused || (e as Error)?.message === NOT_CALENDAR)) {
    return 'היומן הזה לא ציבורי, ולכן אי אפשר לקרוא אותו מקישור כזה. ב-Google Calendar במחשב: ליד שם היומן ⋮ ← "הגדרות ושיתוף" ← "כתובת סודית בפורמט iCal" - והדביקו אותה כאן';
  }
  if (kind === 'private' && refused) return 'הכתובת הסודית הזו לא פעילה - אולי היא אופסה ב-Google. העתיקו את הכתובת הסודית העדכנית מהגדרות היומן';
  if (e instanceof Error && /[֐-׿]/.test(e.message)) return e.message;
  if ((e as Error)?.name === 'TimeoutError' || (e as Error)?.name === 'AbortError') return 'Google לא סיים לשלוח את היומן בזמן. נסו שוב בעוד כמה דקות';
  return 'לא ניתן לקרוא את היומן כרגע';
}

// The last good copy of each calendar is also kept in the shared file store (compressed), so a server
// instance that starts cold has it at once instead of waiting for Google.
// ("calendar2-": trimmed. A "calendar-" copy is the whole calendar, kept for a short while before
// trimming existed - never read, and removed.)
const hashOf = (url: string) => createHash('sha256').update(generation ? `${generation} ${url}` : url).digest('hex').slice(0, 32);
const sharedName = (url: string) => `calendar2-${hashOf(url)}.ics.gz`;
const untrimmedRemoved = new Set<string>();

async function keepShared(url: string, at: number, text: string, waited: boolean): Promise<void> {
  try {
    await putFile(sharedName(url), gzipSync(Buffer.from(`${at}${waited ? ' waited' : ''}\n${text}`, 'utf8')));
    if (!untrimmedRemoved.has(url)) {
      untrimmedRemoved.add(url);
      await removeFile(`calendar-${hashOf(url)}.ics.gz`);
    }
  } catch {
    /* only a head start for other instances */
  }
}

async function sharedCopy(url: string): Promise<Cached | null> {
  // not there a moment ago: another instance may be reading it now - look again soon
  if (Date.now() - (sharedLooked.get(url) ?? 0) < SHARED_LOOK_MS) return null;
  sharedLooked.set(url, Date.now());
  try {
    const raw = await getFile(sharedName(url));
    if (!raw) return null;
    const text = gunzipSync(raw).toString('utf8');
    const nl = text.indexOf('\n');
    const [at, mark] = text.slice(0, nl).split(' ');
    const { root } = parseTrimmed(text.slice(nl + 1));
    const entry: Cached = { at: Number(at) || 0, root, error: null, name: nameOf(root), waited: mark === 'waited' };
    cache.set(url, entry);
    return entry;
  } catch {
    return null;
  }
}

/** a calendar no longer used anywhere: its shared copy goes too */
function dropShared(url: string): void {
  const used = db().get('SELECT 1 FROM calendar_sources WHERE url = ?', url) || chosenPlanRows().some((r) => r.url === url) || weeksCalendarUrl() === url;
  if (used) return;
  cache.delete(url);
  void removeFile(sharedName(url));
}

/** One reading from Google at a time for each address; what it brings is kept here and in the shared store. */
function readFromGoogle(url: string): Promise<Cached> {
  const running = reading.get(url);
  if (running) return running;
  const p = (async (): Promise<Cached> => {
    let entry: Cached;
    try {
      const { root, text } = parseTrimmed(await fetcher(url));
      entry = { at: Date.now(), root, error: null, name: nameOf(root), waited: awaited.has(url) };
      await keepShared(url, entry.at, text, !!entry.waited);
    } catch (e) {
      // keep showing the last good copy while the calendar cannot be reached
      const hit = cache.get(url);
      entry = { at: Date.now(), root: hit?.root ?? null, error: readError(e, url), name: hit?.name ?? null };
    }
    cache.set(url, entry);
    return entry;
  })().finally(() => (reading.delete(url), awaited.delete(url)));
  reading.set(url, p);
  return p;
}

/**
 * A calendar as it can be shown now. For a page, a copy older than a few minutes is shown as is while a
 * fresh one is read in the background. The commander's own action (choosing a calendar, checking it for
 * weeks) reads it afresh. Either way, waiting is short (`wait`): if Google is still putting a big
 * calendar together it comes back as loading, the reading goes on, and the next request has it.
 */
async function loadSource(url: string, { explicit = false, wait = PAGE_WAIT_MS }: { explicit?: boolean; wait?: number } = {}): Promise<Cached> {
  let copy = cache.get(url);
  if (!copy?.root) copy = (await sharedCopy(url)) ?? copy;
  if (explicit) {
    // what a reading the last try stopped waiting for brought: this try takes it instead of starting over
    if (copy?.root && copy.waited && Date.now() - copy.at < REFRESH_MS) {
      copy.waited = false;
      return copy;
    }
  } else if (copy && Date.now() - copy.at < (copy.error ? RETRY_MS : REFRESH_MS)) return copy;
  const read = readFromGoogle(url);
  if (copy?.root && !explicit) return copy;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<null>((r) => (timer = setTimeout(() => r(null), wait)));
  const done = await Promise.race([read, late]).finally(() => clearTimeout(timer));
  if (done) return done;
  if (explicit) awaited.add(url);
  return { at: copy?.at ?? 0, root: copy?.root ?? null, error: null, name: copy?.name ?? null, loading: true };
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

/**
 * An event, with its exceptions given (none) rather than found by ical.js: on its own, every new event
 * looks through the whole calendar and takes every moved occurrence in it as its own, whatever its UID.
 * On a calendar of thousands of events that is millions of objects - it ran a server out of memory.
 */
const eventOf = (ve: ICAL.Component) => new ICAL.Event(ve, { strictExceptions: true, exceptions: [] });

/** each calendar's events of some days, worked out once per reading of it (a page asks for the same days again and again) */
const expanded = new WeakMap<ICAL.Component, Map<string, ExternalEvent[]>>();

function expandCached(source: SourceRow, root: ICAL.Component, from: string, to: string, zone: string): ExternalEvent[] {
  let byKey = expanded.get(root);
  if (!byKey) expanded.set(root, (byKey = new Map()));
  const prefix = `${source.id}|${source.name}|${zone}|`;
  const key = `${prefix}${from}|${to}`;
  let hit = byKey.get(key);
  if (!hit) {
    // days inside ones already worked out (a week of the three-week plan): taken from them
    for (const [k, list] of byKey) {
      if (!k.startsWith(prefix)) continue;
      const [f, t] = k.slice(prefix.length).split('|');
      if (f <= from && t >= to) {
        hit = list.filter((e) => e.date >= from && e.date <= to);
        break;
      }
    }
    hit ??= expand(source, root, from, to, zone);
    if (byKey.size >= 24) byKey.delete(byKey.keys().next().value!);
    byKey.set(key, hit);
  }
  return [...hit];
}

function expand(source: SourceRow, root: ICAL.Component, from: string, to: string, zone: string): ExternalEvent[] {
  const out: ExternalEvent[] = [];
  const windowStart = zonedToUtc(from, '00:00', zone);
  const windowEnd = zonedToUtc(addDays(to, 1), '00:00', zone);
  const masters = new Map<string, ICAL.Event>();
  const exceptions: ICAL.Component[] = [];
  for (const ve of root.getAllSubcomponents('vevent')) {
    if (ve.hasProperty('recurrence-id')) exceptions.push(ve);
    else masters.set(String(ve.getFirstPropertyValue('uid') ?? `noid-${masters.size}`), eventOf(ve));
  }
  // each moved occurrence to its own repeating event, by its UID
  for (const ex of exceptions) {
    const master = masters.get(String(ex.getFirstPropertyValue('uid') ?? ''));
    if (master) master.relateException(eventOf(ex));
    else masters.set(`orphan-${masters.size}`, eventOf(ex));
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

  // a calendar full of repeating events must not hold the server: past the budget, the rest is left out
  const deadline = Date.now() + EXPAND_BUDGET_MS;
  for (const ev of masters.values()) {
    if (Date.now() > deadline) {
      console.warn(`[calendar] "${source.name}": expanding took over ${EXPAND_BUDGET_MS}ms, the rest left out`);
      break;
    }
    try {
      if (!ev.isRecurring()) {
        emit(ev, ev.startDate, ev.endDate);
        continue;
      }
      const it = ev.iterator();
      // an occurrence long before the days asked for (more than a block's 62 days) shows nothing, unless moved
      const early = windowStart.getTime() - 63 * 864e5;
      const moved = Object.keys(ev.exceptions).length > 0 || ev.rangeExceptions.length > 0;
      for (let next = it.next(), n = 0; next && n < 20_000; next = it.next(), n++) {
        const at = instant(next, zone);
        if (at >= windowEnd || ((n & 255) === 255 && Date.now() > deadline)) break;
        if (!moved && at.getTime() < early) continue;
        const d = ev.getOccurrenceDetails(next);
        emit(d.item, d.startDate, d.endDate);
      }
    } catch {
      /* one malformed event does not hide the rest */
    }
  }
  return out;
}

/** The calendars shown - never their addresses: a secret address stays on the server, the commander's browser included. */
export function listCalendarSources(): CalendarSource[] {
  return db()
    .all<SourceRow>('SELECT id, name, url, color FROM calendar_sources ORDER BY id')
    .map((r) => ({
      id: r.id,
      name: r.name,
      calendarName: cache.get(r.url)?.name ?? null,
      color: isGoogleColor(r.color) ? r.color : null,
      error: cache.get(r.url)?.error ?? null,
      loading: reading.has(r.url) && !cache.get(r.url)?.root,
    }));
}

/** The colour a connected calendar is drawn in, for everyone - as it is in Google (null: by its place). */
export function setCalendarSourceColor(id: number, color: GoogleColor | null): void {
  if (!db().get('SELECT 1 FROM calendar_sources WHERE id = ?', id)) throw notFound('היומן לא נמצא');
  db().run('UPDATE calendar_sources SET color = ? WHERE id = ?', color, id);
}

/** Checks the address right away, so a wrong one is reported while adding it. */
export async function addCalendarSource(actor: UserRow, name: string, rawUrl: string, color: GoogleColor | null = null): Promise<void> {
  const url = normalizeCalendarUrl(rawUrl);
  if (db().get<{ n: number }>('SELECT count(*) AS n FROM calendar_sources')!.n >= MAX_SOURCES) throw badRequest(`אפשר לחבר עד ${MAX_SOURCES} יומנים`);
  if (db().get('SELECT 1 FROM calendar_sources WHERE url = ?', url)) throw badRequest('היומן הזה כבר מחובר');
  const loaded = await loadSource(url, { explicit: true, wait: CHOOSE_WAIT_MS });
  // still loading (a big calendar): connected, and its events come in when Google has sent it
  if (!loaded.root && !loaded.loading) throw badRequest(loaded.error ?? 'לא ניתן לקרוא את היומן');
  // no name given: the one the calendar has in Google
  db().run('INSERT INTO calendar_sources(name, url, color, created_by, created_at) VALUES (?, ?, ?, ?, ?)', name.trim() || loaded.name || 'יומן Google', url, color, actor.id, nowIso());
}

export function removeCalendarSource(id: number): void {
  const row = db().get<SourceRow>('SELECT id, name, url FROM calendar_sources WHERE id = ?', id);
  if (!row) throw notFound('היומן לא נמצא');
  db().run('DELETE FROM calendar_sources WHERE id = ?', id);
  dropShared(row.url);
}

/** Events of the connected calendars between two dates (up to two months). */
export async function externalEvents(from: string, to: string): Promise<ExternalEvent[]> {
  if (diffDays(to, from) > 62) to = addDays(from, 62);
  const zone = tz();
  const sources = db().all<SourceRow>('SELECT id, name, url FROM calendar_sources ORDER BY id');
  const loaded = await Promise.all(sources.map(async (s) => ({ s, c: await loadSource(s.url) })));
  return loaded
    .flatMap(({ s, c }) => (c.root ? expandCached(s, c.root, from, to, zone) : []))
    .sort((a, b) => a.date.localeCompare(b.date) || (a.startTime ?? '').localeCompare(b.startTime ?? ''));
}

// ---------------- the plan's calendar ----------------
// The plan documents (plans.ts) read the course's own calendar - the one the commander chose for them
// ("יומן התוכנית"), or before any choice the one the server was set up with (PLAN_CALENDAR_URL, kept
// out of the code); with neither, the calendars connected to the schedule. A chosen calendar is not
// shown in the schedule: only its main blocks enter the plans.

const PLAN_KEY = 'plan_calendars';
const MAX_PLAN_CALENDARS = 4;

interface PlanRow {
  url: string;
  /** the name it was chosen by; empty: the one it has in Google */
  name: string;
}

/** the commander's choice: null before any (an empty list: chosen to have none) */
function storedPlanRows(): PlanRow[] | null {
  const raw = db().get<{ value: string }>('SELECT value FROM meta WHERE key = ?', PLAN_KEY)?.value;
  if (raw === undefined) return null;
  try {
    const v = JSON.parse(raw) as unknown;
    return Array.isArray(v) ? v.filter((x): x is PlanRow => !!x && typeof x.url === 'string').map((x) => ({ url: x.url, name: typeof x.name === 'string' ? x.name : '' })) : [];
  } catch {
    return [];
  }
}

function serverPlanRows(): PlanRow[] {
  const raw = process.env.PLAN_CALENDAR_URL?.trim();
  if (!raw) return [];
  try {
    return [{ url: normalizeCalendarUrl(raw), name: '' }];
  } catch {
    return [];
  }
}

/** the calendars chosen for the plans - by the commander, else the server's */
const chosenPlanRows = (): PlanRow[] => storedPlanRows() ?? serverPlanRows();

const savePlanRows = (rows: PlanRow[]) =>
  db().run('INSERT INTO meta(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', PLAN_KEY, JSON.stringify(rows));

/**
 * Each by its name and whether it can be read - read here (or kept from a recent reading), as a server
 * instance may not have read it yet. `wait`: how long to wait for one never read (0 right after choosing
 * it, which already waited).
 */
export async function listPlanCalendars(wait = PAGE_WAIT_MS): Promise<PlanCalendars> {
  const calendars = await Promise.all(
    chosenPlanRows().map(async (r, index) => {
      const c = await loadSource(r.url, { wait });
      return { index, name: r.name || c.name || 'יומן Google', error: c.error, loading: !!c.loading };
    }),
  );
  return { calendars, fromServer: storedPlanRows() === null && serverPlanRows().length > 0 };
}

/** Checks the address right away, so a wrong one is reported while choosing it. */
export async function addPlanCalendar(name: string, rawUrl: string): Promise<void> {
  const url = normalizeCalendarUrl(rawUrl);
  const rows = chosenPlanRows();
  if (rows.some((r) => r.url === url)) throw badRequest('היומן הזה כבר נבחר לתוכנית');
  if (rows.length >= MAX_PLAN_CALENDARS) throw badRequest(`אפשר לבחור עד ${MAX_PLAN_CALENDARS} יומנים לתוכנית`);
  const loaded = await loadSource(url, { explicit: true, wait: CHOOSE_WAIT_MS });
  // still loading (a big calendar): chosen, and its blocks come in when Google has sent it
  if (!loaded.root && !loaded.loading) throw badRequest(loaded.error ?? 'לא ניתן לקרוא את היומן');
  savePlanRows([...rows, { url, name: name.trim().slice(0, 60) }]);
}

export function removePlanCalendar(index: number): void {
  const rows = chosenPlanRows();
  if (!rows[index]) throw notFound('היומן לא נמצא');
  savePlanRows(rows.filter((_, i) => i !== index));
  dropShared(rows[index].url);
}

/** a calendar a plan reads, as read for some days */
export interface CalendarRead {
  /** the name it was chosen by, else the one it has in Google */
  name: string;
  error: string | null;
  /** read for the first time and not there yet */
  loading: boolean;
  events: ExternalEvent[];
}

/** What the plan documents read: the calendars chosen for them, else the schedule's. One after the other: a calendar read once is kept for the next. */
export async function readPlanCalendars(from: string, to: string): Promise<{ reads: CalendarRead[]; from: 'plan' | 'schedule' }> {
  if (diffDays(to, from) > 62) to = addDays(from, 62);
  const zone = tz();
  const chosen = chosenPlanRows();
  const rows: SourceRow[] = chosen.length ? chosen.map((r, i) => ({ id: -1 - i, name: r.name, url: r.url })) : db().all<SourceRow>('SELECT id, name, url FROM calendar_sources ORDER BY id');
  const reads = await Promise.all(
    rows.map(async (r): Promise<CalendarRead> => {
      const c = await loadSource(r.url);
      const source = { ...r, name: r.name || c.name || 'יומן Google' };
      return { name: source.name, error: c.error, loading: !!c.loading, events: c.root ? expandCached(source, c.root, from, to, zone) : [] };
    }),
  );
  return { reads, from: chosen.length ? 'plan' : 'schedule' };
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
      const ev = eventOf(ve);
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
  const loaded = await loadSource(url, { explicit: true, wait: CHECK_WAIT_MS });
  if (loaded.loading) throw badRequest('Google עדיין שולח את היומן (יומן גדול). לחצו שוב על "בדיקת היומן" בעוד דקה');
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
