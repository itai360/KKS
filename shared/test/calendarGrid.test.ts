import { describe, expect, it } from 'vitest';
import { eventSpan, fromMinutes, layoutDay, monthWeeks, movedSpan, resizedEnd, stepDate, viewDays, viewTitle } from '../calendarGrid';

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
});
