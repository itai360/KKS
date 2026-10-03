import { beforeEach, describe, expect, it } from 'vitest';
import { runAutomation } from '../src/automation';
import { clock } from '../src/core';
import { db } from '../src/db';
import { at, notificationsOf, setup, type Ctx } from './helpers';

let c: Ctx;
beforeEach(async () => {
  c = await setup();
});

async function week(name: string, start: string, end: string, goals = '') {
  const res = await c.cmd.post('/api/weeks', { name, startDate: start, endDate: end, goals, leadId: c.ids.s1 });
  expect(res.status).toBe(200);
  return res.body.week?.id ?? res.body.id;
}

describe('weekly debrief form', () => {
  it('starts from the week\'s goals, keeps each person\'s answers, and is about the week chosen', async () => {
    const w = await week('שבוע שטח', '2026-09-27', '2026-10-01', '- לתרגל ניווט יום\n2. ביקורת ציוד');
    // held on the next week's first day, about the week that ended
    const created = await c.s1.post('/api/debriefs', { kind: 'weekly', weekId: w, title: 'תחקיר שבועי - שבוע שטח', occurredOn: '2026-10-04' });
    expect(created.status).toBe(200);
    const d = created.body;
    expect(d.debrief.kind).toBe('weekly');
    expect(d.debrief.weekId).toBe(w);
    expect(d.week.name).toBe('שבוע שטח');
    expect(d.debrief.answers.goals).toEqual([
      { goal: 'לתרגל ניווט יום', status: '', note: '' },
      { goal: 'ביקורת ציוד', status: '', note: '' },
    ]);
    // two people fill different parts at once: both answers stay
    await c.s1.patch(`/api/debriefs/${d.debrief.id}`, { answers: { headline: 'שבוע עמוס אבל טוב' } });
    await c.cmd.patch(`/api/debriefs/${d.debrief.id}`, { answers: { rating: 4 } });
    const after = (await c.s1.get(`/api/debriefs/${d.debrief.id}`)).body.debrief;
    expect(after.answers).toMatchObject({ headline: 'שבוע עמוס אבל טוב', rating: 4 });
    expect(after.answers.goals).toHaveLength(2);
    expect(after.weekId).toBe(w);
  });

  it('is summed up only when it can change something: required answers, a lesson, an owner and a date', async () => {
    const w = await week('שבוע הגנה', '2026-10-04', '2026-10-08', 'הגנת מרחב');
    const id = (await c.s1.post('/api/debriefs', { kind: 'weekly', weekId: w, title: 'תחקיר שבועי - הגנה', occurredOn: '2026-10-08' })).body.debrief.id;
    const sumUp = () => c.s1.patch(`/api/debriefs/${id}`, { status: 'final' });

    expect((await sumUp()).body.error).toBe('כדי לסכם חסר: מטרות השבוע, תמונה כללית');
    await c.s1.patch(`/api/debriefs/${id}`, { answers: { goals: [{ goal: 'הגנת מרחב', status: 'partial', note: 'חסר זמן' }], rating: 3 } });
    expect((await sumUp()).body.error).toContain('הוסיפו לפחות לקח אחד');

    const now = await c.s1.post(`/api/debriefs/${id}/items`, { kind: 'lesson', horizon: 'now', body: 'לקבוע תדריך בטיחות יום לפני כל תרגיל' });
    const lessonId = now.body.items[0].id;
    expect((await sumUp()).body.error).toContain('אחראי ותאריך');

    await c.s1.patch(`/api/debrief-items/${lessonId}`, { ownerId: c.ids.s2, dueDate: '2026-10-12' });
    await c.s1.post(`/api/debriefs/${id}/items`, { kind: 'lesson', horizon: 'next', body: 'להקדים את תרגיל ההגנה ליום שני' });
    const done = await sumUp();
    expect(done.status).toBe(200);
    expect(done.body.debrief.status).toBe('final');

    // the lesson for this cycle is now s2's task, by its date; the one for next cycle is kept, not a task
    const lessons = done.body.items;
    const task = db().get<{ title: string; owner_id: number; deadline: string; debrief_id: number }>('SELECT title, owner_id, deadline, debrief_id FROM tasks WHERE id = ?', lessons.find((l: { horizon: string }) => l.horizon === 'now').taskId);
    expect(task).toMatchObject({ title: 'לקבוע תדריך בטיחות יום לפני כל תרגיל', owner_id: c.ids.s2, debrief_id: id });
    expect(task!.deadline.slice(0, 10)).toBe('2026-10-12');
    expect(notificationsOf(c.ids.s2).some((n) => n.title.includes('נוספה לך משימה חדשה'))).toBe(true);
    const next = lessons.find((l: { horizon: string }) => l.horizon === 'next');
    expect(next.taskId).toBeNull();
    expect(next.target).toBe(`שבוע ${(await c.cmd.get(`/api/weeks/${w}`)).body.week.number} · שבוע הגנה`);

    // the debrief was about another week after all: its next-cycle lesson follows
    const other = await week('שבוע מטווחים', '2026-10-11', '2026-10-15');
    await c.s1.patch(`/api/debriefs/${id}`, { status: 'draft' });
    const moved = (await c.s1.patch(`/api/debriefs/${id}`, { weekId: other })).body;
    expect(moved.debrief.weekId).toBe(other);
    expect(moved.items.find((l: { horizon: string }) => l.horizon === 'next').target).toContain('שבוע מטווחים');
  });
});

describe('lessons bank', () => {
  it('shows a week the lessons an earlier cycle wrote for a week of that name or number - not its own', async () => {
    const w1 = await week('שבוע ניווט', '2026-10-11', '2026-10-15');
    const id = (await c.cmd.post('/api/debriefs', { kind: 'weekly', weekId: w1, title: 'תחקיר שבועי - ניווט', occurredOn: '2026-10-15' })).body.debrief.id;
    await c.cmd.post(`/api/debriefs/${id}/items`, { kind: 'lesson', horizon: 'next', body: 'לתת מפות יום מראש' });
    expect((await c.cmd.get(`/api/lessons?week=${w1}`)).body).toEqual([]);
    // the next cycle's week of the same name
    const w2 = await week('שבוע ניווט', '2027-03-07', '2027-03-11');
    const bank = (await c.s3.get(`/api/lessons?week=${w2}`)).body;
    expect(bank.map((l: { body: string }) => l.body)).toEqual(['לתת מפות יום מראש']);
    expect(bank[0]).toMatchObject({ debriefId: id, debriefKind: 'weekly' });
    expect((await c.cmd.get('/api/lessons')).body).toHaveLength(1);
  });
});

describe('intensive event debrief', () => {
  it('reports a safety event to the commander, and keeps lessons for the next event of that name', async () => {
    const ev = (await c.cmd.post('/api/events', { date: '2026-10-06', startTime: '22:00', title: 'מארס טורקי' })).body.event.id;
    const id = (await c.s1.post('/api/debriefs', { kind: 'event', eventId: ev, title: 'תחקיר מארס טורקי', occurredOn: '2026-10-07' })).body.debrief.id;
    await c.s1.patch(`/api/debriefs/${id}`, {
      answers: {
        numbers: { started: 60, finished: 57, evacuated: 3 },
        goals: [{ goal: 'חוסן', status: 'met', note: '' }],
        rating: 4,
        safetyEvent: true,
        safety: 'שני צוערים עם התייבשות בקילומטר 12',
      },
    });
    await c.s1.post(`/api/debriefs/${id}/items`, { kind: 'lesson', horizon: 'next', body: 'נקודת מים כל 4 ק"מ' });
    expect((await c.s1.patch(`/api/debriefs/${id}`, { status: 'final' })).status).toBe(200);
    const alert = db().get<{ title: string; category: string }>("SELECT title, category FROM notifications WHERE user_id = ? AND title LIKE 'אירוע בטיחות%'", c.ids.cmd);
    expect(alert).toMatchObject({ title: 'אירוע בטיחות במופע: תחקיר מארס טורקי', category: 'exception' });

    // the next cycle's march: the lesson comes up on it, not on other events
    const next = (await c.cmd.post('/api/events', { date: '2027-04-06', startTime: '22:00', title: 'מארס טורקי - מחזור 53' })).body.event.id;
    const other = (await c.cmd.post('/api/events', { date: '2027-04-07', startTime: '08:00', title: 'מטווח' })).body.event.id;
    expect((await c.s2.get(`/api/lessons?event=${next}`)).body.map((l: { body: string }) => l.body)).toEqual(['נקודת מים כל 4 ק"מ']);
    expect((await c.s2.get(`/api/lessons?event=${other}`)).body).toEqual([]);
    expect((await c.s2.get(`/api/lessons?event=${ev}`)).body).toEqual([]);
  });
});

describe('closing the loop on lessons', () => {
  it('reminds the week lead to hold the weekly debrief - from noon on the last day, once', async () => {
    // NOW is Thursday 1.10 10:00; the week ends today
    const w = await week('שבוע מטווחים', '2026-09-27', '2026-10-01');
    const reminders = () => notificationsOf(c.ids.s1).filter((n) => n.title.startsWith('הגיע זמן התחקיר השבועי'));
    runAutomation();
    expect(reminders()).toHaveLength(0);
    clock.set(new Date(at('2026-10-01', '12:05')));
    runAutomation();
    runAutomation();
    expect(reminders()).toHaveLength(1);
    expect(reminders()[0].link).toBe(`/debriefs?new=weekly&week=${w}`);
    // and on the commander's dashboard, until it is held
    const attn = () => (c.cmd.get('/api/dashboard') as Promise<{ body: { attention: { kind: string; weekId?: number; link?: string }[] } }>);
    expect((await attn()).body.attention.find((a) => a.kind === 'debrief')).toMatchObject({ weekId: w, link: `/debriefs?new=weekly&week=${w}` });
    await c.s1.post('/api/debriefs', { kind: 'weekly', weekId: w, title: 'תחקיר שבועי - מטווחים', occurredOn: '2026-10-01' });
    expect((await attn()).body.attention.some((a) => a.kind === 'debrief')).toBe(false);
  });

  it('asks the lead to decide about each earlier-cycle lesson: a task, applied or not relevant', async () => {
    const old = await week('שבוע ניווט', '2026-09-20', '2026-09-24');
    const d = (await c.cmd.post('/api/debriefs', { kind: 'weekly', weekId: old, title: 'תחקיר ניווט', occurredOn: '2026-09-24' })).body.debrief.id;
    const items = async (body: string) => (await c.cmd.post(`/api/debriefs/${d}/items`, { kind: 'lesson', horizon: 'next', body })).body.items;
    await items('מפות יום מראש');
    const all = await items('תרגיל לילה רק אחרי יום');
    const [a, b] = all.map((i: { id: number }) => i.id);

    // the next cycle's navigation week, ten days ahead, led by s2
    const next = await week('שבוע ניווט', '2026-10-11', '2026-10-15');
    await c.cmd.patch(`/api/weeks/${next}`, { leadId: c.ids.s2 });
    runAutomation();
    const asked = notificationsOf(c.ids.s2).filter((n) => n.title.includes('מהמחזור הקודם'));
    expect(asked.map((n) => n.title)).toEqual(['2 לקחים מהמחזור הקודם לשבוע ניווט']);
    expect(asked[0].link).toBe(`/weeks/${next}#prior`);
    expect((await c.cmd.get('/api/dashboard')).body.attention.find((x: { kind: string }) => x.kind === 'lessons')).toMatchObject({ weekId: next, title: 'שבוע ניווט: 2 לקחים מהמחזור הקודם' });

    // someone else's week: not theirs to decide
    expect((await c.s1.post(`/api/lessons/${a}/review`, { weekId: next, decision: 'applied' })).status).toBe(403);
    // the lead: one becomes a task in the week, one is applied
    const res = await c.s2.post(`/api/lessons/${a}/review`, { weekId: next, decision: 'task', task: { title: 'להכין מפות יום מראש', ownerId: c.ids.s3, deadline: at('2026-10-09') } });
    expect(res.status).toBe(200);
    const reviewed = res.body.find((l: { id: number }) => l.id === a).review;
    expect(reviewed).toMatchObject({ decision: 'task', taskTitle: 'להכין מפות יום מראש', decidedByName: 'מפק"צ 2' });
    const task = db().get<{ owner_id: number; week_id: number; description: string }>('SELECT owner_id, week_id, description FROM tasks WHERE id = ?', reviewed.taskId);
    expect(task).toMatchObject({ owner_id: c.ids.s3, week_id: next });
    expect(task!.description).toContain('מפות יום מראש');
    await c.s2.post(`/api/lessons/${b}/review`, { weekId: next, decision: 'applied' });
    expect((await c.cmd.get('/api/dashboard')).body.attention.some((x: { kind: string }) => x.kind === 'lessons')).toBe(false);

    // undo: back to waiting; the task opened stays
    const undone = (await c.s2.post(`/api/lessons/${b}/review`, { weekId: next, decision: null })).body;
    expect(undone.find((l: { id: number }) => l.id === b).review).toBeNull();
    expect(db().get('SELECT 1 FROM tasks WHERE id = ?', reviewed.taskId)).toBeTruthy();
    // the bank itself (no week) carries no decisions
    expect((await c.cmd.get('/api/lessons')).body[0].review).toBeUndefined();
  });

  it('reminds an event owner a week before an event an earlier one left lessons for', async () => {
    const ev = (await c.cmd.post('/api/events', { date: '2026-09-15', startTime: '22:00', title: 'מארס טורקי' })).body.event.id;
    const d = (await c.cmd.post('/api/debriefs', { kind: 'event', eventId: ev, title: 'תחקיר מארס', occurredOn: '2026-09-16' })).body.debrief.id;
    await c.cmd.post(`/api/debriefs/${d}/items`, { kind: 'lesson', horizon: 'next', body: 'נקודת מים כל 4 ק"מ' });
    const far = (await c.cmd.post('/api/events', { date: '2026-10-20', startTime: '22:00', title: 'מארס טורקי', ownerId: c.ids.s3 })).body.event.id;
    const soon = (await c.cmd.post('/api/events', { date: '2026-10-06', startTime: '22:00', title: 'מארס טורקי - מחזור 53', ownerId: c.ids.s3 })).body.event.id;
    runAutomation();
    const asked = notificationsOf(c.ids.s3).filter((n) => n.title.includes('ממופעים קודמים'));
    expect(asked).toHaveLength(1);
    expect(asked[0].link).toBe(`/schedule?date=2026-10-06&event=${soon}`);
    expect(far).toBeTruthy();
  });
});
