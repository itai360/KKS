// A repeating event as Google Calendar keeps it: a recurrence rule (RFC 5545 RRULE) - every N days,
// weeks, months or years; on some days of the week; on "the fourth Thursday" or "the last Friday" of the
// month; until a day, a number of times, or with no end - and the days it skips (EXDATE).
//
// Only what Google Calendar's own screens make is handled: FREQ, INTERVAL, BYDAY (days of the week, or
// one day with its place in the month), BYMONTHDAY, BYMONTH, COUNT, UNTIL and WKST. Days are date keys
// (YYYY-MM-DD) in the course's time zone; the hour stays on the event.

import { addDays, diffDays, localDateKey, parseDateKey, toDateKey, weekdayOf } from './dates';

export const FREQS = ['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'] as const;
export type Freq = (typeof FREQS)[number];
export const WEEKDAYS = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'] as const;
export type Weekday = (typeof WEEKDAYS)[number];

export interface RRule {
  freq: Freq;
  /** every n days / weeks / months / years */
  interval: number;
  /** WEEKLY: the days of the week; MONTHLY / YEARLY: one day with its place in the month (n: 1-5, -1 the last) */
  byDay?: { day: Weekday; n?: number }[];
  /** MONTHLY / YEARLY: the day of the month */
  byMonthDay?: number[];
  /** YEARLY: the month (1-12) */
  byMonth?: number[];
  /** ends after this many times */
  count?: number;
  /** ends on this day (inclusive) */
  until?: string;
  /** the first day of the week (Israel: Sunday) */
  wkst?: Weekday;
}

/** no rule repeats more than this many times from its first day */
export const MAX_OCCURRENCES = 5000;
/** at most this far from its first day */
export const MAX_YEARS = 30;

const dayIndex = (d: Weekday) => WEEKDAYS.indexOf(d);

// ---------------- reading and writing ----------------

/** "RRULE:FREQ=WEEKLY;BYDAY=TH" or "FREQ=WEEKLY;BYDAY=TH" - null when it is not a rule this handles. */
export function parseRRule(raw: string, tz?: string): RRule | null {
  const s = raw.trim().replace(/^RRULE:/i, '');
  if (!s) return null;
  const parts = new Map<string, string>();
  for (const p of s.split(';')) {
    const [k, v] = p.split('=');
    if (!k || v === undefined) return null;
    parts.set(k.trim().toUpperCase(), v.trim().toUpperCase());
  }
  const freq = parts.get('FREQ') as Freq | undefined;
  if (!freq || !FREQS.includes(freq)) return null;
  const rule: RRule = { freq, interval: 1 };
  const interval = parts.get('INTERVAL');
  if (interval !== undefined) {
    const n = Number(interval);
    if (!Number.isInteger(n) || n < 1 || n > 999) return null;
    rule.interval = n;
  }
  const byDay = parts.get('BYDAY');
  if (byDay) {
    const days: { day: Weekday; n?: number }[] = [];
    for (const item of byDay.split(',')) {
      const m = /^([+-]?\d{1,2})?(SU|MO|TU|WE|TH|FR|SA)$/.exec(item);
      if (!m) return null;
      const n = m[1] ? Number(m[1]) : undefined;
      if (n !== undefined && (n === 0 || n < -5 || n > 5)) return null;
      days.push(n === undefined ? { day: m[2] as Weekday } : { day: m[2] as Weekday, n });
    }
    rule.byDay = days;
  }
  const numbers = (key: string, lo: number, hi: number): number[] | null | undefined => {
    const v = parts.get(key);
    if (v === undefined) return undefined;
    const out = v.split(',').map(Number);
    return out.every((n) => Number.isInteger(n) && n !== 0 && n >= lo && n <= hi) ? out : null;
  };
  const byMonthDay = numbers('BYMONTHDAY', -31, 31);
  if (byMonthDay === null) return null;
  if (byMonthDay) rule.byMonthDay = byMonthDay;
  const byMonth = numbers('BYMONTH', 1, 12);
  if (byMonth === null) return null;
  if (byMonth) rule.byMonth = byMonth;
  const count = parts.get('COUNT');
  if (count !== undefined) {
    const n = Number(count);
    if (!Number.isInteger(n) || n < 1) return null;
    rule.count = Math.min(n, MAX_OCCURRENCES);
  }
  const until = parts.get('UNTIL');
  if (until !== undefined) {
    const day = untilDay(until, tz);
    if (!day) return null;
    rule.until = day;
  }
  if (rule.count && rule.until) return null; // one or the other (RFC 5545)
  const wkst = parts.get('WKST') as Weekday | undefined;
  if (wkst) {
    if (!WEEKDAYS.includes(wkst)) return null;
    rule.wkst = wkst;
  }
  return rule;
}

/** UNTIL as a day: 20261231, or 20261231T215959Z (a moment, read in the course's zone) */
function untilDay(v: string, tz?: string): string | null {
  const m = /^(\d{4})(\d{2})(\d{2})(T(\d{2})(\d{2})(\d{2})(Z)?)?$/.exec(v);
  if (!m) return null;
  const [, y, mo, d, t, hh, mi, ss, z] = m;
  // a day the calendar has (not the 31st of February)
  const real = new Date(Date.UTC(+y, +mo - 1, +d));
  if (real.getUTCFullYear() !== +y || real.getUTCMonth() !== +mo - 1 || real.getUTCDate() !== +d) return null;
  if (t && z) return localDateKey(new Date(Date.UTC(+y, +mo - 1, +d, +hh, +mi, +ss)), tz);
  return toDateKey(+y, +mo, +d);
}

/** The rule as text, as Google writes it ("FREQ=WEEKLY;BYDAY=TH;UNTIL=20261231"), without "RRULE:". */
export function formatRRule(r: RRule): string {
  const out = [`FREQ=${r.freq}`];
  if (r.interval > 1) out.push(`INTERVAL=${r.interval}`);
  if (r.byDay?.length) out.push(`BYDAY=${r.byDay.map((d) => `${d.n ?? ''}${d.day}`).join(',')}`);
  if (r.byMonthDay?.length) out.push(`BYMONTHDAY=${r.byMonthDay.join(',')}`);
  if (r.byMonth?.length) out.push(`BYMONTH=${r.byMonth.join(',')}`);
  if (r.count) out.push(`COUNT=${r.count}`);
  else if (r.until) out.push(`UNTIL=${r.until.replace(/-/g, '')}`);
  if (r.wkst && r.wkst !== 'SU') out.push(`WKST=${r.wkst}`);
  return out.join(';');
}

// ---------------- the days ----------------

function daysIn(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** the nth (1-5, or -1 the last) given weekday of a month, or null when the month has no such */
export function nthWeekday(year: number, month: number, day: Weekday, n: number): string | null {
  const want = dayIndex(day);
  const last = daysIn(year, month);
  if (n > 0) {
    const first = weekdayOf(toDateKey(year, month, 1));
    const d = 1 + ((want - first + 7) % 7) + (n - 1) * 7;
    return d <= last ? toDateKey(year, month, d) : null;
  }
  const lastDay = weekdayOf(toDateKey(year, month, last));
  const d = last - ((lastDay - want + 7) % 7) + (n + 1) * 7;
  return d >= 1 ? toDateKey(year, month, d) : null;
}

/** where a day falls in its month: 1-5 counting from its start, and whether it is the last of its kind */
export function placeInMonth(date: string): { n: number; last: boolean } {
  const { year, month, day } = parseDateKey(date);
  return { n: Math.ceil(day / 7), last: day + 7 > daysIn(year, month) };
}

/** the kth period of the rule (a day, a week, a month or a year from the first): its first day and its candidate days, in order */
function period(rule: RRule, start: string, k: number): { from: string; days: string[] } {
  const s = parseDateKey(start);
  switch (rule.freq) {
    case 'DAILY': {
      const d = addDays(start, k * rule.interval);
      return { from: d, days: !rule.byDay?.length || rule.byDay.some((b) => dayIndex(b.day) === weekdayOf(d)) ? [d] : [] };
    }
    case 'WEEKLY': {
      const wkst = dayIndex(rule.wkst ?? 'SU');
      const weekStart = addDays(start, -((weekdayOf(start) - wkst + 7) % 7) + k * 7 * rule.interval);
      const days = rule.byDay?.length ? rule.byDay.map((b) => dayIndex(b.day)) : [weekdayOf(start)];
      return { from: weekStart, days: [...new Set(days)].map((wd) => addDays(weekStart, (wd - wkst + 7) % 7)).sort() };
    }
    case 'MONTHLY': {
      const m = s.month - 1 + k * rule.interval;
      const year = s.year + Math.floor(m / 12);
      const month = (m % 12) + 1;
      return { from: toDateKey(year, month, 1), days: monthDays(rule, year, month, s.day) };
    }
    case 'YEARLY': {
      const year = s.year + k * rule.interval;
      const months = rule.byMonth?.length ? rule.byMonth : [s.month];
      return { from: toDateKey(year, 1, 1), days: months.flatMap((month) => monthDays(rule, year, month, s.day)).sort() };
    }
  }
}

function monthDays(rule: RRule, year: number, month: number, startDay: number): string[] {
  const last = daysIn(year, month);
  if (rule.byDay?.length) {
    return rule.byDay
      .flatMap((b) => {
        if (b.n) return [nthWeekday(year, month, b.day, b.n)];
        // every such weekday of the month
        const out: string[] = [];
        for (let n = 1; n <= 5; n++) {
          const d = nthWeekday(year, month, b.day, n);
          if (d) out.push(d);
        }
        return out;
      })
      .filter((d): d is string => !!d)
      .sort();
  }
  const days = rule.byMonthDay?.length ? rule.byMonthDay : [startDay];
  // a day the month does not have (the 31st, the 29th of February) is skipped, as Google Calendar does
  return days
    .map((d) => (d < 0 ? last + 1 + d : d))
    .filter((d) => d >= 1 && d <= last)
    .map((d) => toDateKey(year, month, d))
    .sort();
}

/**
 * The days the rule falls on, from its first day (`start`, always the first) - those within [from, to].
 * COUNT counts from the first day, the skipped days (EXDATE) among them, as RFC 5545 has it.
 */
export function expandRRule(rule: RRule, start: string, from: string, to: string, exdates: Iterable<string> = []): string[] {
  const skip = new Set(exdates);
  const out: string[] = [];
  const end = [to, rule.until, addDays(start, Math.round(MAX_YEARS * 365.25))].filter((d): d is string => !!d).sort()[0];
  if (end < start) return out;
  // the first day is always the first time (RFC 5545), even when the rule would not choose it
  let n = 1;
  if (start >= from && !skip.has(start)) out.push(start);
  if (rule.count && n >= rule.count) return out;
  for (let k = 0; k < 40000; k++) {
    const { from: periodFrom, days } = period(rule, start, k);
    // the periods only move forward: one that starts after the end ends it
    if (periodFrom > end) break;
    for (const d of days) {
      if (d <= start) continue;
      if (d > end) return out;
      n++;
      if (d >= from && !skip.has(d)) out.push(d);
      if ((rule.count && n >= rule.count) || n >= MAX_OCCURRENCES) return out;
    }
  }
  return out;
}

/** the last day the rule falls on, or null when it has no end */
export function lastOccurrence(rule: RRule, start: string): string | null {
  if (!rule.count && !rule.until) return null;
  const days = expandRRule(rule, start, start, rule.until ?? addDays(start, Math.round(MAX_YEARS * 365.25)));
  return days.length ? days[days.length - 1] : start;
}

/** the same rule, ending on the day before `day` (for "this and following": the series up to it) */
export function endBefore(rule: RRule, start: string, day: string): RRule {
  const { count: _count, ...rest } = rule;
  return { ...rest, until: addDays(day, -1) < start ? start : addDays(day, -1) };
}

/** how many times the rule fell before `day` (to carry COUNT over to the part from `day` on) */
export function countBefore(rule: RRule, start: string, day: string): number {
  return expandRRule(rule, start, start, addDays(day, -1)).length;
}

// ---------------- in words ----------------

export const WEEKDAY_WORDS: Record<Weekday, string> = { SU: 'ראשון', MO: 'שני', TU: 'שלישי', WE: 'רביעי', TH: 'חמישי', FR: 'שישי', SA: 'שבת' };
const MONTH_WORDS = ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני', 'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'];
const PLACE_WORDS: Record<number, string> = { 1: 'הראשון', 2: 'השני', 3: 'השלישי', 4: 'הרביעי', 5: 'החמישי', [-1]: 'האחרון' };
const WORKDAYS: Weekday[] = ['SU', 'MO', 'TU', 'WE', 'TH'];

const dayWord = (d: Weekday) => (d === 'SA' ? 'שבת' : `יום ${WEEKDAY_WORDS[d]}`);
const isWorkdays = (r: RRule) => r.byDay?.length === 5 && WORKDAYS.every((d) => r.byDay!.some((b) => b.day === d && !b.n));

/** a date in words: "31 בדצמבר 2026" */
export function dateWords(key: string, withYear = true): string {
  const { year, month, day } = parseDateKey(key);
  return `${day} ב${MONTH_WORDS[month - 1]}${withYear ? ` ${year}` : ''}`;
}

function every(n: number, one: string, two: string, many: string): string {
  return n === 1 ? `כל ${one}` : n === 2 ? `כל ${two}` : `כל ${n} ${many}`;
}

/** The rule in Hebrew, as Google Calendar says it: "כל שבוע ביום חמישי, עד 31 בדצמבר 2026". */
export function describeRRule(rule: RRule, start: string): string {
  const parts: string[] = [];
  const s = parseDateKey(start);
  switch (rule.freq) {
    case 'DAILY':
      parts.push(rule.interval === 1 && isWorkdays(rule) ? 'כל יום עבודה (ראשון עד חמישי)' : every(rule.interval, 'יום', 'יומיים', 'ימים'));
      break;
    case 'WEEKLY': {
      if (rule.interval === 1 && isWorkdays(rule)) {
        parts.push('כל יום עבודה (ראשון עד חמישי)');
        break;
      }
      const days = rule.byDay?.length ? rule.byDay.map((b) => b.day) : [WEEKDAYS[weekdayOf(start)]];
      const sorted = [...new Set(days)].sort((a, b) => dayIndex(a) - dayIndex(b));
      const on = sorted.length === 1 ? `ב${dayWord(sorted[0])}` : `בימים ${listWords(sorted.map((d) => WEEKDAY_WORDS[d]))}`;
      parts.push(`${every(rule.interval, 'שבוע', 'שבועיים', 'שבועות')} ${on}`);
      break;
    }
    case 'MONTHLY': {
      const lead = every(rule.interval, 'חודש', 'חודשיים', 'חודשים');
      const nth = rule.byDay?.find((b) => b.n);
      if (nth) parts.push(`${lead} ב${dayWord(nth.day)} ${PLACE_WORDS[nth.n!] ?? ''}`.trim());
      else {
        const d = rule.byMonthDay?.[0] ?? s.day;
        parts.push(d === -1 ? `${lead} ביום האחרון בחודש` : `${lead} ב-${d} לחודש`);
      }
      break;
    }
    case 'YEARLY': {
      const lead = every(rule.interval, 'שנה', 'שנתיים', 'שנים');
      const month = rule.byMonth?.[0] ?? s.month;
      const nth = rule.byDay?.find((b) => b.n);
      if (nth) parts.push(`${lead} ב${dayWord(nth.day)} ${PLACE_WORDS[nth.n!] ?? ''} של ${MONTH_WORDS[month - 1]}`);
      else parts.push(`${lead} ב-${rule.byMonthDay?.[0] ?? s.day} ב${MONTH_WORDS[month - 1]}`);
      break;
    }
  }
  if (rule.count) parts.push(rule.count === 1 ? 'פעם אחת' : `${rule.count} פעמים`);
  else if (rule.until) parts.push(`עד ${dateWords(rule.until)}`);
  return parts.join(', ');
}

function listWords(items: string[]): string {
  return items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} ו${items[items.length - 1]}`;
}

// ---------------- Google's menu ----------------

export interface RepeatPreset {
  /** what the menu says */
  label: string;
  /** the rule, or null: does not repeat; 'custom': opens the custom rule */
  rrule: string | null | 'custom';
}

/**
 * The repeat menu of an event on `date`, as Google Calendar offers it: does not repeat, every day,
 * every week on its day, every month on its place in the month (and the last, when it is), every year
 * on its date, every working day, and custom.
 */
export function repeatPresets(date: string): RepeatPreset[] {
  const wd = WEEKDAYS[weekdayOf(date)];
  const { n, last } = placeInMonth(date);
  const { month, day } = parseDateKey(date);
  const out: RepeatPreset[] = [
    { label: 'לא חוזר', rrule: null },
    { label: 'כל יום', rrule: 'FREQ=DAILY' },
    { label: `כל שבוע ב${dayWord(wd)}`, rrule: `FREQ=WEEKLY;BYDAY=${wd}` },
  ];
  if (n <= 4) out.push({ label: `כל חודש ב${dayWord(wd)} ${PLACE_WORDS[n]}`, rrule: `FREQ=MONTHLY;BYDAY=${n}${wd}` });
  if (last) out.push({ label: `כל חודש ב${dayWord(wd)} האחרון`, rrule: `FREQ=MONTHLY;BYDAY=-1${wd}` });
  out.push(
    { label: `כל שנה ב-${day} ב${MONTH_WORDS[month - 1]}`, rrule: 'FREQ=YEARLY' },
    { label: 'כל יום עבודה (ראשון עד חמישי)', rrule: 'FREQ=WEEKLY;BYDAY=SU,MO,TU,WE,TH' },
    { label: 'בהתאמה אישית...', rrule: 'custom' },
  );
  return out;
}

/** the rule a repeat of the old kind (shared/eventSeries.ts) stands for */
export function rruleFromRepeat(r: { freq: 'daily' | 'weekdays' | 'weekly' | 'monthly'; interval?: number; until?: string | null }): string {
  const rule: RRule =
    r.freq === 'weekdays'
      ? { freq: 'WEEKLY', interval: 1, byDay: WORKDAYS.map((day) => ({ day })) }
      : { freq: r.freq === 'daily' ? 'DAILY' : r.freq === 'weekly' ? 'WEEKLY' : 'MONTHLY', interval: Math.max(1, r.interval ?? 1) };
  if (r.until) rule.until = r.until;
  return formatRRule(rule);
}

/** the days between two days, both counted (for limits on a rule's length) */
export const spanDays = (from: string, to: string) => diffDays(to, from) + 1;
