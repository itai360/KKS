// When a recurring task opens next, as the list of recurring tasks says it.

import { describe, expect, it } from 'vitest';
import { addDays, weekdayOf } from '@shared/dates';
import { dayWord, nextRun } from '../src/lib/recurring';

const today = '2026-10-08';
const daily = { frequency: 'daily' as const, weekdays: [], time: '20:00', lastGeneratedDate: today };

describe('the next time a recurring task opens', () => {
  it('a daily one already opened today opens next tomorrow', () => {
    expect(nextRun(daily, today, '09:00')).toBe(addDays(today, 1));
  });

  it('one not opened yet today, its time still ahead, opens today', () => {
    expect(nextRun({ ...daily, lastGeneratedDate: addDays(today, -1) }, today, '09:00')).toBe(today);
    // and its time already gone: from the next one
    expect(nextRun({ ...daily, lastGeneratedDate: addDays(today, -1) }, today, '21:00')).toBe(addDays(today, 1));
  });

  it('a weekly one opens on its next day of the week', () => {
    const in2 = addDays(today, 2);
    expect(nextRun({ frequency: 'weekly', weekdays: [weekdayOf(in2)], time: '08:00', lastGeneratedDate: null }, today, '10:00')).toBe(in2);
    // on today's weekday, already opened: a week on
    expect(nextRun({ frequency: 'weekly', weekdays: [weekdayOf(today)], time: '08:00', lastGeneratedDate: today }, today, '07:00')).toBe(addDays(today, 7));
  });

  it('without days there is no next one', () => {
    expect(nextRun({ frequency: 'weekly', weekdays: [], time: '08:00', lastGeneratedDate: null }, today, '07:00')).toBeNull();
  });

  it('says the day in words', () => {
    expect(dayWord(today, today)).toBe('היום');
    expect(dayWord(addDays(today, 1), today)).toBe('מחר');
    expect(dayWord(addDays(today, 3), today)).toMatch(/^ב(ראשון|שני|שלישי|רביעי|חמישי|שישי|שבת)$/);
  });
});
