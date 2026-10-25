// The calendar's controls in the top bar, as Google Calendar has them: "היום", the arrows, the title of
// the days shown and the view. The calendar page publishes them while it is open (null otherwise), so
// the top bar and the side bar's month follow it - one place keeps the view and the day (the address).

import { useSyncExternalStore } from 'react';
import type { CalendarView } from '@shared/calendarGrid';

export type CalView = 'agenda' | CalendarView;

export const VIEW_LABELS: Record<CalView, string> = {
  day: 'יום',
  three: '3 ימים',
  four: '4 ימים',
  week: 'שבוע',
  month: 'חודש',
  year: 'שנה',
  agenda: 'סדר יום',
};

/** the keys of each view, as in Google Calendar - a letter and a number */
export const VIEW_KEYS: Partial<Record<CalView, [string, string]>> = {
  day: ['D', '1'],
  week: ['W', '2'],
  month: ['M', '3'],
  four: ['X', '4'],
  agenda: ['A', '5'],
  year: ['Y', '6'],
};

/** a computer's views, in Google Calendar's order; a phone's (seven columns do not fit it) */
export const DESK_VIEWS: CalView[] = ['day', 'week', 'month', 'year', 'agenda', 'four'];
export const PHONE_VIEWS: CalView[] = ['agenda', 'day', 'three', 'month'];

export interface CalendarBar {
  view: CalView;
  /** the day the calendar is on */
  date: string;
  /** the days shown, for the month beside the calendar to mark */
  shown: string[];
  title: string;
  /** today is in the days shown - "היום" has nothing to do */
  todayShown: boolean;
  /** "שבוע", "יום"... for the arrows' names */
  stepLabel: string;
  today(): void;
  step(dir: 1 | -1): void;
  setView(v: CalView): void;
  goTo(date: string): void;
  /** the "מעבר לתאריך" box (G) */
  askDate(): void;
  /** more the calendar can do, under its views: selecting events, printing, Google Calendar */
  extras: { label: string; icon: string; run(): void }[];
}

let current: CalendarBar | null = null;
const listeners = new Set<() => void>();

export function setCalendarBar(bar: CalendarBar | null): void {
  current = bar;
  listeners.forEach((l) => l());
}

export function useCalendarBar(): CalendarBar | null {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => current,
    () => current,
  );
}
