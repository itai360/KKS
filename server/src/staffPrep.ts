// The staff's preparation weeks (שבועות הכנת סגל): the three weeks right after the course's closing
// week (שבוע סיום), when the staff gets ready for the next cycle - and goes over every lesson the
// debriefs kept for it, whatever week or event it was written for (debriefs.ts shows them all there).
// The closing week is the last week whose name has the word "סיום". When the course is ended and
// the next one opened, the closing week stays behind in the archive, so the next course is told
// where it ended and how many preparation weeks the course that ended already had: its own first
// weeks are the rest of them.

import { db } from './db';

/** how many weeks of preparation follow the closing week */
export const STAFF_PREP_WEEKS = 3;

/** the word, with "ה" or "ו" before it: "שבוע סיום", "שבוע הסיום", "סיום קורס" - not "סיומת" */
const CLOSING = /(^|[^֐-׿])[הו]?סיום(?![֐-׿])/;

const AFTER_KEY = 'staff_prep_after';

export interface StaffPrep {
  /** which week of the preparation: 1 to 3 */
  index: number;
  /** the first of them in this course: a lesson is decided there once, for all of them */
  anchorId: number;
  /** the lessons of the debriefs held before this day - the cycle that ended, and the ones before it */
  before: string;
}

interface WeekLite {
  id: number;
  name: string;
  start_date: string;
  end_date: string;
}

/** where the course before this one ended, and how many preparation weeks it already had */
interface After {
  closingEnd: string;
  done: number;
}

const allWeeks = () => db().all<WeekLite>('SELECT id, name, start_date, end_date FROM weeks ORDER BY start_date, id');
const closingOf = (weeks: WeekLite[]) => weeks.findLast((w) => CLOSING.test(w.name));

function after(): After | null {
  const raw = db().get<{ value: string }>('SELECT value FROM meta WHERE key = ?', AFTER_KEY)?.value;
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<After>;
    return typeof v.closingEnd === 'string' && typeof v.done === 'number' ? { closingEnd: v.closingEnd, done: v.done } : null;
  } catch {
    return null;
  }
}

/** the course's preparation weeks, by week */
export function staffPrepWeeks(): Map<number, StaffPrep> {
  const weeks = allWeeks();
  const out = new Map<number, StaffPrep>();
  const mark = (list: WeekLite[], first: number) => {
    const anchor = list[0];
    list.forEach((w, i) => out.has(w.id) || out.set(w.id, { index: first + i, anchorId: anchor.id, before: anchor.start_date }));
  };
  // the course that ended before this one: this course's first weeks finish its preparation
  const prev = after();
  if (prev && prev.done < STAFF_PREP_WEEKS) {
    const list = weeks.filter((w) => w.start_date > prev.closingEnd).slice(0, STAFF_PREP_WEEKS - prev.done);
    if (list.length) mark(list, prev.done + 1);
  }
  // this course's own closing week, and the weeks after it
  const closing = closingOf(weeks);
  if (closing) {
    const list = weeks.filter((w) => w.start_date > closing.end_date).slice(0, STAFF_PREP_WEEKS);
    if (list.length) mark(list, 1);
  }
  return out;
}

/** the preparation week this is, if it is one */
export const staffPrepOf = (weekId: number): StaffPrep | null => staffPrepWeeks().get(weekId) ?? null;

/** the weeks that share a preparation with this one (all of them decide a lesson once) */
export function staffPrepSiblings(anchorId: number): number[] {
  return [...staffPrepWeeks()].filter(([, p]) => p.anchorId === anchorId).map(([id]) => id);
}

/**
 * Before a course is ended (its weeks are still here): what the next course is to know - where the
 * closing week ended (the last week named so, or else the course's last week), and how many
 * preparation weeks came after it already. Nothing when the whole preparation was in this course.
 */
export function prepForNextCourse(): After | null {
  const weeks = allWeeks();
  const closing = closingOf(weeks) ?? weeks.at(-1);
  if (!closing) return null;
  const done = weeks.filter((w) => w.start_date > closing.end_date).length;
  return done >= STAFF_PREP_WEEKS ? null : { closingEnd: closing.end_date, done };
}

/** in the next course (the caller's transaction): kept, or cleared when there is nothing to keep */
export function keepPrepForNextCourse(v: After | null): void {
  if (!v) db().run('DELETE FROM meta WHERE key = ?', AFTER_KEY);
  else db().run('INSERT INTO meta(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', AFTER_KEY, JSON.stringify(v));
}
