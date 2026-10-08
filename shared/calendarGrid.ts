// The arithmetic behind the calendar view of the schedule (day, week and month,
// like Google Calendar): which days a view shows, where an event sits in the
// time grid, and how events that overlap share a column. Free of the DOM so it
// can be tested.

import { addDays, parseDateKey, startOfWeek, toDateKey } from './dates';

/** 'three': the day chosen and the two after it - a phone's week, wide enough to read */
export type CalendarView = 'day' | 'three' | 'week' | 'month';

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

/** The days a view shows, in order. */
export function viewDays(view: CalendarView, date: string): string[] {
  if (view === 'day') return [date];
  if (view === 'three') return [date, addDays(date, 1), addDays(date, 2)];
  if (view === 'week') return Array.from({ length: 7 }, (_, i) => addDays(startOfWeek(date), i));
  return monthWeeks(date).flat();
}

/** The previous or next day, week or month. A month step keeps the day, or the month's last day. */
export function stepDate(view: CalendarView, date: string, dir: 1 | -1): string {
  if (view === 'day') return addDays(date, dir);
  if (view === 'three') return addDays(date, 3 * dir);
  if (view === 'week') return addDays(date, 7 * dir);
  const { year, month, day } = parseDateKey(date);
  const m = month - 1 + dir;
  const y = year + Math.floor(m / 12);
  const mm = ((m % 12) + 12) % 12;
  return toDateKey(y, mm + 1, Math.min(day, daysInMonth(y, mm + 1)));
}

/** "אוקטובר 2026", or "ספטמבר - אוקטובר 2026" for a week across two months. */
export function viewTitle(view: CalendarView, date: string): string {
  const days = view === 'week' || view === 'three' ? viewDays(view, date) : [date];
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
