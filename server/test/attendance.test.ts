import { beforeEach, describe, expect, it } from 'vitest';
import { runAutomation } from '../src/automation';
import { clock } from '../src/core';
import { at, notificationsOf, setup, type Ctx } from './helpers';

let c: Ctx;
beforeEach(async () => {
  c = await setup();
});

async function team(name: string, commanderId: number) {
  return (await c.cmd.post('/api/teams', { name, commanderId })).body.find((t: { name: string }) => t.name === name).id as number;
}
async function cadet(firstName: string, teamId: number) {
  const r = await c.cmd.post('/api/cadets', { firstName, lastName: 'כהן', teamId });
  return (r.body.cadet?.id ?? r.body.id) as number;
}

describe('daily roll call', () => {
  it('marks a team in one go, counts the day, and keeps each cadet\'s absences', async () => {
    const a = await team('צוות א', c.ids.s1);
    const b = await team('צוות ב', c.ids.s2);
    const [x, y, z] = [await cadet('אבי', a), await cadet('בני', a), await cadet('גדי', b)];
    const empty = (await c.s3.get('/api/attendance?date=2026-10-01')).body;
    expect(empty.counts).toMatchObject({ total: 3, unmarked: 3 });

    // s1 marks their team: two in one request, one of them home with a reason
    const res = await c.s1.put('/api/attendance', { date: '2026-10-01', entries: [{ cadetId: x, status: 'present', note: 'ignored' }, { cadetId: y, status: 'leave', note: 'אירוע משפחתי' }] });
    expect(res.status).toBe(200);
    expect(res.body.counts).toMatchObject({ present: 1, leave: 1, unmarked: 1 });
    const ty = res.body.entries.find((e: { cadetId: number }) => e.cadetId === y);
    expect(ty).toMatchObject({ status: 'leave', note: 'אירוע משפחתי', markedByName: 'מפק"צ 1' });
    expect(res.body.entries.find((e: { cadetId: number }) => e.cadetId === x).note).toBe('');
    expect(res.body.teams).toEqual([
      expect.objectContaining({ name: 'צוות א', total: 2, marked: 2, present: 1, commanderName: 'מפק"צ 1' }),
      expect.objectContaining({ name: 'צוות ב', total: 1, marked: 0 }),
    ]);
    // a correction, then an undo
    await c.s1.put('/api/attendance', { date: '2026-10-01', entries: [{ cadetId: y, status: 'sick' }] });
    await c.s2.put('/api/attendance', { date: '2026-10-01', entries: [{ cadetId: z, status: 'late' }] });
    await c.s2.put('/api/attendance', { date: '2026-10-01', entries: [{ cadetId: z, status: null }] });
    const day = (await c.cmd.get('/api/attendance?date=2026-10-01')).body;
    expect(day.counts).toMatchObject({ present: 1, sick: 1, leave: 0, late: 0, unmarked: 1 });
    // one team only
    expect((await c.cmd.get(`/api/attendance?date=2026-10-01&team=${b}`)).body.entries).toHaveLength(1);
    // the commander's dashboard: the day in one line
    expect((await c.cmd.get('/api/dashboard')).body.roll).toMatchObject({ line: '1/3 · 1 גימלים · 1 לא סומנו', teamsMissing: ['צוות ב'] });
    // y's history: the day away, counted
    const hist = (await c.cmd.get(`/api/cadets/${y}/attendance`)).body;
    expect(hist.days).toEqual([{ date: '2026-10-01', status: 'sick', note: '' }]);
    expect(hist.counts).toEqual({ sick: 1 });
    // far in the future: refused
    expect((await c.s1.put('/api/attendance', { date: '2026-12-01', entries: [{ cadetId: x, status: 'leave' }] })).status).toBe(400);
  });

  it('reminds a team commander on a course day when nobody in the team is marked by 08:30', async () => {
    const a = await team('צוות א', c.ids.s1);
    const b = await team('צוות ב', c.ids.s2);
    const x = await cadet('אבי', a);
    await cadet('גדי', b);
    await c.cmd.post('/api/events', { date: '2026-10-02', startTime: '08:00', title: 'מסדר בוקר' });
    await c.s1.put('/api/attendance', { date: '2026-10-02', entries: [{ cadetId: x, status: 'present' }] });
    clock.set(new Date(at('2026-10-02', '08:31')));
    runAutomation();
    runAutomation();
    const rem = (uid: number) => notificationsOf(uid).filter((n) => n.type === 'attendance');
    expect(rem(c.ids.s1)).toHaveLength(0);
    expect(rem(c.ids.s2)).toEqual([expect.objectContaining({ title: 'מצבת צוות ב להיום עוד לא סומנה' })]);
    clock.set(new Date(at('2026-10-02', '10:05')));
    runAutomation();
    expect(rem(c.ids.cmd)).toEqual([expect.objectContaining({ title: 'מצבה: צוות ב עוד לא דיווחו' })]);
    // a day with nothing on the schedule: no reminders
    clock.set(new Date(at('2026-10-03', '09:00')));
    runAutomation();
    expect(rem(c.ids.s2)).toHaveLength(1);
  });
});
