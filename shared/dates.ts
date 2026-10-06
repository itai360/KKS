// Timezone-aware date helpers. "Today", "this week" and recurring deadlines are
// always computed in the course timezone, regardless of where the server runs.
// A "date key" is a calendar date string in the form YYYY-MM-DD.

import { WEEKDAY_NAMES } from './constants';

export const DEFAULT_TZ = 'Asia/Jerusalem';
export const HOUR = 3_600_000;
export const DAY = 24 * HOUR;

const dtfCache = new Map<string, Intl.DateTimeFormat>();
function dtf(tz: string): Intl.DateTimeFormat {
  let f = dtfCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    dtfCache.set(tz, f);
  }
  return f;
}

export interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

export function zonedParts(date: Date, tz: string = DEFAULT_TZ): ZonedParts {
  const out: Record<string, number> = {};
  for (const p of dtf(tz).formatToParts(date)) {
    if (p.type !== 'literal') out[p.type] = Number(p.value);
  }
  return {
    year: out.year,
    month: out.month,
    day: out.day,
    hour: out.hour === 24 ? 0 : out.hour,
    minute: out.minute,
    second: out.second,
  };
}

function offsetMinutes(date: Date, tz: string): number {
  const p = zonedParts(date, tz);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return Math.round((asUtc - Math.floor(date.getTime() / 1000) * 1000) / 60000);
}

const pad = (n: number) => String(n).padStart(2, '0');

export function toDateKey(year: number, month: number, day: number): string {
  return `${year}-${pad(month)}-${pad(day)}`;
}

export function parseDateKey(key: string): { year: number; month: number; day: number } {
  const [y, m, d] = key.split('-').map(Number);
  return { year: y, month: m, day: d };
}

export function isDateKey(s: unknown): s is string {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
}

export function isTimeString(s: unknown): s is string {
  return typeof s === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(s);
}

/** Calendar date (in tz) of an instant. */
export function localDateKey(date: Date | string | number, tz: string = DEFAULT_TZ): string {
  const p = zonedParts(new Date(date), tz);
  return toDateKey(p.year, p.month, p.day);
}

/** "HH:MM" (in tz) of an instant. */
export function localTime(date: Date | string | number, tz: string = DEFAULT_TZ): string {
  const p = zonedParts(new Date(date), tz);
  return `${pad(p.hour)}:${pad(p.minute)}`;
}

/** The UTC instant of a wall-clock time on a calendar date in tz. */
export function zonedToUtc(dateKey: string, time: string = '00:00', tz: string = DEFAULT_TZ): Date {
  const { year, month, day } = parseDateKey(dateKey);
  const [h, mi] = time.split(':').map(Number);
  const guess = Date.UTC(year, month - 1, day, h, mi);
  const off1 = offsetMinutes(new Date(guess), tz);
  let utc = guess - off1 * 60000;
  const off2 = offsetMinutes(new Date(utc), tz);
  if (off2 !== off1) utc = guess - off2 * 60000;
  return new Date(utc);
}

export function zonedIso(dateKey: string, time: string = '00:00', tz: string = DEFAULT_TZ): string {
  return zonedToUtc(dateKey, time, tz).toISOString();
}

export function addDays(key: string, n: number): string {
  const { year, month, day } = parseDateKey(key);
  const d = new Date(Date.UTC(year, month - 1, day + n));
  return toDateKey(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
}

/** 0 = Sunday ... 6 = Saturday */
export function weekdayOf(key: string): number {
  const { year, month, day } = parseDateKey(key);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

/** Israeli weeks start on Sunday. */
export function startOfWeek(key: string): string {
  return addDays(key, -weekdayOf(key));
}

export function diffDays(a: string, b: string): number {
  const pa = parseDateKey(a);
  const pb = parseDateKey(b);
  return Math.round((Date.UTC(pa.year, pa.month - 1, pa.day) - Date.UTC(pb.year, pb.month - 1, pb.day)) / DAY);
}

export function startOfDayUtc(key: string, tz: string = DEFAULT_TZ): Date {
  return zonedToUtc(key, '00:00', tz);
}

/** Half-open range [start, end) of a local calendar day, as UTC instants. */
export function dayRange(key: string, tz: string = DEFAULT_TZ): [Date, Date] {
  return [zonedToUtc(key, '00:00', tz), zonedToUtc(addDays(key, 1), '00:00', tz)];
}

// ---------- Hebrew formatting ----------

export function shortDate(key: string): string {
  const { month, day } = parseDateKey(key);
  return `${day}.${month}`;
}

export function weekdayName(key: string): string {
  return WEEKDAY_NAMES[weekdayOf(key)];
}

export function longDate(key: string): string {
  return `יום ${weekdayName(key)} ${shortDate(key)}`;
}

/** e.g. "היום 18:00", "מחר 12:00", "אתמול", "רביעי 18:00", "4.10 18:00" */
export function formatDeadline(iso: string, now: Date = new Date(), tz: string = DEFAULT_TZ): string {
  const key = localDateKey(iso, tz);
  const today = localDateKey(now, tz);
  const t = localTime(iso, tz);
  const diff = diffDays(key, today);
  if (diff === 0) return `היום ${t}`;
  if (diff === 1) return `מחר ${t}`;
  if (diff === -1) return `אתמול ${t}`;
  if (diff > 1 && diff < 7) return `${weekdayName(key)} ${t}`;
  return `${shortDate(key)} ${t}`;
}

export function formatDateTime(iso: string, tz: string = DEFAULT_TZ): string {
  return `${shortDate(localDateKey(iso, tz))} ${localTime(iso, tz)}`;
}

export function formatAgo(iso: string, now: Date = new Date()): string {
  const ms = now.getTime() - new Date(iso).getTime();
  const min = Math.floor(ms / 60000);
  if (min < 1) return 'עכשיו';
  if (min < 60) return min === 1 ? 'לפני דקה' : `לפני ${min} דקות`;
  const h = Math.floor(min / 60);
  if (h < 24) return h === 1 ? 'לפני שעה' : h === 2 ? 'לפני שעתיים' : `לפני ${h} שעות`;
  const d = Math.floor(h / 24);
  return d === 1 ? 'אתמול' : d === 2 ? 'לפני יומיים' : `לפני ${d} ימים`;
}

export function daysSince(iso: string, now: Date = new Date()): number {
  return Math.floor((now.getTime() - new Date(iso).getTime()) / DAY);
}

/** Human "time left" text, e.g. "נותרו 3 שעות". Negative means overdue. */
export function formatTimeLeft(iso: string, now: Date = new Date()): string {
  const ms = new Date(iso).getTime() - now.getTime();
  const abs = Math.abs(ms);
  const h = Math.floor(abs / HOUR);
  const d = Math.floor(h / 24);
  const unit = d >= 1 ? (d === 1 ? 'יום' : d === 2 ? 'יומיים' : `${d} ימים`) : h >= 1 ? (h === 1 ? 'שעה' : h === 2 ? 'שעתיים' : `${h} שעות`) : `${Math.max(1, Math.floor(abs / 60000))} דק'`;
  return ms >= 0 ? `נותרו ${unit}` : `באיחור של ${unit}`;
}

// ---------------- a time of day as typed (24-hour, as in Israel) ----------------

/** "1400", "9:5", "14:00" -> "14:00"; null when it is not a time of day (yet) */
export function parseTime(raw: string): string | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(raw.trim()) ?? /^(\d{1,2})(\d{2})$/.exec(raw.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  return h < 24 && min < 60 ? `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}` : null;
}

/** what is typed, as a time takes shape: digits only get their colon ("1400" -> "14:00") */
export function shapeTime(raw: string): string {
  const typed = raw.replace(/[^\d:]/g, '');
  if (/^\d{1,2}:\d{0,2}$/.test(typed)) return typed;
  const d = typed.replace(/\D/g, '').slice(0, 4);
  return d.length <= 2 ? d : `${d.slice(0, d.length - 2)}:${d.slice(-2)}`;
}
