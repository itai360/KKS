import { beforeEach, describe, expect, it } from 'vitest';
import { clock } from '../src/core';
import { morningBrief, resetMorningBrief } from '../src/digest';
import { at, notificationsOf, setup, type Ctx } from './helpers';

let c: Ctx;
beforeEach(async () => {
  c = await setup();
  resetMorningBrief();
});

const briefs = (uid: number) => notificationsOf(uid).filter((n) => n.type === 'brief');

describe('morning brief', () => {
  it('once a day from seven: what is due today, what is late, the activities one runs - and only when there is something', async () => {
    await c.cmd.post('/api/tasks', { title: 'סגירת לו"ז', ownerIds: [c.ids.s1], deadline: at('2026-10-02', '16:00') });
    await c.cmd.post('/api/tasks', { title: 'דוח ציוד', ownerIds: [c.ids.s1], deadline: at('2026-10-01', '18:00') });
    await c.cmd.post('/api/events', { date: '2026-10-02', startTime: '08:00', title: 'מטווח', ownerId: c.ids.s1 });
    // a leave that day: no brief
    await c.s3.post('/api/absences', { startDate: '2026-10-02', endDate: '2026-10-02' });
    await c.cmd.post('/api/tasks', { title: 'משהו', ownerIds: [c.ids.s3], deadline: at('2026-10-02', '12:00') });

    clock.set(new Date(at('2026-10-02', '06:30')));
    expect(morningBrief(clock.now())).toBe(0);
    clock.set(new Date(at('2026-10-02', '07:01')));
    morningBrief(clock.now());
    expect(briefs(c.ids.s1)).toEqual([expect.objectContaining({ title: 'בוקר טוב - היום: משימה אחת, 1 באיחור, פעילות אחת באחריותך', category: 'action', link: '/my' })]);
    expect(briefs(c.ids.s2)).toHaveLength(0); // nothing today
    expect(briefs(c.ids.s3)).toHaveLength(0); // away
    // again that day (another instance, or a restart): still one
    resetMorningBrief();
    morningBrief(new Date(at('2026-10-02', '08:00')));
    expect(briefs(c.ids.s1)).toHaveLength(1);
    // a server first woken in the afternoon sends no morning brief
    resetMorningBrief();
    expect(morningBrief(new Date(at('2026-10-04', '15:00')))).toBe(0);
  });
});
