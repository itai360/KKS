// When a recurring rule opens its next task, in words (pages/RecurringPage.tsx). Each day's task is opened
// that morning, due at the rule's time (server/src/recurring.ts).

import { WEEKDAY_NAMES } from '@shared/constants';
import { addDays, shortDate, weekdayOf } from '@shared/dates';
import type { RecurringRule } from '@shared/types';

/**
 * When the rule opens its next task: the first day ahead (today included, while its time is still ahead)
 * that it runs on and has not opened yet - each day's task is opened that morning, due at the rule's time.
 */
export function nextRun(r: Pick<RecurringRule, 'frequency' | 'weekdays' | 'time' | 'lastGeneratedDate'>, today: string, now: string): string | null {
  const days = r.frequency === 'daily' ? [0, 1, 2, 3, 4, 5, 6] : r.weekdays;
  if (!days.length) return null;
  for (let i = 0; i < 8; i++) {
    const d = addDays(today, i);
    if (!days.includes(weekdayOf(d))) continue;
    if (r.lastGeneratedDate && d <= r.lastGeneratedDate) continue;
    // today's, not opened while its time already passed: it starts from the next one
    if (d === today && r.time <= now) continue;
    return d;
  }
  return null;
}

export function dayWord(d: string, today: string): string {
  if (d === today) return 'היום';
  if (d === addDays(today, 1)) return 'מחר';
  if (d < addDays(today, 7)) return `ב${WEEKDAY_NAMES[weekdayOf(d)]}`;
  return shortDate(d);
}
