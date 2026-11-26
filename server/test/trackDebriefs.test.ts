import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { debriefTemplateDocx } from '../../shared/debriefTemplate';
import type { DebriefDetail, DebriefContribution, TrackDetail } from '../../shared/types';
import { config } from '../src/core';
import { Db, db, migrate } from '../src/db';
import { closeSlots } from '../src/parallel';
import { setSnapshotProvider } from '../src/snapshots';
import { setup, type Ctx } from './helpers';

let c: Ctx;
beforeEach(async () => {
  config.dataDir = mkdtempSync(join(tmpdir(), 'kks-track-debriefs-'));
  closeSlots();
  setSnapshotProvider(null);
  c = await setup();
});
afterEach(() => { closeSlots(); setSnapshotProvider(null); });
const detail = async (id: number) => (await c.cmd.get(`/api/debriefs/${id}`)).body as DebriefDetail;
const track = async (name = 'ניווטים בתרגיל') => (await c.cmd.post('/api/tracks', { name, leadId: c.ids.s1, goals: 'ניווט יום\nניווט לילה' })).body.id as number;
async function create(trackId: number) {
  const res = await c.cmd.post('/api/debriefs', { kind: 'track', trackId, title: 'תחקיר ציר ניווטים', occurredOn: '2026-10-01' });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body.debrief.id as number;
}
const tasks = (id: number) => db().get<{ n: number }>('SELECT count(*) AS n FROM tasks WHERE debrief_id = ?', id)!.n;

async function ready(id: number) {
  expect((await c.s1.patch(`/api/debriefs/${id}`, { answers: { goals: [{ goal: 'ניווט יום', status: 'met', note: 'בוצע' }], rating: 4, headline: 'הציר התקדם' } })).status).toBe(200);
  expect((await c.s1.post(`/api/debriefs/${id}/items`, { kind: 'lesson', body: 'להכין מפות מראש', horizon: 'now', ownerId: c.ids.s2, dueDate: '2026-10-05' })).status).toBe(200);
  expect((await c.s1.post(`/api/debriefs/${id}/items`, { kind: 'lesson', body: 'להוסיף תרגול ניווט', horizon: 'next' })).status).toBe(200);
}

describe('track debriefs', () => {
  it('requires a real track, opens without a week, and starts from its goals and lead', async () => {
    const body = { kind: 'track', title: 'תחקיר', occurredOn: '2026-10-01' };
    for (const extra of [{}, { trackId: null }, { trackId: 999999 }]) expect((await c.cmd.post('/api/debriefs', { ...body, ...extra })).status).toBe(400);
    const trackId = await track();
    const id = await create(trackId);
    const d = (await detail(id)).debrief;
    expect(d).toMatchObject({ kind: 'track', trackId, trackName: 'ניווטים בתרגיל', weekId: null, facilitatorId: c.ids.s1, status: 'draft', submittedAt: null });
    expect(d.answers.goals).toEqual([{ goal: 'ניווט יום', status: '', note: '' }, { goal: 'ניווט לילה', status: '', note: '' }]);
    expect((await c.s2.get('/api/debriefs')).body.find((x: { id: number }) => x.id === id)).toMatchObject({ trackId, canContribute: true, canEdit: false });
    expect((await c.s1.get(`/api/debriefs/${id}`)).body.debrief).toMatchObject({ canEdit: true, canSumUp: false, canContribute: false });
    expect((await c.s2.patch(`/api/debriefs/${id}`, { answers: { headline: 'לא שלי' } })).status).toBe(403);
    expect((await c.s1.patch(`/api/debriefs/${id}`, { status: 'final' })).status).toBe(400);
    expect((await c.cmd.patch(`/api/debriefs/${id}`, { trackId: null })).status).toBe(400);
    expect((await c.cmd.patch(`/api/debriefs/${id}`, { trackId: 999999 })).status).toBe(400);
  });

  it('reviews staff additions from creation and keeps lessons in the track through commander approval', async () => {
    const trackId = await track();
    const id = await create(trackId);
    await ready(id);
    const url = `/api/debriefs/${id}/contributions`;
    const sent = await c.s2.post(url, { answers: { headline: 'נקודת מבט נוספת', rating: 3 }, lessons: [{ body: 'להוסיף ניווט זוגות', horizon: 'next' }] });
    expect(sent.status).toBe(200);
    const sub = sent.body.contributions[0] as DebriefContribution;
    expect(sub.points.find(p => p.lesson)?.lesson).toMatchObject({ trackId });
    expect(sub.points.find(p => p.questionId === 'rating')?.label).toBe('ציון לציר');
    expect((await c.s1.patch(`/api/debriefs/${id}`, { status: 'final' })).status).toBe(400);
    expect((await c.s1.post(`${url}/review`, { decision: 'accepted', pointIds: sub.points.map(p => p.id) })).status).toBe(200);
    expect((await detail(id)).debrief.answers.headline).toContain('ציון לציר: 3/5');
    const submitted = await c.s1.patch(`/api/debriefs/${id}`, { status: 'final' });
    expect(submitted.status).toBe(200);
    expect(submitted.body.debrief.status).toBe('draft');
    expect(submitted.body.debrief.submittedAt).toBeTruthy();
    expect(tasks(id)).toBe(0);
    const lessonId = submitted.body.items.find((l: { horizon: string }) => l.horizon === 'now').id;
    expect((await c.s1.post(`/api/debrief-items/${lessonId}/task`, { title: 'עקיפה', ownerIds: [c.ids.s2], deadline: '2026-10-05T12:00:00Z' })).status).toBe(400);
    const final = await c.cmd.patch(`/api/debriefs/${id}`, { status: 'final' });
    expect(final.status).toBe(200);
    expect(final.body.debrief.status).toBe('final');
    expect(final.body.tasks).toHaveLength(1);
    expect(final.body.tasks[0].trackId).toBe(trackId);
    const page = (await c.cmd.get(`/api/tracks/${trackId}`)).body as TrackDetail;
    expect(page.lessons).toHaveLength(3);
    expect((await c.cmd.get('/api/lessons')).body.filter((l: { debriefId: number }) => l.debriefId === id).every((l: { target: string }) => l.target === 'ציר ניווטים בתרגיל')).toBe(true);
    expect((await c.s1.patch(`/api/debriefs/${id}`, { status: 'draft' })).status).toBe(403);
    expect((await c.s1.post(`/api/debriefs/${id}/items`, { kind: 'lesson', body: 'אחרי אישור' })).status).toBe(400);
  });

  it('imports the same form as a Word template and defaults imported lessons to the selected track', async () => {
    const trackId = await track();
    const id = await create(trackId);
    const answers = { goals: [{ goal: 'ניווט לילה', status: 'partial', note: 'נדרש תרגול' }], rating: 3, sustain: ['תכנון הצירים'], headline: 'התקדמות' };
    const file = debriefTemplateDocx({ kind: 'track', title: 'תחקיר ציר', when: '1.10.2026', about: 'ציר ניווטים', participants: 'הסגל', summary: '', answers, items: [{ kind: 'lesson', body: 'לקח מיובא', horizon: 'next', ownerName: null, dueDate: null }] }).data;
    const res = await c.s1.post(`/api/debriefs/${id}/import/file`).set('content-type', 'application/octet-stream').send(Buffer.from(file));
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect((await detail(id)).debrief.answers).toMatchObject({ ...answers, goals: expect.arrayContaining(answers.goals) });
    expect((await detail(id)).debrief.answers.goals).toHaveLength(2);
    expect((await detail(id)).items[0]).toMatchObject({ body: 'לקח מיובא', trackId });
  });

  it('keeps a debrief readable after a track is deleted, and requires a valid replacement', async () => {
    const id = await create(await track());
    const before = (await detail(id)).debrief;
    expect((await c.cmd.del(`/api/tracks/${before.trackId}`)).status).toBe(200);
    expect((await detail(id)).debrief).toMatchObject({ trackId: null, trackName: null, kind: 'track' });
    expect((await c.cmd.patch(`/api/debriefs/${id}`, { status: 'final' })).status).toBe(400);
    const other = await track('ציר חלופי');
    expect((await c.cmd.patch(`/api/debriefs/${id}`, { trackId: other })).status).toBe(200);
    expect((await detail(id)).debrief.trackId).toBe(other);
  });

  it('carries next-cycle lessons with their track, including when the next course omits tracks', async () => {
    const trackId = await track();
    const id = await create(trackId);
    await ready(id);
    for (const take of [['tracks', 'lessons'], ['lessons']]) {
      const course = await c.cmd.post('/api/courses/parallel', { name: `מחזור ${take.length}`, startDate: '2027-03-07', take });
      expect(course.status, JSON.stringify(course.body)).toBe(200);
      expect((await c.cmd.post('/api/courses/switch', { id: course.body.id })).status).toBe(200);
      const there = (await detail(id)).debrief;
      expect(there.kind).toBe('track');
      expect(there.trackId).toBe(take.includes('tracks') ? trackId : null);
      expect((await detail(id)).items).toHaveLength(1);
      expect((await c.cmd.post('/api/courses/switch', { id: null })).status).toBe(200);
    }
  });

  it('upgrades existing debriefs without changing their content or submitted contributions', () => {
    const before = new Db(':memory:');
    migrate(before, 67);
    before.run("INSERT INTO users(id, username, password_hash, display_name, role, created_at) VALUES (1, 'cmd', 'x', 'מפקד', 'commander', '2026-09-01')");
    before.run("INSERT INTO debriefs(id, kind, title, occurred_on, created_by, created_at, updated_at, answers) VALUES (1, 'weekly', 'קיים', '2026-10-01', 1, '2026-10-01', '2026-10-01', '{\"headline\":\"נשמר\"}')");
    before.run("INSERT INTO debrief_submissions(id, debrief_id, author_id, author_name, created_at) VALUES (1, 1, 1, 'מפקד', '2026-10-01')");
    before.run("INSERT INTO debrief_submission_points(submission_id, question_id, label, value) VALUES (1, 'headline', 'סיכום', '\"תוספת\"')");
    migrate(before);
    expect(before.get('SELECT title, answers, track_id FROM debriefs WHERE id = 1')).toEqual({ title: 'קיים', answers: '{"headline":"נשמר"}', track_id: null });
    expect(before.get('SELECT status FROM debrief_submission_points WHERE submission_id = 1')).toEqual({ status: 'pending' });
    before.close();
  });
});
