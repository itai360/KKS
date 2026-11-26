// Writing events into Google Calendar, as the screens use it (server/src/gcalSync.ts): the person's connected
// account and the calendars they may write to, the calendar chosen for an event, and connecting - by
// Google's own sign-in, coming back to the page one left.

import { CAL_COLOR_HEX, CAL_COLORS, type CalColor } from '@shared/calendarLayers';
import type { EventCalendar, EventGoogle, GoogleCalendarStatus, ScheduleEvent } from '@shared/types';
import { api } from './api';
import { useApi } from './useApi';

export const useGoogleCalendar = () => useApi<GoogleCalendarStatus>('/api/google/calendar', ['google', 'events']);

/** to Google's sign-in; it comes back to this page */
export async function connectGoogleCalendar(back = location.pathname + location.search): Promise<void> {
  const { url } = await api.post<{ url: string }>('/api/google/calendar/connect', { back });
  window.location.assign(url);
}

/** where a new or changed event goes: the course's calendar, one's own, or a Google calendar of one's account */
export type CalendarPick = 'course' | 'personal' | `g:${string}`;

export const isGooglePick = (p: CalendarPick): p is `g:${string}` => p.startsWith('g:');

/** the pick an event has now: a Google calendar chosen for it (or its series), else its calendar here */
export function pickOf(e: Pick<ScheduleEvent, 'calendar'> | null | undefined, google?: EventGoogle | null): CalendarPick {
  if (google && google.src !== 'course' && google.calendarId) return `g:${google.calendarId}`;
  return e?.calendar === 'personal' ? 'personal' : 'course';
}

/**
 * What the server is told. A new event says a Google calendar only when one was chosen (the course's calendar
 * takes the course's Google calendar by itself); a change says it when the choice changed.
 */
export function pickBody(pick: CalendarPick, status: GoogleCalendarStatus | undefined, change: boolean): { calendar: EventCalendar; googleCalendarId?: string | null } {
  if (isGooglePick(pick)) {
    const id = pick.slice(2);
    return { calendar: status?.course?.calendarId === id ? 'course' : 'personal', googleCalendarId: id };
  }
  if (pick === 'course') return change ? { calendar: 'course', googleCalendarId: status?.course?.calendarId ?? null } : { calendar: 'course' };
  return change ? { calendar: 'personal', googleCalendarId: null } : { calendar: 'personal' };
}

const LAST = 'kks.calendarPick';
/** the calendar chosen last time, on this device */
export function lastPick(): CalendarPick | null {
  try {
    const v = localStorage.getItem(LAST);
    return v === 'course' || v === 'personal' || v?.startsWith('g:') ? (v as CalendarPick) : null;
  } catch {
    return null;
  }
}
export function rememberPick(p: CalendarPick): void {
  try {
    localStorage.setItem(LAST, p);
  } catch {
    /* this visit only */
  }
}

/** the app's colour nearest a Google calendar's (for the colour mark beside the choice) */
export function nearestColor(hex: string): CalColor {
  const rgb = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const [r, g, b] = rgb(hex);
  let best: CalColor = 'blue';
  let dist = Infinity;
  for (const c of CAL_COLORS) {
    const [r2, g2, b2] = rgb(CAL_COLOR_HEX[c]);
    const d = (r - r2) ** 2 + (g - g2) ** 2 + (b - b2) ** 2;
    if (d < dist) {
      dist = d;
      best = c;
    }
  }
  return best;
}

/** the colour mark of a pick: the course's blue, one's own teal, a Google calendar's own */
export function pickColor(pick: CalendarPick, status: GoogleCalendarStatus | undefined): CalColor {
  if (isGooglePick(pick)) {
    const cal = status?.calendars.find((c) => c.id === pick.slice(2));
    return cal ? nearestColor(cal.color) : 'blue';
  }
  return pick === 'course' ? 'blue' : 'teal';
}
