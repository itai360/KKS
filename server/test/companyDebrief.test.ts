import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../src/db';
import { setup, type Ctx } from './helpers';

let c: Ctx;
beforeEach(async () => {
  c = await setup();
});

async function course() {
  const teamId = (await c.cmd.post('/api/teams', { name: 'צוות 1', commanderId: c.ids.s1 })).body[0].id;
  const cadet = async (firstName: string, lastName: string) => (await c.cmd.post('/api/cadets', { firstName, lastName, teamId })).body.cadet.id as number;
  const first = await cadet('רועי', 'אלון');
  const second = await cadet('שירה', 'גל');
  const other = await cadet('עידו', 'נחום');
  // the training officer of the broad experience: one cadet for each half of the course
  const broad = (cadetId: number, span: string, startDate: string, endDate: string, mentorId?: number) =>
    c.s1.post('/api/experiences', { cadetId, kind: 'broad', role: 'קה"ד', span, startDate, endDate, mentorId });
  expect((await broad(first, 'first_half', '2026-09-01', '2026-10-15', c.ids.s3)).status).toBe(200);
  expect((await broad(second, 'second_half', '2026-10-16', '2026-12-31')).status).toBe(200);
  // another broad experience at the same time is not the one who brings it
  expect((await c.s1.post('/api/experiences', { cadetId: other, kind: 'broad', role: 'קב"ט', span: 'full', startDate: '2026-09-01', endDate: '2026-12-31' })).status).toBe(200);
  const week = (await c.cmd.post('/api/weeks', { name: 'שבוע שטח', startDate: '2026-10-04', endDate: '2026-10-08', leadId: c.ids.s1 })).body;
  return { first, second, other, weekId: (week.week?.id ?? week.id) as number };
}

describe('company debrief (תחק"ש פלוגתי)', () => {
  it('is brought by the cadet who is the broad training officer on its day, and is about a week', async () => {
    const { first, second, weekId } = await course();
    expect((await c.s2.get('/api/debriefs/presenter?date=2026-10-08')).body).toMatchObject({ cadetId: first, cadetName: 'רועי אלון', mentorId: c.ids.s3 });
    expect((await c.s2.get('/api/debriefs/presenter?date=2026-11-01')).body).toMatchObject({ cadetId: second, mentorId: null });
    expect((await c.s2.get('/api/debriefs/presenter?date=2027-03-01')).body).toBeNull();
    expect((await c.s2.get('/api/debriefs/presenter?date=nope')).status).toBe(400);

    // a week must be chosen, as for the weekly debrief
    expect((await c.s2.post('/api/debriefs', { kind: 'company', title: 'תחק"ש', occurredOn: '2026-10-08' })).body.error).toContain('בחרו את השבוע');
    const created = await c.s2.post('/api/debriefs', { kind: 'company', weekId, title: 'תחק"ש פלוגתי - שבוע שטח', occurredOn: '2026-10-08' });
    expect(created.status).toBe(200);
    expect(created.body.debrief).toMatchObject({ kind: 'company', weekId, presenterId: first, presenterName: 'רועי אלון' });
    expect(created.body.week.name).toBe('שבוע שטח');
    // no goals from the week: its form is points, not the weekly form
    expect(created.body.debrief.answers.goals).toBeUndefined();

    // another cadet brings it after all, or none is set yet
    const id = created.body.debrief.id;
    expect((await c.s2.patch(`/api/debriefs/${id}`, { answers: { presenterId: second } })).body.debrief.presenterName).toBe('שירה גל');
    expect((await c.s2.patch(`/api/debriefs/${id}`, { answers: { presenterId: 999999 } })).body.error).toContain('לא נמצא');
    const chosen = await c.s2.post('/api/debriefs', { kind: 'company', weekId, title: 'תחק"ש', occurredOn: '2027-03-01', answers: { presenterId: null } });
    expect(chosen.body.debrief.presenterId).toBeNull();
  });

  it('sums up with one point at least, before the staff, the broad staff or the company - lessons are optional', async () => {
    const { weekId } = await course();
    const id = (await c.s2.post('/api/debriefs', { kind: 'company', weekId, title: 'תחק"ש פלוגתי', occurredOn: '2026-10-08' })).body.debrief.id;
    const sumUp = () => c.s2.patch(`/api/debriefs/${id}`, { status: 'final' });
    expect((await sumUp()).body.error).toBe('כדי לסכם צריך לפחות נקודה אחת - מול הסגל, מול סגל רוחב, מול הפלוגה');

    await c.s2.patch(`/api/debriefs/${id}`, { answers: { staffWeek: ['הלו"ז השתנה בלי הודעה מראש'], staffWoods: [], company: ['  '] } });
    const done = await sumUp();
    expect(done.status).toBe(200);
    expect(done.body.debrief.status).toBe('final');

    // a point the staff takes on, with an owner and a date, becomes a task on summing up
    await c.s2.patch(`/api/debriefs/${id}`, { status: 'draft' });
    const item = (await c.s2.post(`/api/debriefs/${id}/items`, { kind: 'lesson', horizon: 'now', body: 'להודיע על שינויי לו"ז עד 20:00 ביום הקודם' })).body.items[0];
    expect((await sumUp()).body.error).toContain('אחראי ותאריך');
    await c.s2.patch(`/api/debrief-items/${item.id}`, { ownerId: c.ids.s1, dueDate: '2026-10-12' });
    const final = await sumUp();
    expect(final.status).toBe(200);
    const task = db().get<{ title: string; owner_id: number; description: string }>('SELECT title, owner_id, description FROM tasks WHERE id = ?', final.body.items[0].taskId)!;
    expect(task).toMatchObject({ title: 'להודיע על שינויי לו"ז עד 20:00 ביום הקודם', owner_id: c.ids.s1 });
    expect(task.description).toContain('תחק"ש פלוגתי');
  });

  it('keeps its next-cycle lessons for its week, beside the weekly debrief\'s', async () => {
    const { weekId } = await course();
    const id = (await c.s2.post('/api/debriefs', { kind: 'company', weekId, title: 'תחק"ש פלוגתי', occurredOn: '2026-10-08' })).body.debrief.id;
    const kept = (await c.s2.post(`/api/debriefs/${id}/items`, { kind: 'lesson', horizon: 'next', body: 'לתת לפלוגה יום התארגנות לפני שבוע השטח' })).body.items[0];
    expect(kept.target).toContain('שבוע שטח');
    // the weekly debrief of the same week is a different debrief
    const weekly = await c.s1.post('/api/debriefs', { kind: 'weekly', weekId, title: 'תחקיר שבועי - שבוע שטח', occurredOn: '2026-10-08' });
    expect(weekly.status).toBe(200);
    const list = (await c.s1.get(`/api/debriefs?week=${weekId}`)).body.map((d: { kind: string }) => d.kind).sort();
    expect(list).toEqual(['company', 'weekly']);
  });
});
