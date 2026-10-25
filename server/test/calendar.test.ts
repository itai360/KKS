// Google Calendar: the schedule as a feed Google subscribes to, and Google
// calendars shown in the schedule.

import request from 'supertest';
import ICAL from 'ical.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { calendarReadsSettled, normalizeCalendarUrl, setCalendarFetcher, setCalendarWaits, trimCalendar } from '../src/calendar';
import { db } from '../src/db';
import { at, newTask, setup, type Ctx } from './helpers';

let c: Ctx;
beforeEach(async () => {
  c = await setup();
});
afterEach(() => setCalendarFetcher(async () => ''));

// shaped like a Google Calendar export
const GOOGLE_ICS = [
  'BEGIN:VCALENDAR',
  'PRODID:-//Google Inc//Google Calendar 70.9054//EN',
  'VERSION:2.0',
  'CALSCALE:GREGORIAN',
  'METHOD:PUBLISH',
  'X-WR-CALNAME:סגל',
  'X-WR-TIMEZONE:Asia/Jerusalem',
  'BEGIN:VTIMEZONE',
  'TZID:Asia/Jerusalem',
  'X-LIC-LOCATION:Asia/Jerusalem',
  'BEGIN:DAYLIGHT',
  'TZOFFSETFROM:+0200',
  'TZOFFSETTO:+0300',
  'TZNAME:IDT',
  'DTSTART:19700327T020000',
  'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1FR',
  'END:DAYLIGHT',
  'BEGIN:STANDARD',
  'TZOFFSETFROM:+0300',
  'TZOFFSETTO:+0200',
  'TZNAME:IST',
  'DTSTART:19701025T020000',
  'RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU',
  'END:STANDARD',
  'END:VTIMEZONE',
  // every Monday at 9, except 5.10; the 12.10 meeting moved to Tuesday 11:00
  'BEGIN:VEVENT',
  'DTSTART;TZID=Asia/Jerusalem:20260921T090000',
  'DTEND;TZID=Asia/Jerusalem:20260921T100000',
  'RRULE:FREQ=WEEKLY;BYDAY=MO',
  'EXDATE;TZID=Asia/Jerusalem:20261005T090000',
  'DTSTAMP:20260901T000000Z',
  'UID:weekly-1@google.com',
  'SUMMARY:ישיבת סגל שבועית',
  'LOCATION:חדר מפקד',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'DTSTART;TZID=Asia/Jerusalem:20261013T110000',
  'DTEND;TZID=Asia/Jerusalem:20261013T120000',
  'DTSTAMP:20260901T000000Z',
  'UID:weekly-1@google.com',
  'RECURRENCE-ID;TZID=Asia/Jerusalem:20261012T090000',
  'SUMMARY:ישיבת סגל (נדחתה)',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'DTSTART;VALUE=DATE:20261002',
  'DTEND;VALUE=DATE:20261004',
  'DTSTAMP:20260901T000000Z',
  'UID:allday-1@google.com',
  'SUMMARY:סוף שבוע ארוך',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'DTSTART:20261001T150000Z',
  'DTEND:20261001T160000Z',
  'DTSTAMP:20260901T000000Z',
  'UID:utc-1@google.com',
  'SUMMARY:שיחה עם הגדוד',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'DTSTART;TZID=Asia/Jerusalem:20261001T080000',
  'DTEND;TZID=Asia/Jerusalem:20261001T090000',
  'DTSTAMP:20260901T000000Z',
  'UID:cancelled-1@google.com',
  'STATUS:CANCELLED',
  'SUMMARY:בוטל',
  'END:VEVENT',
  'END:VCALENDAR',
].join('\r\n');

const GOOGLE_URL = 'https://calendar.google.com/calendar/ical/abc%40group.calendar.google.com/private-123/basic.ics';

describe('the schedule in Google Calendar', () => {
  it('gives each user a private link that serves the schedule in iCal format', async () => {
    const ev = await c.cmd.post('/api/events', { date: '2026-10-02', startTime: '08:00', endTime: '09:30', title: 'מטווח, יום א׳; ירי לילה', location: 'מטווח 3', notes: 'להביא אטמי אוזניים\nולא לשכוח מים' });
    expect(ev.status).toBe(200);
    const feed = (await c.s1.get('/api/calendar/feed')).body;
    expect(feed.url).toMatch(/\/api\/ics\/[A-Za-z0-9_-]{20,}\.ics$/);
    expect(feed.googleUrl).toBe(`https://calendar.google.com/calendar/r?cid=${encodeURIComponent(feed.url.replace(/^https?:/, 'webcal:'))}`);
    expect(new URL((await c.s1.get('/api/calendar/feed')).body.url).pathname).toBe(new URL(feed.url).pathname); // the same link every time

    const path = new URL(feed.url).pathname;
    const res = await request(c.app).get(path); // no session: Google fetches it on its own
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/^text\/calendar/);
    const ics: string = res.text;
    expect(ics.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true);
    const unfolded = ics.replace(/\r\n /g, '');
    expect(unfolded).toContain('SUMMARY:מטווח\\, יום א׳\\; ירי לילה');
    expect(unfolded).toContain('DTSTART:20261002T050000Z'); // 08:00 in Israel summer time
    expect(unfolded).toContain('DTEND:20261002T063000Z');
    expect(unfolded).toContain('LOCATION:מטווח 3');
    expect(unfolded).toContain('להביא אטמי אוזניים\\nולא לשכוח מים');
    expect(unfolded).toContain(`UID:kks-event-${ev.body.event.id}@`);
    for (const line of ics.split('\r\n')) expect(Buffer.byteLength(line)).toBeLessThanOrEqual(75);
  });

  it("carries one's own open tasks at their deadline - not another's, and not one done", async () => {
    const mine = await newTask(c.cmd, { title: 'הזמנת הסעות, לשבוע ניווטים', ownerIds: [c.ids.s1], deadline: at('2026-10-05', '18:00') });
    const shared = await newTask(c.cmd, { title: 'תיאום מטווח', ownerIds: [c.ids.s2, c.ids.s1], assignMode: 'shared', deadline: at('2026-10-06', '12:00') });
    await newTask(c.cmd, { title: 'משימה של אחר', ownerIds: [c.ids.s2], deadline: at('2026-10-05', '18:00') });
    const done = await newTask(c.cmd, { title: 'כבר הושלמה', ownerIds: [c.ids.s1], deadline: at('2026-10-04', '18:00') });
    await c.s1.post(`/api/tasks/${done}/transition`, { action: 'complete' });
    const ics = (await request(c.app).get(new URL((await c.s1.get('/api/calendar/feed')).body.url).pathname)).text.replace(/\r\n /g, '');
    expect(ics).toContain('X-WR-CALNAME:');
    expect(ics).toContain('SUMMARY:משימה: הזמנת הסעות\\, לשבוע ניווטים');
    expect(ics).toContain(`UID:kks-task-${mine}@`);
    expect(ics).toContain('DTSTART:20261005T143000Z'); // half an hour ending at 18:00 in Israel
    expect(ics).toContain('DTEND:20261005T150000Z');
    expect(ics).toContain(`/tasks/${mine}`);
    expect(ics).toContain(`UID:kks-task-${shared}@`); // one they take part in
    expect(ics).not.toContain('משימה של אחר');
    expect(ics).not.toContain('כבר הושלמה');
  });

  it('a new link replaces the old one, and a deactivated user loses it', async () => {
    const old = new URL((await c.s1.get('/api/calendar/feed')).body.url).pathname;
    const fresh = new URL((await c.s1.post('/api/calendar/feed/rotate')).body.url).pathname;
    expect(fresh).not.toBe(old);
    expect((await request(c.app).get(old)).status).toBe(404);
    expect((await request(c.app).get(fresh)).status).toBe(200);
    db().run('UPDATE users SET active = 0 WHERE id = ?', c.ids.s1);
    expect((await request(c.app).get(fresh)).status).toBe(404);
    expect((await request(c.app).get('/api/ics/not-a-real-token-at-all.ics')).status).toBe(404);
  });
});

describe('Google calendars in the schedule', () => {
  it('shows repeating, moved, all-day and UTC events in the course time zone', async () => {
    const asked: string[] = [];
    setCalendarFetcher(async (url) => {
      asked.push(url);
      return GOOGLE_ICS;
    });
    expect((await c.s1.post('/api/calendar/sources', { name: 'יומן סגל', url: GOOGLE_URL })).status).toBe(403);
    const added = await c.cmd.post('/api/calendar/sources', { name: 'יומן סגל', url: GOOGLE_URL.replace('https://', 'webcal://') });
    expect(added.status).toBe(200);
    // the secret address stays on the server - the commander's browser included
    expect(added.body).toEqual([{ id: expect.any(Number), name: 'יומן סגל', calendarName: 'סגל', color: null, error: null, loading: false }]);
    expect(asked).toEqual([GOOGLE_URL]);

    const events = (await c.s1.get('/api/calendar/external?from=2026-09-28&to=2026-10-18')).body;
    expect(events.map((e: { date: string; startTime: string | null; endTime: string | null; title: string }) => [e.date, e.startTime, e.endTime, e.title])).toEqual([
      ['2026-09-28', '09:00', '10:00', 'ישיבת סגל שבועית'],
      ['2026-10-01', '18:00', '19:00', 'שיחה עם הגדוד'],
      ['2026-10-02', null, null, 'סוף שבוע ארוך'],
      ['2026-10-03', null, null, 'סוף שבוע ארוך'],
      ['2026-10-13', '11:00', '12:00', 'ישיבת סגל (נדחתה)'],
    ]);
    expect(events[0]).toMatchObject({ sourceName: 'יומן סגל', location: 'חדר מפקד' });

    // across the end of summer time (25.10) the meeting stays at 9:00 local time
    const later = (await c.s1.get('/api/calendar/external?from=2026-10-19&to=2026-10-31')).body;
    expect(later.map((e: { date: string; startTime: string }) => [e.date, e.startTime])).toEqual([
      ['2026-10-19', '09:00'],
      ['2026-10-26', '09:00'],
    ]);
    expect(asked).toHaveLength(1); // fetched once, kept for a few minutes

    // staff see which calendars are shown, not their secret addresses
    expect((await c.s1.get('/api/calendar/sources')).body).toEqual([{ id: added.body[0].id, name: 'יומן סגל', calendarName: 'סגל', color: null, error: null, loading: false }]);
    expect(JSON.stringify((await c.cmd.get('/api/calendar/sources')).body)).not.toContain('private-');

    expect((await c.cmd.del(`/api/calendar/sources/${added.body[0].id}`)).body).toEqual([]);
    expect((await c.s1.get('/api/calendar/external?from=2026-09-28&to=2026-10-18')).body).toEqual([]);
  });

  it('a Google link that only shows a calendar leads to its public iCal address', () => {
    const ical = (id: string) => `https://calendar.google.com/calendar/ical/${encodeURIComponent(id)}/public/basic.ics`;
    // the embed link, as Google gives it to put a calendar in a site
    expect(normalizeCalendarUrl('https://calendar.google.com/calendar/embed?src=team%40group.calendar.google.com&ctz=Asia%2FJerusalem')).toBe(ical('team@group.calendar.google.com'));
    expect(normalizeCalendarUrl('https://www.google.com/calendar/embed?src=someone%40gmail.com')).toBe(ical('someone@gmail.com'));
    // "add this calendar": the id as it is or in base64, or another calendar's address
    const b64 = Buffer.from('other@group.calendar.google.com').toString('base64url');
    expect(normalizeCalendarUrl(`https://calendar.google.com/calendar/u/0?cid=${b64}`)).toBe(ical('other@group.calendar.google.com'));
    expect(normalizeCalendarUrl('https://calendar.google.com/calendar/r?cid=other%40group.calendar.google.com')).toBe(ical('other@group.calendar.google.com'));
    expect(normalizeCalendarUrl(`https://calendar.google.com/calendar/r?cid=${encodeURIComponent('webcal://example.com/team.ics')}`)).toBe('https://example.com/team.ics');
    // iCal addresses stay as they are
    expect(normalizeCalendarUrl(GOOGLE_URL)).toBe(GOOGLE_URL);
    expect(normalizeCalendarUrl(ical('team@group.calendar.google.com'))).toBe(ical('team@group.calendar.google.com'));
    // a page of Google Calendar is not a calendar, and one link of several calendars is connected one by one
    expect(() => normalizeCalendarUrl('https://calendar.google.com/calendar/u/0/r/week')).toThrow(/דף של Google Calendar/);
    expect(() => normalizeCalendarUrl('https://calendar.google.com/calendar/embed?src=a%40gmail.com&src=b%40gmail.com')).toThrow(/כמה יומנים/);
    expect(() => normalizeCalendarUrl(`https://calendar.google.com/calendar/r?cid=${encodeURIComponent('webcal://localhost/x.ics')}`)).toThrow(/ציבורית/);
  });

  it('says what to do when Google will not give a calendar', async () => {
    const asked: string[] = [];
    setCalendarFetcher(async (url) => {
      asked.push(url);
      throw Object.assign(new Error('not found'), { status: 404 });
    });
    const embed = await c.cmd.post('/api/calendar/sources', { name: 'x', url: 'https://calendar.google.com/calendar/embed?src=closed%40group.calendar.google.com' });
    expect(embed.status).toBe(400);
    expect(embed.body.error).toMatch(/לא ציבורי.*כתובת סודית בפורמט iCal/);
    expect(asked).toEqual(['https://calendar.google.com/calendar/ical/closed%40group.calendar.google.com/public/basic.ics']);
    const reset = await c.cmd.post('/api/calendar/sources', { name: 'x', url: GOOGLE_URL });
    expect(reset.status).toBe(400);
    expect(reset.body.error).toMatch(/אופסה/);
    expect((await c.cmd.get('/api/calendar/sources')).body).toEqual([]);
  });

  it('draws a connected calendar in the colour the commander chose for it, as it is in Google', async () => {
    setCalendarFetcher(async () => GOOGLE_ICS);
    const added = await c.cmd.post('/api/calendar/sources', { name: 'יומן סגל', url: GOOGLE_URL, color: 'tomato' });
    expect(added.status).toBe(200);
    const id = added.body[0].id;
    expect(added.body[0].color).toBe('tomato');
    // the commander changes it, for everyone
    const changed = await c.cmd.patch(`/api/calendar/sources/${id}`, { color: 'basil' });
    expect(changed.status).toBe(200);
    expect(changed.body[0].color).toBe('basil');
    expect((await c.s1.get('/api/calendar/sources')).body[0].color).toBe('basil');
    // back to its colour by place
    expect((await c.cmd.patch(`/api/calendar/sources/${id}`, { color: null })).body[0].color).toBeNull();
    // only Google's colours, only the commander, only a calendar that is there
    expect((await c.cmd.patch(`/api/calendar/sources/${id}`, { color: 'neon' })).status).toBe(400);
    expect((await c.s1.patch(`/api/calendar/sources/${id}`, { color: 'basil' })).status).toBe(403);
    expect((await c.cmd.patch('/api/calendar/sources/9999', { color: 'basil' })).status).toBe(404);
  });

  it('a calendar connected without a name takes the one it has in Google', async () => {
    setCalendarFetcher(async () => GOOGLE_ICS);
    const added = await c.cmd.post('/api/calendar/sources', { name: '', url: GOOGLE_URL });
    expect(added.status).toBe(200);
    expect(added.body[0]).toMatchObject({ name: 'סגל', calendarName: 'סגל' });
  });

  it('refuses local addresses and files that are not calendars', async () => {
    setCalendarFetcher(async () => '<html>not a calendar</html>');
    for (const url of ['http://localhost:3000/x.ics', 'https://127.0.0.1/x.ics', 'https://intranet/x.ics', 'ftp://example.com/x.ics', 'not a url']) {
      const r = await c.cmd.post('/api/calendar/sources', { name: 'x', url });
      expect(r.status, url).toBe(400);
    }
    const r = await c.cmd.post('/api/calendar/sources', { name: 'x', url: 'https://example.com/page' });
    expect(r.status).toBe(400);
    expect(r.body.error).toBe('הקובץ בכתובת הזו אינו יומן בפורמט iCal');
    expect((await c.cmd.get('/api/calendar/sources')).body).toEqual([]);
  });

  it('keeps showing the last copy when Google cannot be reached', async () => {
    let up = true;
    setCalendarFetcher(async () => {
      if (!up) throw new Error('network down');
      return GOOGLE_ICS;
    });
    const added = await c.cmd.post('/api/calendar/sources', { name: 'יומן סגל', url: GOOGLE_URL });
    expect(added.status).toBe(200);
    up = false;
    // the copy is refreshed after ten minutes
    const realNow = Date.now;
    Date.now = () => realNow() + 11 * 60_000;
    try {
      const events = (await c.s1.get('/api/calendar/external?from=2026-09-28&to=2026-10-04')).body;
      expect(events.length).toBeGreaterThan(0);
      expect((await c.cmd.get('/api/calendar/sources')).body[0].error).toBe('לא ניתן לקרוא את היומן כרגע');
    } finally {
      Date.now = realNow;
    }
  });
});

const weeksIcs = (week1: { start: string; end: string; name: string }) =>
  [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Google Inc//Google Calendar 70.9054//EN',
    'X-WR-TIMEZONE:Asia/Jerusalem',
    // a week as an all-day event from Sunday to Thursday (the end date is not included)
    'BEGIN:VEVENT',
    `DTSTART;VALUE=DATE:${week1.start}`,
    `DTEND;VALUE=DATE:${week1.end}`,
    'UID:week-1@google.com',
    `SUMMARY:${week1.name}`,
    'END:VEVENT',
    'BEGIN:VEVENT',
    'DTSTART;VALUE=DATE:20261011',
    'DTEND;VALUE=DATE:20261016',
    'UID:week-2@google.com',
    'SUMMARY:שבוע 2 - שבוע שטח',
    'END:VEVENT',
    // three days inside week 2: not a week of its own
    'BEGIN:VEVENT',
    'DTSTART;VALUE=DATE:20261012',
    'DTEND;VALUE=DATE:20261015',
    'UID:exercise@google.com',
    'SUMMARY:תרגיל פלוגתי',
    'END:VEVENT',
    // a one-day marker: the week that starts that day
    'BEGIN:VEVENT',
    'DTSTART;VALUE=DATE:20261018',
    'DTEND;VALUE=DATE:20261019',
    'UID:week-3@google.com',
    'SUMMARY:שבוע 3',
    'END:VEVENT',
    // not weeks: a one-hour summary, the holiday, a repeating meeting, the whole course
    'BEGIN:VEVENT',
    'DTSTART;TZID=Asia/Jerusalem:20261008T140000',
    'DTEND;TZID=Asia/Jerusalem:20261008T150000',
    'UID:summary@google.com',
    'SUMMARY:סיכום שבוע',
    'END:VEVENT',
    'BEGIN:VEVENT',
    'DTSTART;VALUE=DATE:20270611',
    'DTEND;VALUE=DATE:20270612',
    'UID:shavuot@google.com',
    'SUMMARY:שבועות',
    'END:VEVENT',
    'BEGIN:VEVENT',
    'DTSTART;TZID=Asia/Jerusalem:20261004T090000',
    'DTEND;TZID=Asia/Jerusalem:20261004T100000',
    'RRULE:FREQ=WEEKLY;BYDAY=SU',
    'UID:meeting@google.com',
    'SUMMARY:שבוע - ישיבת פתיחה',
    'END:VEVENT',
    'BEGIN:VEVENT',
    'DTSTART;VALUE=DATE:20261004',
    'DTEND;VALUE=DATE:20261204',
    'UID:course@google.com',
    'SUMMARY:קורס קק"ס',
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');

describe('course weeks from a Google calendar', () => {
  it('finds the weeks, previews them, and creates or updates them linked to their events', async () => {
    let ics = weeksIcs({ start: '20261004', end: '20261009', name: 'שבוע 1 - הכרות' });
    setCalendarFetcher(async () => ics);
    // a week the commander already made by hand, starting the same day as week 2
    const manual = (await c.cmd.post('/api/weeks', { name: 'שבוע שני', startDate: '2026-10-11', endDate: '2026-10-17' })).body.id;

    expect((await c.s1.post('/api/weeks/calendar/preview', { url: GOOGLE_URL })).status).toBe(403);
    const preview = (await c.cmd.post('/api/weeks/calendar/preview', { url: GOOGLE_URL })).body;
    expect(preview.weeks.map((w: { name: string; startDate: string; endDate: string; number: number | null; action: string }) => [w.name, w.startDate, w.endDate, w.number, w.action])).toEqual([
      ['שבוע 1 - הכרות', '2026-10-04', '2026-10-08', 1, 'create'],
      ['שבוע 2 - שבוע שטח', '2026-10-11', '2026-10-15', 2, 'update'],
      ['שבוע 3', '2026-10-18', '2026-10-24', 3, 'create'],
    ]);
    expect(preview.weeks[1]).toMatchObject({ weekId: manual, changes: ['שם: שבוע שני ← שבוע 2 - שבוע שטח', 'תאריכים'] });
    expect(preview.ignored).toBe(5);

    const applied = await c.cmd.post('/api/weeks/calendar/apply', { url: GOOGLE_URL, items: preview.weeks });
    expect(applied.status).toBe(200);
    expect(applied.body.map((w: { number: number; name: string; startDate: string; endDate: string }) => [w.number, w.name, w.startDate, w.endDate])).toEqual([
      [1, 'שבוע 1 - הכרות', '2026-10-04', '2026-10-08'],
      [2, 'שבוע 2 - שבוע שטח', '2026-10-11', '2026-10-15'], // the number follows the calendar too
      [3, 'שבוע 3', '2026-10-18', '2026-10-24'],
    ]);
    expect((await c.cmd.get('/api/weeks/calendar')).body).toEqual({ url: GOOGLE_URL });
    const settings = (await c.cmd.get('/api/settings')).body;
    expect([settings.startDate, settings.endDate]).toEqual(['2026-10-04', '2026-10-24']);

    // nothing changed: nothing to do
    expect((await c.cmd.post('/api/weeks/calendar/preview', { url: GOOGLE_URL })).body.weeks.map((w: { action: string }) => w.action)).toEqual(['same', 'same', 'same']);

    // week 1 moves a day and is renamed in Google: the update finds it by its event, not by its date
    ics = weeksIcs({ start: '20261005', end: '20261010', name: 'שבוע 1 - פתיחה' });
    const again = (await c.cmd.post('/api/weeks/calendar/preview', { url: GOOGLE_URL })).body.weeks;
    expect(again[0]).toMatchObject({ action: 'update', startDate: '2026-10-05', endDate: '2026-10-09', weekId: applied.body[0].id });
    await c.cmd.post('/api/weeks/calendar/apply', { url: GOOGLE_URL, items: [again[0]] });
    const after = (await c.cmd.get('/api/weeks')).body;
    expect(after).toHaveLength(3);
    expect(after[0]).toMatchObject({ id: applied.body[0].id, name: 'שבוע 1 - פתיחה', startDate: '2026-10-05', endDate: '2026-10-09' });
  });

  it('a big calendar still on its way: checked again a moment later, it takes what came in meanwhile', async () => {
    let send: (t: string) => void = () => undefined;
    let slow = true;
    let ics = weeksIcs({ start: '20261004', end: '20261009', name: 'שבוע 1 - הכרות' });
    setCalendarFetcher(() => (slow ? new Promise<string>((r) => (send = r)) : Promise.resolve(ics)));
    setCalendarWaits(20, 40);
    try {
      const first = await c.cmd.post('/api/weeks/calendar/preview', { url: GOOGLE_URL });
      expect(first.status).toBe(400);
      expect(first.body.error).toContain('Google עדיין שולח את היומן');
      send(ics);
      await calendarReadsSettled();
      // the reading the last check stopped waiting for is taken, not started over
      slow = false;
      ics = weeksIcs({ start: '20261004', end: '20261009', name: 'שבוע 1 - שונה' });
      expect((await c.cmd.post('/api/weeks/calendar/preview', { url: GOOGLE_URL })).body.weeks[0].name).toBe('שבוע 1 - הכרות');
      // after that, each check reads it afresh
      expect((await c.cmd.post('/api/weeks/calendar/preview', { url: GOOGLE_URL })).body.weeks[0].name).toBe('שבוע 1 - שונה');
    } finally {
      setCalendarWaits(2_500, 5_000);
    }
  });
});

describe('a calendar of many years', () => {
  it('is trimmed before parsing to about a year back and a year ahead, keeping what still repeats', () => {
    const ev = (uid: string, lines: string[]) => ['BEGIN:VEVENT', `UID:${uid}`, ...lines, 'END:VEVENT'];
    const old: string[] = [];
    // years of a company's past: 20,000 events
    for (let i = 0; i < 20000; i++) old.push(...ev(`old-${i}`, [`DTSTART:2019${String((i % 12) + 1).padStart(2, '0')}10T080000Z`, 'DTEND:20190110T090000Z', `SUMMARY:אירוע ישן ${i}`]));
    const text = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'X-WR-CALNAME:יומן הפלוגה',
      'BEGIN:VTIMEZONE',
      'TZID:Asia/Jerusalem',
      'END:VTIMEZONE',
      ...old,
      ...ev('now', ['DTSTART;TZID=Asia/Jerusalem:20261012T090000', 'DTEND;TZID=Asia/Jerusalem:20261012T100000', 'SUMMARY:תרגיל השבוע']),
      ...ev('block', ['DTSTART;VALUE=DATE:20250901', 'DTEND;VALUE=DATE:20261231', 'SUMMARY:קורס ארוך']),
      ...ev('weekly', ['DTSTART:20180107T060000Z', 'RRULE:FREQ=WEEKLY;BYDAY=SU', 'SUMMARY:מסדר שבועי']),
      ...ev('ended', ['DTSTART:20180107T060000Z', 'RRULE:FREQ=WEEKLY;UNTIL=20200101T000000Z', 'SUMMARY:נגמר מזמן']),
      ...ev('far', ['DTSTART:20290101T060000Z', 'SUMMARY:רחוק מדי']),
      'END:VCALENDAR',
    ].join('\r\n');
    const trimmed = trimCalendar(text, '2026-10-16');
    expect(text.length).toBeGreaterThan(2_000_000);
    expect(trimmed.length).toBeLessThan(2000);
    for (const kept of ['UID:now', 'UID:block', 'UID:weekly', 'X-WR-CALNAME:יומן הפלוגה', 'TZID:Asia/Jerusalem', 'END:VCALENDAR']) expect(trimmed).toContain(kept);
    for (const gone of ['UID:old-', 'UID:ended', 'UID:far']) expect(trimmed).not.toContain(gone);
    // still a calendar, line by line
    expect(trimmed.split('\r\n').filter((l) => l === 'BEGIN:VEVENT').length).toBe(3);
    expect(trimmed).not.toMatch(/\n\n|\r\r/);
  });

  it('a big one read from Google: only its recent part is kept and shown', async () => {
    const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'X-WR-CALNAME:גדול'];
    for (let i = 0; i < 20000; i++) lines.push('BEGIN:VEVENT', `UID:o${i}`, 'DTSTART:20190310T080000Z', 'SUMMARY:ישן', 'END:VEVENT');
    const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    lines.push('BEGIN:VEVENT', 'UID:fresh', `DTSTART:${today}T080000Z`, `DTEND:${today}T090000Z`, 'SUMMARY:אירוע של היום', 'END:VEVENT', 'END:VCALENDAR');
    setCalendarFetcher(async () => lines.join('\r\n'));
    expect((await c.cmd.post('/api/calendar/sources', { name: '', url: GOOGLE_URL })).body[0]).toMatchObject({ calendarName: 'גדול', error: null });
    const d = new Date().toISOString().slice(0, 10);
    const events = (await c.s1.get(`/api/calendar/external?from=${d}&to=${d}`)).body;
    expect(events.map((e: { title: string }) => e.title)).toEqual(['אירוע של היום']);
  });

  it('thousands of events with moved occurrences: each moved one stays with its own event', async () => {
    const day = (n: number) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10).replace(/-/g, '');
    const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'X-WR-CALNAME:הרבה'];
    for (let i = 0; i < 3000; i++) lines.push('BEGIN:VEVENT', `UID:s${i}`, `DTSTART:${day(0)}T0${i % 10}0000Z`, `DTEND:${day(0)}T0${i % 10}3000Z`, `SUMMARY:אירוע ${i}`, 'END:VEVENT');
    // two weekly events at the same hour, each with today's occurrence moved: ical.js on its own lets every
    // event take every moved occurrence in the calendar as its own (and look through the whole calendar for it)
    for (const name of ['אלף', 'בית']) {
      lines.push('BEGIN:VEVENT', `UID:${name}`, `DTSTART:${day(-7)}T060000Z`, `DTEND:${day(-7)}T070000Z`, 'RRULE:FREQ=WEEKLY', `SUMMARY:${name}`, 'END:VEVENT');
      lines.push('BEGIN:VEVENT', `UID:${name}`, `RECURRENCE-ID:${day(0)}T060000Z`, `DTSTART:${day(0)}T080000Z`, `DTEND:${day(0)}T090000Z`, `SUMMARY:${name} - הוזז`, 'END:VEVENT');
    }
    lines.push('END:VCALENDAR');
    setCalendarFetcher(async () => lines.join('\r\n'));
    expect((await c.cmd.post('/api/calendar/sources', { name: '', url: GOOGLE_URL })).status).toBe(200);
    const d = new Date().toISOString().slice(0, 10);
    const related = vi.spyOn(ICAL.Event.prototype, 'relateException');
    try {
      const events = (await c.s1.get(`/api/calendar/external?from=${d}&to=${d}`)).body as { title: string }[];
      expect(events.filter((e) => e.title.startsWith('אירוע')).length).toBe(3000);
      expect(events.map((e) => e.title).filter((t) => t.endsWith('הוזז')).sort()).toEqual(['אלף - הוזז', 'בית - הוזז']);
      // each moved occurrence related once, to its own event - not to each of the 3,002 events
      expect(related.mock.calls.length).toBe(2);
    } finally {
      related.mockRestore();
    }
  });
});
