import { describe, expect, it } from 'vitest';
import { eventSpan, fitLanes, fromMinutes, laneCount, layoutDay, layoutSpans, monthWeeks, movedSpan, resizedEnd, stepDate, viewDays, viewTitle, yearMonths } from '../calendarGrid';

describe('calendar grid', () => {
  it('reads event times as minutes', () => {
    expect(eventSpan('08:30', '10:00')).toEqual({ start: 510, end: 600 });
    expect(eventSpan('08:30', null)).toEqual({ start: 510, end: 570 });
    expect(eventSpan('23:30', null)).toEqual({ start: 1410, end: 1440 });
    expect(eventSpan('22:00', '01:00')).toEqual({ start: 1320, end: 1440 }); // past midnight: to the end of the day
    expect(eventSpan('22:00', '23:59')).toEqual({ start: 1320, end: 1440 });
    expect(fromMinutes(1440)).toBe('23:59');
    expect(fromMinutes(65)).toBe('01:05');
  });

  it('shows a whole number of weeks in a month', () => {
    const oct = monthWeeks('2026-10-15'); // 1.10.2026 is a Thursday, 31.10 a Saturday
    expect(oct).toHaveLength(5);
    expect(oct[0][0]).toBe('2026-09-27');
    expect(oct[4][6]).toBe('2026-10-31');
    const feb = monthWeeks('2026-02-10'); // 1.2.2026 is a Sunday, 28 days
    expect(feb).toHaveLength(4);
    expect(monthWeeks('2026-08-01')).toHaveLength(6); // starts on Saturday, 31 days
  });

  it('knows the days of each view', () => {
    expect(viewDays('day', '2026-10-01')).toEqual(['2026-10-01']);
    expect(viewDays('week', '2026-10-01')).toEqual(['2026-09-27', '2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02', '2026-10-03']);
    expect(viewDays('month', '2026-10-01')).toHaveLength(35);
  });

  it('steps by day, week and month', () => {
    expect(stepDate('day', '2026-10-01', -1)).toBe('2026-09-30');
    expect(stepDate('week', '2026-10-01', 1)).toBe('2026-10-08');
    expect(stepDate('month', '2026-01-31', 1)).toBe('2026-02-28');
    expect(stepDate('month', '2026-01-15', -1)).toBe('2025-12-15');
    expect(stepDate('month', '2026-12-15', 1)).toBe('2027-01-15');
  });

  it('titles a view by its month', () => {
    expect(viewTitle('month', '2026-10-15')).toBe('אוקטובר 2026');
    expect(viewTitle('week', '2026-10-01')).toBe('ספטמבר - אוקטובר 2026');
    expect(viewTitle('week', '2026-12-30')).toBe('דצמבר 2026 - ינואר 2027');
    expect(viewTitle('day', '2026-10-01')).toBe('אוקטובר 2026');
  });

  it('puts overlapping events side by side and the rest at full width', () => {
    const items = [
      { id: 'a', s: '08:00', e: '10:00' },
      { id: 'b', s: '09:00', e: '09:30' },
      { id: 'c', s: '09:30', e: '11:00' }, // b has ended: takes b's column
      { id: 'd', s: '12:00', e: '13:00' }, // alone
      { id: 'e', s: '14:00', e: '14:10' }, // shown 30 minutes tall
      { id: 'f', s: '14:20', e: '15:00' }, // so it shares the row with e
    ];
    const placed = Object.fromEntries(layoutDay(items, (i) => eventSpan(i.s, i.e)).map((p) => [p.item.id, p]));
    expect([placed.a.col, placed.a.cols]).toEqual([0, 2]);
    expect([placed.b.col, placed.b.cols]).toEqual([1, 2]);
    expect([placed.c.col, placed.c.cols]).toEqual([1, 2]);
    expect([placed.d.col, placed.d.cols]).toEqual([0, 1]);
    expect([placed.e.col, placed.f.col, placed.f.cols]).toEqual([0, 1, 2]);
    expect([placed.a.span, placed.b.span, placed.d.span]).toEqual([1, 1, 1]);
  });

  it('stretches an event over the columns that are free during it', () => {
    const items = [
      { id: 'long', s: '08:00', e: '12:00' },
      { id: 'x', s: '08:00', e: '09:00' },
      { id: 'y', s: '08:00', e: '09:00' },
      { id: 'w', s: '10:00', e: '11:00' }, // takes x's column, and y's is free by then
    ];
    const placed = Object.fromEntries(layoutDay(items, (i) => eventSpan(i.s, i.e)).map((p) => [p.item.id, p]));
    expect([placed.long.col, placed.long.span, placed.long.cols]).toEqual([0, 1, 3]);
    expect([placed.x.col, placed.x.span]).toEqual([1, 1]);
    expect([placed.w.col, placed.w.span]).toEqual([1, 2]);
  });

  it('moves and resizes in whole steps inside the day', () => {
    expect(movedSpan(480, 540, 37)).toEqual({ start: 510, end: 570 });
    expect(movedSpan(480, 540, -600)).toEqual({ start: 0, end: 60 });
    expect(movedSpan(1380, 1440, 120)).toEqual({ start: 1380, end: 1440 });
    expect(resizedEnd(480, 540, -200)).toBe(495);
    expect(resizedEnd(480, 540, 55)).toBe(600);
    expect(resizedEnd(480, 540, 52)).toBe(585);
    expect(resizedEnd(480, 540, 2000)).toBe(1440);
  });

  it('shows four days, and a year', () => {
    expect(viewDays('four', '2026-10-30')).toEqual(['2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02']);
    expect(stepDate('four', '2026-10-30', 1)).toBe('2026-11-03');
    expect(viewTitle('four', '2026-10-30')).toBe('אוקטובר - נובמבר 2026');
    const year = viewDays('year', '2026-06-15');
    expect(year).toHaveLength(365);
    expect([year[0], year[364]]).toEqual(['2026-01-01', '2026-12-31']);
    expect(viewDays('year', '2028-03-01')).toHaveLength(366);
    expect(yearMonths('2026-06-15')).toEqual(Array.from({ length: 12 }, (_, i) => `2026-${String(i + 1).padStart(2, '0')}-01`));
    expect(stepDate('year', '2028-02-29', 1)).toBe('2029-02-28');
    expect(stepDate('year', '2026-06-15', -1)).toBe('2025-06-15');
    expect(viewTitle('year', '2026-06-15')).toBe('2026');
  });

  it('lays things of a day or more in rows over the days shown', () => {
    const week = viewDays('week', '2026-10-25'); // 25.10 - 31.10
    const items = [
      { id: 'week', startDate: '2026-10-25', endDate: '2026-10-29' },
      { id: 'leave', startDate: '2026-10-20', endDate: '2026-10-26' }, // began the week before
      { id: 'task', startDate: '2026-10-27', endDate: '2026-10-27' },
      { id: 'trip', startDate: '2026-10-30', endDate: '2026-11-03' }, // goes on into the next week
      { id: 'later', startDate: '2026-11-08', endDate: '2026-11-08' }, // not in this week
    ];
    const lanes = Object.fromEntries(layoutSpans(items, week, (i) => i).map((l) => [l.item.id, l]));
    expect(lanes.later).toBeUndefined();
    expect([lanes.week.start, lanes.week.end, lanes.week.lane]).toEqual([0, 4, 0]); // the longer of the two first
    expect([lanes.leave.start, lanes.leave.end, lanes.leave.lane, lanes.leave.cutStart]).toEqual([0, 1, 1, true]);
    expect([lanes.task.start, lanes.task.lane]).toEqual([2, 1]); // the leave is over by then
    expect([lanes.trip.start, lanes.trip.end, lanes.trip.lane, lanes.trip.cutEnd]).toEqual([5, 6, 0, true]);
    expect(laneCount(Object.values(lanes))).toBe(2);
  });

  it('puts what does not fit in a day under "more"', () => {
    const days = viewDays('week', '2026-10-25');
    const one = (id: string, d: string) => ({ id, startDate: d, endDate: d });
    const items = [one('a', '2026-10-26'), one('b', '2026-10-26'), one('c', '2026-10-26'), one('d', '2026-10-26'), { id: 'span', startDate: '2026-10-25', endDate: '2026-10-27' }, one('e', '2026-10-28')];
    const lanes = layoutSpans(items, days, (i) => i);
    const { shown, more } = fitLanes(lanes, days.length, 3);
    // the 26th has five: the span (in the first row, it started earlier), one more and "עוד 3"
    expect(more).toEqual([0, 3, 0, 0, 0, 0, 0]);
    expect(shown.map((l) => l.item.id).sort()).toEqual(['a', 'e', 'span']);
    // with room for all, nothing is hidden
    expect(fitLanes(lanes, days.length, 6).more.every((n) => n === 0)).toBe(true);
  });

  it('hides a thing on all its days when it does not fit on one of them', () => {
    const days = viewDays('week', '2026-10-25');
    const span = (id: string, a: string, b: string) => ({ id, startDate: a, endDate: b });
    const items = [
      span('A', '2026-10-25', '2026-10-27'),
      span('B', '2026-10-25', '2026-10-27'),
      span('T', '2026-10-27', '2026-10-28'), // third row on the 27th, which is full
      span('u', '2026-10-27', '2026-10-27'),
      span('v', '2026-10-27', '2026-10-27'),
    ];
    const { shown, more } = fitLanes(layoutSpans(items, days, (i) => i), days.length, 3);
    expect(shown.map((l) => l.item.id).sort()).toEqual(['A', 'B']);
    // on the 28th T would fit, but it is one thing: counted there as well
    expect(more).toEqual([0, 0, 3, 1, 0, 0, 0]);
  });
});
