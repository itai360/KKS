import { describe, expect, it } from 'vitest';
import { countBefore, describeRRule, endBefore, expandRRule, formatRRule, lastOccurrence, nthWeekday, parseRRule, placeInMonth, repeatPresets, rruleFromRepeat, type RRule } from '../rrule';

const rule = (s: string) => {
  const r = parseRRule(s, 'Asia/Jerusalem');
  if (!r) throw new Error(`not a rule: ${s}`);
  return r;
};
const days = (s: string, start: string, from: string, to: string, ex: string[] = []) => expandRRule(rule(s), start, from, to, ex);

describe('a recurrence rule, read and written as Google Calendar keeps it', () => {
  it('reads and writes the rules of Google\'s menu', () => {
    for (const s of ['FREQ=DAILY', 'FREQ=WEEKLY;BYDAY=TH', 'FREQ=MONTHLY;BYDAY=-1TH', 'FREQ=MONTHLY;BYDAY=4TH', 'FREQ=YEARLY', 'FREQ=WEEKLY;BYDAY=SU,MO,TU,WE,TH', 'FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE;UNTIL=20261231', 'FREQ=DAILY;INTERVAL=3;COUNT=10', 'FREQ=MONTHLY;BYMONTHDAY=29']) {
      expect(formatRRule(rule(s))).toBe(s);
    }
    expect(formatRRule(rule('RRULE:freq=weekly;byday=th'))).toBe('FREQ=WEEKLY;BYDAY=TH');
  });

  it('turns down what it does not know, or what cannot be', () => {
    for (const bad of ['', 'BYDAY=TH', 'FREQ=HOURLY', 'FREQ=WEEKLY;BYDAY=XX', 'FREQ=DAILY;COUNT=0', 'FREQ=DAILY;COUNT=3;UNTIL=20261231', 'FREQ=MONTHLY;BYDAY=6TH', 'FREQ=DAILY;UNTIL=20260231', 'FREQ=DAILY;INTERVAL=0']) {
      expect(parseRRule(bad), bad).toBeNull();
    }
  });

  it('reads an end given as a moment in the course\'s own day', () => {
    // 23:59 in Israel is 21:59 UTC in the winter: still the 31st
    expect(rule('FREQ=DAILY;UNTIL=20261231T215959Z').until).toBe('2026-12-31');
    // an hour later it is already the 1st of January there
    expect(rule('FREQ=DAILY;UNTIL=20261231T225959Z').until).toBe('2027-01-01');
    expect(rule('FREQ=DAILY;UNTIL=20261231').until).toBe('2026-12-31');
  });

  it('keeps the old repeats as rules', () => {
    expect(rruleFromRepeat({ freq: 'weekly', interval: 2, until: '2026-12-31' })).toBe('FREQ=WEEKLY;INTERVAL=2;UNTIL=20261231');
    expect(rruleFromRepeat({ freq: 'weekdays', until: '2026-12-31' })).toBe('FREQ=WEEKLY;BYDAY=SU,MO,TU,WE,TH;UNTIL=20261231');
    expect(rruleFromRepeat({ freq: 'monthly' })).toBe('FREQ=MONTHLY');
  });
});

describe('the days a rule falls on', () => {
  it('every other day, in a window', () => {
    expect(days('FREQ=DAILY;INTERVAL=2', '2026-10-29', '2026-10-29', '2026-11-05')).toEqual(['2026-10-29', '2026-10-31', '2026-11-02', '2026-11-04']);
  });

  it('every week on some days, from a Thursday', () => {
    expect(days('FREQ=WEEKLY;BYDAY=SU,TU,TH', '2026-10-29', '2026-10-29', '2026-11-06')).toEqual(['2026-10-29', '2026-11-01', '2026-11-03', '2026-11-05']);
  });

  it('every two weeks on Monday', () => {
    expect(days('FREQ=WEEKLY;INTERVAL=2;BYDAY=MO', '2026-11-02', '2026-11-01', '2026-12-01')).toEqual(['2026-11-02', '2026-11-16', '2026-11-30']);
  });

  it('every working day, Sunday to Thursday', () => {
    expect(days('FREQ=WEEKLY;BYDAY=SU,MO,TU,WE,TH', '2026-10-29', '2026-10-29', '2026-11-04')).toEqual(['2026-10-29', '2026-11-01', '2026-11-02', '2026-11-03', '2026-11-04']);
  });

  it('every month on the last Thursday, and on the fourth', () => {
    expect(days('FREQ=MONTHLY;BYDAY=-1TH', '2026-10-29', '2026-10-01', '2027-01-31')).toEqual(['2026-10-29', '2026-11-26', '2026-12-31', '2027-01-28']);
    expect(days('FREQ=MONTHLY;BYDAY=4TH', '2026-10-22', '2026-10-01', '2026-12-31')).toEqual(['2026-10-22', '2026-11-26', '2026-12-24']);
  });

  it('every month on the 31st skips the months that have none, as Google Calendar does', () => {
    expect(days('FREQ=MONTHLY', '2026-10-31', '2026-10-01', '2027-03-31')).toEqual(['2026-10-31', '2026-12-31', '2027-01-31', '2027-03-31']);
  });

  it('every year on the 29th of February: only leap years', () => {
    expect(days('FREQ=YEARLY', '2028-02-29', '2028-01-01', '2033-01-01')).toEqual(['2028-02-29', '2032-02-29']);
  });

  it('ends after a number of times - the skipped days counted too', () => {
    expect(days('FREQ=WEEKLY;COUNT=3', '2026-10-29', '2026-10-01', '2027-12-31')).toEqual(['2026-10-29', '2026-11-05', '2026-11-12']);
    expect(days('FREQ=WEEKLY;COUNT=3', '2026-10-29', '2026-10-01', '2027-12-31', ['2026-11-05'])).toEqual(['2026-10-29', '2026-11-12']);
    // a window after the first days: they still count
    expect(days('FREQ=DAILY;COUNT=5', '2026-10-29', '2026-11-01', '2026-12-31')).toEqual(['2026-11-01', '2026-11-02']);
  });

  it('ends on a day, that day included', () => {
    expect(days('FREQ=DAILY;UNTIL=20261031', '2026-10-29', '2026-10-01', '2026-12-31')).toEqual(['2026-10-29', '2026-10-30', '2026-10-31']);
  });

  it('with no end, as far as asked', () => {
    expect(days('FREQ=YEARLY', '2026-10-29', '2026-01-01', '2029-12-31')).toEqual(['2026-10-29', '2027-10-29', '2028-10-29', '2029-10-29']);
    expect(lastOccurrence(rule('FREQ=YEARLY'), '2026-10-29')).toBeNull();
    expect(lastOccurrence(rule('FREQ=WEEKLY;COUNT=3'), '2026-10-29')).toBe('2026-11-12');
  });

  it('the first day is the first time even when the rule would not pick it', () => {
    expect(days('FREQ=WEEKLY;BYDAY=MO', '2026-10-29', '2026-10-29', '2026-11-10')).toEqual(['2026-10-29', '2026-11-02', '2026-11-09']);
  });

  it('places a day in its month', () => {
    expect(placeInMonth('2026-10-29')).toEqual({ n: 5, last: true });
    expect(placeInMonth('2026-10-22')).toEqual({ n: 4, last: false });
    expect(nthWeekday(2026, 11, 'MO', 5)).toBe('2026-11-30');
    expect(nthWeekday(2026, 2, 'MO', 5)).toBeNull();
  });

  it('cuts a series before a day, and carries the count over', () => {
    const r = rule('FREQ=WEEKLY;COUNT=6');
    expect(endBefore(r, '2026-10-29', '2026-11-12')).toEqual({ freq: 'WEEKLY', interval: 1, until: '2026-11-11' } satisfies RRule);
    expect(countBefore(r, '2026-10-29', '2026-11-12')).toBe(2);
  });
});

describe('a rule in words, and Google\'s menu', () => {
  it('says each rule as Google Calendar does', () => {
    const say = (s: string, start = '2026-10-29') => describeRRule(rule(s), start);
    expect(say('FREQ=DAILY')).toBe('כל יום');
    expect(say('FREQ=DAILY;INTERVAL=2')).toBe('כל יומיים');
    expect(say('FREQ=WEEKLY;BYDAY=TH')).toBe('כל שבוע ביום חמישי');
    expect(say('FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,TH')).toBe('כל שבועיים בימים שני וחמישי');
    expect(say('FREQ=WEEKLY;BYDAY=SU,MO,TU,WE,TH')).toBe('כל יום עבודה (ראשון עד חמישי)');
    expect(say('FREQ=WEEKLY;BYDAY=SA')).toBe('כל שבוע בשבת');
    expect(say('FREQ=MONTHLY;BYDAY=-1TH')).toBe('כל חודש ביום חמישי האחרון');
    expect(say('FREQ=MONTHLY')).toBe('כל חודש ב-29 לחודש');
    expect(say('FREQ=MONTHLY;INTERVAL=3')).toBe('כל 3 חודשים ב-29 לחודש');
    expect(say('FREQ=YEARLY')).toBe('כל שנה ב-29 באוקטובר');
    expect(say('FREQ=WEEKLY;BYDAY=TH;UNTIL=20261231')).toBe('כל שבוע ביום חמישי, עד 31 בדצמבר 2026');
    expect(say('FREQ=DAILY;COUNT=5')).toBe('כל יום, 5 פעמים');
  });

  it('offers the repeats Google offers for the day', () => {
    // Thursday the 29th: the fifth Thursday, the last of the month
    expect(repeatPresets('2026-10-29').map((p) => p.label)).toEqual([
      'לא חוזר',
      'כל יום',
      'כל שבוע ביום חמישי',
      'כל חודש ביום חמישי האחרון',
      'כל שנה ב-29 באוקטובר',
      'כל יום עבודה (ראשון עד חמישי)',
      'בהתאמה אישית...',
    ]);
    // the 22nd: the fourth Thursday, not the last
    expect(repeatPresets('2026-10-22').map((p) => p.rrule)).toContain('FREQ=MONTHLY;BYDAY=4TH');
    expect(repeatPresets('2026-10-22').map((p) => p.rrule)).not.toContain('FREQ=MONTHLY;BYDAY=-1TH');
  });
});
