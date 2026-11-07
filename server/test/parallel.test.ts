// A course opened beside the current one: the next cycle, prepared while this one still runs - its own tasks,
// weeks and settings, apart from the current course's; the people and their notifications are one. It takes
// what was chosen from the current course when it opens, and more later; in the end it becomes the current course.

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { CopySource, Notification, ParallelCourse, PreviousCycleWeek, Task, Week } from '../../shared/types';
import { runAutomation } from '../src/automation';
import { clock, config } from '../src/core';
import { db } from '../src/db';
import { closeSlots, withSlotDb } from '../src/parallel';
import { setSnapshotProvider } from '../src/snapshots';
import { at, newTask, NOW, setup, type Agent, type Ctx } from './helpers';

let c: Ctx;
beforeEach(async () => {
  config.dataDir = mkdtempSync(join(tmpdir(), 'kks-parallel-'));
  setSnapshotProvider(null);
  closeSlots();
  c = await setup();
});
afterEach(() => {
  closeSlots();
  setSnapshotProvider(null);
});

const titles = async (a: Agent) => ((await a.get('/api/tasks')).body as Task[]).map((t) => t.title).sort();
const weeks = async (a: Agent) => (await a.get('/api/weeks')).body as Week[];
const into = async (a: Agent, id: number | null) => expect((await a.post('/api/courses/switch', { id })).status).toBe(200);

/** the current course: a week with a task, a template, a recurring task, a team with a cadet */
async function fillCourse() {
  await c.cmd.patch('/api/settings', { courseName: 'קורס בדיקה - מחזור 1', startDate: '2026-09-06', endDate: '2027-01-28' });
  const team = (await c.cmd.post('/api/teams', { name: 'צוות א', commanderId: c.ids.s1 })).body[0].id;
  await c.cmd.post('/api/cadets', { firstName: 'פלוני', lastName: 'אלמוני', teamId: team });
  const w = (await c.cmd.post('/api/weeks', { name: 'שבוע שטח', startDate: '2026-09-27', endDate: '2026-10-01', leadId: c.ids.s1 })).body;
  const weekId: number = w.week?.id ?? w.id;
  await newTask(c.cmd, { title: 'הזמנת ציוד', ownerIds: [c.ids.s1], weekId, deadline: at('2026-09-29', '12:00') });
  await c.cmd.post('/api/templates', { name: 'תבנית שבוע שטח' });
  await c.cmd.post('/api/recurring', { title: 'דוח בוקר', frequency: 'daily', time: '08:00', assignee: 'all' });
  return { weekId };
}

async function openBeside(body: object = {}): Promise<ParallelCourse> {
  const r = await c.cmd.post('/api/courses/parallel', { name: 'קורס בדיקה - מחזור 2', startDate: '2027-03-07', endDate: '2027-07-29', ...body });
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  return r.body as ParallelCourse;
}

describe('a course beside the current one', () => {
  it('only the commander opens one; it starts with what was chosen, its weeks at the same point of it', async () => {
    await fillCourse();
    expect((await c.s1.post('/api/courses/parallel', { name: 'מחזור 2' })).status).toBe(403);
    const course = await openBeside({ take: ['weeks', 'templates', 'recurring', 'teams'] });
    expect(course).toMatchObject({ name: 'קורס בדיקה - מחזור 2', startDate: '2027-03-07', stats: { tasks: 0, weeks: 1 } });
    expect((await c.cmd.get('/api/courses/parallel')).body).toMatchObject({ courses: [{ id: course.id }], in: null });

    // in it: its own settings, the week moved to its dates (26 weeks on), none of the current course's tasks or cadets
    await into(c.cmd, course.id);
    const me = (await c.cmd.get('/api/auth/me')).body;
    expect(me.settings.courseName).toBe('קורס בדיקה - מחזור 2');
    expect(me.parallel).toMatchObject({ slot: { id: course.id, name: 'קורס בדיקה - מחזור 2' } });
    expect((await weeks(c.cmd)).map((w) => [w.name, w.startDate, w.endDate, w.status])).toEqual([['שבוע שטח', '2027-03-28', '2027-04-01', 'planning']]);
    expect(await titles(c.cmd)).toEqual([]);
    expect((await c.cmd.get('/api/cadets')).body).toEqual([]);
    expect(((await c.cmd.get('/api/templates')).body as { name: string }[]).map((t) => t.name)).toEqual(['תבנית שבוע שטח']);
    expect(((await c.cmd.get('/api/teams')).body as { name: string }[]).map((t) => t.name)).toEqual(['צוות א']);
    // the people are the same people
    expect(((await c.cmd.get('/api/users')).body as { id: number }[]).map((u) => u.id).sort()).toEqual(Object.values(c.ids).sort());
  });

  it('what is done in it stays in it - and its notifications reach the person, marked with their course', async () => {
    await fillCourse();
    const course = await openBeside({ take: ['weeks'] });
    await into(c.cmd, course.id);
    const id = await newTask(c.cmd, { title: 'הכנת מחזור 2', ownerIds: [c.ids.s1], deadline: at('2027-03-10', '12:00') });
    expect(await titles(c.cmd)).toEqual(['הכנת מחזור 2']);
    // in the current course: not there
    expect(await titles(c.s1)).toEqual(['הזמנת ציוד']);
    await into(c.cmd, null);
    expect(await titles(c.cmd)).toEqual(['הזמנת ציוד']);
    expect((await c.cmd.get('/api/settings')).body.courseName).toBe('קורס בדיקה - מחזור 1');

    // the person hears of it wherever they are - a tap takes them into its course
    const mine = ((await c.s1.get('/api/notifications')).body as { items?: Notification[] } | Notification[]) as unknown;
    const list = (Array.isArray(mine) ? mine : (mine as { items: Notification[] }).items) as Notification[];
    const n = list.find((x) => x.title.includes('הכנת מחזור 2'))!;
    expect(n).toMatchObject({ courseSlot: course.id, taskId: id, link: `/tasks/${id}` });
    expect(db().get('SELECT course_slot, task_id, slot_task_id FROM notifications WHERE id = ?', n.id)).toEqual({ course_slot: course.id, task_id: null, slot_task_id: id });

    // and staff move into it themselves
    await into(c.s1, course.id);
    expect(await titles(c.s1)).toEqual(['הכנת מחזור 2']);
  });

  it('its reminders run in it too', async () => {
    const course = await openBeside();
    await into(c.cmd, course.id);
    await newTask(c.cmd, { title: 'משימה של מחזור 2', ownerIds: [c.ids.s1], deadline: at('2026-10-01', '12:00') });
    clock.set(new Date(NOW.getTime() + 3 * 3_600_000));
    runAutomation();
    expect(db().all("SELECT title, course_slot FROM notifications WHERE user_id = ? AND type = 'overdue'", c.ids.s1)).toEqual([
      { title: 'המשימה "משימה של מחזור 2" עברה את הדד-ליין', course_slot: course.id },
    ]);
    // once
    runAutomation();
    expect(db().get<{ n: number }>("SELECT count(*) AS n FROM notifications WHERE type = 'overdue'")!.n).toBe(1);
  });

  it('takes more from the current course later - what it has already stays as it is', async () => {
    await fillCourse();
    const course = await openBeside({ take: ['templates'] });
    await c.cmd.post('/api/templates', { name: 'תבנית מטווח' });
    const src = (await c.cmd.get(`/api/courses/parallel/${course.id}/copy/templates`)).body as CopySource;
    expect(src.from).toBe('קורס בדיקה - מחזור 1');
    expect(src.items.map((i) => [i.name, i.exists])).toEqual([
      ['תבנית מטווח', false],
      ['תבנית שבוע שטח', true],
    ]);
    const r = await c.cmd.post(`/api/courses/parallel/${course.id}/copy`, { area: 'templates', ids: src.items.map((i) => i.id) });
    expect(r.body).toEqual({ copied: 1, skipped: 1 });
    await into(c.cmd, course.id);
    expect(((await c.cmd.get('/api/templates')).body as { name: string }[]).map((t) => t.name).sort()).toEqual(['תבנית מטווח', 'תבנית שבוע שטח']);
    expect((await c.s1.get(`/api/courses/parallel/${course.id}/copy/templates`)).status).toBe(403);
  });

  it("a week's tasks in it repeat what the current course did that week", async () => {
    await fillCourse();
    const course = await openBeside({ take: ['weeks'] });
    await into(c.cmd, course.id);
    const w = (await weeks(c.cmd))[0];
    const prev = (await c.cmd.get(`/api/weeks/${w.id}/previous-cycle`)).body as PreviousCycleWeek;
    expect(prev).toMatchObject({ archiveId: 0, archiveName: 'קורס בדיקה - מחזור 1', week: { name: 'שבוע שטח' } });
    expect(prev.tasks.map((t) => t.title)).toEqual(['הזמנת ציוד']);
    const r = await c.cmd.post(`/api/weeks/${w.id}/previous-cycle/copy`, { archiveId: 0, taskIds: prev.tasks.map((t) => t.id) });
    expect(r.body).toEqual({ created: 1, skipped: 0 });
    const t = ((await c.cmd.get('/api/tasks')).body as Task[])[0];
    expect([t.title, t.deadline.slice(0, 10), t.weekId]).toEqual(['הזמנת ציוד', '2027-03-30', w.id]);
  });

  it('becomes the current course when this one ends - which is kept whole', async () => {
    await fillCourse();
    const course = await openBeside({ take: ['weeks'] });
    await into(c.cmd, course.id);
    const id = await newTask(c.cmd, { title: 'הכנת מחזור 2', ownerIds: [c.ids.s1], deadline: at('2027-03-10', '12:00') });
    await into(c.cmd, null);
    expect((await c.s1.post(`/api/courses/parallel/${course.id}/promote`, { archiveName: 'מחזור 1' })).status).toBe(403);
    const r = await c.cmd.post(`/api/courses/parallel/${course.id}/promote`, { archiveName: 'מחזור 1' });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body).toMatchObject({ name: 'מחזור 1', stats: { tasks: 1 } });

    expect((await c.cmd.get('/api/settings')).body.courseName).toBe('קורס בדיקה - מחזור 2');
    expect(await titles(c.s1)).toEqual(['הכנת מחזור 2']);
    expect((await weeks(c.cmd)).map((w) => w.startDate)).toEqual(['2027-03-28']);
    expect((await c.cmd.get('/api/courses/parallel')).body.courses).toEqual([]);
    expect(((await c.cmd.get('/api/courses')).body as { archives: { name: string }[] }).archives.map((a) => a.name)).toEqual(['מחזור 1']);
    // its notifications are the current course's now, about its task
    expect(db().get("SELECT task_id, course_slot FROM notifications WHERE title LIKE '%הכנת מחזור 2%' AND user_id = ?", c.ids.s1)).toEqual({ task_id: id, course_slot: null });
    // the people are as they were: everyone still signs in
    expect((await c.s2.get('/api/auth/me')).status).toBe(200);
  });

  it('is deleted with its notifications; whoever was in it is back in the current course', async () => {
    await fillCourse();
    const course = await openBeside();
    await into(c.s1, course.id);
    await into(c.cmd, course.id);
    await newTask(c.cmd, { title: 'טיוטה', ownerIds: [c.ids.s1] });
    await into(c.cmd, null);
    expect((await c.cmd.del(`/api/courses/parallel/${course.id}`)).status).toBe(200);
    expect(db().get<{ n: number }>('SELECT count(*) AS n FROM notifications WHERE course_slot IS NOT NULL')!.n).toBe(0);
    expect(await titles(c.s1)).toEqual(['הזמנת ציוד']);
    expect((await c.s1.get('/api/auth/me')).body.parallel).toBeUndefined();
  });

  it('a link from a notification goes into its course, and only to a screen of the app', async () => {
    const course = await openBeside();
    const r = await c.s1.get(`/api/courses/open?c=s${course.id}&to=${encodeURIComponent('/tasks/3')}`);
    expect([r.status, r.headers.location]).toEqual([302, '/tasks/3']);
    expect((await c.s1.get('/api/auth/me')).body.parallel.slot).toMatchObject({ id: course.id });
    for (const to of ['//evil.example', 'https://evil.example', '/\\evil.example', '/api/auth/logout']) {
      expect((await c.s1.get(`/api/courses/open?c=main&to=${encodeURIComponent(to)}`)).headers.location).toBe('/');
    }
    expect((await c.s1.get('/api/auth/me')).body.parallel.slot).toBeNull();
  });

  it('makes no tasks by itself before it starts - the current course goes on making them once', async () => {
    await fillCourse();
    // no weeks without a date to move them to
    expect((await c.cmd.post('/api/courses/parallel', { name: 'מחזור 2', take: ['weeks'] })).status).toBe(400);
    const course = await openBeside({ take: ['recurring'], startDate: '2026-10-02' });
    runAutomation();
    await into(c.cmd, course.id);
    expect(await titles(c.cmd)).toEqual([]);
    // from the day it starts - a recurring task from the same point of it as here (it began 2.10 here: 26 days on, 28.10)
    const made = () => withSlotDb(course.id, () => db().all<{ title: string }>('SELECT DISTINCT title FROM tasks').map((t) => t.title));
    clock.set(new Date(at('2026-10-02', '09:00')));
    runAutomation();
    expect(made()).toEqual([]);
    clock.set(new Date(at('2026-10-28', '09:00')));
    runAutomation();
    expect(made()).toEqual(['דוח בוקר']);
  });

  it('at most three beside the current one', async () => {
    for (let i = 0; i < 3; i++) await openBeside({ name: `מחזור ${i + 2}` });
    expect((await c.cmd.post('/api/courses/parallel', { name: 'עוד אחד' })).status).toBe(400);
  });
});
