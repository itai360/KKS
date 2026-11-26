import { describe, expect, it } from 'vitest';
import type { PlanDocument, PlansOverview, ThreeWeekPlan, Week } from '../../shared/types';
import { clock } from '../src/core';
import { setup, type Ctx } from './helpers';

async function fixture(c: Ctx) {
  const ids = new Map<number, number>();
  // Deliberately create them out of order: neither IDs, numbers nor names define the timeline.
  for (const [number, name, startDate, endDate] of [
    [1, 'שבוע פרט', '2027-01-03', '2027-01-09'],
    [44, 'שבוע הקורס', '2026-10-25', '2026-10-31'],
    [53, 'שבוע שטח', '2026-12-27', '2027-01-02'],
    [52, 'שם חופשי לשבוע הראשון', '2026-12-20', '2026-12-26'],
    [2, 'שבוע אחרון מחוץ לתאריכים', '2027-01-10', '2027-01-16'],
  ] as const) {
    const r = await c.cmd.post('/api/weeks', { number, name, startDate, endDate });
    expect(r.status).toBe(200);
    ids.set(number, r.body.id);
  }
  return ids;
}

const weeks = async (c: Ctx, course = false): Promise<Week[]> => {
  const r = await c.cmd.get(`/api/weeks${course ? '?course=1' : ''}`);
  expect(r.status).toBe(200);
  return r.body;
};

async function dates(c: Ctx, startDate: string | null, endDate: string | null) {
  expect((await c.cmd.patch('/api/settings', { startDate, endDate })).status).toBe(200);
}

describe('course planning uses the course dates', () => {
  it('shows only overlapping course weeks in chronological order in plans, their horizon and the weekly target', async () => {
    const c = await setup();
    const ids = await fixture(c);
    // Both boundary weeks overlap only partly; they still belong to the course.
    await dates(c, '2026-12-22', '2027-01-05');
    const expected = [ids.get(52), ids.get(53), ids.get(1)];
    expect((await weeks(c, true)).map(w => w.id)).toEqual(expected);
    expect((await weeks(c)).map(w => w.number)).toEqual([44, 52, 53, 1, 2]);

    const overview = await c.cmd.get('/api/plans');
    expect(overview.status).toBe(200);
    expect((overview.body as PlansOverview).weeks.map(p => p.week.id)).toEqual(expected);
    expect((await c.cmd.get('/api/activity-files')).body.map((w: { id: number }) => w.id)).toEqual(expected);
    expect((await c.cmd.get(`/api/activity-files?week=${ids.get(44)}`)).body[0].id).toBe(ids.get(44));
    const plan = await c.cmd.get(`/api/plans/${ids.get(52)}`);
    expect(plan.status).toBe(200);
    expect((plan.body as PlanDocument).horizon.map(w => w.weekId)).toEqual(expected);
    expect((plan.body as PlanDocument).position.total).toBe(3);
    const span = await c.cmd.get(`/api/three-week/${ids.get(52)}`);
    expect(span.status).toBe(200);
    expect((span.body as ThreeWeekPlan).weeks.map(p => p.week.id)).toEqual(expected);

    clock.set(new Date('2026-10-27T10:00:00Z'));
    const target = await c.cmd.get('/api/weekly/target');
    expect(target.status).toBe(200);
    expect(target.body.weekId).toBe(ids.get(52));
    expect(target.body.weeks.map((w: { id: number }) => w.id)).toEqual(expected);
    for (const number of [44, 2]) {
      expect((await c.cmd.get(`/api/plans/${ids.get(number)}`)).status).toBe(404);
      expect((await c.cmd.get(`/api/three-week/${ids.get(number)}`)).status).toBe(404);
      // History is retained, including a direct view of the old week.
      expect((await c.cmd.get(`/api/weeks/${ids.get(number)}`)).status).toBe(200);
    }
  });

  it('falls back to all existing weeks when no course dates are configured', async () => {
    const c = await setup();
    await fixture(c);
    await dates(c, null, null);
    expect((await weeks(c, true)).map(w => w.number)).toEqual([44, 52, 53, 1, 2]);
    const overview = (await c.cmd.get('/api/plans')).body as PlansOverview;
    expect(overview.weeks.map(p => p.week.number)).toEqual([44, 52, 53, 1, 2]);
  });

  it('respects either bound on its own, including a week touching the boundary day', async () => {
    const c = await setup();
    await fixture(c);
    await dates(c, '2026-12-26', null);
    expect((await weeks(c, true)).map(w => w.number)).toEqual([52, 53, 1, 2]);
    await dates(c, null, '2026-12-27');
    expect((await weeks(c, true)).map(w => w.number)).toEqual([44, 52, 53]);
  });

  it('changing course dates updates planning immediately without deleting or renumbering historical weeks', async () => {
    const c = await setup();
    const ids = await fixture(c);
    const all = (await weeks(c)).map(w => ({ id: w.id, number: w.number, name: w.name }));
    await dates(c, '2026-12-20', '2027-01-09');
    expect((await weeks(c, true)).map(w => w.number)).toEqual([52, 53, 1]);
    await dates(c, '2026-10-25', '2026-10-31');
    expect((await weeks(c, true)).map(w => w.id)).toEqual([ids.get(44)]);
    const overview = (await c.cmd.get('/api/plans')).body as PlansOverview;
    expect(overview.weeks.map(p => p.week.id)).toEqual([ids.get(44)]);
    expect((await weeks(c)).map(w => ({ id: w.id, number: w.number, name: w.name }))).toEqual(all);
  });
});


it('uses the same course weeks for dashboard, staff responsibilities and next-week handoff', async () => {
  const c = await setup();
  const ids = await fixture(c);
  await dates(c, '2026-12-20', '2027-01-09');
  for (const id of ids.values()) expect((await c.cmd.patch(`/api/weeks/${id}`, { leadId: c.ids.s1 })).status).toBe(200);
  clock.set(new Date('2026-10-27T10:00:00Z'));
  const dashboard = (await c.cmd.get('/api/dashboard')).body;
  expect(dashboard.currentWeek).toBeNull();
  expect(dashboard.nextWeek.id).toBe(ids.get(52));
  expect((await c.s1.get('/api/my')).body.myWeeks.map((w: Week) => w.id)).toEqual([ids.get(52), ids.get(53), ids.get(1)]);
  expect((await c.cmd.get(`/api/team/${c.ids.s1}`)).body.weeks.map((w: Week) => w.id)).toEqual([ids.get(52), ids.get(53), ids.get(1)]);
  expect((await c.cmd.get(`/api/weeks/${ids.get(1)}`)).body.nextWeek).toBeNull();
  expect((await c.cmd.get(`/api/weeks/${ids.get(1)}/close-check`)).body.nextWeek).toBeNull();
});
