// Course tracks (צירים בקורס): the course's lines of work beside its weeks, each with a lead, goals
// and the tasks marked with it.

import { beforeEach, describe, expect, it } from 'vitest';
import { COURSE_TRACKS } from '../../shared/constants';
import type { Task, Track, TrackDetail } from '../../shared/types';
import { Db, migrate } from '../src/db';
import { at, setup, type Ctx } from './helpers';

let c: Ctx;
beforeEach(async () => {
  c = await setup();
});

const tracks = async () => (await c.cmd.get('/api/tracks')).body as Track[];
const trackOf = async (name: string) => (await tracks()).find((t) => t.name === name)!;
const newTask = async (body: Record<string, unknown>, who = c.cmd) => (await who.post('/api/tasks', { title: 'משימה', ownerIds: [c.ids.s1], deadline: at('2026-10-05'), ...body })).body.ids[0] as number;
const task = async (id: number) => (await c.cmd.get(`/api/tasks/${id}`)).body.task as Task;

describe('course tracks', () => {
  it('start with the course\'s ten tracks, in alphabetical order', async () => {
    expect((await tracks()).map((t) => t.name)).toEqual(['אימון גופני', 'אקדמיה', 'דת', 'חינוך', 'מארס טורקי', 'מסע פתיחה', 'ניווטים', 'רכב', 'שטח', 'תרגיל מסכם']);
    expect(COURSE_TRACKS).toHaveLength(10);
  });

  it('a task joins its track by its field - or by an area of the same name', async () => {
    const march = await trackOf('מארס טורקי');
    const field = await trackOf('שטח');
    const a = await newTask({ trackId: march.id });
    const b = await newTask({ domain: 'שטח' }); // the area names the track
    const d = await newTask({ domain: 'שטח', trackId: null }); // told: no track
    const e = await newTask({ domain: 'לוגיסטיקה' });
    expect([(await task(a)).trackName, (await task(b)).trackName, (await task(d)).trackId, (await task(e)).trackId]).toEqual(['מארס טורקי', 'שטח', null, null]);
    // a subtask stays in its parent's track
    const sub = await newTask({ parentId: a });
    expect((await task(sub)).trackId).toBe(march.id);
    // moved to another track, with a line in its history
    expect((await c.cmd.patch(`/api/tasks/${e}`, { trackId: field.id })).status).toBe(200);
    expect((await task(e)).trackName).toBe('שטח');
    expect((await c.cmd.get(`/api/tasks/${e}`)).body.activity.map((x: { text: string }) => x.text)).toEqual(expect.arrayContaining([expect.stringContaining('לציר "שטח"')]));
    expect((await c.cmd.patch(`/api/tasks/${e}`, { trackId: 9999 })).status).toBe(400);
    // the task list filters by track
    expect(((await c.cmd.get(`/api/tasks?track=${march.id}`)).body as Task[]).map((t) => t.id).sort()).toEqual([a, sub].sort());
    expect(((await c.cmd.get('/api/tasks?track=none')).body as Task[]).map((t) => t.id)).toEqual([d]);
  });

  it('counts readiness, overdue and the next deadline from its tasks, by course week', async () => {
    const nav = await trackOf('ניווטים');
    const week = (await c.cmd.post('/api/weeks', { name: 'שבוע ניווטים', startDate: '2026-10-04', endDate: '2026-10-10' })).body.id;
    const done = await newTask({ trackId: nav.id, deadline: at('2026-10-06') });
    await newTask({ trackId: nav.id, deadline: at('2026-09-30') }); // overdue, no week
    await newTask({ trackId: nav.id, deadline: at('2026-10-08') });
    await c.s1.post(`/api/tasks/${done}/transition`, { action: 'complete' });
    const t = await trackOf('ניווטים');
    expect(t).toMatchObject({ totalTasks: 3, doneTasks: 1, overdueTasks: 1, readiness: 33 });
    expect(t.nextDeadline).toBe(at('2026-10-08')); // the nearest still open and not yet past
    const detail = (await c.cmd.get(`/api/tracks/${nav.id}`)).body as TrackDetail;
    expect(detail.byWeek.map((w) => [w.name, w.done, w.total])).toEqual([
      ['שבוע ניווטים', 1, 2],
      ['ללא שבוע', 0, 1],
    ]);
    expect(detail.byWeek[0].weekId).toBe(week);
    expect(detail.tasks).toHaveLength(3);
  });

  it('the commander adds, names and gives a lead; the lead writes the goals; a deleted track leaves its tasks', async () => {
    expect((await c.s1.post('/api/tracks', { name: 'ציר חדש' })).status).toBe(403);
    const created = (await c.cmd.post('/api/tracks', { name: 'טקסים', leadId: c.ids.s1 })).body as Track;
    expect(created).toMatchObject({ name: 'טקסים', leadName: expect.any(String) });
    expect((await c.cmd.post('/api/tracks', { name: 'טקסים' })).status).toBe(400);
    // the lead heard about it
    expect(((await c.s1.get('/api/notifications')).body as { title: string }[]).some((n) => n.title.includes('טקסים'))).toBe(true);
    expect((await c.s1.patch(`/api/tracks/${created.id}`, { goals: 'טקס פתיחה וטקס סיום' })).status).toBe(200);
    expect((await c.s1.patch(`/api/tracks/${created.id}`, { name: 'טקסים וכנסים' })).status).toBe(403);
    expect((await c.s2.patch(`/api/tracks/${created.id}`, { goals: 'לא שלי' })).status).toBe(403);
    expect((await c.cmd.get(`/api/tracks/${created.id}`)).body.track.goals).toBe('טקס פתיחה וטקס סיום');
    const id = await newTask({ trackId: created.id });
    expect((await c.s1.del(`/api/tracks/${created.id}`)).status).toBe(403);
    expect((await c.cmd.del(`/api/tracks/${created.id}`)).status).toBe(200);
    expect((await task(id)).trackId).toBeNull();
    expect((await c.cmd.get(`/api/tracks/${created.id}`)).status).toBe(404);
  });

  it('the migration puts the tasks already in an area of a track\'s name into that track', () => {
    const before = new Db(':memory:');
    migrate(before, 31);
    before.run("INSERT INTO users(id, username, password_hash, display_name, role, created_at) VALUES (1, 'cmd', 'x', 'מפקד', 'commander', '2026-09-01')");
    const task = (id: number, domain: string) =>
      before.run(
        "INSERT INTO tasks(id, title, owner_id, created_by, deadline, domain, created_at, updated_at, last_activity_at) VALUES (?, 'משימה', 1, 1, '2026-10-05T15:00:00.000Z', ?, '2026-09-01', '2026-09-01', '2026-09-01')",
        id,
        domain,
      );
    task(1, 'ניווטים');
    task(2, 'לוגיסטיקה');
    task(3, '');
    migrate(before);
    expect(before.all<{ id: number; name: string | null }>('SELECT t.id, tr.name FROM tasks t LEFT JOIN tracks tr ON tr.id = t.track_id ORDER BY t.id')).toEqual([
      { id: 1, name: 'ניווטים' },
      { id: 2, name: null },
      { id: 3, name: null },
    ]);
    expect(before.get<{ n: number }>('SELECT count(*) AS n FROM tracks')?.n).toBe(10);
    before.close();
  });
});
