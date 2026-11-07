import { describe, expect, it } from 'vitest';
import { screenAt, topicTarget } from '../src/lib/topics';

const tasks = [{ to: '/my' }, { to: '/tasks' }, { to: '/requests' }, { to: '/templates' }];
const control = [{ to: '/overview' }, { to: '/reports/weekly' }, { to: '/reports' }];

describe('the menu holds the topics, their screens are tabs on top', () => {
  it('finds the screen on show - itself, or one under it; the longest match', () => {
    expect(screenAt('/tasks', tasks)?.to).toBe('/tasks');
    expect(screenAt('/tasks/12', tasks)?.to).toBe('/tasks');
    expect(screenAt('/taskslist', tasks)).toBeUndefined();
    expect(screenAt('/reports/weekly', control)?.to).toBe('/reports/weekly');
    expect(screenAt('/', [{ to: '/', end: true }])?.to).toBe('/');
    expect(screenAt('/x', [{ to: '/', end: true }])).toBeUndefined();
  });

  it('a topic opens the screen of it last used - while it is still one of its screens - else its first', () => {
    expect(topicTarget('ניהול משימות', tasks, {})).toBe('/my');
    expect(topicTarget('ניהול משימות', tasks, { 'ניהול משימות': '/templates' })).toBe('/templates');
    expect(topicTarget('ניהול משימות', tasks, { 'ניהול משימות': '/command' })).toBe('/my');
  });
});
