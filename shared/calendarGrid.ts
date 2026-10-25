// The arithmetic behind the calendar (day, a few days, week, month and year, like
// Google Calendar): which days a view shows, where an event sits in the time grid,
// how events that overlap share a column, and how things that last a day or more
// (a course week, an absence, a deadline) share the rows above the hours and the
// month's cells. Free of the DOM so it can be tested.

import { addDays, diffDays, parseDateKey, startOfWeek, toDateKey } from './dates';

/**
 * 'three': the day chosen and the two after it - a phone's week, wide enough to read;
 * 'four': the computer's own few days (Google Calendar's custom view); 'year': twelve months
 */
export type CalendarView = 'day' | 'three' | 'four' | 'week' | 'month' | 'year';

export const MONTH_NAMES = ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני', 'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'] as const;

export const DAY_MINUTES = 24 * 60;
/** an event with no end time takes an hour in the grid */
export const DEFAULT_SPAN = 60;
/** short events still get room for their title */
export const MIN_VISIBLE = 30;

const pad = (n: number) => String(n).padStart(2, '0');

export function toMinutes(time: string): number {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
}

/** "HH:MM"; the end of the day is written 23:59, the last time the server accepts */
export function fromMinutes(min: number): string {
  const n = Math.max(0, Math.min(DAY_MINUTES - 1, Math.round(min)));
  return `${pad(Math.floor(n / 60))}:${pad(n % 60)}`;
}

export function snap(min: number, step: number): number {
  return Math.round(min / step) * step;
}

/** Start and end in minutes from midnight. No end: an hour. An end at or before the start runs to midnight. */
export function eventSpan(startTime: string, endTime: string | null): { start: number; end: number } {
  const start = toMinutes(startTime);
  if (!endTime) return { start, end: Math.min(DAY_MINUTES, start + DEFAULT_SPAN) };
  const end = toMinutes(endTime);
  // 23:59 is how the end of the day is stored
  return { start, end: end <= start || end === DAY_MINUTES - 1 ? DAY_MINUTES : end };
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** The weeks of the month view: from the Sunday before the 1st to the Saturday after the last day. */
export function monthWeeks(date: string): string[][] {
  const { year, month } = parseDateKey(date);
  const first = toDateKey(year, month, 1);
  const last = toDateKey(year, month, daysInMonth(year, month));
  const weeks: string[][] = [];
  for (let d = startOfWeek(first); d <= last; d = addDays(d, 7)) weeks.push(Array.from({ length: 7 }, (_, i) => addDays(d, i)));
  return weeks;
}

/** how many days a view of a few days shows */
const FEW: Partial<Record<CalendarView, number>> = { three: 3, four: 4 };

/** The first day of each month of the year `date` is in. */
export function yearMonths(date: string): string[] {
  const { year } = parseDateKey(date);
  return Array.from({ length: 12 }, (_, i) => toDateKey(year, i + 1, 1));
}

/** The days a view shows, in order (a year: every day of it). */
export function viewDays(view: CalendarView, date: string): string[] {
  if (view === 'day') return [date];
  const few = FEW[view];
  if (few) return Array.from({ length: few }, (_, i) => addDays(date, i));
  if (view === 'week') return Array.from({ length: 7 }, (_, i) => addDays(startOfWeek(date), i));
  if (view === 'year') {
    const { year } = parseDateKey(date);
    const first = toDateKey(year, 1, 1);
    const n = diffDays(toDateKey(year + 1, 1, 1), first);
    return Array.from({ length: n }, (_, i) => addDays(first, i));
  }
  return monthWeeks(date).flat();
}

/** The previous or next day, few days, week, month or year. A month or year step keeps the day, or the month's last day. */
export function stepDate(view: CalendarView, date: string, dir: 1 | -1): string {
  if (view === 'day') return addDays(date, dir);
  const few = FEW[view];
  if (few) return addDays(date, few * dir);
  if (view === 'week') return addDays(date, 7 * dir);
  const { year, month, day } = parseDateKey(date);
  const m = month - 1 + (view === 'year' ? 12 : 1) * dir;
  const y = year + Math.floor(m / 12);
  const mm = ((m % 12) + 12) % 12;
  return toDateKey(y, mm + 1, Math.min(day, daysInMonth(y, mm + 1)));
}

/** "אוקטובר 2026", "ספטמבר - אוקטובר 2026" for a week across two months, or the year alone. */
export function viewTitle(view: CalendarView, date: string): string {
  if (view === 'year') return String(parseDateKey(date).year);
  const days = view === 'week' || FEW[view] ? viewDays(view, date) : [date];
  const a = parseDateKey(days[0]);
  const b = parseDateKey(days[days.length - 1]);
  if (a.month === b.month) return `${MONTH_NAMES[a.month - 1]} ${a.year}`;
  if (a.year === b.year) return `${MONTH_NAMES[a.month - 1]} - ${MONTH_NAMES[b.month - 1]} ${a.year}`;
  return `${MONTH_NAMES[a.month - 1]} ${a.year} - ${MONTH_NAMES[b.month - 1]} ${b.year}`;
}

export interface Placed<T> {
  item: T;
  start: number;
  end: number;
  /** the column inside its group of overlapping events, from the start side */
  col: number;
  /** how many columns the group needs */
  cols: number;
  /** how many columns it covers: it stretches over the next ones while they are free */
  span: number;
}

/**
 * Lays out one day's timed events the way Google Calendar does: events that
 * overlap (also visually, since a short event gets MIN_VISIBLE) form a group;
 * each takes the first column free at its start, the group divides the width
 * between its columns, and an event stretches over the columns after its own
 * that are free all through its time.
 */
export function layoutDay<T>(items: T[], span: (item: T) => { start: number; end: number }): Placed<T>[] {
  const sorted = items
    .map((item) => ({ item, ...span(item) }))
    .sort((a, b) => a.start - b.start || b.end - a.end);
  const out: Placed<T>[] = [];
  let group: Placed<T>[] = [];
  let colEnds: number[] = [];
  let groupEnd = -1;
  const visible = (p: Placed<T>) => Math.max(p.end, p.start + MIN_VISIBLE);
  const close = () => {
    for (const p of group) {
      p.cols = colEnds.length;
      while (p.col + p.span < p.cols && !group.some((q) => q.col === p.col + p.span && q.start < visible(p) && p.start < visible(q))) p.span++;
    }
    out.push(...group);
    group = [];
    colEnds = [];
  };
  for (const s of sorted) {
    const visibleEnd = Math.max(s.end, s.start + MIN_VISIBLE);
    if (s.start >= groupEnd) close();
    let col = colEnds.findIndex((end) => end <= s.start);
    if (col === -1) {
      col = colEnds.length;
      colEnds.push(visibleEnd);
    } else colEnds[col] = visibleEnd;
    groupEnd = Math.max(group.length ? groupEnd : 0, visibleEnd);
    group.push({ item: s.item, start: s.start, end: s.end, col, cols: 1, span: 1 });
  }
  close();
  return out;
}

/** Where a moved event lands: whole steps, inside the day, same length. */
export function movedSpan(start: number, end: number, delta: number, step = 15): { start: number; end: number } {
  const length = end - start;
  const s = Math.max(0, Math.min(DAY_MINUTES - length, snap(start + delta, step)));
  return { start: s, end: s + length };
}

/** Where a resized event ends: whole steps, at least one step long, by midnight. */
export function resizedEnd(start: number, end: number, delta: number, step = 15): number {
  return Math.max(start + step, Math.min(DAY_MINUTES, snap(end + delta, step)));
}

// ---------------- what lasts a day or more: the rows above the hours, the month's cells ----------------

/** A thing of one day or more, placed in a row (lane) over the days shown. */
export interface Lane<T> {
  item: T;
  /** the first and last day shown it covers, as indexes into the days */
  start: number;
  end: number;
  /** the row it is in, from the top */
  lane: number;
  /** it began before the first day shown / goes on after the last */
  cutStart: boolean;
  cutEnd: boolean;
}

/**
 * Lays things of one day or more in rows over consecutive days, the way Google Calendar fills the
 * rows above the hours and a month's week: the earliest first, the longer of two that start
 * together first (then `order`), each in the first row free all through its days.
 */
export function layoutSpans<T>(
  items: T[],
  days: string[],
  range: (item: T) => { startDate: string; endDate: string },
  order: (a: T, b: T) => number = () => 0,
): Lane<T>[] {
  if (!days.length) return [];
  const first = days[0];
  const last = days[days.length - 1];
  const placed = items
    .map((item) => ({ item, ...range(item) }))
    .filter((x) => x.startDate <= last && x.endDate >= first)
    .map((x) => {
      const start = x.startDate < first ? 0 : diffDays(x.startDate, first);
      const end = x.endDate > last ? days.length - 1 : diffDays(x.endDate, first);
      return { item: x.item, start, end, cutStart: x.startDate < first, cutEnd: x.endDate > last };
    })
    .sort((a, b) => a.start - b.start || b.end - b.start - (a.end - a.start) || order(a.item, b.item));
  const lanes: number[] = []; // the last day taken in each row
  return placed.map((p) => {
    let lane = lanes.findIndex((end) => end < p.start);
    if (lane === -1) lane = lanes.push(p.end) - 1;
    else lanes[lane] = p.end;
    return { ...p, lane };
  });
}

/**
 * What fits in `rows` rows of each day: a day with more than that shows one row less and "עוד N"
 * in its place. A thing hidden on any of its days is hidden on all of them (and counted there).
 */
export function fitLanes<T>(lanes: Lane<T>[], dayCount: number, rows: number): { shown: Lane<T>[]; more: number[] } {
  const total = Array.from({ length: dayCount }, () => 0);
  for (const l of lanes) for (let i = l.start; i <= l.end; i++) total[i]++;
  const limit = total.map((n) => (n > rows ? rows - 1 : rows));
  const shown = lanes.filter((l) => {
    for (let i = l.start; i <= l.end; i++) if (l.lane >= limit[i]) return false;
    return true;
  });
  const seen = Array.from({ length: dayCount }, () => 0);
  for (const l of shown) for (let i = l.start; i <= l.end; i++) seen[i]++;
  return { shown, more: total.map((n, i) => n - seen[i]) };
}

/** How many rows the lanes take (0 when there are none). */
export const laneCount = (lanes: Lane<unknown>[]) => lanes.reduce((n, l) => Math.max(n, l.lane + 1), 0);
