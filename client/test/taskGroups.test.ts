import { describe, expect, it } from 'vitest';
import type { Task } from '@shared/types';
import { collapseGroups, expandUnits, foldTasks, groupLabel, groupView, isFolded } from '../src/lib/taskGroups';

const ME = 1;
const names: Record<number, string> = { 1: 'מפקד הקורס', 2: 'דנה', 3: 'יואב', 4: 'נועה', 5: 'עומר' };
const userName = (id: number) => names[id] ?? '';

// a task as a list gets it - only what folding reads
function task(id: number, ownerId: number, over: Partial<Task> = {}): Task {
  return { id, title: `משימה ${id}`, ownerId, ownerName: userName(ownerId), participantIds: [], createdBy: ME, groupId: null, groupCopies: [], groupName: null, status: 'todo', overdue: false, tone: 'gray', deadline: '2026-10-05T15:00:00.000Z', ...over } as Task;
}
const copies = [
  { id: 10, ownerId: 2, done: false },
  { id: 11, ownerId: 3, done: true },
  { id: 12, ownerId: 4, done: false },
];
const copy = (id: number, ownerId: number, over: Partial<Task> = {}) => task(id, ownerId, { groupId: 'g1', groupCopies: copies, groupName: 'סגל', ...over });

describe('a task given to a group, in a list', () => {
  it('is one row where its first copy stood, under its group', () => {
    const list = [task(1, 2), copy(10, 2), task(2, 3), copy(12, 4, { status: 'in_progress', overdue: true, tone: 'red' })];
    const units = collapseGroups(list, ME);
    expect(units.map((u) => u.task.id)).toEqual([1, 10, 2]);
    expect(units[1].copies.map((t) => t.id)).toEqual([10, 12]);
    expect(isFolded(units[1], ME)).toBe(true);
    // started by one, late for one, not done by all
    expect(groupView(units[1], ME)).toMatchObject({ status: 'in_progress', overdue: true, tone: 'red' });
    expect(groupLabel(units[1].task, userName)).toBe('סגל');
  });

  it("is the viewer's own copy when they have one - theirs to tick, not folded", () => {
    const units = collapseGroups([copy(10, 2), copy(12, 4)], 4);
    expect(units).toHaveLength(1);
    expect(units[0].task.id).toBe(12);
    expect(isFolded(units[0], 4)).toBe(false);
    expect(groupView(units[0], 4)).toBe(units[0].task);
  });

  it('is done once everyone is', () => {
    const all = copies.map((c) => ({ ...c, done: true }));
    const [u] = collapseGroups([copy(10, 2, { groupCopies: all, status: 'done' })], ME);
    expect(groupView(u, ME)).toMatchObject({ status: 'done', overdue: false, tone: 'green' });
  });

  it('acts on all of its copies - but is not handed to one person, and is done only where it is not yet', () => {
    const units = collapseGroups([copy(10, 2), task(1, 2), copy(12, 4, { status: 'in_progress' })], ME);
    const expand = expandUnits(units, ME);
    expect(expand('delete', [10]).sort()).toEqual([10, 11, 12]);
    expect(expand('priority', [10, 1]).sort()).toEqual([1, 10, 11, 12]);
    expect(expand('complete', [10]).sort()).toEqual([10, 12]);
    expect(expand('start', [10])).toEqual([10]);
    expect(expand('owner', [10, 1])).toEqual([1]);
  });

  it("stays each person's copy in one person's list", () => {
    const rows = foldTasks([copy(10, 2), copy(12, 4)], ME, false);
    expect(rows.map((r) => [r.task.id, r.folded, r.task.status])).toEqual([
      [10, false, 'todo'],
      [12, false, 'todo'],
    ]);
    expect(foldTasks([copy(10, 2), copy(12, 4)], ME).map((r) => [r.task.id, r.folded])).toEqual([[10, true]]);
  });

  it('names people who are not one group', () => {
    expect(groupLabel(copy(10, 2, { groupName: null }), userName)).toBe('דנה, יואב, נועה');
    expect(groupLabel(task(1, 2, { participantIds: [3, 4, 5] }), userName)).toBe('דנה, יואב +2');
    expect(groupLabel(task(1, 2), userName)).toBe('');
  });
});
