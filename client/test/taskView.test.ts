import { describe, expect, it } from 'vitest';
import type { Task } from '../../shared/types';
import { boardTransition, changeTaskFilter, newTaskFromFilters, sortTasks, taskFilters, taskSortPreference, taskViewPreference } from '../src/lib/taskView';

const task = (changes: Partial<Task> = {}): Task => ({
  id: 1, title: 'תיאום פעילות', status: 'todo', priority: 'normal', ownerId: 2, ownerName: 'אביב',
  createdBy: 1, creatorRole: 'commander', participantIds: [], requiresApproval: false,
  deadline: '2026-10-06T15:00:00Z', createdAt: '2026-10-01T09:00:00Z', overdue: false,
  needsCommander: false, ...changes,
} as Task);

describe('task filters and navigation', () => {
  it('recovers closed-status bookmarks that also ask for open tasks', () => {
    expect(taskFilters(new URLSearchParams('scope=open&status=done')).scope).toBe('all');
    expect(taskFilters(new URLSearchParams('scope=today&status=cancelled')).scope).toBe('all');
    expect(taskFilters(new URLSearchParams('scope=done&status=in_progress')).scope).toBe('open');
  });

  it('a scope shortcut clears a conflicting status but retains the person, search and sort', () => {
    const before = new URLSearchParams('scope=all&status=done&owner=7&q=מטווח&sort=priority');
    const after = changeTaskFilter(before, 'scope', 'overdue');
    expect(after.get('status')).toBeNull();
    expect(taskFilters(after)).toMatchObject({ scope: 'overdue', owner: '7', q: 'מטווח' });
    expect(after.get('sort')).toBe('priority');
    expect(before.get('status')).toBe('done');
  });

  it('selecting a closed status does not leave an invisible open-only constraint', () => {
    const after = changeTaskFilter(new URLSearchParams('scope=overdue&track=3'), 'status', 'done');
    expect(taskFilters(after)).toMatchObject({ scope: 'all', status: 'done', track: '3' });
    expect(after.get('scope')).toBe('all');
  });

  it('keeps date scopes when choosing a compatible working status', () => {
    const after = changeTaskFilter(new URLSearchParams('scope=today'), 'status', 'waiting');
    expect(taskFilters(after)).toMatchObject({ scope: 'today', status: 'waiting' });
  });

  it('accepts remembered mobile views and falls back safely from invalid preferences', () => {
    expect(taskViewPreference('board', true)).toBe('board');
    expect(taskViewPreference('invalid', true)).toBe('list');
    expect(taskViewPreference(null, false)).toBe('table');
    expect(taskSortPreference('invalid')).toBe('deadline');
    expect(taskFilters(new URLSearchParams('scope=invalid&status=invalid'))).toMatchObject({ scope: 'open', status: '' });
  });

  it('creates in the selected context, preserving unassigned week/track without NaN', () => {
    const defaults = newTaskFromFilters(taskFilters(new URLSearchParams('owner=me&week=none&track=none&domain=בטיחות&priority=high')), 9);
    expect(defaults).toEqual({ ownerIds: [9], weekId: null, trackId: null, domain: 'בטיחות', priority: 'high' });
    expect(newTaskFromFilters(taskFilters(new URLSearchParams('owner=oops&week=7&track=3')), 9)).toMatchObject({ ownerIds: undefined, weekId: 7, trackId: 3 });
  });
});

describe('one task order across views and export', () => {
  it('places overdue and commander decisions before regular work, and closed work last', () => {
    const list = [task({ id: 1, status: 'done', deadline: '2026-01-01T00:00:00Z' }), task({ id: 2 }),
      task({ id: 3, needsCommander: true }), task({ id: 4, overdue: true }), task({ id: 5, status: 'waiting' })];
    expect(sortTasks(list, 'attention').map((t) => t.id)).toEqual([4, 3, 5, 2, 1]);
    expect(list.map((t) => t.id)).toEqual([1, 2, 3, 4, 5]);
  });

  it('reverses priority and sorts equal priorities by deadline', () => {
    const list = [task({ id: 1, priority: 'low' }), task({ id: 2, priority: 'critical' }),
      task({ id: 3, priority: 'critical', deadline: '2026-10-05T00:00:00Z' })];
    expect(sortTasks(list, 'priority').map((t) => t.id)).toEqual([3, 2, 1]);
    expect(sortTasks(list, 'priority', true).map((t) => t.id)).toEqual([1, 3, 2]);
  });

  it('compares actual instants across time zone offsets and resolves ties stably', () => {
    const list = [task({ id: 3, deadline: '2026-10-06T15:00:00Z' }), task({ id: 2, deadline: '2026-10-06T17:00:00+03:00' }), task({ id: 1, deadline: '2026-10-06T14:00:00Z' })];
    expect(sortTasks(list, 'deadline').map((t) => t.id)).toEqual([1, 2, 3]);
    expect(sortTasks(list, 'deadline', true).map((t) => t.id)).toEqual([3, 1, 2]);
  });
});

describe('board transitions follow the approval workflow', () => {
  it('does not let an owner approve their own commander-assigned task', () => {
    const pending = task({ status: 'pending_approval', requiresApproval: true });
    expect(boardTransition(pending, 'done', 2, false)).toBeNull();
    expect(boardTransition(pending, 'done', 1, true)).toBe('approve');
  });

  it('allows a staff creator to approve a task assigned to another staff member', () => {
    expect(boardTransition(task({ status: 'pending_approval', requiresApproval: true, creatorRole: 'staff', createdBy: 3 }), 'done', 3, false)).toBe('approve');
    expect(boardTransition(task({ status: 'pending_approval', requiresApproval: true, creatorRole: 'staff', createdBy: 2 }), 'done', 2, false)).toBeNull();
  });

  it('only sends work to approval when approval is required and the actor cannot approve it', () => {
    expect(boardTransition(task({ requiresApproval: true }), 'pending_approval', 2, false)).toBe('complete');
    expect(boardTransition(task(), 'pending_approval', 2, false)).toBeNull();
    expect(boardTransition(task({ requiresApproval: true }), 'pending_approval', 1, true)).toBeNull();
    expect(boardTransition(task({ requiresApproval: true }), 'done', 2, false)).toBe('complete');
  });

  it('preserves blocker details, closed states, and permissions', () => {
    expect(boardTransition(task(), 'waiting', 2, false)).toBe('details');
    expect(boardTransition(task(), 'in_progress', 7, false)).toBeNull();
    expect(boardTransition(task({ status: 'waiting' }), 'in_progress', 2, false)).toBe('unblock');
    expect(boardTransition(task({ status: 'done' }), 'in_progress', 1, true)).toBeNull();
    expect(boardTransition(task({ status: 'done' }), 'todo', 2, false)).toBeNull();
    expect(boardTransition(task({ status: 'done' }), 'todo', 1, true)).toBe('reopen');
  });
});
