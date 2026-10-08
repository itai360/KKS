import { describe, expect, it } from 'vitest';
import type { ExternalEvent, ScheduleEvent, Task } from '@shared/types';
import { agendaDays, dayLoad, endMinutes, foldQuiet, inMinutes, leftMinutes, nowAndNext } from '../src/lib/agenda';

const ev = (id: number, date: string, startTime: string, endTime: string | null = null, over: Partial<ScheduleEvent> = {}): ScheduleEvent =>
  ({ id, date, startTime, endTime, title: `אירוע ${id}`, location: '', ownerId: null, ownerName: null, weekId: null, notes: '', cancelled: false, taskTotal: 0, taskDone: 0, ...over }) as ScheduleEvent;
const ext = (id: string, date: string, startTime: string | null): ExternalEvent => ({ id, sourceId: 1, sourceName: 'יומן', date, startTime, endTime: null, title: `חיצוני ${id}`, location: '' });
// the deadline as the course's day and time - here written straight into the task
const task = (id: number, date: string, time: string) => ({ id, title: `משימה ${id}`, deadline: `${date}T${time}` }) as unknown as Task;
const deadlineAt = (t: Task) => ({ date: t.deadline.slice(0, 10), time: t.deadline.slice(11, 16) });

describe('the schedule as one running list', () => {
  it('puts events, Google events and deadlines of each day in one timeline', () => {
    const days = agendaDays('2026-10-08', 3, [ev(1, '2026-10-08', '10:00'), ev(2, '2026-10-08', '08:00'), ev(3, '2026-10-10', '09:00')], [ext('a', '2026-10-08', null), ext('b', '2026-10-08', '09:00')], [task(7, '2026-10-08', '10:00'), task(8, '2026-10-20', '10:00')], deadlineAt);
    expect(days.map((d) => d.date)).toEqual(['2026-10-08', '2026-10-09', '2026-10-10']);
    // all-day first, then by time; at the same minute the event before the deadline; a deadline outside the days left out
    expect(days[0].items.map((i) => i.key)).toEqual(['xa', 'e2', 'xb', 'e1', 't7']);
    expect(days[1].items).toEqual([]);
    expect(days[2].items.map((i) => i.key)).toEqual(['e3']);
  });

  it('folds quiet days in a row into one line, but never today or the day chosen', () => {
    const days = agendaDays('2026-10-08', 7, [ev(1, '2026-10-08', '10:00'), ev(2, '2026-10-13', '10:00')], [], [], deadlineAt);
    expect(foldQuiet(days, new Set(['2026-10-08']))).toEqual([
      { kind: 'day', date: '2026-10-08', items: days[0].items },
      { kind: 'gap', from: '2026-10-09', to: '2026-10-12' },
      { kind: 'day', date: '2026-10-13', items: days[5].items },
      { kind: 'gap', from: '2026-10-14', to: '2026-10-14' },
    ]);
    // today kept on its own even when quiet: the quiet days around it are two lines
    expect(foldQuiet(days, new Set(['2026-10-10'])).map((r) => (r.kind === 'gap' ? `${r.from}..${r.to}` : r.date))).toEqual([
      '2026-10-08',
      '2026-10-09..2026-10-09',
      '2026-10-10',
      '2026-10-11..2026-10-12',
      '2026-10-13',
      '2026-10-14..2026-10-14',
    ]);
  });

  it('counts a day without its cancelled events', () => {
    expect(dayLoad('2026-10-08', [ev(1, '2026-10-08', '10:00'), ev(2, '2026-10-08', '11:00', null, { cancelled: true }), ev(3, '2026-10-09', '10:00')], [ext('a', '2026-10-08', null)])).toBe(2);
  });
});

describe('now and next', () => {
  const day = '2026-10-08';
  it('finds what goes on now, how far it is, and what comes next', () => {
    const r = nowAndNext([ev(1, day, '08:00', '10:00'), ev(2, day, '11:30', '12:00'), ev(3, '2026-10-09', '09:00')], day, '09:30');
    expect(r.now?.id).toBe(1);
    expect(r.progress).toBe(0.75);
    expect(r.left).toBe(30);
    expect(r.next?.id).toBe(2);
    expect(r.until).toBe(120);
  });

  it('takes the latest of overlapping events, and skips cancelled ones', () => {
    const r = nowAndNext([ev(1, day, '06:00', '22:00'), ev(2, day, '09:00', '10:00'), ev(3, day, '09:15', '09:45', { cancelled: true })], day, '09:20');
    expect(r.now?.id).toBe(2);
    expect(r.next).toBeNull();
  });

  it('gives an event with no end an hour, and one ending at 23:59 the whole evening', () => {
    expect(endMinutes({ startTime: '10:00', endTime: null })).toBe(11 * 60);
    expect(endMinutes({ startTime: '20:00', endTime: '23:59' })).toBe(24 * 60);
    expect(endMinutes({ startTime: '22:00', endTime: '01:00' })).toBe(24 * 60);
    expect(nowAndNext([ev(1, day, '10:00')], day, '10:59').now?.id).toBe(1);
    expect(nowAndNext([ev(1, day, '10:00')], day, '11:00').now).toBeNull();
  });

  it('says how long, briefly', () => {
    expect(inMinutes(25)).toBe("בעוד 25 דק'");
    expect(inMinutes(60)).toBe('בעוד שעה');
    expect(inMinutes(120)).toBe('בעוד שעתיים');
    expect(inMinutes(135)).toBe("בעוד שעתיים ו-15 דק'");
    expect(inMinutes(180)).toBe('בעוד 3 שעות');
    expect(leftMinutes(40)).toBe("נותרו 40 דק'");
    expect(leftMinutes(60)).toBe('נותרה שעה');
    expect(leftMinutes(80)).toBe("נותרו שעה ו-20 דק'");
    // a long one: whole hours, not "14:34", which reads as a time of day
    expect(leftMinutes(874)).toBe('נותרו 15 שעות');
  });
});
