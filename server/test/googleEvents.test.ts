// The calendar's events as Google Calendar keeps them: rules without an end, a rule changed, guests and
// their answers, one's own calendar, private events, reminders, and the trash.
import { beforeEach, describe, expect, it } from 'vitest';
import { runAutomation } from '../src/automation';
import { clock } from '../src/core';
import { Db, db, migrate } from '../src/db';
import { extendRecurrences, HORIZON_DAYS, purgeOldTrash, setDefaultReminders } from '../src/schedule';
import { FINISHED, NOTIFICATIONS_FROM } from '../src/journal';
import { addDays, zonedIso } from '../../shared/dates';
import { NOW, setup, staffMay, type Ctx } from './helpers';

let c: Ctx;
beforeEach(async () => {
  c = await setup();
});

type Ev = { id: number; title: string; date: string; startTime: string; seriesId: number | null; recurrence: string | null; recurrenceText: string | null; location: string; guests: { userId: number; response: string }[]; myResponse: string | null; calendar: string; hidden?: boolean; canEdit?: boolean };
const ev = (body: Record<string, unknown>) => ({ startTime: '08:00', title: 'פעילות', ...body });
const listAs = async (who: Ctx['cmd'], from: string, to: string) => (await who.get(`/api/events?from=${from}&to=${to}`)).body as Ev[];
const list = (from: string, to: string) => listAs(c.cmd, from, to);
const notes = (uid: number, type: string) => db().all<{ title: string; ref: string | null }>('SELECT title, ref FROM notifications WHERE user_id = ? AND type = ? ORDER BY id', uid, type);

describe('a rule as Google keeps it', () => {
  it('repeats with no end: its days are there a year ahead, and grow day by day', async () => {
    const r = await c.cmd.post('/api/events', ev({ date: '2026-10-04', title: 'ישיבת סגל', recurrence: 'FREQ=WEEKLY;BYDAY=SU' }));
    expect(r.status).toBe(200);
    expect(r.body.event.recurrenceText).toBe('כל שבוע ביום ראשון');
    const ids = (await list('2026-10-01', '2028-01-01')).filter((e) => e.title === 'ישיבת סגל');
    // a year ahead of today (1.10.2026): every Sunday from the 4th of October up to the horizon
    const last = ids[ids.length - 1].date;
    expect(ids[0].date).toBe('2026-10-04');
    // (from the series' first day, the 4th, as it is after today)
    expect(last <= addDays('2026-10-04', HORIZON_DAYS)).toBe(true);
    expect(last > addDays('2026-10-04', HORIZON_DAYS - 7)).toBe(true);
    // three weeks and a half later the series has grown by the Sundays of those weeks
    clock.set(new Date(NOW.getTime() + 25 * 86_400_000));
    expect(extendRecurrences()).toBeGreaterThanOrEqual(3);
    const after = (await list('2026-10-01', '2028-02-01')).filter((e) => e.title === 'ישיבת סגל');
    expect(after.length - ids.length).toBeGreaterThanOrEqual(3);
  });

  it('every month on the last Thursday, three times', async () => {
    await c.cmd.post('/api/events', ev({ date: '2026-10-29', title: 'סיכום חודש', recurrence: 'FREQ=MONTHLY;BYDAY=-1TH;COUNT=3' }));
    expect((await list('2026-10-01', '2027-06-01')).map((e) => e.date)).toEqual(['2026-10-29', '2026-11-26', '2026-12-31']);
  });

  it('turns an event into a series, then changes the rule of all of it - a day with a task stays as an event of its own', async () => {
    const one = (await c.cmd.post('/api/events', ev({ date: '2026-10-05', title: 'שיעור' }))).body.event;
    await c.cmd.patch(`/api/events/${one.id}`, { recurrence: 'FREQ=WEEKLY;UNTIL=20261102' });
    const weekly = await list('2026-10-01', '2026-11-30');
    expect(weekly.map((e) => e.date)).toEqual(['2026-10-05', '2026-10-12', '2026-10-19', '2026-10-26', '2026-11-02']);
    // a task to prepare the 12th
    const task = await c.cmd.post('/api/tasks', { title: 'להכין שיעור', ownerIds: [c.ids.s1], deadline: zonedIso('2026-10-11', '18:00', 'Asia/Jerusalem'), eventId: weekly[1].id });
    expect(task.status, JSON.stringify(task.body)).toBe(200);
    // every two weeks from now on, for all of it
    const r = await c.cmd.patch(`/api/events/${weekly[0].id}`, { recurrence: 'FREQ=WEEKLY;INTERVAL=2;UNTIL=20261102', scope: 'all' });
    expect(r.status).toBe(200);
    const after = await list('2026-10-01', '2026-11-30');
    expect(after.map((e) => `${e.date}${e.seriesId ? '' : ' (own)'}`)).toEqual(['2026-10-05', '2026-10-12 (own)', '2026-10-19', '2026-11-02']);
    expect(after[0].recurrenceText).toBe('כל שבועיים ביום שני, עד 2 בנובמבר 2026');
  });

  it('moves a whole series by a day: all its days, and the rule with them', async () => {
    await c.cmd.post('/api/events', ev({ date: '2026-10-05', title: 'מסדר', recurrence: 'FREQ=WEEKLY;BYDAY=MO;UNTIL=20261026' }));
    const [first] = await list('2026-10-01', '2026-10-31');
    expect((await c.cmd.patch(`/api/events/${first.id}`, { date: '2026-10-06', scope: 'all' })).status).toBe(200);
    const moved = await list('2026-10-01', '2026-10-31');
    expect(moved.map((e) => e.date)).toEqual(['2026-10-06', '2026-10-13', '2026-10-20', '2026-10-27']);
    expect(moved[0].recurrence).toBe('FREQ=WEEKLY;BYDAY=TU;UNTIL=20261027');
  });
});

describe('the trash', () => {
  it('a deleted day of a series waits in the trash, is not made again, and comes back', async () => {
    await c.cmd.post('/api/events', ev({ date: '2026-10-04', title: 'ריצה', recurrence: 'FREQ=WEEKLY' }));
    const days = await list('2026-10-01', '2026-10-31');
    const second = days[1];
    expect((await c.cmd.del(`/api/events/${second.id}`)).body.deleted).toBe(1);
    expect((await list('2026-10-01', '2026-10-31')).map((e) => e.date)).not.toContain(second.date);
    // the trash has it
    const trash = (await c.cmd.get('/api/events/trash')).body as { id: number; count: number; title: string }[];
    expect(trash).toMatchObject([{ id: second.id, count: 1, title: 'ריצה' }]);
    // a year later the series grows - that day is not made again
    clock.set(new Date(NOW.getTime() + 2 * 86_400_000));
    extendRecurrences();
    expect((await list('2026-10-01', '2026-10-31')).map((e) => e.date)).not.toContain(second.date);
    // back from the trash
    expect((await c.cmd.post(`/api/events/${second.id}/untrash`)).body.restored).toBe(1);
    expect((await list('2026-10-01', '2026-10-31')).map((e) => e.date)).toContain(second.date);
  });

  it('"this and following" deleted and brought back: the series runs on as before', async () => {
    await c.cmd.post('/api/events', ev({ date: '2026-10-04', title: 'ריצה', recurrence: 'FREQ=WEEKLY;UNTIL=20261101' }));
    const days = await list('2026-10-01', '2026-11-30');
    expect((await c.cmd.del(`/api/events/${days[2].id}?scope=following`)).body.deleted).toBe(3);
    expect((await list('2026-10-01', '2026-11-30')).map((e) => e.date)).toEqual(['2026-10-04', '2026-10-11']);
    expect((await list('2026-10-01', '2026-10-31'))[0].recurrence).toBe('FREQ=WEEKLY;UNTIL=20261017');
    const trash = (await c.cmd.get('/api/events/trash')).body as { id: number; count: number }[];
    expect(trash).toMatchObject([{ id: days[2].id, count: 3 }]);
    await c.cmd.post(`/api/events/${days[2].id}/untrash`);
    expect((await list('2026-10-01', '2026-11-30')).map((e) => e.date)).toEqual(['2026-10-04', '2026-10-11', '2026-10-18', '2026-10-25', '2026-11-01']);
    expect((await list('2026-10-01', '2026-10-31'))[0].recurrence).toBe('FREQ=WEEKLY;UNTIL=20261101');
  });

  it('empties itself after 30 days, and deletes for good on request', async () => {
    const a = (await c.cmd.post('/api/events', ev({ date: '2026-10-05', title: 'א' }))).body.event;
    const b = (await c.cmd.post('/api/events', ev({ date: '2026-10-06', title: 'ב' }))).body.event;
    await c.cmd.del(`/api/events/${a.id}`);
    await c.cmd.del(`/api/events/${b.id}`);
    expect((await c.cmd.del(`/api/events/${a.id}/forever`)).body.deleted).toBe(1);
    expect(db().get('SELECT 1 FROM events WHERE id = ?', a.id)).toBeUndefined();
    expect(purgeOldTrash(new Date(NOW.getTime() + 29 * 86_400_000))).toBe(0);
    expect(purgeOldTrash(new Date(NOW.getTime() + 31 * 86_400_000))).toBe(1);
    expect(db().get('SELECT 1 FROM events WHERE id = ?', b.id)).toBeUndefined();
  });

  it('only one who could change it sees it in the trash', async () => {
    await staffMay(c, { schedule: false });
    const a = (await c.cmd.post('/api/events', ev({ date: '2026-10-05', title: 'א' }))).body.event;
    await c.cmd.del(`/api/events/${a.id}`);
    expect((await c.s2.get('/api/events/trash')).body).toEqual([]);
    expect((await c.s2.post(`/api/events/${a.id}/untrash`)).status).toBe(403);
  });
});

describe('guests and their answers', () => {
  it('invites, lets each answer, tells the maker - and the invitation leaves the bell once answered', async () => {
    const r = await c.cmd.post('/api/events', ev({ date: '2026-10-07', title: 'ישיבת תכנון', guests: [{ userId: c.ids.s1 }, { userId: c.ids.s2, optional: true }] }));
    expect(r.status).toBe(200);
    const id = r.body.event.id;
    expect(notes(c.ids.s1, 'event_invite').map((n) => n.title)).toEqual(['הוזמנת: ישיבת תכנון']);
    const inviteFinished = () => db().get<{ f: number }>(`SELECT ${FINISHED} AS f FROM ${NOTIFICATIONS_FROM} WHERE n.user_id = ? AND n.type = 'event_invite'`, c.ids.s1)!.f;
    expect(inviteFinished()).toBe(0)
    // s1 sees it with the answer still owed
    const seen = (await listAs(c.s1, '2026-10-07', '2026-10-07')).find((e) => e.id === id)!;
    expect(seen.myResponse).toBe('needsAction');
    expect(seen.guests.map((g) => g.response)).toEqual(['needsAction', 'needsAction']);
    // s1 answers yes: the maker hears of it
    expect((await c.s1.post(`/api/events/${id}/respond`, { response: 'accepted' })).status).toBe(200);
    expect(notes(c.ids.cmd, 'event_response').map((n) => n.title)).toEqual(['מפק"צ 1: מגיע/ה']);
    // answered: the invitation is done with, out of the bell
    expect(inviteFinished()).toBe(1);
    // one not invited cannot answer
    expect((await c.s3.post(`/api/events/${id}/respond`, { response: 'accepted' })).status).toBe(403);
  });

  it('answers the whole series - its new days too', async () => {
    await c.cmd.post('/api/events', ev({ date: '2026-10-04', title: 'ישיבת סגל', recurrence: 'FREQ=WEEKLY', guests: [{ userId: c.ids.s1 }] }));
    const days = await listAs(c.s1, '2026-10-01', '2026-10-31');
    await c.s1.post(`/api/events/${days[1].id}/respond`, { response: 'declined', scope: 'all' });
    expect((await listAs(c.s1, '2026-10-01', '2026-10-31')).map((e) => e.myResponse)).toEqual(['declined', 'declined', 'declined', 'declined']);
    // the days the series grows by come already declined
    clock.set(new Date(NOW.getTime() + 21 * 86_400_000));
    extendRecurrences();
    const farRes = await c.s1.get(`/api/events?from=${addDays('2026-10-04', HORIZON_DAYS)}&to=${addDays('2026-10-01', HORIZON_DAYS + 21)}`);
    expect(farRes.status, JSON.stringify(farRes.body)).toBe(200);
    const far = farRes.body as Ev[];
    expect(far.length).toBeGreaterThan(0);
    expect(far.every((e) => e.myResponse === 'declined')).toBe(true);
  });
});

describe('one\'s own calendar and private events', () => {
  it('an event in one\'s own calendar: its maker and its guests see it, no one else - and not the course\'s screens', async () => {
    await staffMay(c, { schedule: false });
    // any staff member may add to their own calendar
    const r = await c.s1.post('/api/events', ev({ date: '2026-10-08', title: 'רופא שיניים', calendar: 'personal', guests: [{ userId: c.ids.s2 }] }));
    expect(r.status).toBe(200);
    const id = r.body.event.id;
    expect((await listAs(c.s1, '2026-10-08', '2026-10-08')).map((e) => e.title)).toContain('רופא שיניים');
    expect((await listAs(c.s2, '2026-10-08', '2026-10-08')).map((e) => e.title)).toContain('רופא שיניים');
    expect((await listAs(c.s3, '2026-10-08', '2026-10-08')).map((e) => e.title)).not.toContain('רופא שיניים');
    expect((await listAs(c.cmd, '2026-10-08', '2026-10-08')).map((e) => e.title)).not.toContain('רופא שיניים');
    expect((await c.s3.get(`/api/events/${id}`)).status).toBe(404);
    // a staff member without the schedule may not put it in the course's calendar
    expect((await c.s1.post('/api/events', ev({ date: '2026-10-08', title: 'ללו"ז' }))).status).toBe(403);
    // the guest may not change it (guests may not, unless allowed)
    expect((await c.s2.patch(`/api/events/${id}`, { title: 'אחר' })).status).toBe(403);
  });

  it('a private event of the course reads as "busy" to whoever is not in it', async () => {
    // (one who may change every event of the course sees it whole, as one who may change a calendar in Google)
    await staffMay(c, { schedule: false });
    const r = await c.cmd.post('/api/events', ev({ date: '2026-10-09', title: 'שיחה אישית', location: 'חדר מפקד', visibility: 'private', ownerId: c.ids.s1 }));
    const id = r.body.event.id;
    const other = (await listAs(c.s2, '2026-10-09', '2026-10-09')).find((e) => e.id === id)!;
    expect([other.title, other.location, other.hidden]).toEqual(['עסוק', '', true]);
    const owner = (await listAs(c.s1, '2026-10-09', '2026-10-09')).find((e) => e.id === id)!;
    expect(owner.title).toBe('שיחה אישית');
  });
});

describe('the search over the events', () => {
  const find = async (q: string, who = c.cmd) => ((await who.get(`/api/events/search?q=${encodeURIComponent(q)}`)).body as Ev[]).map((e) => e.title);

  it('finds every word typed, in the title, the place, the notes or who is in charge - however the Hebrew was typed', async () => {
    await c.cmd.post('/api/events', ev({ date: '2026-10-12', title: 'מטווח לילה', location: 'מטווח 7' }));
    await c.cmd.post('/api/events', ev({ date: '2026-11-20', title: 'שיעור ניווט', notes: 'להביא מצפנים', ownerId: c.ids.s2 }));
    await c.cmd.post('/api/events', ev({ date: '2027-03-01', title: 'תדריך מפק"צים' }));
    expect(await find('מטווח')).toEqual(['מטווח לילה']);
    // two words, in two of its fields; the one in charge by name
    expect(await find('ניווט מצפנים')).toEqual(['שיעור ניווט']);
    expect(await find('מפק"צ 2')).toEqual(['שיעור ניווט']);
    // no quote mark typed, a final letter as a plain one
    expect(await find('מפקצים')).toEqual(['תדריך מפק"צים']);
    expect(await find('מצפנימ')).toEqual(['שיעור ניווט']);
    // every word must be there; nothing typed finds nothing
    expect(await find('מטווח ניווט')).toEqual([]);
    expect(await find('  ')).toEqual([]);
    // by date, in the days asked
    expect((await c.cmd.get(`/api/events/search?q=${encodeURIComponent('ו')}&from=2026-11-01&to=2026-12-31`)).body.map((e: Ev) => e.title)).toEqual(['שיעור ניווט']);
    expect((await c.cmd.get('/api/events/search?q=x&from=2026-12-31&to=2026-11-01')).status).toBe(400);
  });

  it('gives away nothing the reader may not see: another\'s calendar, or what a private event keeps', async () => {
    await staffMay(c, { schedule: false });
    await c.s1.post('/api/events', ev({ date: '2026-10-08', title: 'רופא שיניים', calendar: 'personal' }));
    await c.cmd.post('/api/events', ev({ date: '2026-10-09', title: 'שיחה אישית', location: 'חדר מפקד', visibility: 'private', ownerId: c.ids.s1 }));
    expect(await find('רופא', c.s1)).toEqual(['רופא שיניים']);
    expect(await find('רופא', c.s3)).toEqual([]);
    expect(await find('שיחה', c.s2)).toEqual([]);
    expect(await find('עסוק', c.s2)).toEqual([]);
    expect(await find('שיחה', c.s1)).toEqual(['שיחה אישית']);
  });
});

describe('finding a time', () => {
  it("shows each person's busy hours on a day - their events and absences; what is not the reader's reads as busy", async () => {
    await staffMay(c, { schedule: false });
    const day = '2026-10-14';
    await c.cmd.post('/api/events', ev({ date: day, startTime: '10:00', endTime: '11:00', title: 'מטווח', ownerId: c.ids.s1 }));
    const asked = (await c.cmd.post('/api/events', ev({ date: day, startTime: '12:00', endTime: '13:00', title: 'ישיבה', guests: [{ userId: c.ids.s2 }, { userId: c.ids.s3 }] }))).body.event.id;
    await c.s3.post(`/api/events/${asked}/respond`, { response: 'declined' });
    await c.s1.post('/api/events', ev({ date: day, startTime: '16:00', endTime: '17:00', title: 'רופא שיניים', calendar: 'personal' }));
    await c.cmd.post('/api/events', ev({ date: day, startTime: '18:00', endTime: '19:00', title: 'פנוי', ownerId: c.ids.s1, transparency: 'transparent' }));
    await c.cmd.post('/api/absences', { userId: c.ids.s3, startDate: day, endDate: day, reason: 'leave' });
    const busy = (await c.s2.get(`/api/events/busy?date=${day}&users=${c.ids.s1},${c.ids.s2},${c.ids.s3}`)).body;
    expect(busy[c.ids.s1]).toEqual([
      { start: '10:00', end: '11:00', title: 'מטווח' },
      // their own calendar: s2 is not in it - busy, nothing more
      { start: '16:00', end: '17:00', title: 'עסוק' },
    ]);
    expect(busy[c.ids.s2]).toEqual([{ start: '12:00', end: '13:00', title: 'ישיבה' }]);
    // declined: not busy; away: the whole day
    expect(busy[c.ids.s3]).toEqual([{ start: null, end: null, title: 'לא זמין/ה' }]);
    // the event being edited is not in the way of itself; the maker sees their own event by name
    expect((await c.cmd.get(`/api/events/busy?date=${day}&users=${c.ids.s2}&except=${asked}`)).body[c.ids.s2]).toEqual([]);
    expect((await c.s1.get(`/api/events/busy?date=${day}&users=${c.ids.s1}`)).body[c.ids.s1].map((b: { title: string }) => b.title)).toEqual(['מטווח', 'רופא שיניים']);
    expect((await c.s1.get('/api/events/busy?users=1')).status).toBe(400);
  });
});

describe('reminders', () => {
  const at = (date: string, time: string) => new Date(zonedIso(date, time, 'Asia/Jerusalem'));

  it('reminds the owner and the guests who did not decline, once, and again when the event moves', async () => {
    const r = await c.cmd.post('/api/events', ev({ date: '2026-10-02', startTime: '12:00', title: 'מטווח', ownerId: c.ids.s1, reminders: [{ minutes: 10 }], guests: [{ userId: c.ids.s2 }, { userId: c.ids.s3 }] }));
    const id = r.body.event.id;
    await c.s3.post(`/api/events/${id}/respond`, { response: 'declined' });
    clock.set(at('2026-10-02', '11:45'));
    runAutomation();
    expect(notes(c.ids.s1, 'event_reminder')).toEqual([]);
    clock.set(at('2026-10-02', '11:50'));
    runAutomation();
    runAutomation();
    expect(notes(c.ids.s1, 'event_reminder').map((n) => n.title)).toEqual(['בעוד 10 דקות: מטווח']);
    expect(notes(c.ids.s2, 'event_reminder')).toHaveLength(1);
    expect(notes(c.ids.s3, 'event_reminder')).toEqual([]);
    // moved an hour later: it reminds again before the new time
    await c.cmd.patch(`/api/events/${id}`, { startTime: '13:00' });
    clock.set(at('2026-10-02', '12:51'));
    runAutomation();
    expect(notes(c.ids.s1, 'event_reminder').map((n) => n.title)).toEqual(['בעוד 10 דקות: מטווח', 'בעוד 9 דקות: מטווח']);
  });

  it('the default is 30 minutes before; an event made after its reminder\'s time does not remind', async () => {
    clock.set(at('2026-10-02', '11:40'));
    await c.cmd.post('/api/events', ev({ date: '2026-10-02', startTime: '12:00', title: 'קרוב מדי', ownerId: c.ids.s1 }));
    await c.cmd.post('/api/events', ev({ date: '2026-10-02', startTime: '13:00', title: 'שעה', ownerId: c.ids.s1 }));
    clock.set(at('2026-10-02', '12:30'));
    runAutomation();
    expect(notes(c.ids.s1, 'event_reminder').map((n) => n.title)).toEqual(['בעוד 30 דקות: שעה']);
  });

  it('a reminder the scheduler reaches after the start says since when; none at all once the default is off', async () => {
    clock.set(at('2026-10-01', '08:00'));
    await c.cmd.post('/api/events', ev({ date: '2026-10-02', startTime: '12:00', title: 'באיחור', ownerId: c.ids.s1 }));
    clock.set(at('2026-10-02', '12:07'));
    runAutomation();
    expect(notes(c.ids.s1, 'event_reminder').map((n) => n.title)).toEqual(['התחיל לפני 7 דקות: באיחור']);
    setDefaultReminders(false);
    try {
      await c.cmd.post('/api/events', ev({ date: '2026-10-02', startTime: '14:00', title: 'בלי', ownerId: c.ids.s1 }));
      clock.set(at('2026-10-02', '13:40'));
      runAutomation();
      expect(notes(c.ids.s1, 'event_reminder')).toHaveLength(1);
    } finally {
      setDefaultReminders(true);
    }
  });

  it("each person's own default, as Google's settings: none, or another time - an event's own reminders stay as they are", async () => {
    expect((await c.s1.get('/api/me/calendar')).body).toEqual({ defaultReminder: 30 });
    expect((await c.s1.patch('/api/me/calendar', { defaultReminder: null })).body).toEqual({ defaultReminder: null });
    expect((await c.s2.patch('/api/me/calendar', { defaultReminder: 10 })).body).toEqual({ defaultReminder: 10 });
    expect((await c.s2.patch('/api/me/calendar', { defaultReminder: -5 })).status).toBe(400);
    clock.set(at('2026-10-01', '08:00'));
    // left as it is: s1 (none) is not reminded, s2 ten minutes before, s3 (never set) thirty
    await c.cmd.post('/api/events', ev({ date: '2026-10-02', startTime: '12:00', title: 'תדריך', ownerId: c.ids.s1, guests: [{ userId: c.ids.s2 }, { userId: c.ids.s3 }] }));
    // with its own reminder: everyone, whatever their default
    await c.cmd.post('/api/events', ev({ date: '2026-10-02', startTime: '16:00', title: 'מטווח', ownerId: c.ids.s1, reminders: [{ minutes: 15 }] }));
    for (const t of ['11:30', '11:50', '15:45']) {
      clock.set(at('2026-10-02', t));
      runAutomation();
    }
    expect(notes(c.ids.s1, 'event_reminder').map((n) => n.title)).toEqual(['בעוד 15 דקות: מטווח']);
    expect(notes(c.ids.s2, 'event_reminder').map((n) => n.title)).toEqual(['בעוד 10 דקות: תדריך']);
    expect(notes(c.ids.s3, 'event_reminder').map((n) => n.title)).toEqual(['בעוד 30 דקות: תדריך']);
  });
});

describe('the series of before', () => {
  it('carries an old series over as a rule, its days as they were', () => {
    const d = new Db(':memory:');
    migrate(d, 50);
    d.run("INSERT INTO users(id, username, password_hash, display_name, role, created_at) VALUES (1, 'u', 'x', 'משתמש', 'commander', '2026-09-01')");
    const s = d.run("INSERT INTO event_series(freq, interval, until, created_by, created_at) VALUES ('weekly', 1, '2026-10-26', 1, '2026-09-01')").id;
    for (const day of ['2026-10-05', '2026-10-12', '2026-10-19', '2026-10-26']) {
      d.run("INSERT INTO events(date, start_time, title, created_at, updated_at, series_id) VALUES (?, '07:30', 'מסדר', '2026-09-01', '2026-09-01', ?)", day, s);
    }
    migrate(d);
    const rec = d.get<{ id: number; rrule: string; dtstart: string }>('SELECT id, rrule, dtstart FROM event_recurrences')!;
    expect([rec.rrule, rec.dtstart]).toEqual(['FREQ=WEEKLY;BYDAY=MO;UNTIL=20261026', '2026-10-05']);
    expect(d.all<{ original_date: string }>('SELECT original_date FROM events WHERE recurrence_id = ? ORDER BY date', rec.id).map((e) => e.original_date)).toEqual(['2026-10-05', '2026-10-12', '2026-10-19', '2026-10-26']);
  });
});
