import { beforeEach, describe, expect, it } from 'vitest';
import { at, setup, type Ctx } from './helpers';

let c: Ctx;
beforeEach(async () => {
  c = await setup();
});

describe('a refused form', () => {
  it('says in Hebrew which field and what is wrong', async () => {
    const long = await c.cmd.post('/api/tasks', { title: 'א'.repeat(201), ownerIds: [c.ids.s1], deadline: at('2026-10-05') });
    expect(long.status).toBe(400);
    expect(long.body.error).toBe('הכותרת - אפשר עד 200 תווים');

    const desc = await c.cmd.post('/api/tasks', { title: 'x', description: 'ב'.repeat(5001), ownerIds: [c.ids.s1], deadline: at('2026-10-05') });
    expect(desc.body.error).toBe('התיאור - אפשר עד 5000 תווים');

    const team = await c.cmd.post('/api/teams', { name: 'ג'.repeat(61) });
    expect(team.body.error).toBe('השם - אפשר עד 60 תווים');
  });

  it('never shows English or a field key to the person', async () => {
    const cadet = (await c.cmd.post('/api/cadets', { firstName: 'דנה' })).body.cadet.id;
    const bad = [
      await c.cmd.post('/api/tasks', { title: 'x', ownerIds: [c.ids.s1], deadline: at('2026-10-05'), priority: 'urgent' }),
      await c.cmd.post(`/api/cadets/${cadet}/records`, { kind: 'note', body: 'x', score: 9 }),
      await c.cmd.post('/api/events', { date: '2026-10-05', startTime: '08:00', title: 'x', location: 'ד'.repeat(201) }),
      await c.cmd.post('/api/teams', {}),
    ];
    for (const r of bad) {
      expect(r.status).toBe(400);
      expect(r.body.error).not.toMatch(/[A-Za-z]/);
    }
  });
});

describe('searching', () => {
  it('finds a cadet by full name and a staff member however the quote mark was typed', async () => {
    await c.cmd.post('/api/cadets', { firstName: 'דנה', lastName: 'כהן' });
    expect((await c.cmd.get(`/api/cadets?q=${encodeURIComponent('דנה כהן')}`)).body).toHaveLength(1);
    const found = await c.cmd.get(`/api/search?q=${encodeURIComponent('מפק״צ 1')}`);
    expect(found.body.users.map((u: { displayName: string }) => u.displayName)).toContain('מפק"צ 1');
    await c.cmd.post('/api/tasks', { title: 'סגירת מטווח', ownerIds: [c.ids.s2], deadline: at('2026-10-05') });
    const tasks = await c.cmd.get(`/api/tasks?q=${encodeURIComponent('מפקצ 2 מטווח')}`);
    expect(tasks.body.map((t: { title: string }) => t.title)).toEqual(['סגירת מטווח']);
  });
});
