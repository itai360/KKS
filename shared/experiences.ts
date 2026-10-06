// Experiences (התנסויות): a role in an event for a few days, or a broad experience (התנסות רוחב) - a
// staff role a cadet holds alongside the course, for half of it or all of it.

import { addDays, diffDays } from './dates';
import { sortHe } from './sort';

export const EXPERIENCE_KINDS = ['role', 'broad'] as const;
export type ExperienceKind = (typeof EXPERIENCE_KINDS)[number];
export const EXPERIENCE_KIND_LABELS: Record<ExperienceKind, string> = { role: 'התנסות בתפקיד', broad: 'התנסות רוחב' };

/** the broad experiences, in alphabetical order */
export const BROAD_EXPERIENCES: readonly string[] = sortHe(['ס\' מ"פ', 'קה"ד', 'קב"ט', 'קל"ג', 'קחו"ם', 'א"ג', 'שטח', 'ניווטים', 'אקדמיה', 'פרט']);

export const EXPERIENCE_SPANS = ['first_half', 'second_half', 'full'] as const;
export type ExperienceSpan = (typeof EXPERIENCE_SPANS)[number];
export const SPAN_LABELS: Record<ExperienceSpan, string> = { first_half: 'חצי ראשון של הקורס', second_half: 'חצי שני של הקורס', full: 'כל הקורס' };
export const SPAN_SHORT: Record<ExperienceSpan, string> = { first_half: 'חצי קורס ראשון', second_half: 'חצי קורס שני', full: 'קורס שלם' };

/** the days a broad experience covers, from the course's first and last day */
export function spanDates(span: ExperienceSpan, courseStart: string, courseEnd: string): { startDate: string; endDate: string } {
  const half = Math.floor(diffDays(courseEnd, courseStart) / 2);
  if (span === 'first_half') return { startDate: courseStart, endDate: addDays(courseStart, half) };
  if (span === 'second_half') return { startDate: addDays(courseStart, half + 1), endDate: courseEnd };
  return { startDate: courseStart, endDate: courseEnd };
}
