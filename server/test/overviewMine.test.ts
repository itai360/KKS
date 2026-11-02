import { beforeEach, describe, expect, it } from 'vitest';
import { at, newTask, setup, type Ctx } from './helpers';

let c: Ctx;
beforeEach(async () => {
  c = await setup();
});

describe('the overview', () => {
  it("is the whole course for the commander, one's own for the staff", async () => {
    await newTask(c.cmd, { title: 'של מפקצ 1', ownerIds: [c.ids.s1], deadline: at('2026-09-01') });
    await newTask(c.cmd, { title: 'של מפקצ 2', ownerIds: [c.ids.s2], deadline: at('2026-09-01') });
    const whole = (await c.cmd.get('/api/dashboard')).body;
    expect(whole.staff.length).toBeGreaterThan(1);
    const titles = (d: { attention: { title: string }[] }) => d.attention.map((a) => a.title);
    expect(titles(whole)).toEqual(expect.arrayContaining(['של מפקצ 1', 'של מפקצ 2']));
    const res = await c.s1.get('/api/dashboard');
    expect(res.status).toBe(200);
    expect(res.body.staff.map((s: { userId: number }) => s.userId)).toEqual([c.ids.s1]);
    expect(titles(res.body)).toContain('של מפקצ 1');
    expect(titles(res.body)).not.toContain('של מפקצ 2');
    expect(res.body.stats.overdue).toBe(1);
  });
});
