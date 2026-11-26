import { addDays, courseIsoWeekNumber, diffDays, weekdayOf } from '../../shared/dates';
import { db, type Db } from './db';

/**
 * The number of a week given none: counted on from the nearest week by date, so it follows the
 * course's own numbering - 1, 2, 3, or the calendar's 38, 39, 40. The first week is 1.
 */
export function inferWeekNumber(startDate: string, known: { number: number; startDate: string }[] | undefined = undefined, d: Db = db()): number {
  const numbering = weekNumbering(d);
  if (numbering) return numberOn(numbering, startDate);
  known ??= d.all<{ number: number; startDate: string }>('SELECT number, start_date AS startDate FROM weeks');
  if (!known.length) return 1;
  const near = known.reduce((a, b) => (Math.abs(diffDays(b.startDate, startDate)) < Math.abs(diffDays(a.startDate, startDate)) ? b : a));
  const n = near.number + Math.round(diffDays(startDate, near.startDate) / 7);
  return n >= 1 && n <= 100 ? n : Math.max(...known.map((k) => k.number)) + 1;
}

// ---------------- the weeks' numbers by the calendar ----------------

/** a week's number by the calendar: weeks of Sunday to Saturday, the first the one January 1 is in */
export function calendarWeekNumber(start: string): number {
  const saturday = addDays(start, 6 - weekdayOf(start));
  return Math.floor(diffDays(saturday, `${saturday.slice(0, 4)}-01-01`) / 7) + 1;
}

/** the same by the international rule (weeks of Monday to Sunday, the first the one with the year's first
 * Thursday) - of the Monday the week reaches */
const isoWeekNumber = courseIsoWeekNumber;

/** a calendar's way of numbering the weeks of the year - and how far from it a course counts (a week either way) */
export interface WeekNumbering {
  rule: (start: string) => number;
  offset: number;
}

export const numberOn = (n: WeekNumbering, start: string) => Math.max(1, n.rule(start) + n.offset);

/** how a course numbers its weeks: by the calendar (38, 39, 40 - most of them so), or null - its own (1, 2, 3) */
export function weekNumbering(d: Db = db()): WeekNumbering | null {
  if (d.get<{ value: string }>("SELECT value FROM settings WHERE key = 'weekNumberingRule'")?.value === '"iso"') {
    return { rule: isoWeekNumber, offset: 0 };
  }
  const weeks = d.all<{ number: number; start_date: string }>('SELECT number, start_date FROM weeks ORDER BY start_date, number');
  if (weeks.length < 2 || weeks[0].number <= 1) return null;
  let best: (WeekNumbering & { n: number }) | null = null;
  for (const rule of [calendarWeekNumber, isoWeekNumber]) {
    for (const offset of [0, -1, 1]) {
      const n = weeks.filter((w) => w.number === rule(w.start_date) + offset).length;
      if (!best || n > best.n) best = { rule, offset, n };
    }
  }
  return best && best.n >= Math.ceil(weeks.length * 0.75) ? { rule: best.rule, offset: best.offset } : null;
}

/** "שבוע 38 - שטח" become week 11: "שבוע 11 - שטח" */
export const renamedWeek = (name: unknown, was: unknown, now: number) =>
  typeof name === 'string' && typeof was === 'number' && was !== now ? name.replace(new RegExp(`^(\\s*שבוע\\s+)${was}(?!\\d)`), `$1${now}`) : name;

