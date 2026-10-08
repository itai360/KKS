// Many items at once: the same rules as one at a time, reported per item.

import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../src/db';
import { at, newTask, setup, type Ctx } from './helpers';

let c: Ctx;
beforeEach(async () => {
  c = await setup();
});

const bulk = (agent: Ctx['cmd'], entity: string, action: string, ids: number[], value?: unknown) => agent.post('/api/bulk', { entity, action, ids, ...(value !== undefined ? { value } : {}) });

describe('bulk actions', () => {
  it('changes many tasks in one go, and reports the ones a user may not change', async () => {
    const mine = [await newTask(c.s1, { title: 'א', ownerIds: [c.ids.s1] }), await newTask(c.s1, { title: 'ב', ownerIds: [c.ids.s1] })];
    const commanders = await newTask(c.cmd, { title: 'של המפקד', ownerIds: [c.ids.s1] });

    expect((await bulk(c.s1, 'tasks', 'priority', [...mine, commanders], 'high')).body).toEqual({
      done: 2,
      failed: [{ id: commanders, error: 'רק מי שיצר את המשימה או מפקד הקורס יכולים לערוך אותה' }],
    });
    expect((await bulk(c.s1, 'tasks', 'shift', mine, 2)).body.done).toBe(2);
    const moved = db().get<{ deadline: string }>('SELECT deadline FROM tasks WHERE id = ?', mine[0])!.deadline;
    expect(moved).toBe(at('2026-10-07'));
    // across the change of the clock (25.10): two days later is still 18:00, not 17:00
    const late = await newTask(c.s1, { title: 'ג', ownerIds: [c.ids.s1], deadline: at('2026-10-24') });
    expect((await bulk(c.s1, 'tasks', 'shift', [late], 2)).body.done).toBe(1);
    expect(db().get<{ deadline: string }>('SELECT deadline FROM tasks WHERE id = ?', late)!.deadline).toBe(at('2026-10-26'));

    // staff cannot delete a task the commander gave them; the others are deleted
    const del = (await bulk(c.s1, 'tasks', 'delete', [...mine, commanders])).body;
    expect(del.done).toBe(2);
    expect(del.failed).toEqual([{ id: commanders, error: 'לא ניתן למחוק משימה שהקצה מפקד הקורס' }]);
    expect(db().get<{ n: number }>('SELECT count(*) AS n FROM tasks')!.n).toBe(2);

    expect((await bulk(c.s1, 'tasks', 'complete', [commanders])).body.done).toBe(1);
    expect((await bulk(c.s1, 'tasks', 'nonsense', [commanders])).status).toBe(400);
  });

  it('moves cadets between teams; deleting and team changes beyond a user’s team are refused', async () => {
    const t1 = (await c.cmd.post('/api/teams', { name: 'אלון', commanderId: c.ids.s1 })).body[0].id;
    const t2 = (await c.cmd.post('/api/teams', { name: 'גיורא' })).body.find((t: { name: string }) => t.name === 'גיורא').id;
    await c.cmd.post('/api/cadets/import', { text: 'שם מלא\tצוות\nיהב גור אריה\tאלון\nעמית שמש\tאלון\nסתיו שגב\tגיורא' });
    const ids = (await c.cmd.get('/api/cadets')).body.map((x: { id: number }) => x.id);

    expect((await bulk(c.s2, 'cadets', 'delete', ids)).status).toBe(403);
    expect((await bulk(c.cmd, 'cadets', 'team', ids, t2)).body).toEqual({ done: 3, failed: [] });
    expect((await c.cmd.get('/api/teams')).body.map((t: { name: string; cadetCount: number }) => [t.name, t.cadetCount])).toEqual([
      ['אלון', 0],
      ['גיורא', 3],
    ]);
    expect((await bulk(c.cmd, 'cadets', 'status', ids.slice(0, 1), 'graduated')).body.done).toBe(1);
    expect((await bulk(c.cmd, 'cadets', 'delete', ids)).body.done).toBe(3);
    expect(t1).toBeGreaterThan(0);
  });

  it('marks notifications read, pauses recurring tasks, and keeps one active commander', async () => {
    await newTask(c.cmd, { title: 'משימה', ownerIds: [c.ids.s1] });
    const notes = (await c.s1.get('/api/notifications')).body.map((n: { id: number }) => n.id);
    expect(notes.length).toBeGreaterThan(0);
    // someone else's notification is not touched
    expect((await bulk(c.s2, 'notifications', 'read', notes)).body.done).toBe(notes.length);
    expect(db().get<{ n: number }>('SELECT count(*) AS n FROM notifications WHERE read_at IS NOT NULL')!.n).toBe(0);
    await bulk(c.s1, 'notifications', 'read', notes);
    expect(db().get<{ n: number }>('SELECT count(*) AS n FROM notifications WHERE user_id = ? AND read_at IS NULL', c.ids.s1)!.n).toBe(0);

    const rule = (await c.cmd.post('/api/recurring', { title: 'דוח בוקר', frequency: 'daily', time: '08:00', assignee: 'all' })).body[0].id;
    expect((await bulk(c.s1, 'recurring', 'active', [rule], false)).status).toBe(403);
    await bulk(c.cmd, 'recurring', 'active', [rule], false);
    expect((await c.cmd.get('/api/recurring')).body[0].active).toBe(false);

    const users = (await bulk(c.cmd, 'users', 'active', [c.ids.s2, c.ids.cmd], false)).body;
    expect(users.done).toBe(1);
    expect(users.failed[0]).toMatchObject({ id: c.ids.cmd });
  });
});
