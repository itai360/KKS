// Previous courses: ending a course keeps it whole, the next one starts clean with what carries
// over, and the commander reads an earlier course on every screen - read only.

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { CourseArchive, CoursesOverview, SnapshotInfo } from '../../shared/types';
import { config } from '../src/core';
import { db } from '../src/db';
import { setSnapshotProvider, toPrune } from '../src/snapshots';
import { newTask, setup, type Ctx } from './helpers';

let c: Ctx;
beforeEach(async () => {
  config.dataDir = mkdtempSync(join(tmpdir(), 'kks-courses-'));
  setSnapshotProvider(null);
  c = await setup();
});
afterEach(() => setSnapshotProvider(null));

const count = (table: string) => db().get<{ n: number }>(`SELECT count(*) AS n FROM ${table}`)!.n;

/** a course with a bit of everything */
async function fillCourse() {
  await c.cmd.patch('/api/settings', { courseName: 'קורס קק"ס - מחזור 52' });
  const team = (await c.cmd.post('/api/teams', { name: 'צוות אלון', commanderId: c.ids.s1 })).body[0].id;
  await c.cmd.post('/api/cadets', { firstName: 'נועה', lastName: 'כהן', teamId: team });
  const week = (await c.cmd.post('/api/weeks', { name: 'שבוע שטח', startDate: '2026-09-27', endDate: '2026-10-01', leadId: c.ids.s1 })).body;
  const weekId = week.week?.id ?? week.id;
  await c.cmd.post('/api/events', { date: '2026-10-01', startTime: '08:00', title: 'מסדר בוקר' });
  await newTask(c.cmd, { title: 'הזמנת תחמושת', ownerIds: [c.ids.s1], weekId });
  await c.cmd.post('/api/recurring', { title: 'דוח בוקר', frequency: 'daily', time: '08:00', assignee: 'all' });
  // a debrief with a lesson for the next cycle, and one without
  const kept = (await c.s1.post('/api/debriefs', { kind: 'weekly', weekId, title: 'תחקיר שבועי - שבוע שטח', occurredOn: '2026-10-01' })).body.debrief.id;
  await c.s1.post(`/api/debriefs/${kept}/items`, { kind: 'lesson', horizon: 'next', body: 'להקדים את תרגיל ההגנה ליום שני' });
  await c.s1.post(`/api/debriefs/${kept}/items`, { kind: 'lesson', horizon: 'now', body: 'תדריך בטיחות יום לפני' });
  await c.s2.post('/api/debriefs', { title: 'תחקיר מטווח', occurredOn: '2026-09-30' });
  // the staff's absences: one over, one ahead
  await c.s2.post('/api/absences', { startDate: '2026-10-05', endDate: '2026-10-07' });
  db().run("INSERT INTO absences(user_id, start_date, end_date, created_at) VALUES (?, '2026-09-01', '2026-09-03', '2026-08-30T10:00:00Z')", c.ids.s3);
  return { weekId, team };
}

const startNew = (body: object = {}) => c.cmd.post('/api/courses/new', { archiveName: 'מחזור 52', name: 'קורס קק"ס - מחזור 53', startDate: '2027-03-07', endDate: '2027-08-26', ...body });

describe('previous courses', () => {
  it('only the commander sees them, ends a course or opens one', async () => {
    expect((await c.s1.get('/api/courses')).status).toBe(403);
    expect((await c.s1.post('/api/courses/new', { archiveName: 'א', name: 'ב' })).status).toBe(403);
    expect((await c.s1.post('/api/courses/view', { id: 1 })).status).toBe(403);
    const o = (await c.cmd.get('/api/courses')).body as CoursesOverview;
    expect(o.archives).toEqual([]);
    expect(o.viewing).toBeNull();
  });

  it('ending a course keeps it whole and starts the next one with what carries over', async () => {
    await fillCourse();
    const before = (await c.cmd.get('/api/courses')).body as CoursesOverview;
    expect(before.current).toMatchObject({ name: 'קורס קק"ס - מחזור 52', startDate: '2026-09-27', endDate: '2026-10-01' });
    expect(before.current.stats).toMatchObject({ tasks: 1, weeks: 1, events: 1, cadets: 1, debriefs: 2, lessons: 1 });

    const res = await startNew();
    expect(res.status).toBe(200);
    const archive = res.body as CourseArchive;
    expect(archive).toMatchObject({ name: 'מחזור 52', startDate: '2026-09-27', endDate: '2026-10-01', archivedByName: 'מפקד הקורס' });
    expect(archive.stats).toMatchObject({ tasks: 1, cadets: 1 });

    // the new course: clean
    for (const t of ['tasks', 'weeks', 'events', 'cadets', 'notifications', 'activity']) expect(count(t), t).toBe(0);
    const settings = (await c.cmd.get('/api/settings')).body;
    expect(settings).toMatchObject({ courseName: 'קורס קק"ס - מחזור 53', startDate: '2027-03-07', endDate: '2027-08-26' });
    // ...with the people, the teams, the recurring tasks - and everyone still signed in
    expect(count('users')).toBe(4);
    expect(count('teams')).toBe(1);
    expect(count('recurring_rules')).toBe(1);
    expect((await c.s1.get('/api/my')).status).toBe(200);
    // the lessons bank carries over, not tied to a week of the course that ended; the other debrief stays behind
    const bank = (await c.cmd.get('/api/lessons')).body as { body: string }[];
    expect(bank.map((l) => l.body)).toEqual(['להקדים את תרגיל ההגנה ליום שני']);
    expect(db().all('SELECT week_id, event_id FROM debriefs')).toEqual([{ week_id: null, event_id: null }]);
    expect(count('debrief_items')).toBe(1);
    // the absence still ahead stays
    expect(db().all<{ start_date: string }>('SELECT start_date FROM absences').map((a) => a.start_date)).toEqual(['2026-10-05']);
    expect(db().all('PRAGMA foreign_key_check')).toEqual([]);

    const after = (await c.cmd.get('/api/courses')).body as CoursesOverview;
    expect(after.archives.map((a) => a.name)).toEqual(['מחזור 52']);
    expect(after.current.stats.tasks).toBe(0);
    // the archive is not one of the backups, and is never pruned
    expect(((await c.cmd.get('/api/admin/snapshots')).body as SnapshotInfo[]).some((s) => s.label === 'archive')).toBe(false);
  });

  it('the commander reads a previous course on every screen, read only, then goes back', async () => {
    await fillCourse();
    const { id } = (await startNew()).body as CourseArchive;
    await newTask(c.cmd, { title: 'משימה בקורס החדש', ownerIds: [c.ids.s2] });

    expect((await c.cmd.post('/api/courses/view', { id: 999 })).status).toBe(404);
    const opened = await c.cmd.post('/api/courses/view', { id });
    expect(opened.status).toBe(200);
    expect(String(opened.headers['set-cookie'])).toContain('HttpOnly');

    const titles = async () => ((await c.cmd.get('/api/tasks')).body as { title: string }[]).map((t) => t.title);
    expect(await titles()).toEqual(['הזמנת תחמושת']);
    expect((await c.cmd.get('/api/settings')).body.courseName).toBe('קורס קק"ס - מחזור 52');
    expect(((await c.cmd.get('/api/cadets')).body as unknown[]).length).toBe(1);
    expect(((await c.cmd.get('/api/weeks')).body as { name: string }[]).map((w) => w.name)).toEqual(['שבוע שטח']);
    const me = (await c.cmd.get('/api/auth/me')).body;
    expect(me.course).toEqual({ id, name: 'מחזור 52' });
    expect((await c.cmd.get('/api/courses')).body.viewing).toBe(id);

    // nothing changes while it is open
    const write = await c.cmd.post('/api/tasks', { title: 'לא אמור להיווצר', ownerIds: [c.ids.s1], deadline: '2026-10-05T15:00:00.000Z' });
    expect(write.status).toBe(403);
    expect(write.body.error).toContain('לקריאה בלבד');
    // the staff keep working on the current course
    expect(((await c.s1.get('/api/settings')).body as { courseName: string }).courseName).toBe('קורס קק"ס - מחזור 53');

    expect((await c.cmd.post('/api/courses/view', { id: null })).status).toBe(200);
    expect(await titles()).toEqual(['משימה בקורס החדש']);
    expect((await c.cmd.get('/api/auth/me')).body.course).toBeNull();
  });

  it('signing out closes the previous course', async () => {
    await fillCourse();
    const { id } = (await startNew()).body as CourseArchive;
    await c.cmd.post('/api/courses/view', { id });
    const out = await c.cmd.post('/api/auth/logout', {});
    expect(String(out.headers['set-cookie'])).toMatch(/kks_course=;/);
  });

  it('when the course cannot be kept, nothing is cleared', async () => {
    await fillCourse();
    setSnapshotProvider({
      list: async () => [],
      take: async () => {
        throw new Error('storage down');
      },
      fetch: async () => undefined,
    });
    const res = await startNew();
    expect(res.status).toBe(503);
    expect(res.body.error).toContain('לא נמחק דבר');
    expect(count('tasks')).toBe(1);
    expect(count('course_archives')).toBe(0);
    expect((await c.cmd.get('/api/settings')).body.courseName).toBe('קורס קק"ס - מחזור 52');
  });

  it('a restore from a backup keeps the list of previous courses', async () => {
    await c.cmd.post('/api/admin/snapshots', {});
    const [snap] = (await c.cmd.get('/api/admin/snapshots')).body as SnapshotInfo[];
    await fillCourse();
    await startNew();
    await c.cmd.post(`/api/admin/snapshots/${snap.id}/restore`, {});
    expect(((await c.cmd.get('/api/courses')).body as CoursesOverview).archives.map((a) => a.name)).toEqual(['מחזור 52']);
  });

  it('asks for both names and dates in order', async () => {
    expect((await c.cmd.post('/api/courses/new', { archiveName: '', name: 'ב' })).body.error).toContain('חסר שם לקורס שמסתיים');
    expect((await startNew({ startDate: '2027-09-01', endDate: '2027-03-01' })).body.error).toContain('תאריך הסיום לפני');
    expect(count('course_archives')).toBe(0);
  });
});

describe('archive snapshots', () => {
  it('are never pruned', () => {
    const now = new Date('2026-10-01T10:00:00Z');
    const old: SnapshotInfo[] = [
      { id: '20250101T100000000Z~archive', savedAt: '2025-01-01T10:00:00.000Z', label: 'archive', bytes: 1 },
      { id: '20250101T100000000Z~manual', savedAt: '2025-01-01T10:00:00.000Z', label: 'manual', bytes: 1 },
    ];
    expect(toPrune(old, now)).toEqual(['20250101T100000000Z~manual']);
  });
});
