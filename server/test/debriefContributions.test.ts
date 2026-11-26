import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../src/db';
import { setup, type Agent, type Ctx } from './helpers';

let c: Ctx;
beforeEach(async () => { c = await setup(); });

type Point = { id: number; questionId: string | null; value: unknown; lesson: { body: string } | null; status: string; reviewedByName: string | null; reviewedAt: string | null };
type Contribution = { id: number; authorId: number; authorName: string; createdAt: string; points: Point[] };
const path = (id: number) => `/api/debriefs/${id}/contributions`;

async function weekly(name = 'שבוע שטח') {
  const w = await c.cmd.post('/api/weeks', { name, startDate: '2026-09-27', endDate: '2026-10-01', goals: 'ניווט יום', leadId: c.ids.s1 });
  expect(w.status).toBe(200);
  const weekId = w.body.week?.id ?? w.body.id;
  const d = await c.s1.post('/api/debriefs', { kind: 'weekly', weekId, title: `תחקיר - ${name}`, occurredOn: '2026-10-01', facilitatorId: c.ids.s1 });
  expect(d.status).toBe(200);
  return { id: d.body.debrief.id as number, weekId: weekId as number };
}

async function submit(id: number, body: object, actor: Agent = c.s2): Promise<Contribution> {
  const res = await actor.post(path(id), body);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body.contributions.at(-1);
}
const review = (id: number, pointIds: number[], decision = 'accepted', actor: Agent = c.s1) => actor.post(`${path(id)}/review`, { pointIds, decision });
const taskCount = (id: number) => db().get<{ n: number }>('SELECT count(*) AS n FROM tasks WHERE debrief_id = ?', id)!.n;

async function ready(id: number) {
  const r = await c.s1.patch(`/api/debriefs/${id}`, { answers: { goals: [{ goal: 'ניווט יום', status: 'met', note: 'בוצע' }], rating: 4 } });
  expect(r.status).toBe(200);
  const l = await c.s1.post(`/api/debriefs/${id}/items`, { kind: 'lesson', body: 'להכין ציוד מראש', horizon: 'now', ownerId: c.ids.s1, dueDate: '2026-10-05' });
  expect(l.status).toBe(200);
}

describe('staff contributions to weekly debriefs', () => {
  it('offers contributions in the list and detail immediately upon creation, with the week lead as default owner', async () => {
    const w = await c.cmd.post('/api/weeks', { name: 'שבוע חדש', startDate: '2026-09-27', endDate: '2026-10-01', leadId: c.ids.s1 });
    const created = await c.s2.post('/api/debriefs', { kind: 'weekly', weekId: w.body.id, title: 'תחקיר חדש', occurredOn: '2026-10-01' });
    expect(created.status).toBe(200);
    const id = created.body.debrief.id;
    expect(created.body.debrief).toMatchObject({ facilitatorId: c.ids.s1, status: 'draft', submittedAt: null, canContribute: true, canEdit: false });
    expect((await c.s3.get('/api/debriefs')).body.find((d: { id: number }) => d.id === id).canContribute).toBe(true);
    expect((await c.s1.get(`/api/debriefs/${id}`)).body.debrief).toMatchObject({ canEdit: true, canContribute: false });
    expect((await c.s2.get(path(id))).body.canContribute).toBe(true);
    await submit(id, { answers: { headline: 'תוספת לפני כל מילוי ושליחה' } });
    expect((await c.s1.get(`/api/debriefs/${id}`)).body.debrief.submittedAt).toBeNull();
  });

  it('keeps the selected training track through submission, review and commander-approved task creation', async () => {
    const { id } = await weekly();
    const trackId = (await c.cmd.post('/api/tracks', { name: 'ציר ניווט', leadId: c.ids.s1 })).body.id;
    await ready(id);
    const sub = await submit(id, { lessons: [
      { body: 'לקח עם ציר למחזור הזה', horizon: 'now', ownerId: c.ids.s2, dueDate: '2026-10-06', trackId },
      { body: 'לקח עם ציר למחזור הבא', horizon: 'next', trackId },
    ] });
    expect(sub.points.map(p => p.lesson)).toEqual(expect.arrayContaining([expect.objectContaining({ trackId, horizon: 'now' }), expect.objectContaining({ trackId, horizon: 'next' })]));
    const merged = await review(id, sub.points.map(p => p.id));
    expect(merged.status).toBe(200);
    expect(merged.body.items.filter((i: { trackId: number }) => i.trackId === trackId)).toHaveLength(2);
    expect(taskCount(id)).toBe(0);
    const final = await c.cmd.patch(`/api/debriefs/${id}`, { status: 'final' });
    expect(final.status).toBe(200);
    const task = final.body.tasks.find((t: { title: string }) => t.title === 'לקח עם ציר למחזור הזה');
    expect(task.trackId).toBe(trackId);
  });

  it('validates tracks on submission and again before review; old submissions without a track still work', async () => {
    const { id } = await weekly();
    expect((await c.s2.post(path(id), { lessons: [{ body: 'לא תקין', horizon: 'next', trackId: 999999 }] })).status).toBe(400);
    const trackId = (await c.cmd.post('/api/tracks', { name: 'ציר זמני' })).body.id;
    const sub = await submit(id, { lessons: [{ body: 'ציר שהוסר', horizon: 'next', trackId }] });
    db().run('DELETE FROM tracks WHERE id = ?', trackId);
    expect((await review(id, sub.points.map(p => p.id))).status).toBe(400);
    const old = await submit(id, { lessons: [{ body: 'ללא ציר', horizon: 'next' }] });
    db().run('UPDATE debrief_submission_points SET lesson = ? WHERE id = ?', JSON.stringify({ body: 'ללא ציר', horizon: 'next', ownerId: null, dueDate: null }), old.points[0].id);
    expect((await review(id, old.points.map(p => p.id))).status).toBe(200);
  });

  it('keeps submissions separate, reviews individual list rows, and keeps author and reviewer provenance', async () => {
    const { id } = await weekly();
    await c.s1.patch(`/api/debriefs/${id}`, { answers: { sustain: ['נקודה של האחראי'], headline: 'סיכום האחראי' } });
    const sub = await submit(id, { answers: { sustain: ['תיאום טוב', 'שיתוף פעולה'], headline: 'התרשמות נוספת' }, lessons: [] });
    expect(sub).toMatchObject({ authorId: c.ids.s2, authorName: 'מפק"צ 2' });
    expect(sub.createdAt).toBeTruthy();
    expect(sub.points).toHaveLength(3);
    expect(sub.points.every(p => p.status === 'pending' && p.reviewedAt === null)).toBe(true);
    const before = (await c.s1.get(`/api/debriefs/${id}`)).body;
    expect(before.debrief.answers.sustain).toEqual(['נקודה של האחראי']);
    const chosen = sub.points.find(p => p.questionId === 'sustain')!;
    const accepted = await review(id, [chosen.id]);
    expect(accepted.status).toBe(200);
    expect(accepted.body.debrief.answers.sustain).toHaveLength(2);
    expect(accepted.body.debrief.answers.sustain[0]).toBe('נקודה של האחראי');
    expect(accepted.body.debrief.answers.sustain[1]).toContain('תיאום טוב');
    const stored: Contribution = (await c.s2.get(path(id))).body.contributions[0];
    expect(stored.points.find(p => p.id === chosen.id)).toMatchObject({ status: 'accepted', reviewedByName: 'מפק"צ 1', value: chosen.value });
    expect(stored.points.find(p => p.id === chosen.id)?.reviewedAt).toBeTruthy();
    expect(stored.points.filter(p => p.status === 'pending')).toHaveLength(2);
    const rejected = sub.points.find(p => p.questionId === 'headline')!;
    expect((await review(id, [rejected.id], 'rejected')).status).toBe(200);
    expect((await c.s1.get(`/api/debriefs/${id}`)).body.debrief.answers.headline).toBe('סיכום האחראי');
    expect((await c.s2.get(path(id))).body.contributions[0].points.find((p: Point) => p.id === rejected.id).status).toBe('rejected');
  });

  it('merges an entire submission without overwriting existing answers or duplicating on a retried review', async () => {
    const { id } = await weekly();
    await ready(id);
    await c.s1.patch(`/api/debriefs/${id}`, { answers: { headline: 'הערכת האחראי', sustain: ['קיים'] } });
    const sub = await submit(id, { answers: { headline: 'משוב מהסגל', rating: 2, sustain: ['תוספת'], goals: [{ goal: 'עבודת צוות', status: 'partial', note: 'נדרש תרגול' }] }, lessons: [{ body: 'להוסיף אימון במחזור הבא', horizon: 'next', ownerId: null, dueDate: null }] });
    const ids = sub.points.map(p => p.id);
    const res = await review(id, ids);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.debrief.answers.rating).toBe(4);
    expect(res.body.debrief.answers.headline).toContain('הערכת האחראי');
    expect(res.body.debrief.answers.headline).toContain('משוב מהסגל');
    expect(res.body.debrief.answers.headline).toContain('2');
    expect(res.body.debrief.answers.goals).toHaveLength(2);
    expect(res.body.debrief.answers.sustain).toHaveLength(2);
    expect(res.body.items).toHaveLength(2);
    expect(taskCount(id)).toBe(0);
    const retry = await review(id, ids);
    expect(retry.status).toBe(200);
    expect(retry.body.debrief.answers).toEqual(res.body.debrief.answers);
    expect(retry.body.items).toHaveLength(2);
  });

  it('only creates tasks after the course commander approves, and accepting additions resets an earlier submission', async () => {
    const { id } = await weekly();
    await ready(id);
    const sent = await c.s1.patch(`/api/debriefs/${id}`, { status: 'final' });
    expect(sent.status).toBe(200);
    expect(sent.body.debrief.submittedAt).toBeTruthy();
    expect(sent.body.debrief.status).toBe('draft');
    const sub = await submit(id, { answers: {}, lessons: [{ body: 'לתאם הסעות מוקדם', horizon: 'now', ownerId: c.ids.s2, dueDate: '2026-10-06' }] });
    expect(taskCount(id)).toBe(0);
    const accepted = await review(id, sub.points.map(p => p.id));
    expect(accepted.status).toBe(200);
    expect(accepted.body.debrief).toMatchObject({ status: 'draft', submittedAt: null, canSumUp: false });
    expect(taskCount(id)).toBe(0);
    const resent = await c.s1.patch(`/api/debriefs/${id}`, { status: 'final' });
    expect(resent.status).toBe(200);
    expect(resent.body.debrief.status).toBe('draft');
    expect(taskCount(id)).toBe(0);
    expect((await c.s2.patch(`/api/debriefs/${id}`, { status: 'final' })).status).toBe(403);
    const final = await c.cmd.patch(`/api/debriefs/${id}`, { status: 'final' });
    expect(final.status).toBe(200);
    expect(final.body.debrief.status).toBe('final');
    expect(taskCount(id)).toBe(2);
    expect(final.body.items.find((i: { body: string }) => i.body === 'לתאם הסעות מוקדם').taskId).toBeTruthy();
  });

  it('allows the responsible lead and commander to review, while other staff cannot review or edit the official form', async () => {
    const { id } = await weekly();
    expect((await c.s2.get(path(id))).body).toMatchObject({ canContribute: true, canReview: false });
    expect((await c.s1.get(path(id))).body).toMatchObject({ canContribute: false, canReview: true });
    const sub = await submit(id, { answers: { headline: 'תוספת סגל' }, lessons: [] });
    expect((await review(id, sub.points.map(p => p.id), 'accepted', c.s2)).status).toBe(403);
    expect((await review(id, sub.points.map(p => p.id), 'accepted', c.s3)).status).toBe(403);
    expect((await c.s2.patch(`/api/debriefs/${id}`, { answers: { headline: 'עקיפה' } })).status).toBe(403);
    expect((await c.s1.post(path(id), { answers: { headline: 'כבר אחראי' }, lessons: [] })).status).toBe(403);
    const res = await review(id, sub.points.map(p => p.id), 'accepted', c.cmd);
    expect(res.status).toBe(200);
    expect(res.body.debrief.status).toBe('draft');
    expect((await c.s2.get(path(id))).body.contributions[0].points[0].reviewedByName).toBe('מפקד הקורס');
  });

  it('rejects cross-debrief or missing point IDs atomically, without partially merging valid points', async () => {
    const a = await weekly();
    const b = await weekly('שבוע אחר');
    const subA = await submit(a.id, { answers: { headline: 'א' }, lessons: [] });
    const subB = await submit(b.id, { answers: { headline: 'ב' }, lessons: [] });
    for (const invalid of [subB.points[0].id, 999999]) {
      const res = await review(a.id, [subA.points[0].id, invalid]);
      expect(res.status).toBeGreaterThanOrEqual(400);
      expect((await c.s1.get(`/api/debriefs/${a.id}`)).body.debrief.answers.headline).toBeUndefined();
      expect((await c.s1.get(path(a.id))).body.contributions[0].points[0].status).toBe('pending');
    }
  });

  it('requires reviewing pending points before approval and protects final debriefs from further contributions or reviews', async () => {
    const { id } = await weekly();
    await ready(id);
    const sub = await submit(id, { answers: { headline: 'טרם נבדק' }, lessons: [] });
    expect((await c.s1.patch(`/api/debriefs/${id}`, { status: 'final' })).status).toBe(400);
    expect((await c.cmd.patch(`/api/debriefs/${id}`, { status: 'final' })).status).toBe(400);
    expect((await review(id, sub.points.map(p => p.id), 'rejected')).status).toBe(200);
    const final = await c.cmd.patch(`/api/debriefs/${id}`, { status: 'final' });
    expect(final.status).toBe(200);
    const after = (await c.s1.get(path(id))).body;
    expect(after).toMatchObject({ canContribute: false, canReview: false });
    expect((await c.s2.post(path(id), { answers: { headline: 'מאוחר מדי' }, lessons: [] })).status).toBeGreaterThanOrEqual(400);
    expect((await review(id, sub.points.map(p => p.id))).status).toBeGreaterThanOrEqual(400);
    expect((await c.s1.get(`/api/debriefs/${id}`)).body.debrief.answers.headline).toBeUndefined();
  });

  it('validates empty and malformed submissions and does not accept contributions for nonweekly debriefs', async () => {
    const { id } = await weekly();
    for (const body of [{ answers: {}, lessons: [] }, { answers: { rating: 6 }, lessons: [] }, { answers: {}, lessons: [{ body: 'לקח', horizon: 'now', ownerId: 999999, dueDate: '2026-10-05' }] }]) {
      expect((await c.s2.post(path(id), body)).status).toBeGreaterThanOrEqual(400);
    }
    expect((await c.s1.get(path(id))).body.contributions).toHaveLength(0);
    const other = await c.s1.post('/api/debriefs', { title: 'תחקיר פעילות', occurredOn: '2026-10-01' });
    expect(other.status).toBe(200);
    expect((await c.s2.post(path(other.body.debrief.id), { answers: { headline: 'לא שבועי' }, lessons: [] })).status).toBeGreaterThanOrEqual(400);
  });
  it('prevents alternate lesson conversions before commander approval, and editing after it', async () => {
    const { id, weekId } = await weekly();
    await ready(id);
    const sub = await submit(id, { lessons: [{ body: 'לקח לשנה הבאה', horizon: 'next' }] });
    const merged = await review(id, sub.points.map(p => p.id));
    const item = merged.body.items.find((i: { horizon: string }) => i.horizon === 'next').id;
    for (const endpoint of ['task', 'recurring', 'template']) {
      const blocked = await c.cmd.post(`/api/debrief-items/${item}/${endpoint}`, {});
      expect(blocked.status).toBe(400);
      expect(blocked.body.error).toContain('אישור מפקד הקורס');
    }
    expect((await c.cmd.post(`/api/lessons/${item}/review`, { weekId, decision: 'task', task: { title: 'עקיפה', ownerId: c.ids.s1, deadline: '2026-10-06T12:00:00Z' } })).status).toBe(400);
    expect(taskCount(id)).toBe(0);
    expect((await c.cmd.patch(`/api/debriefs/${id}`, { status: 'final' })).status).toBe(200);
    expect((await c.s1.patch(`/api/debriefs/${id}`, { answers: { headline: 'שינוי אחרי אישור' } })).status).toBe(400);
    expect((await c.s1.post(`/api/debriefs/${id}/items`, { kind: 'lesson', body: 'חדש' })).status).toBe(400);
    expect((await c.s1.patch(`/api/debrief-items/${item}`, { body: 'שינוי' })).status).toBe(400);
    expect((await c.s1.del(`/api/debrief-items/${item}`)).status).toBe(400);
    expect((await c.cmd.patch(`/api/debriefs/${id}`, { status: 'draft' })).status).toBe(200);
    expect((await c.s1.patch(`/api/debrief-items/${item}`, { body: 'שינוי בטיוטה' })).status).toBe(200);
  });

});
