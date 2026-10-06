import { isOpenStatus, PRIORITIES, PRIORITY_RANK, STATUSES, type TaskStatus } from '../../../shared/constants';
import type { Task } from '../../../shared/types';
import type { NewTaskInitial } from '../components/NewTask';

export const TASK_SCOPES = [
  ['open', 'פתוחות'], ['overdue', 'באיחור'], ['today', 'להיום'], ['week', 'לשבוע הקרוב'],
  ['waiting', 'חסומות'], ['pending_approval', 'ממתינות לאישור'], ['attention', 'חריגות'],
  ['done', 'הושלמו'], ['all', 'הכל'],
] as const;

export const TASK_SORTS = [
  ['deadline', 'דד-ליין'], ['attention', 'דורשות טיפול תחילה'], ['priority', 'עדיפות'],
  ['owner', 'אחראי'], ['status', 'סטטוס'], ['newest', 'מועד יצירה'],
] as const;
export type TaskSort = typeof TASK_SORTS[number][0];
export type TaskView = 'table' | 'list' | 'board';

export function taskViewPreference(saved: string | null, mobile: boolean): TaskView {
  return saved === 'table' || saved === 'list' || saved === 'board' ? saved : mobile ? 'list' : 'table';
}

export function taskFilters(params: URLSearchParams) {
  const get = (key: string) => params.get(key) ?? '';
  let scope: string = TASK_SCOPES.some(([key]) => key === get('scope')) ? get('scope') : 'open';
  const status = STATUSES.some((s) => s === get('status')) || get('status') === 'overdue' ? get('status') : '';
  // Old bookmarks can combine a closed status with an open-only scope.
  if (status === 'done' || status === 'cancelled') scope = 'all';
  else if (status && (scope === 'done' || scope === 'waiting' || scope === 'pending_approval')) scope = 'open';
  return {
    scope, status, owner: get('owner'), createdBy: get('createdBy'), week: get('week'), track: get('track'),
    domain: get('domain'), priority: get('priority'), q: get('q'), routine: get('routine') === '1' ? '1' : '0',
  };
}

export function changeTaskFilter(params: URLSearchParams, key: keyof ReturnType<typeof taskFilters>, value: string) {
  const next = new URLSearchParams(params);
  if (value) next.set(key, value);
  else next.delete(key);
  if (key === 'scope') next.delete('status');
  if (key === 'status' && value) {
    const scope = taskFilters(next).scope;
    if (scope === 'open') next.delete('scope');
    else next.set('scope', scope);
  }
  return next;
}

export function taskSortPreference(value: string | null): TaskSort {
  return TASK_SORTS.some(([key]) => key === value) ? value as TaskSort : 'deadline';
}

export function sortTasks(tasks: Task[], sort: TaskSort, descending = false): Task[] {
  const attention = (t: Task) => !isOpenStatus(t.status) ? 6 : t.overdue ? 0 : t.needsCommander ? 1 : t.status === 'pending_approval' ? 2 : t.status === 'waiting' ? 3 : t.priority === 'critical' ? 4 : 5;
  return [...tasks].sort((a, b) => {
    let order: number;
    switch (sort) {
      case 'attention': order = attention(a) - attention(b); break;
      case 'priority': order = PRIORITY_RANK[b.priority] - PRIORITY_RANK[a.priority]; break;
      case 'owner': order = a.ownerName.localeCompare(b.ownerName, 'he'); break;
      case 'status': order = STATUSES.indexOf(a.status) - STATUSES.indexOf(b.status); break;
      case 'newest': order = Date.parse(b.createdAt) - Date.parse(a.createdAt); break;
      default: order = Date.parse(a.deadline) - Date.parse(b.deadline);
    }
    return (descending ? -order : order) || Date.parse(a.deadline) - Date.parse(b.deadline) || a.id - b.id;
  });
}

export function newTaskFromFilters(f: ReturnType<typeof taskFilters>, userId: number): NewTaskInitial {
  const id = (v: string) => /^\d+$/.test(v) && Number(v) > 0 ? Number(v) : undefined;
  const owner = f.owner === 'me' ? userId : id(f.owner);
  return {
    weekId: f.week === 'none' ? null : id(f.week),
    trackId: f.track === 'none' ? null : id(f.track),
    ownerIds: owner ? [owner] : undefined,
    domain: f.domain || undefined,
    priority: PRIORITIES.find((p) => p === f.priority),
  };
}

/** Dragging follows the same approval rules as the task detail screen. */
export function boardTransition(task: Task, target: TaskStatus, userId: number, commander: boolean): string | null {
  const update = commander || task.ownerId === userId || task.createdBy === userId || task.participantIds.includes(userId);
  const approve = commander || (task.createdBy === userId && task.creatorRole !== 'commander' && task.ownerId !== userId);
  if (!update || task.status === target) return null;
  if (target === 'todo' && !isOpenStatus(task.status) && (commander || task.createdBy === userId || approve)) return 'reopen';
  if (!isOpenStatus(task.status)) return null;
  if (target === 'in_progress' && task.status === 'todo') return 'start';
  if (target === 'in_progress' && task.status === 'waiting') return 'unblock';
  if (task.status === 'pending_approval') return target === 'done' && approve ? 'approve' : null;
  if (target === 'waiting') return 'details';
  if (target === 'done') return 'complete';
  if (target === 'pending_approval' && task.requiresApproval && !approve) return 'complete';
  return null;
}
