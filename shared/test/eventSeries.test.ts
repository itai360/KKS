import { describe, expect, it } from 'vitest';
import { repeatText, SERIES_MAX, seriesDates, seriesSpan } from '../eventSeries';

describe('a repeating event', () => {
  it('falls on every day, every few days, every week or every other week', () => {
    expect(seriesDates('2026-10-05', { freq: 'daily', interval: 1, until: '2026-10-08' })).toEqual(['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08']);
    expect(seriesDates('2026-10-05', { freq: 'daily', interval: 3, until: '2026-10-12' })).toEqual(['2026-10-05', '2026-10-08', '2026-10-11']);
    expect(seriesDates('2026-10-05', { freq: 'weekly', interval: 1, until: '2026-10-26' })).toEqual(['2026-10-05', '2026-10-12', '2026-10-19', '2026-10-26']);
    expect(seriesDates('2026-10-05', { freq: 'weekly', interval: 2, until: '2026-11-02' })).toEqual(['2026-10-05', '2026-10-19', '2026-11-02']);
  });

  it('falls on the working days, Sunday to Thursday', () => {
    // 30.10.2026 is a Friday
    expect(seriesDates('2026-10-29', { freq: 'weekdays', interval: 1, until: '2026-11-03' })).toEqual(['2026-10-29', '2026-11-01', '2026-11-02', '2026-11-03']);
  });

  it('keeps the day of the month, and skips a month without it', () => {
    expect(seriesDates('2026-01-31', { freq: 'monthly', interval: 1, until: '2026-06-30' })).toEqual(['2026-01-31', '2026-03-31', '2026-05-31']);
    expect(seriesDates('2026-10-15', { freq: 'monthly', interval: 2, until: '2027-04-15' })).toEqual(['2026-10-15', '2026-12-15', '2027-02-15', '2027-04-15']);
  });

  it('stops at its last day, at most a year and so many events', () => {
    expect(seriesDates('2026-10-05', { freq: 'weekly', interval: 1, until: '2026-10-04' })).toEqual([]);
    expect(seriesDates('2026-10-05', { freq: 'daily', interval: 1, until: '2030-01-01' })).toHaveLength(SERIES_MAX);
    const weekly = seriesDates('2026-10-05', { freq: 'weekly', interval: 1, until: '2030-01-01' });
    expect(weekly[weekly.length - 1] <= '2027-10-06').toBe(true);
    expect(seriesSpan('2026-10-05', { freq: 'weekly', interval: 1, until: '2026-10-26' })).toEqual({ count: 4, last: '2026-10-26' });
  });

  it('says how often in words', () => {
    expect(repeatText({ freq: 'weekly', interval: 1 })).toBe('כל שבוע');
    expect(repeatText({ freq: 'weekly', interval: 2 })).toBe('כל שבועיים');
    expect(repeatText({ freq: 'daily', interval: 3 })).toBe('כל 3 ימים');
    expect(repeatText({ freq: 'weekdays', interval: 2 })).toBe('כל יום עבודה (ראשון עד חמישי)');
  });
});
