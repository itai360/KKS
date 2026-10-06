// The weekly debrief as a task: each week's lead gets it on the week's Tuesday from 08:00, due the
// next Tuesday at 12:00; it closes itself when the week's debrief is summed up, and moves to a new lead.

import { beforeEach, describe, expect, it } from 'vitest';
import { clock } from '../src/core';
import { runAutomation } from '../src/automation';
import { openingDay } from '../src/weeklyDebriefTask';
import { at, notificationsOf, setup, type Ctx } from './helpers';

let c: Ctx;
let week = 0;

beforeEach(async () => {
  c = await setup();
  week = (await c.cmd.post('/api/weeks', { name: 'שבוע הגנה', startDate: '2026-10-04', endDate: '2026-10-10', leadId: c.ids.s1, goals: 'הגנת מרחב' })).body.id;
});

const run = (date: string, time: string) => {
  clock.set(new Date(at(date, time)));
  return runAutomation();
};
const debriefTasks = async (agent = c.cmd) =>
  ((await agent.get('/api/tasks')).body as { id: number; title: string; ownerId: number; deadline: string; weekId: number; status: string }[]).filter((t) => t.title.startsWith('תחקיר שבועי'));

describe('the weekly debrief task', () => {
  it('opens for the week’s lead on its Tuesday from 08:00, due the next Tuesday at 12:00 - once', async () => {
    run('2026-10-05', '10:00');
    run('2026-10-06', '07:30');
    expect(await debriefTasks()).toHaveLength(0);
    expect(run('2026-10-06', '08:05').debriefTasks).toBe(1);
    const [t] = await debriefTasks();
    expect(t).toMatchObject({ title: 'תחקיר שבועי - שבוע הגנה', ownerId: c.ids.s1, weekId: week, deadline: at('2026-10-13', '12:00') });
    // the lead hears of it
    expect(notificationsOf(c.ids.s1).some((n) => n.link === `/tasks/${t.id}` || n.title.includes('תחקיר שבועי'))).toBe(true);
    run('2026-10-07', '09:00');
    expect(await debriefTasks()).toHaveLength(1);
    // deleted, it is not opened again
    await c.cmd.del(`/api/tasks/${t.id}`);
    run('2026-10-08', '09:00');
    expect(await debriefTasks()).toHaveLength(0);
  });

  it('its page leads to the debrief; summing the debrief up closes it', async () => {
    run('2026-10-06', '09:00');
    const [t] = await debriefTasks();
    expect((await c.s1.get(`/api/tasks/${t.id}`)).body.weeklyDebrief).toEqual({ weekId: week, weekName: 'שבוע הגנה', debriefId: null });
    clock.set(new Date(at('2026-10-11', '10:00')));
    const id = (await c.s1.post('/api/debriefs', { kind: 'weekly', weekId: week, title: 'תחקיר שבועי - הגנה', occurredOn: '2026-10-11' })).body.debrief.id;
    expect((await c.s1.get(`/api/tasks/${t.id}`)).body.weeklyDebrief.debriefId).toBe(id);
    await c.s1.patch(`/api/debriefs/${id}`, { answers: { goals: [{ goal: 'הגנת מרחב', status: 'done', note: '' }], rating: 4 } });
    const lesson = (await c.s1.post(`/api/debriefs/${id}/items`, { kind: 'lesson', horizon: 'next', body: 'להקדים את תרגיל ההגנה' })).body.items[0].id;
    expect(lesson).toBeTruthy();
    expect((await c.s1.patch(`/api/debriefs/${id}`, { status: 'final' })).status).toBe(200);
    expect((await c.s1.get(`/api/tasks/${t.id}`)).body.task.status).toBe('done');
  });

  it('a new lead takes it; a week without a lead gets it once one is set, until the day it would be due', async () => {
    run('2026-10-06', '09:00');
    const [t] = await debriefTasks();
    await c.cmd.patch(`/api/weeks/${week}`, { leadId: c.ids.s2 });
    expect((await c.cmd.get(`/api/tasks/${t.id}`)).body.task.ownerId).toBe(c.ids.s2);

    const later = (await c.cmd.post('/api/weeks', { name: 'שבוע ניווט', startDate: '2026-10-11', endDate: '2026-10-17' })).body.id;
    run('2026-10-13', '09:00');
    expect((await debriefTasks()).filter((x) => x.weekId === later)).toHaveLength(0);
    await c.cmd.patch(`/api/weeks/${later}`, { leadId: c.ids.s3 });
    run('2026-10-15', '09:00');
    expect((await debriefTasks()).find((x) => x.weekId === later)).toMatchObject({ ownerId: c.ids.s3, deadline: at('2026-10-20', '12:00') });

    // a week whose lead came only on the day it would be due: too late to open
    const late = (await c.cmd.post('/api/weeks', { name: 'שבוע סיכום', startDate: '2026-10-18', endDate: '2026-10-24' })).body.id;
    clock.set(new Date(at('2026-10-27', '09:00')));
    await c.cmd.patch(`/api/weeks/${late}`, { leadId: c.ids.s1 });
    run('2026-10-27', '09:00');
    expect((await debriefTasks()).filter((x) => x.weekId === late)).toHaveLength(0);
  });

  it('a week already debriefed gets none; the Tuesday of a week that has none is its first day', async () => {
    clock.set(new Date(at('2026-10-05', '20:00')));
    const id = (await c.s1.post('/api/debriefs', { kind: 'weekly', weekId: week, title: 'תחקיר מוקדם', occurredOn: '2026-10-05' })).body.debrief.id;
    await c.s1.patch(`/api/debriefs/${id}`, { answers: { goals: [{ goal: 'הגנת מרחב', status: 'done', note: '' }], rating: 4 } });
    await c.s1.post(`/api/debriefs/${id}/items`, { kind: 'lesson', horizon: 'next', body: 'לקח' });
    expect((await c.s1.patch(`/api/debriefs/${id}`, { status: 'final' })).status).toBe(200);
    run('2026-10-06', '09:00');
    expect(await debriefTasks()).toHaveLength(0);
    expect(openingDay('2026-10-04', '2026-10-10')).toBe('2026-10-06');
    expect(openingDay('2026-10-07', '2026-10-13')).toBe('2026-10-13');
    expect(openingDay('2026-10-07', '2026-10-10')).toBe('2026-10-07');
  });
});
