// The weekly (שבועי): the staff's meeting of a course week - over the week's schedule, the
// professional closures, the topics the team commanders raise, and at the end the commander's points.
// One per course week (server/src/weekly.ts).

import type { ScheduleEvent, Task } from './types';

export const WEEKLY_KINDS = ['schedule', 'closure', 'topic', 'point'] as const;
export type WeeklyKind = (typeof WEEKLY_KINDS)[number];

/** in the order of the meeting */
export const WEEKLY_KIND_LABELS: Record<WeeklyKind, string> = {
  schedule: 'הערה ללו"ז',
  closure: 'סגירה מקצועית',
  topic: 'נושא לשיח',
  point: 'דגש שלי',
};

/** what "done" means for each kind */
export const WEEKLY_DONE_LABELS: Record<WeeklyKind, string> = {
  schedule: 'טופל',
  closure: 'נסגר',
  topic: 'נדון',
  point: 'נאמר',
};

export interface WeeklyItem {
  id: number;
  weekId: number;
  kind: WeeklyKind;
  title: string;
  details: string;
  /** a note on the schedule: the event it is about ('e:<id>' in the schedule, 'x:<id>' from a Google calendar) and its day */
  eventRef: string | null;
  eventDate: string | null;
  /** a closure: who closes it */
  ownerId: number | null;
  ownerName: string | null;
  done: boolean;
  /** what was decided about it in the meeting */
  outcome: string;
  taskId: number | null;
  taskTitle: string | null;
  /** came over, not yet discussed, from the weekly of an earlier week */
  carriedFrom: { id: number; name: string } | null;
  createdBy: number | null;
  createdByName: string | null;
  createdAt: string;
  /** the one asking may change it (its text, its owner) and delete it */
  canEdit: boolean;
  /** the one asking may mark it done, write what was decided and turn it into a task */
  canSettle: boolean;
}

export interface WeeklyWeek {
  id: number;
  number: number;
  name: string;
  startDate: string;
  endDate: string;
  leadId: number | null;
  leadName: string | null;
  heldAt: string | null;
}

export interface WeeklyView {
  week: WeeklyWeek;
  /** every week of the course, for moving between weeklies */
  weeks: WeeklyWeek[];
  heldAt: string | null;
  heldByName: string | null;
  items: WeeklyItem[];
  /** the commander's points are the commander's until the weekly is held; then everyone's */
  pointsHidden: boolean;
  /** the commander and the week's team commander run it */
  canManage: boolean;
  /** the commander holds it (sends the summary) and writes the points */
  canHold: boolean;
  events: ScheduleEvent[];
  /** the week's tasks not yet done, to go over with the closures */
  openTasks: Task[];
  next: { id: number; name: string } | null;
}

/** where a new topic goes: the weekly of the current week until it is held, then the next one */
export interface WeeklyTarget {
  weekId: number | null;
  weeks: WeeklyWeek[];
}

export interface WeeklyHoldResult {
  carried: number;
  notified: number;
  nextWeekId: number | null;
}

/** the summary as text, to paste in the staff's WhatsApp group */
export function weeklySummaryText(v: Pick<WeeklyView, 'week' | 'items'>): string {
  const lines: string[] = [`*שבועי - ${v.week.name}*`];
  const section = (title: string, kind: WeeklyKind, row: (i: WeeklyItem) => string) => {
    const items = v.items.filter((i) => i.kind === kind);
    if (!items.length) return;
    lines.push('', `*${title}*`);
    for (const i of items) lines.push(row(i));
  };
  const outcome = (i: WeeklyItem) => (i.outcome.trim() ? ` - ${i.outcome.trim()}` : '');
  section('לו"ז', 'schedule', (i) => `• ${i.title}${outcome(i)}`);
  section('סגירות מקצועיות', 'closure', (i) => `${i.done ? '✔' : '•'} ${i.title}${i.ownerName ? ` (${i.ownerName})` : ''}${outcome(i)}`);
  section('נושאים לשיח', 'topic', (i) => `• ${i.title}${outcome(i)}`);
  section('דגשי המפקד', 'point', (i) => `• ${i.title}${i.details.trim() ? ` - ${i.details.trim()}` : ''}`);
  return lines.join('\n');
}
