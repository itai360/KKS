import { describe, expect, it } from 'vitest';
import {
  addDays,
  diffDays,
  formatDeadline,
  localDateKey,
  localTime,
  startOfWeek,
  weekdayOf,
  zonedIso,
} from '../dates';

const TZ = 'Asia/Jerusalem';

describe('dates', () => {
  it('converts wall-clock Israel time to UTC across DST', () => {
    // Summer (IDT, UTC+3)
    expect(zonedIso('2026-07-01', '18:00', TZ)).toBe('2026-07-01T15:00:00.000Z');
    // Winter (IST, UTC+2)
    expect(zonedIso('2026-12-01', '18:00', TZ)).toBe('2026-12-01T16:00:00.000Z');
  });

  it('round-trips local date and time', () => {
    const iso = zonedIso('2026-10-04', '06:30', TZ);
    expect(localDateKey(iso, TZ)).toBe('2026-10-04');
    expect(localTime(iso, TZ)).toBe('06:30');
  });

  it('local day differs from UTC day near midnight', () => {
    // 23:30 UTC on Oct 1 is already Oct 2 in Israel
    expect(localDateKey('2026-10-01T23:30:00Z', TZ)).toBe('2026-10-02');
  });

  it('calendar arithmetic', () => {
    expect(addDays('2026-10-30', 3)).toBe('2026-11-02');
    expect(weekdayOf('2026-10-04')).toBe(0); // Sunday
    expect(startOfWeek('2026-10-01')).toBe('2026-09-27');
    expect(diffDays('2026-10-07', '2026-10-01')).toBe(6);
  });

  it('formats deadlines relative to now in Hebrew', () => {
    const now = new Date(zonedIso('2026-10-01', '10:00', TZ));
    expect(formatDeadline(zonedIso('2026-10-01', '18:00', TZ), now, TZ)).toBe('היום 18:00');
    expect(formatDeadline(zonedIso('2026-10-02', '12:00', TZ), now, TZ)).toBe('מחר 12:00');
    expect(formatDeadline(zonedIso('2026-09-30', '12:00', TZ), now, TZ)).toBe('אתמול 12:00');
    expect(formatDeadline(zonedIso('2026-10-07', '18:00', TZ), now, TZ)).toBe('רביעי 18:00');
    expect(formatDeadline(zonedIso('2026-10-20', '09:00', TZ), now, TZ)).toBe('20.10 09:00');
  });
});

describe('a time of day as typed', () => {
  it('takes shape as 24-hour time, whatever the device language', async () => {
    const { parseTime, shapeTime } = await import('../dates');
    expect(['1400', '14:00', '9:30', '930', '0000', '23:59'].map(parseTime)).toEqual(['14:00', '14:00', '09:30', '09:30', '00:00', '23:59']);
    expect(['24:00', '1260', '2:00 PM', '', '14:'].map(parseTime)).toEqual([null, null, null, null, null]);
    expect(['1', '14', '140', '1400', '9:', '14:0', '14000'].map(shapeTime)).toEqual(['1', '14', '1:40', '14:00', '9:', '14:0', '14:00']);
  });
});

describe('a date as typed', () => {
  it('is day, month, year - as Israel writes it, whatever the device language', async () => {
    const { parseDateIL, fmtDateIL, shapeDate } = await import('../dates');
    expect(['06.10.2026', '6.10.2026', '6/10/2026', '06-10-2026', '06102026', '29.02.2028'].map((s) => parseDateIL(s))).toEqual(['2026-10-06', '2026-10-06', '2026-10-06', '2026-10-06', '2026-10-06', '2028-02-29']);
    // a short year only once the field is left: "06.10.20" may still become 2026
    expect([parseDateIL('06.10.26'), parseDateIL('06.10.26', true), parseDateIL('061026', true)]).toEqual([null, '2026-10-06', '2026-10-06']);
    expect(['31.04.2026', '29.02.2027', '00.10.2026', '06.13.2026', '10/06', '', '2026-10-06'].map((s) => parseDateIL(s, true))).toEqual([null, null, null, null, null, null, null]);
    expect([fmtDateIL('2026-10-06'), fmtDateIL(''), fmtDateIL('nope')]).toEqual(['06.10.2026', '', '']);
    expect(['0', '06', '061', '0610', '06102', '06102026', '061020261', '06.', '06.10.', '6.', '6.10.2026', '6/10/26', '06.102', '06.10.20261'].map(shapeDate)).toEqual([
      '0',
      '06',
      '06.1',
      '06.10',
      '06.10.2',
      '06.10.2026',
      '06.10.2026',
      '06',
      '06.10',
      '6.',
      '6.10.2026',
      '6.10.26',
      '06.10.2',
      '06.10.2026',
    ]);
  });
});
