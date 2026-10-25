import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../src/db';
import { setup, staffMay, type Ctx } from './helpers';

let c: Ctx;
beforeEach(async () => {
  c = await setup();
});

const ev = (body: Record<string, unknown>) => ({ startTime: '08:00', title: 'פעילות', ...body });
const list = async (from: string, to: string) => (await c.cmd.get(`/api/events?from=${from}&to=${to}`)).body as { id: number; title: string; date: string; endDate: string | null; allDay: boolean; color: string | null; seriesId: number | null; startTime: string; endTime: string | null }[];

describe('the calendar: an event all day, over several days, in a colour', () => {
  it('keeps an all-day event of several days, and lists it on every day it runs into', async () => {
    const r = await c.cmd.post('/api/events', ev({ date: '2026-10-25', allDay: true, endDate: '2026-10-27', startTime: '10:00', endTime: '12:00', title: 'שבוע שטח', color: 'green' }));
    expect(r.status).toBe(200);
    const e = r.body.event;
    // all day: no hours of its own
    expect([e.allDay, e.endDate, e.startTime, e.endTime, e.color, e.seriesId]).toEqual([true, '2026-10-27', '00:00', null, 'green', null]);
    // asked for a day in its middle, or its last day: it is there
    expect((await list('2026-10-26', '2026-10-26')).map((x) => x.title)).toEqual(['שבוע שטח']);
    expect((await list('2026-10-27', '2026-10-30')).map((x) => x.title)).toEqual(['שבוע שטח']);
    expect(await list('2026-10-28', '2026-10-30')).toEqual([]);
    // an event as it always was: one day, its hours, no colour
    const plain = (await c.cmd.post('/api/events', ev({ date: '2026-10-26', endTime: '09:00', title: 'מסדר' }))).body.event;
    expect([plain.allDay, plain.endDate, plain.color, plain.startTime, plain.endTime]).toEqual([false, null, null, '08:00', '09:00']);
    // the all-day one first on its day
    expect((await list('2026-10-26', '2026-10-26')).map((x) => x.title)).toEqual(['שבוע שטח', 'מסדר']);
  });

  it('refuses what an event cannot be', async () => {
    const bad = async (body: Record<string, unknown>) => (await c.cmd.post('/api/events', ev(body))).status;
    expect(await bad({ date: '2026-10-25', endDate: '2026-10-27' })).toBe(400); // several days, but with hours
    expect(await bad({ date: '2026-10-25', allDay: true, endDate: '2026-10-24' })).toBe(400); // ends before it starts
    expect(await bad({ date: '2026-10-01', allDay: true, endDate: '2026-12-31' })).toBe(400); // longer than two months
    expect(await bad({ date: '2026-10-25', color: 'magenta' })).toBe(400);
    expect(await bad({ date: '2026-10-25', repeat: { freq: 'weekly', until: '2026-10-01' } })).toBe(400); // repeats until before it starts
  });

  it('moves an event of several days whole, and turns it back into an event with hours', async () => {
    const id = (await c.cmd.post('/api/events', ev({ date: '2026-10-25', allDay: true, endDate: '2026-10-27', title: 'תרגיל' }))).body.event.id;
    // dragged to another day: as long as it was
    let e = (await c.cmd.patch(`/api/events/${id}`, { date: '2026-11-01' })).body.event;
    expect([e.date, e.endDate, e.allDay]).toEqual(['2026-11-01', '2026-11-03', true]);
    // given hours: one day again
    e = (await c.cmd.patch(`/api/events/${id}`, { allDay: false, startTime: '09:00', endTime: '11:00' })).body.event;
    expect([e.date, e.endDate, e.allDay, e.startTime, e.endTime]).toEqual(['2026-11-01', null, false, '09:00', '11:00']);
    // a colour, and back to the course's blue
    expect((await c.cmd.patch(`/api/events/${id}`, { color: 'red' })).body.event.color).toBe('red');
    expect((await c.cmd.patch(`/api/events/${id}`, { color: null })).body.event.color).toBe(null);
  });

  it('writes an all-day event in the personal iCal link as calendar days', async () => {
    await c.cmd.post('/api/events', ev({ date: '2026-10-25', allDay: true, endDate: '2026-10-27', title: 'שבוע שטח' }));
    const feed = (await c.s1.get('/api/calendar/feed')).body;
    const ics = (await request(c.app).get(new URL(feed.url).pathname)).text.replace(/\r\n /g, '');
    expect(ics).toContain('DTSTART;VALUE=DATE:20261025');
    expect(ics).toContain('DTEND;VALUE=DATE:20261028'); // the day after the last, as iCal has it
  });
});

describe('the calendar: a repeating event', () => {
  it('makes each of its days a whole event, together in a series', async () => {
    const r = await c.cmd.post('/api/events', ev({ date: '2026-10-05', startTime: '07:30', endTime: '08:00', title: 'מסדר בוקר', repeat: { freq: 'weekly', until: '2026-10-26' } }));
    expect(r.status).toBe(200);
    const all = await list('2026-10-01', '2026-10-31');
    expect(all.map((x) => x.date)).toEqual(['2026-10-05', '2026-10-12', '2026-10-19', '2026-10-26']);
    const series = all[0].seriesId;
    expect(series).toBeTruthy();
    expect(all.every((x) => x.seriesId === series && x.startTime === '07:30' && x.title === 'מסדר בוקר')).toBe(true);
    // each its own: its own activity log line, one for the series
    const log = db().all<{ text: string }>("SELECT text FROM activity WHERE action = 'event_created'");
    expect(log).toHaveLength(1);
    expect(log[0].text).toContain('4 אירועים');
    // working days: Sunday to Thursday
    await c.cmd.post('/api/events', ev({ date: '2026-11-01', title: 'שיחת בוקר', repeat: { freq: 'weekdays', until: '2026-11-10' } }));
    expect((await list('2026-11-01', '2026-11-10')).filter((x) => x.title === 'שיחת בוקר').map((x) => x.date)).toEqual(['2026-11-01', '2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-08', '2026-11-09', '2026-11-10']);
  });

  it('changes one event of a series, it and the later ones, or all of it', async () => {
    await c.cmd.post('/api/events', ev({ date: '2026-10-05', startTime: '07:30', title: 'מסדר', repeat: { freq: 'weekly', until: '2026-10-26' } }));
    const [a, b, , d] = await list('2026-10-01', '2026-10-31');
    // one: only it
    await c.cmd.patch(`/api/events/${a.id}`, { title: 'מסדר פתיחה' });
    expect((await list('2026-10-01', '2026-10-31')).map((x) => x.title)).toEqual(['מסדר פתיחה', 'מסדר', 'מסדר', 'מסדר']);
    // it and the later ones: a new hour, and a day later - each of them
    const r = await c.cmd.patch(`/api/events/${b.id}`, { startTime: '07:00', date: '2026-10-13', scope: 'following' });
    expect(r.status).toBe(200);
    expect((await list('2026-10-01', '2026-10-31')).map((x) => `${x.date} ${x.startTime}`)).toEqual(['2026-10-05 07:30', '2026-10-13 07:00', '2026-10-20 07:00', '2026-10-27 07:00']);
    // all of it: a place for every one
    await c.cmd.patch(`/api/events/${d.id}`, { location: 'רחבת המסדרים', scope: 'all' });
    expect((await list('2026-10-01', '2026-10-31')).every((x) => (x as unknown as { location: string }).location === 'רחבת המסדרים')).toBe(true);
  });

  it('deletes one event of a series, it and the later ones, or all of it', async () => {
    await c.cmd.post('/api/events', ev({ date: '2026-10-05', title: 'מסדר', repeat: { freq: 'weekly', until: '2026-11-02' } }));
    const ids = (await list('2026-10-01', '2026-11-30')).map((x) => x.id);
    expect(ids).toHaveLength(5);
    expect((await c.cmd.del(`/api/events/${ids[1]}`)).body.deleted).toBe(1);
    expect((await c.cmd.del(`/api/events/${ids[3]}?scope=following`)).body.deleted).toBe(2);
    expect((await list('2026-10-01', '2026-11-30')).map((x) => x.id)).toEqual([ids[0], ids[2]]);
    expect((await c.cmd.del(`/api/events/${ids[0]}?scope=all`)).body.deleted).toBe(2);
    expect(await list('2026-10-01', '2026-11-30')).toEqual([]);
  });

  it('lets a week lead repeat an event only inside their week, unless it is theirs to run', async () => {
    await staffMay(c, { schedule: false });
    await c.cmd.post('/api/weeks', { name: 'שבוע שטח', startDate: '2026-10-04', endDate: '2026-10-08', leadId: c.ids.s1 });
    // inside their week: yes
    expect((await c.s1.post('/api/events', ev({ date: '2026-10-04', title: 'ריצת בוקר', repeat: { freq: 'daily', until: '2026-10-08' } }))).status).toBe(200);
    // out of it, for someone else to run: no
    expect((await c.s1.post('/api/events', ev({ date: '2026-10-04', title: 'שיעור', ownerId: c.ids.s2, repeat: { freq: 'weekly', until: '2026-10-25' } }))).status).toBe(403);
    // out of it, theirs to run: yes
    expect((await c.s1.post('/api/events', ev({ date: '2026-10-04', title: 'שיעור שלי', ownerId: c.ids.s1, repeat: { freq: 'weekly', until: '2026-10-25' } }))).status).toBe(200);
    // and a series another runs cannot be changed all at once by one who may not change each of them
    const theirs = (await list('2026-10-01', '2026-10-31')).find((x) => x.title === 'שיעור שלי')!;
    expect((await c.s2.patch(`/api/events/${theirs.id}`, { title: 'אחר', scope: 'all' })).status).toBe(403);
  });
});
