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
