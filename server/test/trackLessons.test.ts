// A lesson's training track: the lesson shows in the track's page - in this course, and in the track of the
// same name in the next cycle (a course opened beside this one, or the course after this one ended).

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { DebriefDetail, ParallelCourse, TrackDetail } from '../../shared/types';
import { config } from '../src/core';
import { db } from '../src/db';
import { closeSlots } from '../src/parallel';
import { setSnapshotProvider } from '../src/snapshots';
import { setup, type Ctx } from './helpers';

let c: Ctx;
beforeEach(async () => {
  config.dataDir = mkdtempSync(join(tmpdir(), 'kks-track-lessons-'));
  setSnapshotProvider(null);
  closeSlots();
  c = await setup();
});
afterEach(() => {
  closeSlots();
  setSnapshotProvider(null);
});

const track = async (name: string) => (await c.cmd.post('/api/tracks', { name, leadId: c.ids.s1 })).body.id as number;
const trackPage = async (id: number) => (await c.cmd.get(`/api/tracks/${id}`)).body as TrackDetail;

/** a debrief with two lessons in the track: one for now (with an owner and a date), one for the next cycle */
async function debriefWithLessons(trackId: number) {
  const id = (await c.s2.post('/api/debriefs', { kind: 'general', title: 'תחקיר ניווט לילה', occurredOn: '2026-10-01' })).body.debrief.id as number;
  const add = (body: object) => c.s2.post(`/api/debriefs/${id}/items`, { kind: 'lesson', ...body });
  const now = await add({ horizon: 'now', body: 'לתדרך את המנווטים על נקודות המפגש', ownerId: c.ids.s2, dueDate: '2026-10-08', trackId });
  expect(now.status, JSON.stringify(now.body)).toBe(200);
  expect((await add({ horizon: 'next', body: 'להקדים את הניווט בשבוע', trackId })).status).toBe(200);
  expect((await add({ horizon: 'next', body: 'לקח בלי ציר' })).status).toBe(200);
  return id;
}

describe('lessons in a training track', () => {
  it('a lesson given a track shows in the track; its task goes in the track too', async () => {
    const field = await track('ניווטים - ציר');
    const id = await debriefWithLessons(field);
    expect((await c.s2.post(`/api/debriefs/${id}/items`, { kind: 'lesson', horizon: 'now', body: 'x', trackId: 99999 })).status).toBe(400);
    const items = ((await c.s2.get(`/api/debriefs/${id}`)).body as DebriefDetail).items;
    expect(items.find((i) => i.body === 'להקדים את הניווט בשבוע')).toMatchObject({ trackId: field, trackName: 'ניווטים - ציר' });

    const page = await trackPage(field);
    expect(page.lessons.map((l) => [l.body, l.horizon])).toEqual([
      ['לתדרך את המנווטים על נקודות המפגש', 'now'],
      ['להקדים את הניווט בשבוע', 'next'],
    ]);
    expect(page.lessons[0]).toMatchObject({ debriefId: id, debriefTitle: 'תחקיר ניווט לילה', owner: 'מפק"צ 2', dueDate: '2026-10-08' });
    expect(page.previous).toBeNull();

    // a debrief summed up (a company debrief: its points to handle become tasks) - the task is in the track
    const w = (await c.cmd.post('/api/weeks', { name: 'שבוע ניווטים', startDate: '2026-10-04', endDate: '2026-10-08', leadId: c.ids.s1 })).body;
    const company = (await c.s2.post('/api/debriefs', { kind: 'company', weekId: w.week?.id ?? w.id, title: 'תחק"ש', occurredOn: '2026-10-08' })).body.debrief.id as number;
    await c.s2.patch(`/api/debriefs/${company}`, { answers: { staffGeneral: [{ topic: 'מפגשים בלילה', proposal: '' }] } });
    expect((await c.s2.post(`/api/debriefs/${company}/items`, { kind: 'lesson', horizon: 'now', body: 'לסמן נקודות מפגש במפה', ownerId: c.ids.s3, dueDate: '2026-10-12', trackId: field })).status).toBe(200);
    const done = await c.s2.patch(`/api/debriefs/${company}`, { status: 'final' });
    expect(done.status, JSON.stringify(done.body)).toBe(200);
    const task = db().get<{ track_id: number | null }>("SELECT track_id FROM tasks WHERE title = 'לסמן נקודות מפגש במפה'");
    expect(task?.track_id).toBe(field);
    expect((await trackPage(field)).lessons.find((l) => l.body === 'לסמן נקודות מפגש במפה')?.taskId).toBeTruthy();

    // the track changed on a lesson: no longer in this one
    const other = await track('ציר אחר');
    const lessonId = items.find((i) => i.body === 'להקדים את הניווט בשבוע')!.id;
    expect((await c.s2.patch(`/api/debrief-items/${lessonId}`, { trackId: other })).status).toBe(200);
    expect((await trackPage(field)).lessons.map((l) => l.body).sort()).toEqual(['לסמן נקודות מפגש במפה', 'לתדרך את המנווטים על נקודות המפגש'].sort());
    expect((await trackPage(other)).lessons.map((l) => l.body)).toEqual(['להקדים את הניווט בשבוע']);
  });

  it('the next cycle opened beside: its track of the same name shows the lessons of this one', async () => {
    const field = await track('ציר שטח');
    await debriefWithLessons(field);
    const r = await c.cmd.post('/api/courses/parallel', { name: 'מחזור הבא', startDate: '2027-03-07', take: ['tracks', 'lessons'] });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const course = r.body as ParallelCourse;
    await c.cmd.post('/api/courses/switch', { id: course.id });
    const there = ((await c.cmd.get('/api/tracks')).body as { id: number; name: string }[]).find((t) => t.name === 'ציר שטח')!;
    const page = await trackPage(there.id);
    // the lesson for the next cycle came along in its bank - in the track there; the one for now, from this course
    expect(page.lessons.map((l) => l.body)).toEqual(['להקדים את הניווט בשבוע']);
    expect(page.previous?.lessons.map((l) => l.body)).toEqual(['לתדרך את המנווטים על נקודות המפגש']);
    expect(page.previous?.lessons[0].debriefId).toBeNull();
  });

  it('lessons taken along into a course without the track: no track there (nothing breaks)', async () => {
    await debriefWithLessons(await track('ציר שטח'));
    const r = await c.cmd.post('/api/courses/parallel', { name: 'מחזור הבא', startDate: '2027-03-07', take: ['lessons'] });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
  });

  it('the course after this one ends: the track shows what the course that ended learned in it', async () => {
    const field = await track('ציר שטח');
    await debriefWithLessons(field);
    const ended = await c.cmd.post('/api/courses/new', { archiveName: 'מחזור 52', name: 'מחזור 53', startDate: '2027-03-07', endDate: '2027-08-26' });
    expect(ended.status, JSON.stringify(ended.body)).toBe(200);
    const page = await trackPage(field);
    expect(page.lessons.map((l) => l.body)).toEqual(['להקדים את הניווט בשבוע']);
    expect(page.previous).toMatchObject({ courseName: 'מחזור 52' });
    expect(page.previous?.lessons.map((l) => l.body)).toEqual(['לתדרך את המנווטים על נקודות המפגש']);
  });
});
