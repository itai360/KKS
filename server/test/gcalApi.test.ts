// The calendar in the shape of the Google Calendar API v3 (/api/calendar/v3).
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../src/db';
import { setup, type Ctx } from './helpers';

let c: Ctx;
beforeEach(async () => {
  c = await setup();
});

const V3 = '/api/calendar/v3';
type GEvent = { id: string; summary: string; start: { date?: string; dateTime?: string }; end: { date?: string; dateTime?: string }; recurrence?: string[]; recurringEventId?: string; attendees?: { id: string; responseStatus: string; self?: boolean }[]; reminders: { useDefault: boolean; overrides?: { minutes: number }[] }; colorId?: string; status: string };
const items = async (who: Ctx['cmd'], cal: string, q: string) => (await who.get(`${V3}/calendars/${cal}/events?${q}`)).body.items as GEvent[];

describe('the Google Calendar API, v3', () => {
  it('colors and the calendar list, as Google gives them', async () => {
    const colors = (await c.cmd.get(`${V3}/colors`)).body;
    expect(colors.kind).toBe('calendar#colors');
    expect(Object.keys(colors.event)).toEqual(['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11']);
    expect(colors.event['11'].background).toBe('#d50000'); // Tomato
    expect(colors.event['7'].background).toBe('#039be5'); // Peacock
    expect(Object.keys(colors.calendar)).toHaveLength(24);
    const list = (await c.cmd.get(`${V3}/users/me/calendarList`)).body;
    expect(list.items.map((x: { id: string }) => x.id)).toEqual(['course', 'primary']);
    expect(list.items[1].primary).toBe(true);
  });

  it('inserts an event Google\'s way, and the calendar shows it', async () => {
    db().run("UPDATE users SET email = 'staff.two@example.com' WHERE id = ?", c.ids.s2);
    const r = await c.cmd.post(`${V3}/calendars/course/events`, {
      summary: 'ישיבת תכנון',
      location: 'חדר מפקד',
      start: { dateTime: '2026-10-07T09:00:00+03:00' },
      end: { dateTime: '2026-10-07T10:30:00+03:00' },
      recurrence: ['RRULE:FREQ=WEEKLY;COUNT=3'],
      attendees: [{ id: String(c.ids.s1) }, { email: 'staff.two@example.com', optional: true }],
      reminders: { useDefault: false, overrides: [{ method: 'popup', minutes: 15 }] },
      colorId: '11',
    });
    expect(r.status).toBe(200);
    const e = r.body as GEvent;
    expect(e.summary).toBe('ישיבת תכנון');
    expect(e.start.dateTime).toBe('2026-10-07T06:00:00.000Z');
    expect(e.end.dateTime).toBe('2026-10-07T07:30:00.000Z');
    expect(e.recurringEventId).toMatch(/^r\d+$/);
    expect(e.attendees?.map((a) => [a.id, a.responseStatus])).toEqual([
      [String(c.ids.s1), 'needsAction'],
      [String(c.ids.s2), 'needsAction'],
    ]);
    expect(e.reminders).toEqual({ useDefault: false, overrides: [{ method: 'popup', minutes: 15 }] });
    expect(e.colorId).toBe('11');
    // KKS's own list has it, in Tomato
    const kks = (await c.cmd.get('/api/events?from=2026-10-01&to=2026-10-31')).body as { title: string; color: string; startTime: string; endTime: string }[];
    expect(kks.map((x) => [x.title, x.color, x.startTime, x.endTime])).toEqual([
      ['ישיבת תכנון', 'red', '09:00', '10:30'],
      ['ישיבת תכנון', 'red', '09:00', '10:30'],
      ['ישיבת תכנון', 'red', '09:00', '10:30'],
    ]);
  });

  it('lists a series as its rule, or spread out day by day', async () => {
    await c.cmd.post(`${V3}/calendars/course/events`, { summary: 'מסדר', start: { dateTime: '2026-10-05T07:30:00+03:00' }, end: { dateTime: '2026-10-05T08:00:00+03:00' }, recurrence: ['RRULE:FREQ=WEEKLY;UNTIL=20261026'] });
    const spread = await items(c.cmd, 'course', 'singleEvents=true&timeMin=2026-10-01T00:00:00Z&timeMax=2026-11-01T00:00:00Z');
    expect(spread.map((e) => e.start.dateTime)).toEqual(['2026-10-05T04:30:00.000Z', '2026-10-12T04:30:00.000Z', '2026-10-19T04:30:00.000Z', '2026-10-26T05:30:00.000Z']);
    const masters = await items(c.cmd, 'course', 'timeMin=2026-10-01T00:00:00Z&timeMax=2026-11-01T00:00:00Z');
    expect(masters).toHaveLength(1);
    expect(masters[0].id).toMatch(/^r\d+$/);
    expect(masters[0].recurrence).toEqual(['RRULE:FREQ=WEEKLY;UNTIL=20261026']);
    // the series' days
    const inst = (await c.cmd.get(`${V3}/calendars/course/events/${masters[0].id}/instances?timeMin=2026-10-01T00:00:00Z&timeMax=2026-11-01T00:00:00Z`)).body.items as GEvent[];
    expect(inst).toHaveLength(4);
    // renaming the series renames every day; one day alone keeps the rest as they were
    await c.cmd.patch(`${V3}/calendars/course/events/${masters[0].id}`, { summary: 'מסדר בוקר' });
    await c.cmd.patch(`${V3}/calendars/course/events/${inst[1].id}`, { summary: 'מסדר מפקד' });
    expect((await items(c.cmd, 'course', 'singleEvents=true&timeMin=2026-10-01T00:00:00Z&timeMax=2026-11-01T00:00:00Z')).map((e) => e.summary)).toEqual(['מסדר בוקר', 'מסדר מפקד', 'מסדר בוקר', 'מסדר בוקר']);
    // the day changed alone is listed besides the rule
    expect((await items(c.cmd, 'course', 'timeMin=2026-10-01T00:00:00Z&timeMax=2026-11-01T00:00:00Z')).map((e) => e.summary).sort()).toEqual(['מסדר בוקר', 'מסדר מפקד']);
  });

  it('an all-day event: its end is the day after the last, both ways', async () => {
    const e = (await c.cmd.post(`${V3}/calendars/course/events`, { summary: 'שבוע שטח', start: { date: '2026-10-25' }, end: { date: '2026-10-28' } })).body as GEvent;
    expect([e.start, e.end]).toEqual([{ date: '2026-10-25' }, { date: '2026-10-28' }]);
    const kks = (await c.cmd.get('/api/events?from=2026-10-01&to=2026-10-31')).body as { allDay: boolean; endDate: string }[];
    expect([kks[0].allDay, kks[0].endDate]).toEqual([true, '2026-10-27']);
  });

  it('a guest answers Google\'s way: the attendee that is "self"', async () => {
    const e = (await c.cmd.post(`${V3}/calendars/course/events`, { summary: 'תדריך', start: { dateTime: '2026-10-07T09:00:00+03:00' }, end: { dateTime: '2026-10-07T10:00:00+03:00' }, attendees: [{ id: String(c.ids.s1) }] })).body as GEvent;
    const r = await c.s1.patch(`${V3}/calendars/primary/events/${e.id}`, { attendees: [{ self: true, responseStatus: 'accepted' }] });
    expect(r.status).toBe(200);
    expect((r.body as GEvent).attendees?.find((a) => a.self)?.responseStatus).toBe('accepted');
    // it is in their own calendar too (invited)
    expect((await items(c.s1, 'primary', 'singleEvents=true&timeMin=2026-10-01T00:00:00Z&timeMax=2026-11-01T00:00:00Z')).map((x) => x.summary)).toEqual(['תדריך']);
  });

  it('deletes to the trash and brings back with status "confirmed"', async () => {
    const e = (await c.cmd.post(`${V3}/calendars/course/events`, { summary: 'מטווח', start: { dateTime: '2026-10-08T09:00:00+03:00' }, end: { dateTime: '2026-10-08T11:00:00+03:00' } })).body as GEvent;
    expect((await c.cmd.del(`${V3}/calendars/course/events/${e.id}`)).status).toBe(204);
    expect(await items(c.cmd, 'course', 'singleEvents=true&timeMin=2026-10-01T00:00:00Z&timeMax=2026-11-01T00:00:00Z')).toEqual([]);
    expect((await c.cmd.patch(`${V3}/calendars/course/events/${e.id}`, { status: 'confirmed' })).status).toBe(200);
    expect((await items(c.cmd, 'course', 'singleEvents=true&timeMin=2026-10-01T00:00:00Z&timeMax=2026-11-01T00:00:00Z')).map((x) => x.summary)).toEqual(['מטווח']);
  });

  it('quickAdd reads a sentence, and move takes an event to one\'s own calendar', async () => {
    const e = (await c.cmd.post(`${V3}/calendars/course/events/quickAdd?text=${encodeURIComponent('מטווח מחר 10-12 @שטח 30')}`)).body as GEvent & { location: string };
    expect([e.summary, e.location, e.start.dateTime, e.end.dateTime]).toEqual(['מטווח', 'שטח 30', '2026-10-02T07:00:00.000Z', '2026-10-02T09:00:00.000Z']);
    await c.cmd.post(`${V3}/calendars/course/events/${e.id}/move?destination=primary`);
    expect(await items(c.s1, 'course', 'singleEvents=true&timeMin=2026-10-01T00:00:00Z&timeMax=2026-11-01T00:00:00Z')).toEqual([]);
    expect((await items(c.cmd, 'primary', 'singleEvents=true&timeMin=2026-10-01T00:00:00Z&timeMax=2026-11-01T00:00:00Z')).map((x) => x.summary)).toEqual(['מטווח']);
  });

  it('freeBusy: when a staff member is busy - what they run or are in, not what is "free" or declined', async () => {
    await c.cmd.post(`${V3}/calendars/course/events`, { summary: 'א', start: { dateTime: '2026-10-07T09:00:00+03:00' }, end: { dateTime: '2026-10-07T10:00:00+03:00' }, extendedProperties: { shared: { kksOwnerId: String(c.ids.s1) } } });
    await c.cmd.post(`${V3}/calendars/course/events`, { summary: 'ב', start: { dateTime: '2026-10-07T12:00:00+03:00' }, end: { dateTime: '2026-10-07T13:00:00+03:00' }, attendees: [{ id: String(c.ids.s1) }], transparency: 'transparent' });
    await c.cmd.post(`${V3}/calendars/course/events`, { summary: 'ג', start: { dateTime: '2026-10-07T15:00:00+03:00' }, end: { dateTime: '2026-10-07T16:00:00+03:00' } });
    const r = await c.cmd.post(`${V3}/freeBusy`, { timeMin: '2026-10-07T00:00:00+03:00', timeMax: '2026-10-08T00:00:00+03:00', items: [{ id: String(c.ids.s1) }] });
    expect(r.body.calendars[String(c.ids.s1)].busy).toEqual([{ start: '2026-10-07T06:00:00.000Z', end: '2026-10-07T07:00:00.000Z' }]);
  });
});
