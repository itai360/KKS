// The calendar's layers ("היומנים שלי", "יומנים נוספים") and the one shape everything on it takes: a
// course event, an event of a connected Google calendar, a task's deadline, a course week, a cadet's
// experience, a debrief, a staff absence. Only what has a real day of its own is placed - nothing is
// given a made-up date. Free of the DOM so it can be tested.

import { ABSENCE_REASON_LABELS } from './constants';
import { byHe } from './sort';
import type { Absence, Debrief, Experience, ExternalEvent, ScheduleEvent, Task, Week } from './types';

/** the colours things are drawn in - their tones, light and dark, are in the stylesheet (gcal.css) */
export const CAL_COLORS = ['blue', 'teal', 'green', 'olive', 'yellow', 'orange', 'red', 'pink', 'purple', 'lavender', 'graphite'] as const;
export type CalColor = (typeof CAL_COLORS)[number];
export const CAL_COLOR_LABELS: Record<CalColor, string> = {
  blue: 'כחול',
  teal: 'טורקיז',
  green: 'ירוק',
  olive: 'זית',
  yellow: 'צהוב',
  orange: 'כתום',
  red: 'אדום',
  pink: 'ורוד',
  purple: 'סגול',
  lavender: 'לבנדר',
  graphite: 'אפור',
};
export const isCalColor = (c: unknown): c is CalColor => typeof c === 'string' && (CAL_COLORS as readonly string[]).includes(c);

export type CoreLayer = 'events' | 'myTasks' | 'staffTasks' | 'weeks' | 'experiences' | 'debriefs' | 'absences';
/** a connected Google calendar is a layer of its own: "ext:" and its id */
export type LayerId = CoreLayer | `ext:${number}`;

export interface LayerDef {
  id: CoreLayer;
  label: string;
  color: CalColor;
  /** what it shows, in a few words (the box's title) */
  hint: string;
  /** shown until the person says otherwise */
  on: boolean;
}

export const CORE_LAYERS: LayerDef[] = [
  { id: 'events', label: 'אירועי הקורס', color: 'blue', hint: 'הלו"ז של הקורס', on: true },
  { id: 'myTasks', label: 'המשימות שלי', color: 'teal', hint: 'הדד-ליינים של המשימות הפתוחות שלך', on: true },
  { id: 'staffTasks', label: 'משימות הסגל', color: 'lavender', hint: 'הדד-ליינים של כל המשימות הפתוחות שמותר לך לראות', on: false },
  { id: 'weeks', label: 'שבועות הקורס', color: 'green', hint: 'כל שבוע בקורס לאורך ימיו, עם המפק"צ המוביל', on: true },
  { id: 'experiences', label: 'התנסויות צוערים', color: 'purple', hint: 'תפקידים והתנסויות רוחב, לפי התאריכים שלהם', on: false },
  { id: 'debriefs', label: 'תחקירים', color: 'orange', hint: 'היום שבו כל תחקיר נערך', on: false },
  { id: 'absences', label: 'היעדרויות סגל', color: 'graphite', hint: 'מי מהסגל לא נמצא, ומתי', on: false },
];
export const layerDef = (id: CoreLayer): LayerDef => CORE_LAYERS.find((l) => l.id === id)!;

/** whether a layer is shown: as the person left it, or its default (a Google calendar: shown) */
export function layerShown(prefs: Partial<Record<string, boolean>>, id: LayerId): boolean {
  const set = prefs[id];
  if (set !== undefined) return set;
  return id.startsWith('ext:') ? true : (CORE_LAYERS.find((l) => l.id === id)?.on ?? false);
}

/** the colour of a connected Google calendar, by its place among them */
const EXT_COLORS: CalColor[] = ['graphite', 'olive', 'pink', 'yellow', 'red', 'blue', 'teal', 'purple'];
export const externalColor = (index: number): CalColor => EXT_COLORS[((index % EXT_COLORS.length) + EXT_COLORS.length) % EXT_COLORS.length];

export type CalSource =
  | { kind: 'event'; e: ScheduleEvent }
  | { kind: 'external'; e: ExternalEvent }
  | { kind: 'task'; e: Task }
  | { kind: 'week'; e: Week }
  | { kind: 'experience'; e: Experience }
  | { kind: 'debrief'; e: Debrief }
  | { kind: 'absence'; e: Absence };
export type CalKind = CalSource['kind'];

/** One thing on the calendar. */
export interface CalItem {
  /** stable across loads: its kind and its id ("event:12") */
  key: string;
  layer: LayerId;
  title: string;
  /** a few words beside the title: who runs it, whose it is */
  sub: string;
  /** its first and last day (the same for one day) */
  date: string;
  endDate: string;
  /** "HH:MM", or null: it has no hour - all day, or the days it lasts. A task: its deadline's hour. */
  start: string | null;
  end: string | null;
  color: CalColor;
  /** called off, done or over: drawn faded */
  faded: boolean;
  /** a task past its deadline */
  overdue: boolean;
  src: CalSource;
}

export function fromEvent(e: ScheduleEvent): CalItem {
  return {
    key: `event:${e.id}`,
    layer: 'events',
    title: e.title,
    sub: e.location,
    date: e.date,
    endDate: e.endDate ?? e.date,
    start: e.allDay ? null : e.startTime,
    end: e.allDay ? null : e.endTime,
    color: isCalColor(e.color) ? e.color : 'blue',
    faded: e.cancelled,
    overdue: false,
    src: { kind: 'event', e },
  };
}

export function fromExternal(x: ExternalEvent, color: CalColor): CalItem {
  return {
    key: `ext:${x.sourceId}:${x.id}`,
    layer: `ext:${x.sourceId}`,
    title: x.title,
    sub: x.location,
    date: x.date,
    endDate: x.date,
    start: x.startTime,
    end: x.endTime,
    color,
    faded: false,
    overdue: false,
    src: { kind: 'external', e: x },
  };
}

/** a task at its deadline - `at` reads an instant as the course's day and hour */
export function fromTask(t: Task, layer: 'myTasks' | 'staffTasks', at: (iso: string) => { date: string; time: string }): CalItem {
  const { date, time } = at(t.deadline);
  return {
    key: `task:${t.id}`,
    layer,
    title: t.title,
    sub: t.ownerName,
    date,
    endDate: date,
    start: time,
    end: null,
    color: t.overdue ? 'red' : layerDef(layer).color,
    faded: t.status === 'done' || t.status === 'cancelled',
    overdue: t.overdue,
    src: { kind: 'task', e: t },
  };
}

export function fromWeek(w: Week): CalItem {
  return {
    key: `week:${w.id}`,
    layer: 'weeks',
    title: w.name,
    sub: w.leadName ? `מפק"צ מוביל: ${w.leadName}` : '',
    date: w.startDate,
    endDate: w.endDate,
    start: null,
    end: null,
    color: 'green',
    faded: w.status === 'closed',
    overdue: false,
    src: { kind: 'week', e: w },
  };
}

/** what the calendar shows of an experience: the role, the cadet and the days - never the feedback */
export function fromExperience(x: Experience): CalItem {
  return {
    key: `exp:${x.id}`,
    layer: 'experiences',
    title: `${x.role}: ${x.cadetName}`,
    sub: x.teamName ?? '',
    date: x.startDate,
    endDate: x.endDate < x.startDate ? x.startDate : x.endDate,
    start: null,
    end: null,
    color: 'purple',
    faded: x.phase === 'done',
    overdue: false,
    src: { kind: 'experience', e: x },
  };
}

export function fromDebrief(d: Debrief): CalItem {
  return {
    key: `debrief:${d.id}`,
    layer: 'debriefs',
    title: d.title,
    sub: d.status === 'final' ? 'סוכם' : 'טיוטה',
    date: d.occurredOn,
    endDate: d.occurredOn,
    start: null,
    end: null,
    color: 'orange',
    faded: false,
    overdue: false,
    src: { kind: 'debrief', e: d },
  };
}

/**
 * Who is away and when. Why they are away (sick, say) is theirs and the commander's: everyone else
 * reads only that they are away.
 */
export function fromAbsence(a: Absence, showReason: boolean): CalItem {
  return {
    key: `absence:${a.id}`,
    layer: 'absences',
    title: `${a.userName} - ${showReason ? ABSENCE_REASON_LABELS[a.reason] : 'לא זמין'}`,
    sub: '',
    date: a.startDate,
    endDate: a.endDate < a.startDate ? a.startDate : a.endDate,
    start: null,
    end: null,
    color: 'graphite',
    faded: false,
    overdue: false,
    src: { kind: 'absence', e: a },
  };
}

/** placed in the hours: a course or Google event of one day, with an hour */
export const isTimed = (i: CalItem): boolean => (i.src.kind === 'event' || i.src.kind === 'external') && i.start !== null && i.date === i.endDate;

/** the days a thing covers, for layoutSpans */
export const itemDays = (i: CalItem) => ({ startDate: i.date, endDate: i.endDate });

const KIND_RANK: Record<CalKind, number> = { week: 0, absence: 1, experience: 1, event: 2, external: 2, debrief: 3, task: 4 };

/** the order of things in a day's rows: the weeks, who is away, the rest of the day, then deadlines by the hour */
export function dayOrder(a: CalItem, b: CalItem): number {
  return KIND_RANK[a.src.kind] - KIND_RANK[b.src.kind] || (a.start ?? '').localeCompare(b.start ?? '') || byHe(a.title, b.title);
}

/** the things in some days: overlapping them at all */
export const inRange = (items: CalItem[], from: string, to: string) => items.filter((i) => i.date <= to && i.endDate >= from);

/** how busy each day is - the events, the Google events and the deadlines on it - for the year's colours */
export function loadByDay(items: CalItem[]): Map<string, number> {
  const n = new Map<string, number>();
  for (const i of items) {
    const k = i.src.kind;
    if (k !== 'event' && k !== 'external' && k !== 'task') continue;
    if (k === 'event' && i.faded) continue;
    n.set(i.date, (n.get(i.date) ?? 0) + 1);
  }
  return n;
}

/** the same task on two layers (mine, and the staff's) is shown once - as mine */
export function dedupe(items: CalItem[]): CalItem[] {
  const seen = new Set<string>();
  return items.filter((i) => (seen.has(i.key) ? false : (seen.add(i.key), true)));
}

// ---------------- which deadlines: the tasks layers' filter ----------------

export interface TaskFilter {
  /** open: all open tasks; urgent: high or critical; overdue: past their deadline */
  scope: 'open' | 'urgent' | 'overdue';
  /** only preparation tasks of an event */
  linked: boolean;
  domain: string;
  weekId: number | null;
  trackId: number | null;
  /** the staff's tasks: one person's */
  ownerId: number | null;
}

export const NO_TASK_FILTER: TaskFilter = { scope: 'open', linked: false, domain: '', weekId: null, trackId: null, ownerId: null };

export const isTaskFilterSet = (f: TaskFilter) => f.scope !== 'open' || f.linked || !!f.domain || f.weekId !== null || f.trackId !== null || f.ownerId !== null;

/** The tasks query of a layer for some days - the server filters by what the reader may see. */
export function taskQuery(f: TaskFilter, mine: boolean, from: string, to: string): string {
  const q = new URLSearchParams({ from, to, hideClosed: '1', recurring: '0' });
  if (mine) q.set('owner', 'me');
  else if (f.ownerId) q.set('owner', String(f.ownerId));
  if (f.domain) q.set('domain', f.domain);
  if (f.weekId) q.set('week', String(f.weekId));
  if (f.trackId) q.set('track', String(f.trackId));
  if (f.scope === 'overdue') q.set('status', 'overdue');
  if (f.scope === 'urgent') q.set('priority', 'high,critical');
  return `/api/tasks?${q.toString()}`;
}

/** what the query cannot ask for: only the preparation tasks of an event */
export const matchesTaskFilter = (t: Task, f: TaskFilter) => !f.linked || t.eventId !== null;
