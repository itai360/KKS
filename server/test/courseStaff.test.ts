// The staff from cycle to cycle: in the next course (opened beside the current one) some do not go on and
// others take their place - with what was theirs there; the current course goes on as it is. Someone new to the
// staff of the next course signs in and works in it, out of the current one until it becomes the current course.

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { CourseStaffPerson, ParallelCourse, Task, User, Week } from '../../shared/types';
import { config } from '../src/core';
import { closeSlots } from '../src/parallel';
import { setSnapshotProvider } from '../src/snapshots';
import { at, login, newTask, setup, type Agent, type Ctx } from './helpers';

let c: Ctx;
beforeEach(async () => {
  config.dataDir = mkdtempSync(join(tmpdir(), 'kks-staff-'));
  setSnapshotProvider(null);
  closeSlots();
  c = await setup();
});
afterEach(() => {
  closeSlots();
  setSnapshotProvider(null);
});

const into = async (a: Agent, id: number | null) => expect((await a.post('/api/courses/switch', { id })).status).toBe(200);
const userIds = async (a: Agent) => ((await a.get('/api/users')).body as User[]).map((u) => u.id).sort();
const teams = async (a: Agent) => (await a.get('/api/teams')).body as { name: string; commanderId: number | null }[];
const weeks = async (a: Agent) => (await a.get('/api/weeks')).body as Week[];

/** the current course: a team, a week, a task and a recurring task of s1's; then the next course beside it */
async function twoCourses(): Promise<ParallelCourse> {
  await c.cmd.patch('/api/settings', { courseName: 'קורס בדיקה - מחזור 1', startDate: '2026-09-06', endDate: '2027-01-28' });
  expect((await c.cmd.post('/api/teams', { name: 'צוות א', commanderId: c.ids.s1 })).status).toBe(200);
  const w = (await c.cmd.post('/api/weeks', { name: 'שבוע שטח', startDate: '2026-09-27', endDate: '2026-10-01', leadId: c.ids.s1 })).body;
  await newTask(c.cmd, { title: 'הזמנת ציוד', ownerIds: [c.ids.s1], weekId: w.week?.id ?? w.id, deadline: at('2026-09-29', '12:00') });
  expect((await c.cmd.post('/api/recurring', { title: 'דוח בוקר', frequency: 'daily', time: '08:00', assignee: String(c.ids.s1) })).status).toBe(200);
  const r = await c.cmd.post('/api/courses/parallel', { name: 'קורס בדיקה - מחזור 2', startDate: '2027-03-07', endDate: '2027-07-29', take: ['weeks', 'teams', 'recurring'] });
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  return r.body as ParallelCourse;
}

const newcomer = { displayName: 'מפק"צ חדש', title: 'מפק"צ צוות א', username: 'new.staff', password: 'temp-pass-42', role: 'staff' };

describe('the staff of the next course', () => {
  it('who does not go on is out of the next course alone, and whoever takes their place gets what was theirs there', async () => {
    const course = await twoCourses();
    const base = `/api/courses/parallel/${course.id}/staff`;
    expect((await c.s2.get(base)).status).toBe(403);

    const staff = (await c.cmd.get(base)).body as CourseStaffPerson[];
    expect(staff.find((p) => p.id === c.ids.s1)).toMatchObject({ inCourse: true, teams: ['צוות א'], weeks: 1, recurring: 1, newcomer: false });

    // someone new: an account waiting for the next course
    const added = await c.cmd.post(`${base}/new`, newcomer);
    expect(added.status, JSON.stringify(added.body)).toBe(200);
    const n1: number = added.body.id;
    expect((added.body.staff as CourseStaffPerson[]).find((p) => p.id === n1)).toMatchObject({ inCourse: true, newcomer: true });

    // can't take oneself out; the one taking a place must be in the course
    expect((await c.cmd.post(base, { changes: [{ userId: c.ids.cmd, inCourse: false }] })).status).toBe(400);
    expect((await c.cmd.post(base, { changes: [{ userId: c.ids.s1, inCourse: false, replacedBy: c.ids.s2 }, { userId: c.ids.s2, inCourse: false }] })).status).toBe(400);

    const r = await c.cmd.post(base, { changes: [{ userId: c.ids.s1, inCourse: false, replacedBy: n1 }] });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.moved).toMatchObject({ teams: 1, weeks: 1, recurring: 1 });
    expect((r.body.staff as CourseStaffPerson[]).find((p) => p.id === c.ids.s1)).toMatchObject({ inCourse: false, replacedBy: n1 });

    // in the next course: the team and the week are the newcomer's; s1 is not among its people, and can't be given anything
    await into(c.cmd, course.id);
    expect((await teams(c.cmd)).map((t) => [t.name, t.commanderId])).toEqual([['צוות א', n1]]);
    const [week] = await weeks(c.cmd);
    expect(week.leadId).toBe(n1);
    expect(await userIds(c.cmd)).toEqual([c.ids.cmd, c.ids.s2, c.ids.s3, n1].sort());
    expect((await c.cmd.patch(`/api/weeks/${week.id}`, { leadId: c.ids.s1 })).status).toBe(400);

    // the current course goes on as it is: s1's team, s1's week; the newcomer is not among its people
    await into(c.cmd, null);
    expect((await teams(c.cmd)).map((t) => [t.name, t.commanderId])).toEqual([['צוות א', c.ids.s1]]);
    expect((await weeks(c.cmd))[0].leadId).toBe(c.ids.s1);
    expect(await userIds(c.cmd)).toEqual(Object.values(c.ids).sort());
    expect(((await c.cmd.get('/api/users?all=1')).body as User[]).find((u) => u.id === n1)).toMatchObject({ active: false, nextCourse: true });

    // s1 can't move into the next course; it is not offered
    expect((await c.s1.post('/api/courses/switch', { id: course.id })).status).toBe(403);
    expect((await c.s1.get('/api/auth/me')).body.parallel).toBeUndefined();

    // the newcomer signs in - and works in the next course, the current one not offered
    const n = await login(c.app, 'new.staff', 'temp-pass-42');
    const me = (await n.get('/api/auth/me')).body;
    expect(me.mustChangePassword).toBe(true);
    expect(me.parallel).toMatchObject({ slot: { id: course.id }, away: true });
    expect(me.settings.courseName).toBe('קורס בדיקה - מחזור 2');
    expect((await teams(n)).map((t) => t.commanderId)).toEqual([n1]);
    await into(n, null);
    expect((await n.get('/api/auth/me')).body.parallel.slot.id).toBe(course.id);
  });

  it('when the next course becomes the current one: those out of it leave, the newcomers are in', async () => {
    const course = await twoCourses();
    const base = `/api/courses/parallel/${course.id}/staff`;
    const n1: number = (await c.cmd.post(`${base}/new`, newcomer)).body.id;
    expect((await c.cmd.post(base, { changes: [{ userId: c.ids.s1, inCourse: false, replacedBy: n1 }, { userId: c.ids.s3, inCourse: false }] })).status).toBe(200);
    const r = await c.cmd.post(`/api/courses/parallel/${course.id}/promote`, { archiveName: 'מחזור 1' });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(await userIds(c.cmd)).toEqual([c.ids.cmd, c.ids.s2, n1].sort());
    expect((await teams(c.cmd)).map((t) => t.commanderId)).toEqual([n1]);
    // the accounts of those who left are closed
    expect((await c.s1.get('/api/auth/me')).status).toBe(401);
    expect((await c.s3.get('/api/auth/me')).status).toBe(401);
    expect((await c.s2.get('/api/auth/me')).status).toBe(200);
    const n = await login(c.app, 'new.staff', 'temp-pass-42');
    expect((await n.get('/api/auth/me')).body.parallel).toBeUndefined();
    expect(((await c.cmd.get('/api/courses/staff')).body as CourseStaffPerson[]).every((p) => p.inCourse)).toBe(true);
  });

  it('in the current course: whoever leaves it - the account closes, their open tasks move to whoever takes their place', async () => {
    await twoCourses();
    expect((await c.s1.get('/api/courses/staff')).status).toBe(403);
    const r = await c.cmd.post('/api/courses/staff', { changes: [{ userId: c.ids.s1, inCourse: false, replacedBy: c.ids.s2 }] });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.moved).toMatchObject({ teams: 1, weeks: 1, tasks: 1, recurring: 1 });
    expect((await c.s1.get('/api/auth/me')).status).toBe(401);
    const tasks = (await c.cmd.get('/api/tasks')).body as Task[];
    expect(tasks.find((t) => t.title === 'הזמנת ציוד')?.ownerId).toBe(c.ids.s2);
    expect(((await c.cmd.get('/api/courses/staff')).body as CourseStaffPerson[]).map((p) => p.id)).not.toContain(c.ids.s1);
    // someone new for the current course: in it at once
    const added = await c.cmd.post('/api/courses/staff/new', { ...newcomer, password: '', email: 'new.staff@example.com' });
    expect(added.status, JSON.stringify(added.body)).toBe(200);
    expect(await userIds(c.cmd)).toContain(added.body.id);
  });

  it('someone back in the next course is in it again; what moved stays with whoever took the place', async () => {
    const course = await twoCourses();
    const base = `/api/courses/parallel/${course.id}/staff`;
    expect((await c.cmd.post(base, { changes: [{ userId: c.ids.s1, inCourse: false, replacedBy: c.ids.s2 }] })).status).toBe(200);
    const back = await c.cmd.post(base, { changes: [{ userId: c.ids.s1, inCourse: true }] });
    expect(back.status).toBe(200);
    expect((back.body.staff as CourseStaffPerson[]).find((p) => p.id === c.ids.s1)).toMatchObject({ inCourse: true, replacedBy: null, teams: [] });
    await into(c.s1, course.id);
    expect((await teams(c.s1)).map((t) => t.commanderId)).toEqual([c.ids.s2]);
    await into(c.cmd, course.id);
    expect(await userIds(c.cmd)).toEqual(Object.values(c.ids).sort());
  });
});
