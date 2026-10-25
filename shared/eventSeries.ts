// A repeating event (a series): every day, every working day (Sunday to Thursday), every week or every
// month, up to a day. Each of its days becomes a whole event of its own - its own preparation tasks,
// debrief and files - kept together by the series, so it can be changed one, from one on, or all.

import { addDays, parseDateKey, toDateKey, weekdayOf } from './dates';

export const REPEAT_FREQS = ['daily', 'weekdays', 'weekly', 'monthly'] as const;
export type RepeatFreq = (typeof REPEAT_FREQS)[number];

export interface RepeatRule {
  freq: RepeatFreq;
  /** every n days / weeks / months (working days: every one) */
  interval: number;
  /** the last day it may fall on */
  until: string;
}

/** at most this many events in one series, and no further than a year from its first */
export const SERIES_MAX = 120;
export const SERIES_DAYS = 366;

export const REPEAT_LABELS: Record<RepeatFreq, string> = {
  daily: 'כל יום',
  weekdays: 'כל יום עבודה (ראשון עד חמישי)',
  weekly: 'כל שבוע',
  monthly: 'כל חודש',
};

/** "כל שבועיים", "כל 3 ימים"... */
export function repeatText(r: Pick<RepeatRule, 'freq' | 'interval'>): string {
  if (r.interval <= 1 || r.freq === 'weekdays') return REPEAT_LABELS[r.freq];
  if (r.interval === 2) return { daily: 'כל יומיים', weekly: 'כל שבועיים', monthly: 'כל חודשיים' }[r.freq];
  return `כל ${r.interval} ${{ daily: 'ימים', weekly: 'שבועות', monthly: 'חודשים' }[r.freq]}`;
}

/**
 * The days of a series that starts on `start`, in order. A monthly series keeps the day of the month,
 * and skips a month that has no such day (the 31st), as Google Calendar does.
 */
export function seriesDates(start: string, rule: RepeatRule): string[] {
  const last = rule.until < addDays(start, SERIES_DAYS) ? rule.until : addDays(start, SERIES_DAYS);
  const step = Math.max(1, Math.min(12, Math.round(rule.interval) || 1));
  const out: string[] = [];
  if (rule.freq === 'monthly') {
    const { year, month, day } = parseDateKey(start);
    for (let k = 0; out.length < SERIES_MAX; k += step) {
      const m = month - 1 + k;
      const y = year + Math.floor(m / 12);
      const mm = (m % 12) + 1;
      if (toDateKey(y, mm, 1) > last) break;
      const days = new Date(Date.UTC(y, mm, 0)).getUTCDate();
      if (day > days) continue;
      const d = toDateKey(y, mm, day);
      if (d > last) break;
      out.push(d);
    }
    return out;
  }
  const gap = rule.freq === 'weekly' ? 7 * step : rule.freq === 'daily' ? step : 1;
  for (let d = start; d <= last && out.length < SERIES_MAX; d = addDays(d, gap)) {
    // working days: Sunday to Thursday
    if (rule.freq === 'weekdays' && weekdayOf(d) > 4) continue;
    out.push(d);
  }
  return out;
}

/** how many days a series runs, in a few words: "12 אירועים, עד 31.12" */
export function seriesSpan(start: string, rule: RepeatRule): { count: number; last: string | null } {
  const days = seriesDates(start, rule);
  return { count: days.length, last: days.length ? days[days.length - 1] : null };
}
