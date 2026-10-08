// A task given to several people is one task to whoever gave it: changing its deadline (or its title,
// its week...) from one copy changes it for everyone - not only in the copy opened, while the list
// keeps showing another copy with the old date.

import { beforeEach, describe, expect, it } from 'vitest';
import type { Task } from '../../shared/types';
import { at, setup, type Ctx } from './helpers';

let c: Ctx;
beforeEach(async () => {
  c = await setup();
});

const copiesOf = async (ids: number[]) => ((await c.cmd.get('/api/tasks')).body as Task[]).filter((t) => ids.includes(t.id)).sort((a, b) => a.id - b.id);

describe('editing a task given to several people', () => {
  it('moves the deadline and renames every copy, but the one already done keeps its deadline', async () => {
    const ids = (await c.cmd.post('/api/tasks', { title: 'קריאת נוהל', assignMode: 'all', deadline: at('2026-10-05') })).body.ids as number[];
    expect(ids).toHaveLength(3);
    const done = (await copiesOf(ids)).find((t) => t.ownerId === c.ids.s2)!;
    expect((await c.s2.post(`/api/tasks/${done.id}/transition`, { action: 'complete' })).status).toBe(200);

    const r = await c.cmd.patch(`/api/tasks/${ids[0]}`, { deadline: at('2026-10-12'), title: 'קריאת נוהל מעודכן', allCopies: true });
    expect(r.status).toBe(200);
    expect(r.body.task.deadline).toBe(at('2026-10-12'));
    const after = await copiesOf(ids);
    expect(after.map((t) => t.title)).toEqual(['קריאת נוהל מעודכן', 'קריאת נוהל מעודכן', 'קריאת נוהל מעודכן']);
    for (const t of after) expect(t.deadline).toBe(t.id === done.id ? at('2026-10-05') : at('2026-10-12'));
    // each person keeps their own copy
    expect(new Set(after.map((t) => t.ownerId)).size).toBe(3);
    // each one whose deadline moved hears about it, once
    const heard = (await c.s1.get('/api/notifications')).body.filter((n: { type: string }) => n.type === 'deadline_changed');
    expect(heard).toHaveLength(1);
  });

  it('without allCopies changes the copy alone, and a person cannot reach the others through theirs', async () => {
    const ids = (await c.cmd.post('/api/tasks', { title: 'סיכום', assignMode: 'copies', ownerIds: [c.ids.s1, c.ids.s2], deadline: at('2026-10-05') })).body.ids as number[];
    await c.cmd.patch(`/api/tasks/${ids[0]}`, { deadline: at('2026-10-09') });
    expect((await copiesOf(ids)).map((t) => t.deadline)).toEqual([at('2026-10-09'), at('2026-10-05')]);
    // one of them, on their own copy: a deadline the commander set is not theirs to move, for anyone
    const own = (await copiesOf(ids)).find((t) => t.ownerId === c.ids.s1)!;
    expect((await c.s1.patch(`/api/tasks/${own.id}`, { deadline: at('2026-10-20'), allCopies: true })).status).toBe(403);
    expect((await copiesOf(ids)).map((t) => t.deadline)).toEqual([at('2026-10-09'), at('2026-10-05')]);
  });

  it('a task not given to several people is edited as before', async () => {
    const [id] = (await c.cmd.post('/api/tasks', { title: 'ציוד', ownerIds: [c.ids.s3], deadline: at('2026-10-05') })).body.ids as number[];
    const r = await c.cmd.patch(`/api/tasks/${id}`, { deadline: at('2026-10-07'), allCopies: true });
    expect(r.status).toBe(200);
    expect(r.body.task.deadline).toBe(at('2026-10-07'));
  });
});
