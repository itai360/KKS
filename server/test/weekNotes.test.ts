// Notes for the week's weekly debrief, added on the way by any staff member (the bottom bar's "+"): a line to
// keep or to improve, a lesson for the rest of the cycle or for this week in the next one. They wait for the
// debrief while none is open (its lead still opens it, and is still reminded to), go into it once it is, and a
// debrief summed up takes no more.

import { beforeEach, describe, expect, it } from 'vitest';
import type { DebriefDetail, WeekDetail, WeekNoteWeek } from '../../shared/types';
import { db } from '../src/db';
import { weeksWithoutDebrief } from '../src/debriefs';
import { setup, type Ctx } from './helpers';

let c: Ctx;
let prev: number;
let now: number;
beforeEach(async () => {
  c = await setup();
  // NOW is Thursday 1.10.2026: the week on now ends today
  const week = async (name: string, startDate: string, endDate: string) => (await c.cmd.post('/api/weeks', { name, startDate, endDate, leadId: c.ids.s1 })).body.id as number;
  prev = await week('שבוע שטח', '2026-09-20', '2026-09-24');
  now = await week('שבוע ניווט', '2026-09-27', '2026-10-01');
  await week('שבוע מטווחים', '2026-10-04', '2026-10-08');
});

const note = (agent: Ctx['s3'], body: object) => agent.post('/api/debriefs/week-notes', { weekId: now, ...body });

describe('notes for the week\'s debrief on the way', () => {
  it('offers the week on now first, then the one before it', async () => {
    const t = (await c.s3.get('/api/debriefs/week-notes')).body as { weekId: number; weeks: WeekNoteWeek[] };
    expect(t.weekId).toBe(now);
    expect(t.weeks.map((w) => [w.name, w.debriefId, w.summedUp, w.waiting])).toEqual([
      ['שבוע ניווט', null, false, 0],
      ['שבוע שטח', null, false, 0],
    ]);
    expect(prev).toBeTruthy();
  });

  it('wait for the debrief, which its lead still opens - then go into it, each in its place', async () => {
    // s3 is neither the lead nor the debrief's writer
    expect((await note(c.s3, { part: 'sustain', body: 'תדריך בטיחות קצר לפני כל יציאה' })).body).toEqual({ debriefId: null, waiting: 1 });
    await note(c.s3, { part: 'next', body: 'לתת מפות יום מראש' });
    await note(c.s2, { part: 'now', body: 'לבדוק את הקשר לפני תרגיל הלילה', ownerId: c.ids.s2, dueDate: '2026-10-06' });
    expect((await note(c.s2, { part: 'improve', body: 'ההסעה הגיעה באיחור' })).body.waiting).toBe(4);
    // no debrief opened: the week page says what waits, and the reminder to hold it still comes
    expect(((await c.s1.get(`/api/weeks/${now}`)).body as WeekDetail).debriefNotesWaiting).toBe(4);
    expect(db().get("SELECT 1 FROM debriefs WHERE kind = 'weekly'")).toBeUndefined();
    expect(weeksWithoutDebrief('2026-10-01').map((w) => w.weekId)).toContain(now);

    // the lead opens the week's debrief: everything that waited is in it
    const d = (await c.s1.post('/api/debriefs', { kind: 'weekly', weekId: now, title: 'תחקיר שבועי - שבוע ניווט', occurredOn: '2026-10-01' })).body as DebriefDetail;
    expect(d.debrief.answers.sustain).toEqual(['תדריך בטיחות קצר לפני כל יציאה']);
    expect(d.debrief.answers.improve).toEqual(['ההסעה הגיעה באיחור']);
    const lessons = d.items.filter((i) => i.kind === 'lesson').map((i) => [i.horizon, i.body, i.ownerName, i.dueDate]);
    expect(lessons).toEqual([
      ['next', 'לתת מפות יום מראש', null, null],
      ['now', 'לבדוק את הקשר לפני תרגיל הלילה', 'מפק"צ 2', '2026-10-06'],
    ]);
    // the lesson for the next cycle is kept for this very week
    expect(d.items.find((i) => i.horizon === 'next')!.target).toContain('שבוע ניווט');
    expect(db().get<{ n: number }>('SELECT count(*) AS n FROM debrief_contributions')!.n).toBe(0);
  });

  it('go straight into the debrief once it is open - two at once both kept - and a summed-up one takes no more', async () => {
    const d = (await c.s1.post('/api/debriefs', { kind: 'weekly', weekId: now, title: 'תחקיר שבועי - שבוע ניווט', occurredOn: '2026-10-01' })).body as DebriefDetail;
    // the form keeps an empty line at the end to type into
    await c.s1.patch(`/api/debriefs/${d.debrief.id}`, { answers: { improve: ['ההסעה הגיעה באיחור', ''] } });
    const [a, b] = await Promise.all([note(c.s3, { part: 'improve', body: 'לא היו מים בנקודה' }), note(c.s2, { part: 'improve', body: 'התדריך התחיל באיחור' })]);
    expect(a.body).toEqual({ debriefId: d.debrief.id, waiting: 0 });
    expect(b.status).toBe(200);
    const after = (await c.s1.get(`/api/debriefs/${d.debrief.id}`)).body as DebriefDetail;
    expect([...(after.debrief.answers.improve as string[])].sort()).toEqual(['ההסעה הגיעה באיחור', 'התדריך התחיל באיחור', 'לא היו מים בנקודה'].sort());

    // summed up: no more
    db().run("UPDATE debriefs SET status = 'final' WHERE id = ?", d.debrief.id);
    const late = await note(c.s3, { part: 'sustain', body: 'מאוחר מדי' });
    expect(late.status).toBe(400);
    expect(late.body.error).toContain('כבר סוכם');
    expect(((await c.s3.get('/api/debriefs/week-notes')).body as { weekId: number; weeks: WeekNoteWeek[] }).weeks[0]).toMatchObject({ id: now, summedUp: true });
  });

  it('asks for something written, and an owner who is still on the staff', async () => {
    expect((await note(c.s3, { part: 'sustain', body: '   ' })).status).toBe(400);
    expect((await note(c.s3, { part: 'somewhere', body: 'x' })).status).toBe(400);
    db().run('UPDATE users SET active = 0 WHERE id = ?', c.ids.s2);
    expect((await note(c.s3, { part: 'now', body: 'x', ownerId: c.ids.s2 })).status).toBe(400);
  });
});
