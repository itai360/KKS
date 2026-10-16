// Plan approval: a document for every week, drafted from the schedule and the course's state,
// rewritten by the commander, approved by the commander above - and what changed since.

import { beforeEach, describe, expect, it } from 'vitest';
import type { PlanDocument, PlansOverview, ThreeWeekPlan } from '../../shared/types';
import { classify, joinHe, readEvents } from '../src/plans';
import { calendarReadsSettled, forgetCalendarCopies, setCalendarFetcher, setCalendarWaits } from '../src/calendar';
import { db } from '../src/db';
import { at, newTask, setup, type Ctx } from './helpers';

let c: Ctx;
const weekIds: number[] = [];
const eventIds: Record<string, number> = {};

async function week(name: string, startDate: string, endDate: string, extra: Record<string, unknown> = {}) {
  const res = await c.cmd.post('/api/weeks', { name, startDate, endDate, ...extra });
  expect(res.status).toBe(200);
  weekIds.push(res.body.id);
}

async function event(title: string, date: string, startTime: string, endTime: string | null, ownerId: number | null = null) {
  const res = await c.cmd.post('/api/events', { title, date, startTime, endTime, ownerId, location: 'שטח אימונים' });
  expect(res.status).toBe(200);
  eventIds[title] = res.body.event.id;
}

beforeEach(async () => {
  c = await setup();
  weekIds.length = 0;
  await week('שבוע התקפה', '2026-10-04', '2026-10-08', { topic: 'התקפה בשטח פתוח', leadId: c.ids.s1 });
  await week('שבוע הגנה', '2026-10-11', '2026-10-15');
  await week('שבוע שטח', '2026-10-18', '2026-10-22');
  await week('שבוע מבחנים', '2026-10-25', '2026-10-29');
  await week('שבוע סיום', '2026-11-01', '2026-11-05');
  for (const d of ['2026-10-04', '2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08']) {
    await event('אימון גופני', d, '06:30', '07:30', c.ids.s1);
    await event('ארוחת צהריים', d, '13:00', '13:45');
  }
  await event('שיעור: עקרונות התקפה', '2026-10-04', '09:00', '11:00', c.ids.s1);
  await event('ניווט לילה', '2026-10-05', '20:00', '02:00', c.ids.s1);
  await event('מטווח הפעלת כוח', '2026-10-06', '10:00', '15:00', c.ids.s2);
  await event('תרגיל התקפה', '2026-10-07', '06:00', '22:00', c.ids.s3);
  await event('מבחן עקרונות', '2026-10-08', '09:00', '10:00');
  await event('טקס אמצע קורס', '2026-10-20', '18:00', '20:00', c.ids.s2);
  await event('מבחן מסכם', '2026-10-27', '09:00', '12:00', c.ids.s1);
  // the owner of the exercise is away that day, and the range is not ready
  await c.s3.post('/api/absences', { startDate: '2026-10-07', endDate: '2026-10-07', reason: 'leave' });
  await newTask(c.cmd, { title: 'תיאום רפואה למטווח', ownerIds: [c.ids.s2], eventId: eventIds['מטווח הפעלת כוח'], deadline: at('2026-10-05') });
});

const doc = async (i = 0) => (await c.cmd.get(`/api/plans/${weekIds[i]}`)).body as PlanDocument;

describe('reading the schedule', () => {
  it('tells activities apart by their names, and leaves the routine out', () => {
    expect(classify('שיעור: קרב בשטח בנוי')).toBe('learning');
    expect(classify('תרגיל כיתה בשטח')).toBe('field');
    expect(classify('מסדר בוקר ופתיחת יום')).toBe('routine');
    expect(classify('מסדר סיום הקורס')).toBe('ceremony');
    expect(classify('תחקיר תרגיל התקפה')).toBe('staff');
    expect(classify("ח' ערכים")).toBe('values');
    expect(joinHe(['מטווח', 'תרגיל התקפה'])).toBe('מטווח ותרגיל התקפה');
    expect(joinHe(['א', 'ב', '"ג"'])).toBe('א, ב ו-"ג"');
    // the same title on consecutive days is one activity
    const raw = (date: string) => ({ date, startTime: '06:00', endTime: '20:00', title: 'שבוע שטח מסכם', location: '', ownerName: null, notes: '', prep: null, source: 'course' as const });
    const [one] = readEvents([raw('2026-10-18'), raw('2026-10-19'), raw('2026-10-20')]);
    expect(one).toMatchObject({ date: '2026-10-18', endDate: '2026-10-20', kind: 'field', weight: 5 });
  });
});

describe('plan approval', () => {
  it('is the commander\'s only', async () => {
    expect((await c.s1.get('/api/plans')).status).toBe(403);
    expect((await c.s1.get(`/api/plans/${weekIds[0]}`)).status).toBe(403);
    expect((await c.s1.patch(`/api/plans/${weekIds[0]}`, { goals: ['x'] })).status).toBe(403);
    expect((await c.s1.post(`/api/plans/${weekIds[0]}/approve`, { by: 'מח"ט', on: '2026-10-01' })).status).toBe(403);
  });

  it('drafts the week from the schedule: key activities, the three weeks after, goals, achievements, emphases, risks', async () => {
    const d = await doc();
    expect(d.position).toMatchObject({ index: 1, total: 5, phase: 'opening' });
    const titles = d.horizon[0].events.map((e) => e.title);
    expect(titles).toEqual(['ניווט לילה', 'מטווח הפעלת כוח', 'תרגיל התקפה', 'מבחן עקרונות']);
    expect(titles).not.toContain('אימון גופני');
    expect(d.horizon.map((w) => w.name)).toEqual(['שבוע התקפה', 'שבוע הגנה', 'שבוע שטח', 'שבוע מבחנים']);
    expect(d.horizon[2].events.map((e) => e.title)).toEqual(['טקס אמצע קורס']);
    expect(d.horizon[0].events.find((e) => e.title === 'מטווח הפעלת כוח')?.prep).toEqual({ done: 0, total: 1 });

    const all = (k: keyof PlanDocument['sections']) => d.sections[k].items.join('\n');
    expect(all('goals')).toContain('להקנות ולתרגל: התקפה בשטח פתוח');
    expect(all('goals')).toContain('תרגיל התקפה');
    expect(all('goals')).toContain('עקרונות התקפה');
    expect(all('achievements')).toContain('כל הצוערים נבחנו במבחן עקרונות');
    expect(all('emphases')).toContain('בטיחות');
    expect(all('emphases')).toContain('פעילות לילה (ניווט לילה)');
    expect(all('emphases')).toContain('להתחיל כבר השבוע את ההכנות לטקס אמצע קורס');
    expect(all('emphases')).toContain('קליטה ותיאום ציפיות');
    expect(all('requests')).toContain('אישור תוכניות האימון');
    expect(all('requests')).toContain('הזמנה לטקס אמצע קורס');

    const risks = d.risks.map((r) => `${r.level}: ${r.text}`);
    expect(risks).toContain('high: מפק"צ 3, האחראי על תרגיל התקפה, בהיעדרות ב-7.10');
    expect(risks).toContain('medium: למבחן עקרונות אין אחראי');
    expect(risks).toContain('high: מוכנות מטווח הפעלת כוח: 0/1 משימות הכנה');
    expect(d.visit?.title).toBe('תרגיל התקפה');
    expect(d.bluf.text).toContain('שבוע התקפה - שבוע 1 מתוך 5 בקורס.');
    expect(d.bluf.text).toContain('בהמשך: טקס אמצע קורס (20.10).');
    expect(d.status).toBe('draft');
  });

  it('the commander rewrites any part, and can go back to the draft', async () => {
    let d = (await c.cmd.patch(`/api/plans/${weekIds[0]}`, { goals: ['מטרה שלי', 'עוד מטרה'], bluf: 'שורה תחתונה שלי' })).body as PlanDocument;
    expect(d.sections.goals).toMatchObject({ items: ['מטרה שלי', 'עוד מטרה'], edited: true });
    expect(d.sections.goals.auto.length).toBeGreaterThan(0);
    expect(d.bluf).toMatchObject({ text: 'שורה תחתונה שלי', edited: true });
    d = (await c.cmd.patch(`/api/plans/${weekIds[0]}`, { goals: null, bluf: null })).body as PlanDocument;
    expect(d.sections.goals.edited).toBe(false);
    expect(d.bluf.edited).toBe(false);
    expect((await c.cmd.patch(`/api/plans/${weekIds[0]}`, { goals: ['x'.repeat(501)] })).status).toBe(400);
  });

  it('records the approval, and shows what changed in the week since', async () => {
    expect((await c.cmd.post(`/api/plans/${weekIds[0]}/approve`, { by: 'מח"ט', on: '2026-10-09' })).status).toBe(400); // not yet
    const res = await c.cmd.post(`/api/plans/${weekIds[0]}/approve`, { by: 'אל"ם ישראלי, מפקד בה"ד', on: '2026-10-01', notes: 'לחזק את הבטיחות במטווח' });
    expect(res.body).toMatchObject({ status: 'approved', approval: { by: 'אל"ם ישראלי, מפקד בה"ד', on: '2026-10-01', notes: 'לחזק את הבטיחות במטווח' }, changes: [] });

    expect((await c.cmd.patch(`/api/events/${eventIds['מטווח הפעלת כוח']}`, { date: '2026-10-08' })).status).toBe(200);
    await event('מבחן ירי', '2026-10-06', '16:00', '17:00', c.ids.s2);
    expect((await c.cmd.post(`/api/events/${eventIds['מבחן עקרונות']}/cancel`, { taskAction: 'keep' })).status).toBe(200);
    const d = await doc();
    expect(d.changes).toEqual(['הוזז: מטווח הפעלת כוח - משלישי 6.10 10:00 לחמישי 8.10 10:00', 'ירד מהתוכנית: מבחן עקרונות (חמישי 8.10 09:00)', 'נוסף: מבחן ירי (שלישי 6.10 16:00)']);
    const list = (await c.cmd.get('/api/plans')).body as PlansOverview;
    expect(list.weeks[0]).toMatchObject({ status: 'approved', changed: true, approval: { by: 'אל"ם ישראלי, מפקד בה"ד' } });
    expect(list.weeks[1]).toMatchObject({ status: 'draft', changed: false });
    expect(list.currentWeekId).toBe(weekIds[0]);

    // back to ready: the approval no longer stands
    const back = (await c.cmd.patch(`/api/plans/${weekIds[0]}`, { status: 'ready' })).body as PlanDocument;
    expect(back).toMatchObject({ status: 'ready', approval: null, changes: [] });
  });
});

describe('the three-week plan', () => {
  const tw = async (path = '') => (await c.cmd.get(`/api/three-week${path}`)).body as ThreeWeekPlan;

  it("is the commander's only", async () => {
    expect((await c.s1.get('/api/three-week')).status).toBe(403);
    expect((await c.s1.get(`/api/three-week/${weekIds[0]}`)).status).toBe(403);
    expect((await c.s1.patch(`/api/three-week/${weekIds[0]}`, { bluf: 'x' })).status).toBe(403);
    expect((await c.s1.post(`/api/three-week/${weekIds[0]}/approve`, { by: 'מח"ט', on: '2026-10-01' })).status).toBe(403);
  });

  it('shows the week now and the three after it: day by day, the milestones, readiness, the risks with their week', async () => {
    const d = await tw();
    // today is 1.10, before the course: the week to come is the week now
    expect(d).toMatchObject({ startWeekId: weekIds[0], current: true, position: { first: 1, last: 4, total: 5 } });
    expect(d.weeks.map((w) => w.week.name)).toEqual(['שבוע התקפה', 'שבוע הגנה', 'שבוע שטח', 'שבוע מבחנים']);
    expect(d.weeks[0].key.map((e) => e.title)).toEqual(['ניווט לילה', 'מטווח הפעלת כוח', 'תרגיל התקפה', 'מבחן עקרונות']);
    // the main blocks only: not the lesson that morning, nor the routine (the physical training every morning, lunch)
    expect(d.weeks[0].key.map((e) => e.title)).not.toContain('שיעור: עקרונות התקפה');
    expect(d).toMatchObject({ calendars: [], calendarsFrom: 'schedule' });
    expect(d.weeks[2].key.map((e) => e.title)).toEqual(['טקס אמצע קורס']);
    expect(d.milestones.map((e) => e.title)).toEqual(['ניווט לילה', 'מטווח הפעלת כוח', 'תרגיל התקפה', 'מבחן עקרונות', 'טקס אמצע קורס', 'מבחן מסכם']);
    expect(d.weeks[0].plan).toEqual({ status: 'draft', approval: null, changed: false });
    expect(d.weeks[0].goals.items.join('\n')).toContain('להקנות ולתרגל: התקפה בשטח פתוח');

    const risks = d.risks.map((r) => `${r.weekNumber ?? '-'} ${r.level}: ${r.text}`);
    expect(risks).toContain('1 high: מפק"צ 3, האחראי על תרגיל התקפה, בהיעדרות ב-7.10');
    expect(risks).toContain('1 medium: למבחן עקרונות אין אחראי');
    expect(risks).toContain('2 medium: אין עדיין אירועי מפתח בלו"ז השבוע');
    expect(d.risks[0].level).toBe('high');
    expect(d.absences.map((a) => a.userName)).toEqual(['מפק"צ 3']);

    expect(d.requests).toContain('אישור תוכניות האימון: ניווט לילה, מטווח הפעלת כוח ותרגיל התקפה');
    expect(d.requests.join('\n')).toContain('הזמנה לטקס אמצע קורס');
    expect(d.visit?.title).toBe('טקס אמצע קורס');
    expect(d.bluf.text).toContain('שבועות 1-4 מתוך 5 בקורס: שבוע התקפה, שבוע הגנה, שבוע שטח ושבוע מבחנים.');
    expect(d.bluf.text).toContain('בתקופה: 2 מבחנים, 3 פעילויות שטח, טקס אחד ופעילות לילה אחת.');
    expect(d.bluf.text).toContain('0 מתוך 4 התוכניות השבועיות אושרו.');
    expect(d.status).toBe('draft');
  });

  it("does not leave out a weekend between weeks: it is the week before's", async () => {
    await event('תרגיל סוף שבוע', '2026-10-10', '06:00', '20:00', c.ids.s3);
    const d = await tw();
    expect(d.weeks[0].key.map((e) => e.title)).toContain('תרגיל סוף שבוע');
    expect(d.weeks[1].key.map((e) => e.title)).not.toContain('תרגיל סוף שבוע');
    expect(d.milestones.map((e) => e.title)).toContain('תרגיל סוף שבוע');
  });

  it('reads the calendar chosen for the plans - only it, and only its main blocks', async () => {
    const company = 'https://calendar.google.com/calendar/ical/company%40group.calendar.google.com/private-x/basic.ics';
    const shown = 'https://calendar.google.com/calendar/ical/shown%40group.calendar.google.com/private-y/basic.ics';
    const weeksCal = 'https://calendar.google.com/calendar/ical/weeks%40group.calendar.google.com/private-z/basic.ics';
    const ics = (name: string, events: string[][]) =>
      ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Google Inc//Google Calendar 70.9054//EN', `X-WR-CALNAME:${name}`, ...events.flatMap((e, i) => ['BEGIN:VEVENT', `UID:${name}-${i}@google.com`, ...e, 'END:VEVENT']), 'END:VCALENDAR'].join('\r\n');
    const calendars: Record<string, string> = {
      [company]: ics('יומן הפלוגה', [
        // a one-day marker naming the week is not an activity
        ['DTSTART;VALUE=DATE:20261011', 'DTEND;VALUE=DATE:20261012', 'SUMMARY:שבוע 2 - הגנה'],
        ['DTSTART:20261012T060000Z', 'DTEND:20261012T090000Z', 'SUMMARY:תרגיל הגנה בשטח', 'LOCATION:שטח צפוני'],
        // a block of whole days is one of the main blocks
        ['DTSTART;VALUE=DATE:20261014', 'DTEND;VALUE=DATE:20261017', 'SUMMARY:גיבוש פלוגתי'],
        // a lesson and the routine are not
        ['DTSTART:20261013T070000Z', 'DTEND:20261013T080000Z', 'SUMMARY:שיעור: עקרונות הגנה'],
        ['DTSTART:20261011T033000Z', 'DTEND:20261011T040000Z', 'RRULE:FREQ=DAILY;COUNT=5', 'SUMMARY:מסדר בוקר'],
      ]),
      [shown]: ics('יומן אחר', [['DTSTART:20261013T120000Z', 'DTEND:20261013T150000Z', 'SUMMARY:תרגיל מהיומן האחר']]),
      [weeksCal]: ics('יומן השבועות', [['DTSTART:20261012T120000Z', 'DTEND:20261012T150000Z', 'SUMMARY:מטווח מיומן השבועות']]),
    };
    setCalendarFetcher(async (url) => calendars[url] ?? '');
    const titles = (d: ThreeWeekPlan) => d.weeks.flatMap((w) => w.key.map((e) => e.title));
    try {
      // the calendar the weeks came from is not read; with no calendar chosen, the schedule's are
      db().run("INSERT INTO meta(key, value) VALUES ('weeks_calendar_url', ?)", weeksCal);
      expect((await c.cmd.post('/api/calendar/sources', { name: '', url: shown })).status).toBe(200);
      let d = await tw();
      expect(d).toMatchObject({ calendarsFrom: 'schedule', calendars: [{ name: 'יומן אחר', count: 1, error: null }] });
      expect(titles(d)).toContain('תרגיל מהיומן האחר');
      expect(titles(d)).not.toContain('מטווח מיומן השבועות');

      // the one the server was set up with: only it, by its Google name, its main blocks
      process.env.PLAN_CALENDAR_URL = company;
      d = await tw();
      expect(d).toMatchObject({ calendarsFrom: 'plan', calendars: [{ name: 'יומן הפלוגה', count: 2, error: null }] });
      expect(d.weeks[1].key.map((e) => e.title)).toEqual(['תרגיל הגנה בשטח', 'גיבוש פלוגתי']);
      expect(d.weeks[1].key[1]).toMatchObject({ date: '2026-10-14', endDate: '2026-10-16', startTime: null });
      expect(titles(d)).not.toContain('תרגיל מהיומן האחר');
      expect(titles(d)).not.toContain('שיעור: עקרונות הגנה');
      // the week's own document reads it too
      expect((await doc(1)).horizon[0].events.map((e) => e.title)).toEqual(['תרגיל הגנה בשטח', 'גיבוש פלוגתי']);

      // the commander's to see and change
      expect((await c.s1.get('/api/plan-calendars')).status).toBe(403);
      expect((await c.cmd.get('/api/plan-calendars')).body).toEqual({ calendars: [{ index: 0, name: 'יומן הפלוגה', error: null, loading: false }], fromServer: true });
      expect((await c.cmd.post('/api/plan-calendars', { url: company })).status).toBe(400); // already chosen
      // none chosen: back to the schedule's calendars
      expect((await c.cmd.del('/api/plan-calendars/0')).body).toEqual({ calendars: [], fromServer: false });
      expect((await tw()).calendarsFrom).toBe('schedule');
      // chosen in the app, with no name: the one it has in Google
      expect((await c.cmd.post('/api/plan-calendars', { name: '', url: company })).body).toEqual({ calendars: [{ index: 0, name: 'יומן הפלוגה', error: null, loading: false }], fromServer: false });
      expect((await tw()).calendars).toEqual([{ name: 'יומן הפלוגה', count: 2, error: null, loading: false }]);
    } finally {
      delete process.env.PLAN_CALENDAR_URL;
      setCalendarFetcher(async () => '');
    }
  });

  it('a big calendar Google is slow to send: chosen at once, loading meanwhile, then kept for every instance', async () => {
    const company = 'https://calendar.google.com/calendar/ical/big%40group.calendar.google.com/private-b/basic.ics';
    const text = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'X-WR-CALNAME:יומן גדול',
      ...['20261012', '20261013'].flatMap((d, i) => ['BEGIN:VEVENT', `UID:big-${i}@google.com`, `DTSTART:${d}T060000Z`, `DTEND:${d}T090000Z`, `SUMMARY:תרגיל ${i + 1}`, 'END:VEVENT']),
      'END:VCALENDAR',
    ].join('\r\n');
    let send: (t: string) => void = () => undefined;
    let mode: 'slow' | 'hang' | 'timeout' = 'slow';
    setCalendarFetcher((url) => {
      if (mode === 'timeout') return Promise.reject(Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' }));
      if (mode === 'hang' || url !== company) return new Promise<string>(() => undefined);
      return new Promise<string>((r) => (send = r));
    });
    setCalendarWaits(20, 40);
    try {
      // Google has not sent it yet: chosen all the same, and said to be on its way
      const chosen = await c.cmd.post('/api/plan-calendars', { name: '', url: company });
      expect(chosen.status).toBe(200);
      expect(chosen.body.calendars).toEqual([{ index: 0, name: 'יומן Google', error: null, loading: true }]);
      expect((await tw()).calendars).toEqual([{ name: 'יומן Google', count: 0, error: null, loading: true }]);
      // it comes in: its name and its blocks
      send(text);
      await calendarReadsSettled();
      expect((await c.cmd.get('/api/plan-calendars')).body.calendars).toEqual([{ index: 0, name: 'יומן גדול', error: null, loading: false }]);
      expect((await tw()).calendars).toEqual([{ name: 'יומן גדול', count: 2, error: null, loading: false }]);
      // an instance starting cold has the shared copy at once, while Google would keep it waiting
      mode = 'hang';
      forgetCalendarCopies();
      expect((await tw()).calendars).toEqual([{ name: 'יומן גדול', count: 2, error: null, loading: false }]);
      // Google not sending a calendar in time: said in words
      mode = 'timeout';
      const late = await c.cmd.post('/api/plan-calendars', { name: '', url: 'https://calendar.google.com/calendar/ical/late%40group.calendar.google.com/private-l/basic.ics' });
      expect(late.status).toBe(400);
      expect(late.body.error).toContain('Google לא סיים לשלוח את היומן בזמן');
    } finally {
      setCalendarWaits(2_500, 5_000);
      setCalendarFetcher(async () => '');
      await c.cmd.del('/api/plan-calendars/0');
    }
  });

  it('starts at any week; at the end of the course it holds fewer weeks', async () => {
    const d = await tw(`/${weekIds[3]}`);
    expect(d).toMatchObject({ current: false, position: { first: 4, last: 5, total: 5 } });
    expect(d.weeks.map((w) => w.week.name)).toEqual(['שבוע מבחנים', 'שבוע סיום']);
    expect((await c.cmd.get('/api/three-week/9999')).status).toBe(404);
  });

  it("says where each week's own plan stands, and the commander rewrites the bottom line", async () => {
    await c.cmd.post(`/api/plans/${weekIds[1]}/approve`, { by: 'מח"ט', on: '2026-10-01' });
    let d = await tw();
    expect(d.weeks[1].plan).toMatchObject({ status: 'approved', approval: { by: 'מח"ט', on: '2026-10-01' } });
    expect(d.bluf.text).toContain('1 מתוך 4 התוכניות השבועיות אושרו.');
    d = (await c.cmd.patch(`/api/three-week/${weekIds[0]}`, { bluf: 'שורה תחתונה לארבעת השבועות' })).body as ThreeWeekPlan;
    expect(d.bluf).toMatchObject({ text: 'שורה תחתונה לארבעת השבועות', edited: true });
    d = (await c.cmd.patch(`/api/three-week/${weekIds[0]}`, { bluf: null })).body as ThreeWeekPlan;
    expect(d.bluf.edited).toBe(false);
    // a week's own wording of what it asks comes first
    await c.cmd.patch(`/api/plans/${weekIds[2]}`, { requests: ['רכב נוסף לטקס'] });
    expect((await tw()).requests[0]).toBe('רכב נוסף לטקס');
  });

  it('records the approval of the four weeks, and shows what changed in them since', async () => {
    expect((await c.cmd.post(`/api/three-week/${weekIds[0]}/approve`, { by: 'מח"ט', on: '2026-10-09' })).status).toBe(400); // not yet
    let d = (await c.cmd.post(`/api/three-week/${weekIds[0]}/approve`, { by: 'אל"ם ישראלי', on: '2026-10-01', notes: 'לתאם את הטקס מול ההורים' })).body as ThreeWeekPlan;
    expect(d).toMatchObject({ status: 'approved', approval: { by: 'אל"ם ישראלי', on: '2026-10-01', notes: 'לתאם את הטקס מול ההורים' }, changes: [] });
    expect((await c.cmd.patch(`/api/events/${eventIds['טקס אמצע קורס']}`, { date: '2026-10-21' })).status).toBe(200);
    d = await tw();
    expect(d.changes).toEqual(['הוזז: טקס אמצע קורס - משלישי 20.10 18:00 לרביעי 21.10 18:00']);
    // the four weeks from the next week are a document of their own
    expect((await tw(`/${weekIds[1]}`)).status).toBe('draft');
    d = (await c.cmd.patch(`/api/three-week/${weekIds[0]}`, { status: 'ready' })).body as ThreeWeekPlan;
    expect(d).toMatchObject({ status: 'ready', approval: null, changes: [] });
  });
});
