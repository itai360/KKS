// One alphabetical order, everywhere: options are listed by the Hebrew alphabet (א-ב), with quote
// marks ignored and numbers in their natural order ("צוות 2" before "צוות 10").

const collator = new Intl.Collator('he', { numeric: true, sensitivity: 'base' });
// word by word, as a dictionary: only the quote marks of acronyms (מפק"צ, ס׳) are left out
const plain = (s: string) => s.replace(/["'`״׳“”]/g, '');

export const byHe = (a: string, b: string): number => collator.compare(plain(a), plain(b));

/** the catch-all choice: it comes after every other one */
const OTHER = 'אחר';

/** a copy of the list in alphabetical order, by the text `key` gives (the item itself for strings); "אחר" last */
export function sortHe<T>(list: readonly T[], key: (x: T) => string = (x) => String(x)): T[] {
  return [...list].sort((a, b) => Number(key(a) === OTHER) - Number(key(b) === OTHER) || byHe(key(a), key(b)));
}

/** cadets as lists show them: by team (those without one last), then by last and first name */
export function byTeamAndName(a: { team: string | null; last: string; first: string }, b: { team: string | null; last: string; first: string }): number {
  if (!a.team !== !b.team) return a.team ? -1 : 1;
  return byHe(a.team ?? '', b.team ?? '') || byHe(a.last, b.last) || byHe(a.first, b.first);
}

/** Calendar chronology remains 52, 53, 1, 2 across New Year. Never sort weeks by their labels. */
export function sortCourseWeeks<T extends { id: number; startDate: string }>(weeks: readonly T[]): T[] {
  return [...weeks].sort((a, b) => a.startDate.localeCompare(b.startDate) || a.id - b.id);
}

export function weekNavigationLabel(w: { number: number; name: string; startDate: string }): string {
  const label = w.name.trim() === `שבוע ${w.number}` ? w.name : `שבוע ${w.number} · ${w.name}`;
  const [, month, day] = w.startDate.split('-');
  return `${label} · ${Number(day)}.${Number(month)}`;
}

/** A week belongs to a course when its dates overlap the configured course period. */
export function weekWithinCourse(week: { startDate: string; endDate: string }, course: { startDate?: string | null; endDate?: string | null }): boolean {
  return (!course.startDate || week.endDate >= course.startDate) && (!course.endDate || week.startDate <= course.endDate);
}

export function courseWeeksWithin<T extends { id: number; startDate: string; endDate: string }>(weeks: readonly T[], course: { startDate?: string | null; endDate?: string | null }): T[] {
  return sortCourseWeeks(weeks.filter(w => weekWithinCourse(w, course)));
}
