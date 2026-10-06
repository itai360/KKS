// "ביטול" right after marking a task done: back as it was, for the one who marked it, a moment after.

import { beforeEach, describe, expect, it } from 'vitest';
import { clock } from '../src/core';
import { NOW, newTask, notificationsOf, setup, type Ctx } from './helpers';

let c: Ctx;
beforeEach(async () => {
  c = await setup();
});

describe('undoing "done"', () => {
  it('puts the task back and takes back what marking it told others', async () => {
    // a task a team commander gave another: its creator hears when it is done
    const id = await newTask(c.s2, { title: 'הכנת שיעור', ownerIds: [c.ids.s1] });
    expect((await c.s1.post(`/api/tasks/${id}/transition`, { action: 'complete' })).body.task.status).toBe('done');
    expect(notificationsOf(c.ids.s2).some((n) => n.type === 'task_done')).toBe(true);
    // someone else cannot undo it
    expect((await c.s2.post(`/api/tasks/${id}/transition`, { action: 'undo_complete' })).status).toBe(400);
    const back = await c.s1.post(`/api/tasks/${id}/transition`, { action: 'undo_complete' });
    expect(back.status).toBe(200);
    expect(back.body.task).toMatchObject({ status: 'todo', completedAt: null });
    expect(notificationsOf(c.ids.s2).some((n) => n.type === 'task_done')).toBe(false);
    const activity = (await c.s1.get(`/api/tasks/${id}`)).body.activity.map((a: { text: string }) => a.text);
    expect(activity.some((t: string) => t.includes('ביטל את הסימון כהושלמה'))).toBe(true);
  });

  it('a task in progress goes back to in progress; after two minutes it is reopened instead', async () => {
    const id = await newTask(c.s1, { title: 'תיאום הסעות', ownerIds: [c.ids.s1] });
    await c.s1.post(`/api/tasks/${id}/transition`, { action: 'start' });
    await c.s1.post(`/api/tasks/${id}/transition`, { action: 'complete' });
    expect((await c.s1.post(`/api/tasks/${id}/transition`, { action: 'undo_complete' })).body.task.status).toBe('in_progress');

    await c.s1.post(`/api/tasks/${id}/transition`, { action: 'complete' });
    clock.set(new Date(NOW.getTime() + 3 * 60_000));
    const late = await c.s1.post(`/api/tasks/${id}/transition`, { action: 'undo_complete' });
    expect(late.status).toBe(400);
    expect(late.body.error).toContain('לפתוח את המשימה מחדש');
  });
});
