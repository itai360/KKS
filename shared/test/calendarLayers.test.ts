import { describe, expect, it } from 'vitest';
import {
  dayOrder,
  dedupe,
  externalColor,
  GOOGLE_COLORS,
  CAL_COLORS,
  CAL_COLOR_HEX,
  sourceColor,
  sourceGoogleColor,
  fromAbsence,
  fromDebrief,
  fromEvent,
  fromExperience,
  fromExternal,
  fromTask,
  fromWeek,
  inRange,
  isTimed,
  layerShown,
  loadByDay,
  matchesTaskFilter,
  NO_TASK_FILTER,
  taskQuery,
} from '../calendarLayers';
import type { Absence, Debrief, Experience, ExternalEvent, ScheduleEvent, Task, Week } from '../types';

const ev = (id: number, date: string, over: Partial<ScheduleEvent> = {}): ScheduleEvent =>
  ({ id, date, startTime: '09:00', endTime: '10:00', title: `אירוע ${id}`, location: 'מגרש', ownerId: null, ownerName: null, weekId: null, notes: '', cancelled: false, taskTotal: 0, taskDone: 0, ...over }) as ScheduleEvent;
const ext = (id: string, date: string, startTime: string | null): ExternalEvent => ({ id, sourceId: 3, sourceName: 'יומן הפלוגה', date, startTime, endTime: null, title: `חיצוני ${id}`, location: '' });
const task = (id: number, deadline: string, over: Partial<Task> = {}) =>
  ({ id, title: `משימה ${id}`, deadline, ownerName: 'דנה כהן', status: 'open', overdue: false, eventId: null, ...over }) as unknown as Task;
// the deadline as the course's day and time - written straight into the task here
const at = (iso: string) => ({ date: iso.slice(0, 10), time: iso.slice(11, 16) });

describe('the calendar layers', () => {
  it('shows each layer as the person left it, or by its default', () => {
    expect(layerShown({}, 'events')).toBe(true);
    expect(layerShown({}, 'staffTasks')).toBe(false);
    expect(layerShown({}, 'ext:4')).toBe(true); // a connected Google calendar: shown
    expect(layerShown({ events: false, 'ext:4': false, absences: true }, 'events')).toBe(false);
    expect(layerShown({ 'ext:4': false }, 'ext:4')).toBe(false);
    expect(layerShown({ absences: true }, 'absences')).toBe(true);
    expect(externalColor(0)).not.toBe(externalColor(1));
    expect(externalColor(12)).toBe(externalColor(0));
  });

  it('turns every kind of thing into one shape, only by the days it really has', () => {
    const e = fromEvent(ev(1, '2026-10-26'));
    expect([e.key, e.layer, e.date, e.endDate, e.start, e.end, e.color, isTimed(e)]).toEqual(['event:1', 'events', '2026-10-26', '2026-10-26', '09:00', '10:00', 'blue', true]);
    // all day, over several days, in a colour of its own
    const long = fromEvent(ev(2, '2026-10-26', { allDay: true, endDate: '2026-10-28', color: 'red', startTime: '00:00', endTime: null }));
    expect([long.start, long.endDate, long.color, isTimed(long)]).toEqual([null, '2026-10-28', 'red', false]);
    // a colour the calendar does not know falls back to the course's blue; a cancelled event is faded
    const odd = fromEvent(ev(3, '2026-10-26', { color: 'magenta', cancelled: true }));
    expect([odd.color, odd.faded]).toEqual(['blue', true]);

    const x = fromExternal(ext('abc', '2026-10-27', null), 'graphite');
    expect([x.key, x.layer, x.start, isTimed(x)]).toEqual(['ext:3:abc', 'ext:3', null, false]);
    expect(isTimed(fromExternal(ext('def', '2026-10-27', '08:00'), 'graphite'))).toBe(true);

    const t = fromTask(task(7, '2026-10-27T18:00'), 'myTasks', at);
    expect([t.key, t.date, t.start, t.color, t.sub, isTimed(t)]).toEqual(['task:7', '2026-10-27', '18:00', 'teal', 'דנה כהן', false]);
    expect(fromTask(task(8, '2026-10-20T18:00', { overdue: true }), 'staffTasks', at).color).toBe('red');
    expect(fromTask(task(9, '2026-10-20T18:00', { status: 'done' }), 'staffTasks', at).faded).toBe(true);

    const w = fromWeek({ id: 5, name: 'שבוע שטח', startDate: '2026-10-25', endDate: '2026-10-29', leadName: 'מפק"צ 2', status: 'active' } as unknown as Week);
    expect([w.date, w.endDate, w.sub, w.start]).toEqual(['2026-10-25', '2026-10-29', 'מפק"צ מוביל: מפק"צ 2', null]);

    // an experience: the role, the cadet and the days - nothing of its feedback
    const xp = fromExperience({ id: 2, role: 'מפקד מחלקה', cadetName: 'יואב לוי', teamName: 'צוות 1', startDate: '2026-10-25', endDate: '2026-10-30', phase: 'active', feedback: 'סודי' } as unknown as Experience);
    expect([xp.title, xp.sub, xp.endDate]).toEqual(['מפקד מחלקה: יואב לוי', 'צוות 1', '2026-10-30']);
    expect(JSON.stringify([xp.title, xp.sub])).not.toContain('סודי');

    const d = fromDebrief({ id: 4, title: 'תחקיר מטווח', occurredOn: '2026-10-28', status: 'draft' } as unknown as Debrief);
    expect([d.date, d.endDate, d.sub]).toEqual(['2026-10-28', '2026-10-28', 'טיוטה']);
  });

  it('says why someone is away only to them and to the commander', () => {
    const a = { id: 1, userId: 9, userName: 'רון שמש', startDate: '2026-10-26', endDate: '2026-10-27', reason: 'sick', note: '' } as unknown as Absence;
    expect(fromAbsence(a, true).title).toBe('רון שמש - מחלה');
    expect(fromAbsence(a, false).title).toBe('רון שמש - לא זמין');
    expect(fromAbsence(a, false).title).not.toContain('מחלה');
  });

  it('orders a day: the weeks, who is away, the rest, then deadlines by the hour', () => {
    const items = [
      fromTask(task(1, '2026-10-26T18:00'), 'myTasks', at),
      fromTask(task(2, '2026-10-26T09:00'), 'myTasks', at),
      fromDebrief({ id: 4, title: 'תחקיר', occurredOn: '2026-10-26', status: 'final' } as unknown as Debrief),
      fromWeek({ id: 5, name: 'שבוע 5', startDate: '2026-10-25', endDate: '2026-10-29', leadName: null, status: 'active' } as unknown as Week),
      fromAbsence({ id: 1, userId: 9, userName: 'רון', startDate: '2026-10-26', endDate: '2026-10-26', reason: 'leave', note: '' } as Absence, true),
    ];
    expect([...items].sort(dayOrder).map((i) => i.key)).toEqual(['week:5', 'absence:1', 'debrief:4', 'task:2', 'task:1']);
  });

  it('keeps what touches the days shown, counts how busy each day is, and shows a task once', () => {
    const items = [
      fromEvent(ev(1, '2026-10-26')),
      fromEvent(ev(2, '2026-10-26', { cancelled: true })), // not counted
      fromExternal(ext('a', '2026-10-26', '08:00'), 'graphite'),
      fromTask(task(7, '2026-10-26T18:00'), 'myTasks', at),
      fromWeek({ id: 5, name: 'שבוע', startDate: '2026-10-25', endDate: '2026-10-29', leadName: null, status: 'active' } as unknown as Week), // not counted
      fromEvent(ev(3, '2026-11-02')),
    ];
    expect(inRange(items, '2026-10-29', '2026-10-31').map((i) => i.key)).toEqual(['week:5']);
    const load = loadByDay(items);
    expect(load.get('2026-10-26')).toBe(3);
    expect(load.get('2026-11-02')).toBe(1);
    expect(load.get('2026-10-27')).toBeUndefined();
    const mine = fromTask(task(7, '2026-10-26T18:00'), 'myTasks', at);
    const staff = fromTask(task(7, '2026-10-26T18:00'), 'staffTasks', at);
    expect(dedupe([mine, staff]).map((i) => i.layer)).toEqual(['myTasks']);
  });

  it('asks the server for the deadlines of a layer, with its filter', () => {
    const q = (s: string) => Object.fromEntries(new URLSearchParams(s.split('?')[1]));
    expect(q(taskQuery(NO_TASK_FILTER, true, '2026-10-25', '2026-10-31'))).toEqual({ from: '2026-10-25', to: '2026-10-31', hideClosed: '1', recurring: '0', owner: 'me' });
    const f = { scope: 'urgent' as const, linked: true, domain: 'לוגיסטיקה', weekId: 5, trackId: 2, ownerId: 9 };
    expect(q(taskQuery(f, false, '2026-10-25', '2026-10-31'))).toEqual({
      from: '2026-10-25',
      to: '2026-10-31',
      hideClosed: '1',
      recurring: '0',
      owner: '9',
      domain: 'לוגיסטיקה',
      week: '5',
      track: '2',
      priority: 'high,critical',
    });
    // mine: always mine, whoever was picked for the staff's
    expect(q(taskQuery(f, true, '2026-10-25', '2026-10-31')).owner).toBe('me');
    expect(q(taskQuery({ ...NO_TASK_FILTER, scope: 'overdue' }, false, '2026-10-25', '2026-10-31')).status).toBe('overdue');
    // only preparation tasks of an event: asked of each task here
    expect(matchesTaskFilter(task(1, '2026-10-26T18:00', { eventId: 4 }), f)).toBe(true);
    expect(matchesTaskFilter(task(2, '2026-10-26T18:00'), f)).toBe(false);
    expect(matchesTaskFilter(task(2, '2026-10-26T18:00'), NO_TASK_FILTER)).toBe(true);
  });
});

describe("Google Calendar's colours", () => {
  it("draws events in Google's eleven event colours and calendars in its 24 calendar colours", () => {
    expect(CAL_COLORS).toHaveLength(11);
    expect(new Set(Object.values(CAL_COLOR_HEX)).size).toBe(11);
    expect(GOOGLE_COLORS).toHaveLength(24);
    expect(new Set(GOOGLE_COLORS.map((c) => c.id)).size).toBe(24);
    expect(new Set(GOOGLE_COLORS.map((c) => c.hex)).size).toBe(24);
    // every event colour is one of Google's calendar colours too, the same hue
    const hexes = new Set<string>(GOOGLE_COLORS.map((c) => c.hex));
    for (const hex of Object.values(CAL_COLOR_HEX)) expect(hexes.has(hex), hex).toBe(true);
  });

  it("draws a connected calendar in the colour chosen for it, else by its place", () => {
    expect(sourceColor('grape', 0)).toBe('g-grape');
    expect(sourceGoogleColor('grape', 3)).toBe('grape');
    expect(sourceColor(null, 1)).toBe(externalColor(1));
    expect(sourceColor('not-a-colour', 2)).toBe(externalColor(2));
  });
});
