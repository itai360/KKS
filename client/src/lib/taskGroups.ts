// A task given to several people, shown once: its copies (one for each person) fold into one row,
// and the row says the group it went to - "סגל", "מפק"צים", "פורום מוביל" (shared/staffGroups.ts) -
// instead of appearing once per person.

import { namesOf, type StaffGroup } from '@shared/staffGroups';
import type { Task } from '@shared/types';
import { useApi } from './useApi';

/** copies of one task, one for each person (at least two of them left) */
export const isGrouped = (t: Task) => !!t.groupId && t.groupCopies.length > 1;

/** the people a task went to: whose each copy is, or its owner with its participants */
export const peopleOf = (t: Task): number[] => (isGrouped(t) ? t.groupCopies.map((c) => c.ownerId) : [t.ownerId, ...t.participantIds]);

/** the task's group column: the group's name, a few names for people who are not one, nothing for one person */
export function groupLabel(t: Task, userName: (id: number) => string): string {
  const people = peopleOf(t);
  if (people.length < 2) return '';
  return t.groupName ?? namesOf(people.map(userName));
}

export interface TaskUnit {
  /** the row: the viewer's own copy when they have one, so it can be ticked */
  task: Task;
  /** the copies of it in the list (just the task, when it is not given to several people) */
  copies: Task[];
}

/** the list with each task's copies folded into one row, where the first of them stood */
export function collapseGroups(tasks: Task[], userId: number): TaskUnit[] {
  const units: TaskUnit[] = [];
  const byGroup = new Map<string, TaskUnit>();
  for (const t of tasks) {
    const u = isGrouped(t) ? byGroup.get(t.groupId!) : undefined;
    if (!u) {
      const unit = { task: t, copies: [t] };
      if (isGrouped(t)) byGroup.set(t.groupId!, unit);
      units.push(unit);
      continue;
    }
    u.copies.push(t);
    if (t.ownerId === userId) u.task = t;
  }
  return units;
}

/** a row that stands for the whole task - all of its people - rather than for one person's copy: anyone's but the viewer's own */
export const isFolded = (unit: TaskUnit, userId: number) => isGrouped(unit.task) && unit.task.ownerId !== userId;

/** what a folded row shows: done once everyone is, started once anyone is, late when anyone's copy in the list is */
export function groupView(unit: TaskUnit, userId: number): Task {
  const t = unit.task;
  if (!isFolded(unit, userId)) return t;
  const all = t.groupCopies.every((c) => c.done);
  const late = unit.copies.find((c) => c.overdue);
  return {
    ...t,
    status: all ? 'done' : unit.copies.some((c) => c.status !== 'todo' && c.status !== 'done') ? 'in_progress' : 'todo',
    overdue: !all && !!late,
    tone: all ? 'green' : (late?.tone ?? t.tone),
  };
}

export interface TaskView {
  /** what the row shows */
  task: Task;
  /** it stands for the whole group */
  folded: boolean;
}

/** the rows of a list: each task given to a group folded into one - unless the list is one person's (collapse false) */
export function foldTasks(tasks: Task[], userId: number, collapse = true): TaskView[] {
  if (!collapse) return tasks.map((t) => ({ task: t, folded: false }));
  return collapseGroups(tasks, userId).map((u) => ({ task: groupView(u, userId), folded: isFolded(u, userId) }));
}

/**
 * The tasks an action on some rows reaches: a folded row, all of its copies - except to hand it to one
 * person (it stays its group's), and to mark it done or started, only the copies still waiting for that.
 */
export function expandUnits(units: TaskUnit[], userId: number): (action: string, ids: number[]) => number[] {
  const folded = new Map(units.filter((u) => isFolded(u, userId)).map((u) => [u.task.id, u]));
  return (action, ids) => {
    const out = new Set<number>();
    for (const id of ids) {
      const u = folded.get(id);
      if (!u) out.add(id);
      else if (action === 'owner') continue;
      else if (action === 'complete') u.task.groupCopies.filter((c) => !c.done).forEach((c) => out.add(c.id));
      else if (action === 'start') u.copies.filter((c) => c.status === 'todo').forEach((c) => out.add(c.id));
      else u.task.groupCopies.forEach((c) => out.add(c.id));
    }
    return [...out];
  };
}

/** the course's groups, with who is in each now */
export function useStaffGroups(): StaffGroup[] {
  return useApi<StaffGroup[]>('/api/staff-groups', ['settings', 'users', 'cadets']).data ?? [];
}
