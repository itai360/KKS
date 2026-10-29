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
  /** the column inside its group (the events that start together), from the start side */
  col: number;
  /** how many columns the group needs */
  cols: number;
  /** how many columns it covers: it stretches over the next ones while they are free */
  span: number;
  /** how many events it lies on: 0 on the day itself, 1 on an event that began before it, and so on */
  depth: number;
  /** its place across the day's column, as parts of the column's width from the start side */
  left: number;
  width: number;
  /** and pixels added to those (the phone's layout moves an event lying on another in by a fixed step) */
  leftPx?: number;
  widthPx?: number;
}

/** events that start less than this apart sit side by side; one that starts later lies on the earlier */
export const TOGETHER_MINUTES = 30;
/** an event lying on another begins this part of that one's width in from the start side */
export const CASCADE_INDENT = 0.15;

/**
 * Lays out one day's timed events the way Google Calendar does. Events that start together (less than
 * half an hour apart) share a group and divide its width, each in the first column free at its start and
 * stretched over the next columns while they are free. An event that starts later than one it overlaps
 * takes a column there if one is free by then; otherwise it lies on that event - drawn over it, moved in
 * from the start side, so the one under it still shows (Google's cascade). Overlap counts as drawn: a
 * short event gets MIN_VISIBLE.
 */
export function layoutDay<T>(items: T[], span: (item: T) => { start: number; end: number }): Placed<T>[] {
  interface Group {
    members: Spot[];
    cols: number;
    /** the event this group lies on, if any */
    on: Spot | null;
  }
  type Spot = Placed<T> & { group: Group };
  const visibleEnd = (x: { start: number; end: number }) => Math.max(x.end, x.start + MIN_VISIBLE);
  const overlap = (a: { start: number; end: number }, b: { start: number; end: number }) => a.start < visibleEnd(b) && b.start < visibleEnd(a);
  const sorted = items.map((item) => ({ item, ...span(item) })).sort((a, b) => a.start - b.start || b.end - a.end);
  const spots: Spot[] = [];
  const groups: Group[] = [];
  const freeCol = (g: Group, x: { start: number; end: number }) => {
    const taken = new Set(g.members.filter((m) => overlap(m, x)).map((m) => m.col));
    let col = 0;
    while (taken.has(col)) col++;
    return col;
  };
  for (const x of sorted) {
    const over = spots.filter((p) => overlap(p, x));
    const together = over.filter((p) => x.start - p.start < TOGETHER_MINUTES);
    // the one it lies most directly on: the deepest, the latest of those
    const under = over.reduce<Spot | null>((m, p) => (!m || p.depth > m.depth || (p.depth === m.depth && p.start > m.start) ? p : m), null);
    let group: Group;
    let col: number;
    if (together.length) {
      group = together.reduce((m, p) => (p.depth > m.depth ? p : m)).group;
      col = freeCol(group, x);
    } else if (under && freeCol(under.group, x) < under.group.cols) {
      group = under.group;
      col = freeCol(group, x);
    } else {
      group = { members: [], cols: 0, on: under };
      groups.push(group);
      col = 0;
    }
    const depth = group.members.length ? group.members[0].depth : under && group.on === under ? under.depth + 1 : 0;
    const spot: Spot = { item: x.item, start: x.start, end: x.end, col, cols: 1, span: 1, depth, left: 0, width: 1, group };
    group.members.push(spot);
    group.cols = Math.max(group.cols, col + 1);
    spots.push(spot);
  }
  // the boxes, a group after the one it lies on (made before it): its columns divide the width of the event
  // under it, moved in from the start side - or the whole column
  for (const g of groups) {
    const left = g.on ? g.on.left + g.on.width * CASCADE_INDENT : 0;
    const width = g.on ? g.on.width * (1 - CASCADE_INDENT) : 1;
    for (const p of g.members) {
      p.cols = g.cols;
      while (p.col + p.span < g.cols && !g.members.some((q) => q.col === p.col + p.span && overlap(p, q))) p.span++;
      p.left = left + (width * p.col) / g.cols;
      p.width = (width * p.span) / g.cols;
    }
  }
  return spots.map(({ group: _group, ...p }) => p);
}

/** the phone's layout: events that start this close (or closer) sit side by side */
export const APP_TOGETHER_MINUTES = 30;
/** the phone's layout: an event lying on another begins this many pixels in from that one's start side */
export const APP_INDENT_PX = 24;
/** the phone's layout: the shortest an event is drawn, in minutes (one line of its title) */
export const APP_MIN_VISIBLE = 20;

/**
 * Lays out one day's timed events the way Google Calendar's phone app does (its day and three days).
 * Events that start within half an hour of one another share a group and divide its width - the longest
 * in the first column, each in the first column free during it, stretched over the next columns while they
 * are free. An event that starts later than every event it overlaps lies on the one most directly under
 * it: moved in from that one's start side by a fixed step, and reaching on over the columns beside it that
 * are free while it lasts - to the day's end side when they all are. Positions are parts of the column's
 * width plus pixels (`leftPx`, `widthPx`).
 */
export function layoutDayApp<T>(items: T[], span: (item: T) => { start: number; end: number }, minVisible = APP_MIN_VISIBLE, indentPx = APP_INDENT_PX): Placed<T>[] {
  interface Box {
    pct: number;
    px: number;
  }
  interface Group {
    members: Spot[];
    cols: number;
    /** the event this group lies on, if any */
    on: Spot | null;
    left: Box;
    width: Box;
  }
  type Spot = Placed<T> & { group: Group; leftPx: number; widthPx: number };
  const visibleEnd = (x: { start: number; end: number }) => Math.max(x.end, x.start + minVisible);
  const overlap = (a: { start: number; end: number }, b: { start: number; end: number }) => a.start < visibleEnd(b) && b.start < visibleEnd(a);
  const sorted = items.map((item) => ({ item, ...span(item) })).sort((a, b) => a.start - b.start || b.end - a.end);
  const spots: Spot[] = [];
  const groups: Group[] = [];
  const newGroup = (on: Spot | null): Group => {
    const g: Group = { members: [], cols: 1, on, left: { pct: 0, px: 0 }, width: { pct: 1, px: 0 } };
    groups.push(g);
    return g;
  };
  for (const x of sorted) {
    const over = spots.filter((p) => overlap(p, x));
    const together = over.filter((p) => x.start - p.start <= APP_TOGETHER_MINUTES);
    // the one it lies most directly on: the deepest, the latest of those
    const under = over.reduce<Spot | null>((m, p) => (!m || p.depth > m.depth || (p.depth === m.depth && p.start > m.start) ? p : m), null);
    const group = together.length ? together.reduce((m, p) => (p.depth > m.depth ? p : m)).group : newGroup(under);
    const depth = group.on ? group.on.depth + 1 : 0;
    const spot: Spot = { item: x.item, start: x.start, end: x.end, col: 0, cols: 1, span: 1, depth, left: 0, width: 1, leftPx: 0, widthPx: 0, group };
    group.members.push(spot);
    spots.push(spot);
  }
  // the columns of each group: the longest first (then the one that ends later), each in the first column free during it
  for (const g of groups) {
    const order = [...g.members].sort((a, b) => b.end - b.start - (a.end - a.start) || b.end - a.end || a.start - b.start);
    const done: Spot[] = [];
    for (const p of order) {
      let col = 0;
      while (done.some((q) => q.col === col && overlap(p, q))) col++;
      p.col = col;
      done.push(p);
    }
    g.cols = Math.max(...g.members.map((m) => m.col)) + 1;
    for (const p of g.members) {
      p.cols = g.cols;
      while (p.col + p.span < g.cols && !g.members.some((q) => q.col === p.col + p.span && overlap(p, q))) p.span++;
    }
  }
  // the room of each group (one lying on another comes after it): the whole column, or from the event under
  // it moved in by the step, on over the columns beside that one that are free while the group lasts
  const at = (b: Box, w: Box, part: number): Box => ({ pct: b.pct + w.pct * part, px: b.px + w.px * part });
  for (const g of groups) {
    const on = g.on;
    if (on) {
      const og = on.group;
      const from = Math.min(...g.members.map((m) => m.start));
      const to = Math.max(...g.members.map(visibleEnd));
      let end = on.col + on.span;
      while (end < og.cols && !og.members.some((q) => q.col <= end && end < q.col + q.span && q.start < to && from < visibleEnd(q))) end++;
      const right = at(og.left, og.width, end / og.cols);
      g.left = { pct: on.left, px: on.leftPx + indentPx };
      g.width = { pct: right.pct - g.left.pct, px: right.px - g.left.px };
    }
    for (const p of g.members) {
      const l = at(g.left, g.width, p.col / g.cols);
      p.left = l.pct;
      p.leftPx = l.px;
      p.width = (g.width.pct * p.span) / g.cols;
      p.widthPx = (g.width.px * p.span) / g.cols;
    }
  }
  return spots.map(({ group: _group, ...p }) => p);
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
