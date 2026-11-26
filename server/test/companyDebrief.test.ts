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
    expect((await sumUp()).body.error).toBe('כדי לסכם צריך לפחות נושא אחד - מול הסגל, מול סגל רוחב, מול הפלוגה');
    // a proposal without a topic is not a topic yet
    await c.s2.patch(`/api/debriefs/${id}`, { answers: { broadStaff: [{ topic: '  ', proposal: 'להחליף תורנויות' }] } });
    expect((await sumUp()).status).toBe(400);

    // each topic with what is proposed for it (one written before proposals existed counts too)
    await c.s2.patch(`/api/debriefs/${id}`, {
      answers: { staffWeek: [{ topic: 'הלו"ז השתנה בלי הודעה מראש', proposal: 'שינויים עד 20:00 ביום הקודם' }], staffWoods: [], company: ['  '] },
    });
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

  it('puts each topic on someone: the staff, the broad role holders of its week, or a cadet', async () => {
    const { first, second, other, weekId } = await course();
    const created = await c.s2.post('/api/debriefs', { kind: 'company', weekId, title: 'תחק"ש פלוגתי', occurredOn: '2026-10-08' });
    // the broad staff then, by role: the security officer and the first half's training officer - not the second half's
    expect(created.body.broadStaff).toEqual([
      { cadetId: other, name: 'עידו נחום', role: 'קב"ט' },
      { cadetId: first, name: 'רועי אלון', role: 'קה"ד' },
    ]);
    expect(created.body.broadStaff.some((b: { cadetId: number }) => b.cadetId === second)).toBe(false);
    const id = created.body.debrief.id;
    const saved = await c.s2.patch(`/api/debriefs/${id}`, {
      answers: {
        staffWeek: [{ topic: 'הלו"ז השתנה בלי הודעה', proposal: 'שינויים עד 20:00', owner: { kind: 'user', id: c.ids.cmd, name: 'מפקד' } }],
        broadStaff: [{ topic: 'תורנויות', proposal: '', owner: { kind: 'cadet', id: other, name: 'עידו נחום' } }],
        // an owner in another shape is not kept
        company: [{ topic: 'ניקיון', proposal: 'סבב', owner: { kind: 'boss', id: 1 } }, { topic: 'שקט בלילה', owner: { kind: 'cadet', id: first, name: 'x'.repeat(300) } }],
      },
    });
    expect(saved.status).toBe(200);
    const a = saved.body.debrief.answers;
    expect(a.staffWeek[0].owner).toEqual({ kind: 'user', id: c.ids.cmd, name: 'מפקד' });
    expect(a.broadStaff[0].owner).toEqual({ kind: 'cadet', id: other, name: 'עידו נחום' });
    expect(a.company[0]).toEqual({ topic: 'ניקיון', proposal: 'סבב', owner: null });
    expect(a.company[1].owner.name).toHaveLength(120);
    expect((await c.s2.patch(`/api/debriefs/${id}`, { status: 'final' })).status).toBe(200);
    // a debrief of another kind has no broad staff to choose from
    expect((await c.s1.post('/api/debriefs', { kind: 'weekly', weekId, title: 'תחקיר שבועי', occurredOn: '2026-10-08' })).body.broadStaff).toEqual([]);
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

describe('company debrief - who a point is on: people, groups, several', () => {
  const group = (id: number) => ({ kind: 'group', id, name: '' });
  it('a topic on groups and people at once; a point to handle on a group becomes a task its facilitator follows', async () => {
    const { weekId } = await course();
    const id = (await c.s2.post('/api/debriefs', { kind: 'company', weekId, title: 'תחק"ש פלוגתי', occurredOn: '2026-10-08' })).body.debrief.id;
    // סגל (1) and מפק"צ 3: a topic on both
    const r = await c.s2.patch(`/api/debriefs/${id}`, { answers: { staffGeneral: [{ topic: 'עומס בערבים', proposal: 'לקצר את הערב', owners: [group(1), { kind: 'user', id: c.ids.s3, name: 'x' }] }] } });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const row = r.body.debrief.answers.staffGeneral[0];
    expect(row.owners.map((o: { kind: string; name: string }) => [o.kind, o.name])).toEqual([
      ['group', 'סגל'],
      ['user', 'x'],
    ]);
    expect(row.owner).toMatchObject({ kind: 'group', id: 1 });

    // a point to handle on the team commanders (6) and the company (2); one on the commander too
    const add = (body: object) => c.s2.post(`/api/debriefs/${id}/items`, { kind: 'lesson', body: 'נקודה', ...body });
    const p1 = await add({ horizon: 'now', body: 'לבדוק את לוח התורנויות', owners: [group(6), group(2)], dueDate: '2026-10-12' });
    expect(p1.status, JSON.stringify(p1.body)).toBe(200);
    const item = (p1.body.items as { body: string; owners: { name: string }[]; ownerId: number | null }[]).find((i) => i.body === 'לבדוק את לוח התורנויות')!;
    expect(item.owners.map((o) => o.name)).toEqual(['מפק״צים', 'פלוגה']);
    expect(item.ownerId).toBeNull();
    expect((await add({ horizon: 'now', body: 'שיחה עם הקה"ד', owners: [{ kind: 'user', id: c.ids.cmd }, group(4)], dueDate: '2026-10-12' })).status).toBe(200);

    // the next cycle: not this cycle's company or its broad staff
    expect((await add({ horizon: 'next', owners: [group(2)] })).body.error).toContain('לא על הפלוגה');
    expect((await add({ horizon: 'next', owners: [group(3)] })).status).toBe(400);
    expect((await add({ horizon: 'next', owners: [group(5), group(4)] })).status).toBe(200);

    // summed up: each point a task - the group's followed by whoever sums it up (no facilitator), with who it is on
    const done = await c.s2.patch(`/api/debriefs/${id}`, { status: 'final' });
    expect(done.status, JSON.stringify(done.body)).toBe(200);
    const tasks = db().all<{ title: string; description: string; owner_id: number }>("SELECT title, description, owner_id FROM tasks WHERE title IN ('לבדוק את לוח התורנויות', 'שיחה עם הקה\"ד') ORDER BY title");
    const byTitle = Object.fromEntries(tasks.map((t) => [t.title, t]));
    expect(byTitle['לבדוק את לוח התורנויות']).toMatchObject({ owner_id: c.ids.s2 });
    expect(byTitle['לבדוק את לוח התורנויות'].description).toContain('באחריות: מפק״צים, פלוגה');
    expect(byTitle['שיחה עם הקה"ד']).toMatchObject({ owner_id: c.ids.cmd });
  });
});
