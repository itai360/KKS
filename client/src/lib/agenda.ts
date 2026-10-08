// The schedule as one running list ("סדר יום"), the way Google Calendar's Schedule view and
// Fantastical's list read: day after day, course events, Google events and task deadlines in one
// timeline, quiet days folded into one line. Free of the DOM so it can be tested.

import { addDays } from '@shared/dates';
import type { ExternalEvent, ScheduleEvent, Task } from '@shared/types';

export type AgendaItem =
  | { kind: 'event'; key: string; at: string; e: ScheduleEvent }
  /** at: '' for an all-day Google event */
  | { kind: 'external'; key: string; at: string; e: ExternalEvent }
  | { kind: 'task'; key: string; at: string; t: Task };

export interface AgendaDay {
  date: string;
  items: AgendaItem[];
}

export type AgendaRow = { kind: 'day'; date: string; items: AgendaItem[] } | { kind: 'gap'; from: string; to: string };

/** a deadline's day and time where the course is */
export type DeadlineAt = (t: Task) => { date: string; time: string };

const ORDER = { external: 0, event: 1, task: 2 } as const;

/** all-day first, then by time; at the same minute an event comes before a deadline */
const byTime = (a: AgendaItem, b: AgendaItem) => a.at.localeCompare(b.at) || ORDER[a.kind] - ORDER[b.kind];

/** The days from `from`, `count` of them, each with what it holds, in time order. */
export function agendaDays(from: string, count: number, events: ScheduleEvent[], external: ExternalEvent[], tasks: Task[], deadlineAt: DeadlineAt): AgendaDay[] {
  const byDay = new Map<string, AgendaItem[]>();
  const days: string[] = [];
  for (let i = 0; i < count; i++) {
    const d = addDays(from, i);
    days.push(d);
    byDay.set(d, []);
  }
  for (const e of events) byDay.get(e.date)?.push({ kind: 'event', key: `e${e.id}`, at: e.startTime, e });
  for (const x of external) byDay.get(x.date)?.push({ kind: 'external', key: `x${x.id}`, at: x.startTime ?? '', e: x });
  for (const t of tasks) {
    const at = deadlineAt(t);
    byDay.get(at.date)?.push({ kind: 'task', key: `t${t.id}`, at: at.time, t });
  }
  return days.map((date) => ({ date, items: byDay.get(date)!.sort(byTime) }));
}

/** Quiet days in a row fold into one line; the days in `keep` (today, the day chosen) always stand alone. */
export function foldQuiet(days: AgendaDay[], keep: ReadonlySet<string>): AgendaRow[] {
  const rows: AgendaRow[] = [];
  for (const d of days) {
    const last = rows[rows.length - 1];
    if (d.items.length || keep.has(d.date)) rows.push({ kind: 'day', date: d.date, items: d.items });
    else if (last?.kind === 'gap' && addDays(last.to, 1) === d.date) last.to = d.date;
    else rows.push({ kind: 'gap', from: d.date, to: d.date });
  }
  return rows;
}

/** "Only mine": an event this person is in charge of, or has a preparation task in (theirs, or taking part). */
export const isMine = (e: ScheduleEvent, userId: number): boolean => e.ownerId === userId || (e.myTasks ?? 0) > 0;

/** How many things a day holds, for the dots of the strip of days: cancelled events do not count. */
export function dayLoad(date: string, events: ScheduleEvent[], external: ExternalEvent[]): number {
  return events.filter((e) => e.date === date && !e.cancelled).length + external.filter((x) => x.date === date).length;
}

const minutesOf = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));

/** An event's end as minutes: no end - an hour; an end at or before its start (or 23:59) - midnight. */
export function endMinutes(e: { startTime: string; endTime: string | null }): number {
  const start = minutesOf(e.startTime);
  if (!e.endTime) return Math.min(24 * 60, start + 60);
  const end = minutesOf(e.endTime);
  return end <= start || e.endTime === '23:59' ? 24 * 60 : end;
}

export interface NowAndNext {
  /** going on now, the one that started last when several are */
  now: ScheduleEvent | null;
  /** how far through it is, 0..1 */
  progress: number;
  /** minutes until it ends */
  left: number;
  /** the next one to start today */
  next: ScheduleEvent | null;
  /** minutes until it starts */
  until: number;
}

/** Today's event going on now and the next one, as "Up Next" widgets show them. Cancelled ones are not. */
export function nowAndNext(events: ScheduleEvent[], today: string, nowTime: string): NowAndNext {
  const at = minutesOf(nowTime);
  const live = events.filter((e) => e.date === today && !e.cancelled).sort((a, b) => a.startTime.localeCompare(b.startTime));
  const now = [...live].reverse().find((e) => minutesOf(e.startTime) <= at && endMinutes(e) > at) ?? null;
  const next = live.find((e) => minutesOf(e.startTime) > at) ?? null;
  const start = now ? minutesOf(now.startTime) : 0;
  const end = now ? endMinutes(now) : 0;
  return {
    now,
    progress: now ? Math.min(1, Math.max(0, (at - start) / Math.max(1, end - start))) : 0,
    left: now ? end - at : 0,
    next,
    until: next ? minutesOf(next.startTime) - at : 0,
  };
}

const hoursWord = (h: number) => (h === 1 ? 'שעה' : h === 2 ? 'שעתיים' : `${h} שעות`);
/** a length of time, short and in words: "25 דק'", "שעה ו-20 דק'", "שעתיים"; from three hours, whole hours */
function length(min: number): string {
  if (min < 60) return `${Math.max(1, min)} דק'`;
  if (min >= 180) return `${Math.round(min / 60)} שעות`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${hoursWord(h)} ו-${m} דק'` : hoursWord(h);
}

/** "בעוד 25 דק'", "בעוד שעה", "בעוד שעתיים ו-15 דק'" - for a line in a list */
export const inMinutes = (min: number): string => `בעוד ${length(min)}`;

/** "נותרו 25 דק'", "נותרה שעה", "נותרו 15 שעות" */
export const leftMinutes = (min: number): string => (min === 60 ? 'נותרה שעה' : `נותרו ${length(min)}`);
