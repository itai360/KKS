import { isOpenStatus, type Priority, type TaskStatus, type Tone } from './constants';
import { DAY, HOUR } from './dates';

export interface FlagInput {
  status: TaskStatus;
  priority: Priority;
  deadline: string;
  lastActivityAt: string;
}

export interface TaskFlags {
  overdue: boolean;
  dueSoon: boolean;
  stale: boolean;
  tone: Tone;
}

/**
 * Section 5/18/61/72: overdue is derived (deadline passed and not closed) rather
 * than stored, so the real working status ("בטיפול", "ממתין") is never lost.
 */
export function computeFlags(t: FlagInput, now: Date, staleDays: number): TaskFlags {
  const open = isOpenStatus(t.status);
  const left = new Date(t.deadline).getTime() - now.getTime();
  const overdue = open && left < 0;
  const dueSoon = open && !overdue && left <= 24 * HOUR;
  // "Not updated" matters for work in progress, or for untouched work that is
  // close to its deadline - not for a task due in three weeks (section 77).
  const stale =
    open &&
    t.status !== 'pending_approval' &&
    staleDays > 0 &&
    (t.status !== 'todo' || left <= 3 * DAY) &&
    now.getTime() - new Date(t.lastActivityAt).getTime() >= staleDays * DAY;
  return { overdue, dueSoon, stale, tone: toneOf(t.status, t.priority, overdue, dueSoon) };
}

export function toneOf(status: TaskStatus, priority: Priority, overdue: boolean, dueSoon: boolean): Tone {
  if (status === 'done') return 'green';
  if (status === 'cancelled') return 'gray';
  if (overdue || priority === 'critical') return 'red';
  if (dueSoon) return 'orange';
  if (status === 'waiting') return 'purple';
  if (status === 'pending_approval') return 'blue';
  if (status === 'in_progress') return 'yellow';
  return 'gray';
}

/** Section 14 - readiness = completed / all non-cancelled tasks. */
export function readinessPct(done: number, total: number): number {
  if (total <= 0) return 0;
  return Math.round((done / total) * 100);
}

/** Section 32 - "מפק"צ 2 - משימה אחת באיחור" */
export function staffHealthLabel(overdue: number): string {
  if (overdue <= 0) return 'תקין';
  if (overdue === 1) return 'משימה אחת באיחור';
  return `${overdue} משימות באיחור`;
}

export function pluralTasks(n: number): string {
  return n === 1 ? 'משימה אחת' : `${n} משימות`;
}
