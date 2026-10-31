// The calendar, in Google Calendar's way: the hours of a day, a few days or a week, with what lasts all
// day - a course week, an absence, an experience, a deadline - in rows above them; a month of weeks, its
// things in rows inside each week; a year of months, each day as busy as it is. With a mouse a course
// event is dragged to another time or day and stretched from its bottom edge; dragging over free time
// (or clicking it) starts a new one there; in the month an event is dragged to another day. Things of a
// connected Google calendar are read only. The arithmetic is in shared/calendarGrid.ts, and what each
// thing is in shared/calendarLayers.ts.

import { useEffect, useRef, useState, type CSSProperties, type DragEvent, type MouseEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { APP_MIN_VISIBLE, DAY_MINUTES, eventSpan, fitLanes, fromMinutes, laneCount, layoutDay, layoutDayApp, layoutSpans, MIN_VISIBLE, MONTH_NAMES, monthWeeks, movedSpan, resizedEnd, snap, viewDays, yearMonths, type Lane } from '@shared/calendarGrid';
import { dayOrder, isTimed, itemDays, loadByDay, type CalItem } from '@shared/calendarLayers';
import { WEEKDAY_NAMES } from '@shared/constants';
import { addDays, diffDays, shortDate, weekdayName, weekdayOf } from '@shared/dates';
import type { ScheduleEvent, Week } from '@shared/types';
import { onCalendarNow } from '../lib/calendarBar';
import { fmtTime } from '../lib/format';
import { haptic } from '../lib/haptics';
import { useBulk } from './Bulk';
import { Icon } from './Icon';
import type { Anchor } from './Popover';
import { dayLabel, WEEKDAY_LETTERS } from './Agenda';

export type GridView = 'day' | 'three' | 'four' | 'week' | 'month';

export interface Draft {
  date: string;
  start: string | null;
  end: string | null;
  /** what was typed so far, and the colour chosen: the ghost shows them as Google's does */
  title?: string;
  color?: string | null;
  /** a phone: only chosen so far - an outlined box with its handles, as Google Calendar's app; a tap on it opens
   *  the new event */
  pending?: boolean;
}

export interface CalendarProps {
  view: GridView;
  date: string;
  today: string;
  /** false while the days shown are loading */
  ready: boolean;
  /** "HH:MM" now, for the line across today */
  nowTime: string;
  items: CalItem[];
  /** the event being made in the quick create: its place shown in the grid */
  draft: Draft | null;
  /** the rows above the hours opened up to show everything */
  allDayOpen: boolean;
  onAllDayToggle: () => void;
  canCreate: (date: string) => boolean;
  canMove: (e: ScheduleEvent) => boolean;
  onOpen: (item: CalItem, el: HTMLElement) => void;
  onCreate: (d: { date: string; start: string | null; end: string | null }, at: Anchor) => void;
  onMove: (e: ScheduleEvent, to: { date: string; startTime: string; endTime: string | null }) => void;
  /** the new event's block moved or stretched by the finger (a phone): its day and hours */
  onDraftMove?: (d: { date: string; start: string; end: string }) => void;
  /** the chosen time (a pending draft) tapped: the new event opens there */
  onDraftOpen?: () => void;
  onPickDay: (date: string) => void;
  /** a phone, as Google Calendar's app draws it: the day and the three days with the hours on the left
   *  (as the app keeps them in Hebrew too), big titles and its own way of laying events side by side; the
   *  month the whole screen, everything a small filled bar, and a tap on a day opens that day */
  compact?: boolean;
  /** what is over drawn paler (Google's "reduce the brightness of past events"); on unless turned off */
  dimPast?: boolean;
  /** Google's "show weekends" turned off: the week and the month without Friday and Saturday */
  hideWeekend?: boolean;
  /** turned to these days by the finger: the hours stay where they were, as the page beside showed them */
  holdHours?: boolean;
}

/** Friday and Saturday - the weekend here */
const isWeekend = (d: string) => weekdayOf(d) >= 5;
/** "יום א׳" ... "יום ו׳", "שבת" - as the phone app names the day over its hours */
const dayShort = (d: string) => (weekdayOf(d) === 6 ? 'שבת' : `יום ${WEEKDAY_LETTERS[weekdayOf(d)]}׳`);
/** a thing of several days on one of them, as the phone app says it: "(יום 2/7)" */
function dayOfSpan(i: CalItem, day: string): string {
  const total = diffDays(i.endDate, i.date) + 1;
  return total > 1 ? `(יום ${Math.min(total, diffDays(day, i.date) + 1)}/${total})` : '';
}

export function CalendarView(props: CalendarProps) {
  return props.view === 'month' ? <MonthGrid {...props} /> : <TimeGrid {...props} />;
}

// ---------------- a thing in a row: a bar, a dot and its hour, a deadline ----------------

const eventOf = (i: CalItem): ScheduleEvent | null => (i.src.kind === 'event' ? i.src.e : null);

/** what a thing says when a pointer rests on it */
function tip(i: CalItem): string {
  const when = i.endDate !== i.date ? `${shortDate(i.date)} - ${shortDate(i.endDate)}` : i.start ? `${i.start}${i.end ? ` - ${i.end}` : ''}` : 'כל היום';
  const what = i.src.kind === 'task' ? `דד-ליין: ${i.title}` : i.title;
  return [what, when, i.sub, i.overdue ? 'באיחור' : '', i.src.kind === 'external' ? `${i.src.e.sourceName} (Google)` : ''].filter(Boolean).join('\n');
}

/**
 * Over already: drawn pale, as Google Calendar draws what is behind you ("reduce the brightness of past
 * events"), so what is next stands out. Not what was called off (struck through instead), and not a late
 * deadline (it stays red until it is done).
 */
function isPast(i: CalItem, today: string, nowMin: number): boolean {
  if (i.faded || i.overdue) return false;
  if (i.endDate < today) return true;
  if (i.endDate > today || !i.start) return false;
  return eventSpan(i.start, i.end).end <= nowMin;
}

function Chip({ item, lane, hourly, past, onOpen, draggable, onDragStart, onDragEnd, selected, counter, plain }: {
  item: CalItem;
  lane?: Lane<CalItem>;
  /** the month: an event with hours is a dot, its hour and its title - not a bar */
  hourly?: boolean;
  past?: boolean;
  /** which of its days this is, after the title: "(יום 2/7)" */
  counter?: string;
  /** the title alone (a course week without its lead) */
  plain?: boolean;
  onOpen: (item: CalItem, el: HTMLElement) => void;
  draggable?: boolean;
  onDragStart?: (e: DragEvent) => void;
  onDragEnd?: () => void;
  selected?: boolean;
}) {
  const k = item.src.kind;
  const bulk = useBulk();
  const shape = k === 'task' ? 'task' : k === 'debrief' ? 'note' : hourly && item.start ? 'dot' : 'bar';
  const style: CSSProperties | undefined = lane ? { gridColumn: `${lane.start + 1} / ${lane.end + 2}`, gridRow: lane.lane + (hourly !== undefined ? 2 : 1) } : undefined;
  return (
    <button
      type="button"
      className={[
        'gc-chip',
        `is-${shape}`,
        `k-${k}`,
        `c-${item.color}`,
        item.faded && 'is-faded',
        past && 'is-past',
        item.rsvp && `rsvp-${item.rsvp}`,
        item.overdue && 'is-overdue',
        lane?.cutStart && 'cut-start',
        lane?.cutEnd && 'cut-end',
        selected && 'is-selected',
      ]
        .filter(Boolean)
        .join(' ')}
      style={style}
      title={tip(item)}
      draggable={draggable}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      aria-pressed={bulk?.active && k === 'event' ? !!selected : undefined}
      onClick={(ev) => {
        ev.stopPropagation();
        if (bulk?.active && k === 'event') bulk.toggle(item.src.e.id as number);
        else onOpen(item, ev.currentTarget);
      }}
    >
      {shape === 'task' && <span className="gc-task-ring" aria-hidden="true" />}
      {shape === 'note' && <Icon name="lightbulb" size={12} />}
      {shape === 'dot' && <span className="gc-dot" aria-hidden="true" />}
      {(shape === 'dot' || shape === 'task') && item.start && <b className="gc-chip-time">{item.start}</b>}
      <span className="gc-chip-title">
        {k === 'week' && item.sub && !plain ? `${item.title} · ${item.sub.replace('מפק"צ מוביל: ', '')}` : item.title}
        {counter && <span className="gc-chip-count"> {counter}</span>}
      </span>
    </button>
  );
}

// ---------------- day, a few days and the week ----------------

type Drag = { kind: 'move' | 'resize'; id: number; date: string; start: number; end: number } | { kind: 'create'; date: string; start: number; end: number; touch?: boolean; draft?: boolean; home?: string; dx?: number };

/** how long a finger stays on free time before it becomes a new event there (Google Calendar's app: about this) */
const PRESS_MS = 380;

/** Follows one pointer until it is released (or Escape is pressed). */
function track(down: ReactPointerEvent, move: (e: PointerEvent) => void, up: (cancelled: boolean) => void) {
  const id = down.pointerId;
  const onMove = (e: PointerEvent) => {
    if (e.pointerId === id) move(e);
  };
  const finish = (cancelled: boolean) => {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('pointercancel', onUp);
    window.removeEventListener('keydown', onKey, true);
    up(cancelled);
  };
  const onUp = (e: PointerEvent) => {
    if (e.pointerId === id) finish(e.type === 'pointercancel');
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key !== 'Escape') return;
    e.stopPropagation();
    finish(true);
  };
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
  window.addEventListener('pointercancel', onUp);
  window.addEventListener('keydown', onKey, true);
}

const hours = (min: number) => min / 60;
const range = (start: number, end: number) => `${fromMinutes(start)} - ${end >= DAY_MINUTES ? '24:00' : fromMinutes(end)}`;
/** the rows above the hours show this many until opened up */
const ALLDAY_ROWS = 3;
/** away from the app this long, the hours go back to now on return */
const AWAY_MS = 5 * 60_000;

function TimeGrid({ view, date, today, ready, nowTime, items, draft, allDayOpen, onAllDayToggle, canCreate, canMove, onOpen, onCreate, onMove, onDraftMove, onDraftOpen, onPickDay, compact = false, dimPast = true, hideWeekend = false, holdHours = false }: CalendarProps) {
  // a phone: Google Calendar's app - its layout, its hours on the left, the day named beside the all-day rows
  const app = compact;
  const appDay = app && view === 'day';
  const draftTitle = draft?.title?.trim() || '(ללא כותרת)';
  const days = viewDays(view, date).filter((d) => !(hideWeekend && view === 'week' && isWeekend(d)));
  const bulk = useBulk();
  const scrollRef = useRef<HTMLDivElement>(null);
  // the hours scrolled under the rows above them: a shadow under those, as the app has
  const [scrolled, setScrolled] = useState(false);
  const [drag, setDrag] = useState<Drag | null>(null);
  const suppressClick = useRef(false);

  const timed = items.filter((i) => isTimed(i) && days.includes(i.date));
  const lanes = layoutSpans(
    items.filter((i) => !isTimed(i)),
    days,
    itemDays,
    dayOrder,
  );
  const allRows = laneCount(lanes);
  const fit = allDayOpen ? { shown: lanes, more: days.map(() => 0) } : fitLanes(lanes, days.length, ALLDAY_ROWS);
  const rows = allDayOpen ? allRows : Math.min(allRows, ALLDAY_ROWS);
  const canOpen = allRows > ALLDAY_ROWS;

  // where the hours open - once per day or week shown, not on every refresh: with today among the days, the
  // present moment in the middle of what is in sight (not under the phone's bar); another day, its morning (or
  // its first event, if earlier)
  const firstStart = Math.min(8 * 60, ...timed.map((i) => eventSpan(i.start!, i.end).start));
  const showsToday = days.includes(today);
  const scrollKey = `${view}:${days[0]}`;
  const scrolledFor = useRef('');
  const openHours = (smooth: boolean) => {
    const el = scrollRef.current;
    const body = el?.querySelector<HTMLElement>('.gc-col');
    if (!el || !body) return;
    const perMinute = body.offsetHeight / DAY_MINUTES;
    let top = perMinute * (firstStart - 45);
    if (showsToday) {
      const now = eventSpan(fmtTime(new Date().toISOString()), null).start;
      const box = el.getBoundingClientRect();
      // the phone's bar floats over the hours' foot (a computer has none: hidden, it measures nothing)
      const bar = document.querySelector<HTMLElement>('.bottom-nav')?.getBoundingClientRect();
      const covered = bar && bar.height ? Math.max(0, box.bottom - bar.top) : 0;
      top = perMinute * now - (el.clientHeight - covered) / 2;
    }
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    el.scrollTo({ top: Math.max(0, top), behavior: smooth && !reduce ? 'smooth' : 'auto' });
  };
  useEffect(() => {
    if (!scrollRef.current || !ready || scrolledFor.current === scrollKey) return;
    const first = !scrolledFor.current;
    scrolledFor.current = scrollKey;
    if (holdHours && !first) return;
    // the hours not held to the screen's height yet (the screen still settling): a few frames later
    let tries = 0;
    let frame = 0;
    const open = () => {
      const el = scrollRef.current;
      if (el && el.scrollHeight <= el.clientHeight + 1 && ++tries < 12) frame = requestAnimationFrame(open);
      else openHours(false);
    };
    open();
    return () => cancelAnimationFrame(frame);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- where it opens, once for the days shown
  }, [scrollKey, ready]);
  // back in the app after a while away (a phone's app is resumed, not opened again), or the bar's calendar tab
  // tapped while it is on show: today goes back to now
  const openHoursRef = useRef(openHours);
  openHoursRef.current = openHours;
  const showsTodayRef = useRef(showsToday);
  showsTodayRef.current = showsToday;
  useEffect(() => {
    let away = 0;
    const onVisibility = () => {
      if (document.hidden) {
        away = Date.now();
        return;
      }
      const long = away && Date.now() - away > AWAY_MS;
      away = 0;
      if (long && showsTodayRef.current && !document.querySelector('.peek-sheet, .modal, .pop')) openHoursRef.current(true);
    };
    document.addEventListener('visibilitychange', onVisibility);
    const offNow = onCalendarNow(() => showsTodayRef.current && openHoursRef.current(true));
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      offNow();
    };
  }, []);

  const columns = () => [...(scrollRef.current?.querySelectorAll<HTMLElement>('.gc-col') ?? [])];
  /** the day column under x (the nearest one when outside) */
  const columnAt = (x: number) => {
    const cols = columns();
    let best = cols[0];
    let dist = Infinity;
    for (const c of cols) {
      const r = c.getBoundingClientRect();
      const d = x < r.left ? r.left - x : x > r.right ? x - r.right : 0;
      if (d < dist) {
        dist = d;
        best = c;
      }
    }
    return best;
  };
  const minutesAt = (col: HTMLElement, y: number) => {
    const r = col.getBoundingClientRect();
    return ((y - r.top) / r.height) * DAY_MINUTES;
  };
  /** the place of some minutes of a day column on the screen - where the quick create opens beside */
  const slotAt = (col: HTMLElement, start: number, end: number): Anchor => {
    const r = col.getBoundingClientRect();
    return { top: r.top + (start / DAY_MINUTES) * r.height, bottom: r.top + (end / DAY_MINUTES) * r.height, left: r.left, right: r.right };
  };

  const startMove = (down: ReactPointerEvent, e: ScheduleEvent, kind: 'move' | 'resize') => {
    suppressClick.current = false;
    down.stopPropagation(); // never starts a new event underneath
    if (down.button !== 0 || down.pointerType === 'touch' || bulk?.active || !canMove(e)) return;
    const span = eventSpan(e.startTime, e.endTime);
    const home = columnAt(down.clientX);
    const grabAt = minutesAt(home, down.clientY);
    const grab = grabAt - span.start;
    const x0 = down.clientX;
    const y0 = down.clientY;
    let current: Drag | null = null;
    track(
      down,
      (m) => {
        if (!current && Math.hypot(m.clientX - x0, m.clientY - y0) < 5) return;
        if (kind === 'resize') {
          // the edge moves as far as the pointer did - where on the handle it was grabbed does not count
          current = { kind, id: e.id, date: e.date, start: span.start, end: resizedEnd(span.start, span.end, minutesAt(home, m.clientY) - grabAt) };
        } else {
          const col = columnAt(m.clientX);
          const to = movedSpan(span.start, span.end, minutesAt(col, m.clientY) - grab - span.start);
          current = { kind, id: e.id, date: col.dataset.date!, ...to };
        }
        setDrag(current);
      },
      (cancelled) => {
        setDrag(null);
        if (!current) return;
        suppressClick.current = true;
        const c = current;
        if (cancelled || (c.date === e.date && c.start === span.start && c.end === span.end)) return;
        onMove(e, { date: c.date, startTime: fromMinutes(c.start), endTime: e.endTime || kind === 'resize' ? fromMinutes(c.end) : null });
      },
    );
  };

  // a finger held on free time (a phone): while the new event is being drawn, the hours do not scroll under it
  const pressing = useRef(false);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const hold = (e: TouchEvent) => {
      if (!pressing.current) return;
      if (e.cancelable) e.preventDefault();
      // nor does the day turn sideways (the swipe listens above)
      e.stopPropagation();
    };
    el.addEventListener('touchmove', hold, { passive: false });
    return () => el.removeEventListener('touchmove', hold);
  }, []);

  /** a finger on free time: held still a moment, a new event of an hour is there; moved while held, its length
   *  follows the finger; let go, the new event opens - as Google Calendar's app. A finger that moves before
   *  that scrolls or turns the day, as always; a short tap is the click below. */
  const pressCreate = (down: ReactPointerEvent<HTMLDivElement>, day: string) => {
    const col = down.currentTarget;
    const x0 = down.clientX;
    const y0 = down.clientY;
    let current: Extract<Drag, { kind: 'create' }> | null = null;
    let anchor = 0;
    const timer = window.setTimeout(() => {
      anchor = Math.max(0, Math.min(DAY_MINUTES - 60, Math.floor(minutesAt(col, y0) / 15) * 15));
      current = { kind: 'create', date: day, start: anchor, end: anchor + 60, touch: true };
      pressing.current = true;
      suppressClick.current = true;
      haptic('tick');
      setDrag(current);
    }, PRESS_MS);
    track(
      down,
      (m) => {
        if (!current) {
          // moved before it was held: a scroll or a swipe, not a new event
          if (Math.hypot(m.clientX - x0, m.clientY - y0) > 8) window.clearTimeout(timer);
          return;
        }
        // drawn from where it was pressed: down makes it longer (at least the hour), up starts it earlier
        const at = Math.max(0, Math.min(DAY_MINUTES, snap(minutesAt(col, m.clientY), 15)));
        const next = at >= anchor ? { start: anchor, end: Math.max(anchor + 60, at) } : { start: at, end: anchor + 15 };
        if (next.start === current.start && next.end === current.end) return;
        current = { ...current, ...next };
        setDrag(current);
      },
      () => {
        window.clearTimeout(timer);
        pressing.current = false;
        if (!current) return;
        const c = current;
        setDrag(null);
        // the click that may follow the finger's lift is not another new event
        suppressClick.current = true;
        window.setTimeout(() => void (suppressClick.current = false), 400);
        onCreate({ date: day, start: fromMinutes(c.start), end: fromMinutes(c.end) }, slotAt(col, c.start, c.end));
      },
    );
  };

  /**
   * The new event's block, as Google Calendar's app has it while its sheet is open: held and moved, it goes
   * where the finger takes it (another day too, when several are shown); its top or bottom handle stretches
   * it. A quarter of an hour at a time, each with a tick; let go, the sheet's hours are the block's.
   */
  const startDraftDrag = (down: ReactPointerEvent<HTMLElement>, kind: 'move' | 'start' | 'end') => {
    down.stopPropagation();
    if (!draft?.start || !onDraftMove || (down.pointerType === 'mouse' && down.button !== 0)) return;
    const span = eventSpan(draft.start, draft.end);
    const len = Math.max(15, span.end - span.start);
    const home = columnAt(down.clientX);
    const grabAt = minutesAt(home, down.clientY);
    const homeLeft = home.getBoundingClientRect().left;
    const x0 = down.clientX;
    const y0 = down.clientY;
    // the hours and the day hold still under the finger; the block keeps the finger to the end, and stays the
    // same block (in its own day's column, shifted over to another day) - one taken away under a finger loses it
    pressing.current = down.pointerType === 'touch';
    const block = (down.currentTarget as HTMLElement).closest<HTMLElement>('.gc-event') ?? down.currentTarget;
    try {
      block.setPointerCapture(down.pointerId);
    } catch {
      /* the window still hears it */
    }
    let current: Extract<Drag, { kind: 'create' }> | null = null;
    track(
      down,
      (m) => {
        if (!current && Math.hypot(m.clientX - x0, m.clientY - y0) < 4) return;
        const col = kind === 'move' ? columnAt(m.clientX) : home;
        const at = minutesAt(col, m.clientY);
        let start = span.start;
        let end = span.start + len;
        if (kind === 'move') {
          start = Math.max(0, Math.min(DAY_MINUTES - len, snap(span.start + (at - grabAt), 15)));
          end = start + len;
        } else if (kind === 'start') start = Math.max(0, Math.min(end - 15, snap(at, 15)));
        else end = Math.max(start + 15, Math.min(DAY_MINUTES, snap(at, 15)));
        const next = { kind: 'create' as const, date: col.dataset.date!, start, end, draft: true, home: draft.date, dx: col.getBoundingClientRect().left - homeLeft };
        if (current && next.date === current.date && next.start === current.start && next.end === current.end) return;
        if (current) haptic('tick');
        current = next;
        setDrag(current);
      },
      (cancelled) => {
        pressing.current = false;
        setDrag(null);
        // a tap on the chosen time, not a move: the new event opens there
        if (!current) {
          if (!cancelled && draft.pending) onDraftOpen?.();
          return;
        }
        suppressClick.current = true;
        window.setTimeout(() => void (suppressClick.current = false), 400);
        if (!cancelled) onDraftMove({ date: current.date, start: fromMinutes(current.start), end: fromMinutes(current.end) });
      },
    );
  };

  const startCreate = (down: ReactPointerEvent<HTMLDivElement>, day: string) => {
    suppressClick.current = false;
    if (down.pointerType === 'touch' && down.isPrimary && down.target === down.currentTarget && !bulk?.active && canCreate(day)) return pressCreate(down, day);
    if (down.button !== 0 || down.pointerType === 'touch' || bulk?.active || !canCreate(day)) return;
    const col = down.currentTarget;
    const anchor = Math.floor(minutesAt(col, down.clientY) / 15) * 15;
    const y0 = down.clientY;
    let current: Drag | null = null;
    track(
      down,
      (m) => {
        if (!current && Math.abs(m.clientY - y0) < 6) return;
        const at = Math.max(0, Math.min(DAY_MINUTES, snap(minutesAt(col, m.clientY), 15)));
        const start = Math.min(anchor, at);
        current = { kind: 'create', date: day, start, end: Math.max(anchor + 15, at, start + 15) };
        setDrag(current);
      },
      (cancelled) => {
        setDrag(null);
        if (!current) return;
        suppressClick.current = true;
        if (!cancelled) onCreate({ date: day, start: fromMinutes(current.start), end: fromMinutes(current.end) }, slotAt(col, current.start, current.end));
      },
    );
  };

  // a click on free time (any pointer, touch included): an hour from the half hour clicked
  const clickColumn = (ev: MouseEvent<HTMLDivElement>, day: string) => {
    if (suppressClick.current) {
      suppressClick.current = false;
      return;
    }
    if (ev.target !== ev.currentTarget || bulk?.active || !canCreate(day)) return;
    const start = Math.min(DAY_MINUTES - 30, Math.floor(minutesAt(ev.currentTarget, ev.clientY) / 30) * 30);
    const end = Math.min(DAY_MINUTES, start + 60);
    onCreate({ date: day, start: fromMinutes(start), end: fromMinutes(end) }, slotAt(ev.currentTarget, start, end));
  };
  // a click on a day's free place above the hours: an event of the whole day
  const clickAllDay = (ev: MouseEvent<HTMLDivElement>) => {
    if (ev.target !== ev.currentTarget || bulk?.active) return;
    const r = ev.currentTarget.getBoundingClientRect();
    // right to left: the first day is on the right (a phone's grid goes left to right, as the app's)
    const fromStart = app ? ev.clientX - r.left : r.right - ev.clientX;
    const i = Math.min(days.length - 1, Math.max(0, Math.floor((fromStart / r.width) * days.length)));
    const day = days[i];
    if (!canCreate(day)) return;
    const w = r.width / days.length;
    onCreate({ date: day, start: null, end: null }, app ? { top: r.top, bottom: r.bottom, left: r.left + i * w, right: r.left + (i + 1) * w } : { top: r.top, bottom: r.bottom, right: r.right - i * w, left: r.right - (i + 1) * w });
  };
  const clickEvent = (ev: MouseEvent<HTMLElement>, item: CalItem) => {
    ev.stopPropagation();
    if (suppressClick.current) {
      suppressClick.current = false;
      return;
    }
    const e = eventOf(item);
    if (bulk?.active && e) bulk.toggle(e.id);
    else onOpen(item, ev.currentTarget);
  };

  const nowMin = eventSpan(nowTime, null).start;
  const draftShown = draft && draft.start && days.includes(draft.date) ? eventSpan(draft.start, draft.end) : null;

  // the new event's start and end, marked on the hours (a phone): where the finger has it, else where it is
  const heldDraft = drag?.kind === 'create' ? drag : null;
  const marks = !app ? null : heldDraft ? [heldDraft.start, heldDraft.end] : draftShown ? [draftShown.start, draftShown.end] : null;

  // a phone: the new event's block kept in sight above its sheet (and above the keyboard, when it comes up) -
  // the hours scroll to it as it is made, moved, or its hours changed in the sheet
  const draftKey = app && draftShown && !drag ? `${draft!.date} ${draftShown.start} ${draftShown.end}` : '';
  useEffect(() => {
    if (!draftKey) return;
    const reveal = () => {
      const box = scrollRef.current;
      const el = box?.querySelector<HTMLElement>('.gc-event.is-draft');
      if (!box || !el) return;
      const r = el.getBoundingClientRect();
      const b = box.getBoundingClientRect();
      const sheet = document.querySelector<HTMLElement>('.peek-sheet');
      const bar = document.querySelector<HTMLElement>('.bottom-nav');
      const bottom = Math.min(b.bottom, sheet ? sheet.getBoundingClientRect().top : b.bottom, !sheet && bar ? bar.getBoundingClientRect().top : b.bottom) - 16;
      const top = b.top + 8;
      let dy = r.bottom > bottom ? r.bottom - bottom : 0;
      // taller than the room left: its top in sight
      if (r.top - dy < top) dy = r.top - top;
      if (Math.abs(dy) > 2) box.scrollBy({ top: dy, behavior: 'smooth' });
    };
    // once the sheet has come up
    const t = window.setTimeout(reveal, 320);
    const vv = window.visualViewport;
    let kb = 0;
    const onResize = () => {
      window.clearTimeout(kb);
      kb = window.setTimeout(reveal, 160);
    };
    vv?.addEventListener('resize', onResize);
    return () => {
      window.clearTimeout(t);
      window.clearTimeout(kb);
      vv?.removeEventListener('resize', onResize);
    };
  }, [draftKey]);

  return (
    <div className={`gc gc-${view}${app ? ' gc-app' : ''}${scrolled ? ' is-scrolled' : ''}`} style={{ '--days': days.length } as CSSProperties}>
      <div className="gc-head">
        {/* a phone's day names itself beside the rows above the hours, as the app does */}
        {!appDay && (
          <>
            <div className="gc-gutter gc-tz" aria-hidden="true" />
            {days.map((d) => (
              <div key={d} className={`gc-dayhead${d === today ? ' is-today' : ''}${d < today ? ' is-past' : ''}`}>
                <span className="gc-dw">{app ? dayShort(d) : weekdayName(d)}</span>
                <button type="button" className="gc-dn" onClick={() => onPickDay(d)} aria-label={dayLabel(d, today)} disabled={view === 'day'}>
                  {Number(d.slice(8))}
                </button>
              </div>
            ))}
          </>
        )}
        {/* what lasts all day, the course's weeks, who is away, the deadlines - rows over the days */}
        <div className="gc-gutter gc-allday-gutter">
          {appDay && (
            <div className={`gc-appday${days[0] === today ? ' is-today' : ''}`} aria-label={dayLabel(days[0], today)}>
              <span className="gc-dw">{dayShort(days[0])}</span>
              <span className="gc-dn">{Number(days[0].slice(8))}</span>
            </div>
          )}
          {canOpen && (
            <button type="button" className="icon-btn gc-allday-toggle" onClick={onAllDayToggle} aria-expanded={allDayOpen} aria-label={allDayOpen ? 'צמצום השורות שמעל השעות' : 'הצגת כל מה שמעל השעות'} title={allDayOpen ? 'צמצום' : 'הכל'}>
              <Icon name="chevronDown" size={16} />
            </button>
          )}
        </div>
        <div className="gc-allday" style={{ '--rows': Math.max(1, rows) } as CSSProperties} onClick={clickAllDay}>
          {fit.shown.map((l) => (
            <Chip
              key={l.item.key}
              item={l.item}
              lane={l}
              past={dimPast && isPast(l.item, today, nowMin)}
              onOpen={onOpen}
              selected={!!(bulk?.active && eventOf(l.item) && bulk.selected.has(eventOf(l.item)!.id))}
              counter={appDay ? dayOfSpan(l.item, days[0]) : undefined}
              plain={app}
            />
          ))}
          {fit.more.map((n, i) =>
            n > 0 ? (
              <button key={days[i]} type="button" className="gc-more" style={{ gridColumn: i + 1, gridRow: ALLDAY_ROWS }} onClick={onAllDayToggle}>
                עוד {n}
              </button>
            ) : null,
          )}
          {draft && !draft.start && days.includes(draft.date) && (
            <div className={`gc-chip is-bar is-ghost${draft.color ? ` c-${draft.color}` : ''}`} style={{ gridColumn: days.indexOf(draft.date) + 1, gridRow: rows + 1 > ALLDAY_ROWS && !allDayOpen ? ALLDAY_ROWS : rows + 1 }}>
              {draftTitle}
            </div>
          )}
        </div>
      </div>
      <div className="gc-scroll" ref={scrollRef} onScroll={(ev) => setScrolled(ev.currentTarget.scrollTop > 0)}>
        <div className="gc-body">
          <div className="gc-gutter gc-hours" aria-hidden="true">
            {Array.from({ length: 23 }, (_, i) => (
              <span key={i} style={{ top: `calc(var(--hour) * ${i + 1})` }}>
                {/* the app: "8:00"; a computer: "08:00" */}
                {app ? i + 1 : String(i + 1).padStart(2, '0')}:00
              </span>
            ))}
            {/* the new event's start and end on the hours, as Google Calendar's app marks them - following the finger */}
            {marks?.map((m, i) => (
              <b key={i} className="gc-hour-mark" style={{ top: `calc(var(--hour) * ${hours(m)})` }}>
                {Math.floor(m / 60)}:{String(m % 60).padStart(2, '0')}
              </b>
            ))}
          </div>
          {days.map((d) => {
            const own = timed.filter((i) => i.date === d && !(drag && drag.kind !== 'create' && eventOf(i)?.id === drag.id));
            const movingItem = drag && drag.kind !== 'create' && drag.date === d ? timed.find((i) => eventOf(i)?.id === drag.id) : undefined;
            const placed = (app ? layoutDayApp : layoutDay)(
              [
                ...own.map((i) => ({ i, span: eventSpan(i.start!, i.end) })),
                ...(movingItem && drag ? [{ i: movingItem, span: { start: drag.start, end: drag.end } }] : []),
              ],
              (x) => x.span,
            );
            return (
              <div
                key={d}
                className={`gc-col${d === today ? ' is-today' : ''}${canCreate(d) ? ' can-create' : ''}`}
                data-date={d}
                onPointerDown={(ev) => startCreate(ev, d)}
                onClick={(ev) => clickColumn(ev, d)}
                // a long press is ours on a phone, not the browser's menu
                onContextMenu={(ev) => app && ev.target === ev.currentTarget && ev.preventDefault()}
              >
                {placed.map((p) => {
                  const item = p.item.i;
                  const e = eventOf(item);
                  const height = Math.max(p.end - p.start, app ? APP_MIN_VISIBLE : MIN_VISIBLE);
                  const isDragged = !!e && drag?.kind !== 'create' && drag?.id === e.id;
                  // as Google's: what reaches the column's end leaves a strip there free, to click and add at that hour
                  const atEnd = p.left + p.width > 0.999;
                  const leftPx = (p.leftPx ?? 0) + 1;
                  const widthPx = p.widthPx ?? 0;
                  const style: CSSProperties = {
                    top: `calc(var(--hour) * ${hours(p.start)})`,
                    height: `calc(var(--hour) * ${hours(height)} - 2px)`,
                    // the app's grid goes left to right (its titles stay Hebrew, so the side is said outright)
                    [app ? 'left' : 'insetInlineStart']: `calc(${p.left * 100}% + ${leftPx}px)`,
                    width: `calc(${p.width * 100}% + ${widthPx}px - ${atEnd ? 'var(--g-end-gap)' : '2px'})`,
                    // what lies on another is drawn over it
                    zIndex: isDragged ? undefined : 1 + Math.min(p.depth, 2),
                  };
                  const short = p.end - p.start < (app ? 35 : 50);
                  const isNow = d === today && !item.faded && nowMin >= p.start && nowMin < p.end;
                  const past = dimPast && !isDragged && !item.faded && (d < today || (d === today && p.end <= nowMin));
                  const movable = !!e && canMove(e) && !bulk?.active;
                  const prep = e && e.taskTotal > 0 ? `הכנה ${e.taskDone}/${e.taskTotal}` : '';
                  const selected = !!(e && bulk?.selected.has(e.id));
                  return (
                    <button
                      key={item.key}
                      type="button"
                      className={[
                        'gc-event',
                        `c-${item.color}`,
                        `k-${item.src.kind}`,
                        short && 'is-short',
                        item.faded && 'is-faded',
                        isNow && 'is-now',
                        past && 'is-past',
                        item.rsvp && `rsvp-${item.rsvp}`,
                        isDragged && 'is-dragging',
                        movable && 'is-movable',
                        p.depth > 0 && 'is-on',
                        selected && 'is-selected',
                      ]
                        .filter(Boolean)
                        .join(' ')}
                      style={style}
                      onPointerDown={(ev) => (e ? startMove(ev, e, 'move') : ev.stopPropagation())}
                      onClick={(ev) => clickEvent(ev, item)}
                      aria-pressed={bulk?.active && e ? selected : undefined}
                      title={[tip(item), prep].filter(Boolean).join('\n')}
                    >
                      <span className="gc-event-title">
                        {bulk?.active && e && <span className="gc-check" aria-hidden="true" />}
                        {item.title}
                      </span>
                      {app ? (
                        // the app: the title, and the place under it - the hours are on the side
                        item.sub && !short && <span className="gc-event-sub">{item.sub}</span>
                      ) : (
                        <span className="gc-event-meta">
                          {fromMinutes(p.start)}
                          {/* a narrow event says its start only (gcal.css) */}
                          <span className="gc-t-end"> - {p.end >= DAY_MINUTES ? '24:00' : fromMinutes(p.end)}</span>
                          {item.sub && !short && <span className="gc-t-end"> · {item.sub}</span>}
                        </span>
                      )}
                      {!app && !short && prep && <span className={`gc-prep${e!.taskDone === e!.taskTotal ? ' is-done' : ''}`}>{prep}</span>}
                      {movable && <span className="gc-resize" onPointerDown={(ev) => startMove(ev, e!, 'resize')} aria-hidden="true" />}
                    </button>
                  );
                })}
                {drag?.kind === 'create' && !drag.draft && drag.date === d && (
                  <div
                    className={`gc-event is-ghost${drag.touch ? ' is-pressed' : ''}`}
                    style={{ top: `calc(var(--hour) * ${hours(drag.start)})`, height: `calc(var(--hour) * ${hours(drag.end - drag.start)} - 2px)` }}
                  >
                    <span className="gc-event-title">(ללא כותרת)</span>
                    <span className="gc-event-meta">{range(drag.start, drag.end)}</span>
                  </div>
                )}
                {draftShown && (() => {
                  // the new event's block: while the finger has it, where the finger takes it - the same block
                  const held = drag?.kind === 'create' && drag.draft ? drag : null;
                  if ((held ? held.home : draft!.date) !== d || (drag && !held)) return null;
                  const at = held ?? draftShown;
                  return (
                    <div
                      key="draft"
                      className={`gc-event is-ghost${draft!.color ? ` c-${draft!.color}` : ''}${app && onDraftMove ? ' is-draft' : ''}${held ? ' is-dragged' : ''}${app && draft!.pending ? ' is-selecting' : ''}`}
                      role={app && draft!.pending ? 'button' : undefined}
                      aria-label={app && draft!.pending ? `אירוע חדש ${range(at.start, at.end)} - הקשה לפתיחה` : undefined}
                      style={{
                        top: `calc(var(--hour) * ${hours(at.start)})`,
                        height: `calc(var(--hour) * ${hours(Math.max(at.end - at.start, app ? APP_MIN_VISIBLE : MIN_VISIBLE))} - 2px)`,
                        ...(held?.dx ? { transform: `translateX(${held.dx}px)` } : {}),
                      }}
                      onPointerDown={app && onDraftMove ? (ev) => startDraftDrag(ev, 'move') : undefined}
                    >
                      <span className="gc-event-title">{draftTitle}</span>
                      <span className="gc-event-meta">{range(at.start, at.end)}</span>
                      {app && onDraftMove && (
                        <>
                          <span className="gc-draft-handle is-start" onPointerDown={(ev) => startDraftDrag(ev, 'start')} aria-hidden="true" />
                          <span className="gc-draft-handle is-end" onPointerDown={(ev) => startDraftDrag(ev, 'end')} aria-hidden="true" />
                        </>
                      )}
                    </div>
                  );
                })()}
                {d === today && <div className="gc-now" style={{ top: `calc(var(--hour) * ${hours(nowMin)})` }} aria-hidden="true" />}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ---------------- the month ----------------

/** a row of a month's week: its height in rows of things, as the screen has room for (a phone's are smaller) */
const ROW_PX = 22;
const DAYNUM_PX = 26;
const ROW_PX_PHONE = 17;
const DAYNUM_PX_PHONE = 22;

function MonthGrid({ date, today, nowTime, items, draft, canCreate, canMove, onOpen, onCreate, onMove, onPickDay, compact = false, dimPast = true, hideWeekend = false }: CalendarProps) {
  const draftTitle = draft?.title?.trim() || '(ללא כותרת)';
  const nowMin = eventSpan(nowTime, null).start;
  const bulk = useBulk();
  const weeks = monthWeeks(date).map((w) => (hideWeekend ? w.filter((d) => !isWeekend(d)) : w));
  const cols = weeks[0].length;
  const month = date.slice(0, 7);
  const dragged = useRef<ScheduleEvent | null>(null);
  const [over, setOver] = useState<string | null>(null);
  // how many rows of things a week has room for: measured, so a tall screen shows more before "עוד"
  const body = useRef<HTMLDivElement>(null);
  const [rows, setRows] = useState(4);
  useEffect(() => {
    const el = body.current;
    if (!el || typeof ResizeObserver !== 'function') return;
    const measure = () => {
      const h = el.clientHeight / weeks.length;
      setRows(Math.max(1, Math.floor((h - (compact ? DAYNUM_PX_PHONE : DAYNUM_PX) - 4) / (compact ? ROW_PX_PHONE : ROW_PX))));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [weeks.length, compact]);

  const drop = (ev: DragEvent, day: string) => {
    ev.preventDefault();
    setOver(null);
    const e = dragged.current;
    dragged.current = null;
    if (e && e.date !== day) onMove(e, { date: day, startTime: e.startTime, endTime: e.endTime });
  };

  return (
    <div className={`gc-month${compact ? ' is-compact' : ''}`} style={{ '--cols': cols } as CSSProperties}>
      <div className="gc-month-head" aria-hidden="true">
        {(compact ? WEEKDAY_LETTERS : WEEKDAY_NAMES).slice(0, cols).map((n) => (
          <div key={n}>{n}</div>
        ))}
      </div>
      <div className="gc-month-body" ref={body} style={{ '--weeks': weeks.length } as CSSProperties}>
        {weeks.map((w) => {
          const lanes = layoutSpans(
            items.filter((i) => i.date <= w[w.length - 1] && i.endDate >= w[0]),
            w,
            itemDays,
            dayOrder,
          );
          const { shown, more } = fitLanes(lanes, w.length, rows);
          return (
            <div key={w[0]} className="gc-week">
              <div className="gc-week-bg">
                {w.map((d) => {
                  const creatable = canCreate(d) && !bulk?.active;
                  return (
                    <div
                      key={d}
                      className={`gc-cell${d.slice(0, 7) !== month ? ' is-out' : ''}${d === today ? ' is-today' : ''}${over === d ? ' is-over' : ''}${creatable ? ' can-create' : ''}`}
                      onClick={(ev) => {
                        if (creatable) onCreate({ date: d, start: null, end: null }, ((r) => ({ top: r.top, bottom: r.bottom, left: r.left, right: r.right }))(ev.currentTarget.getBoundingClientRect()));
                        else onPickDay(d);
                      }}
                      onDragOver={(ev) => {
                        if (!dragged.current) return;
                        ev.preventDefault();
                        setOver(d);
                      }}
                      onDragLeave={() => setOver((o) => (o === d ? null : o))}
                      onDrop={(ev) => drop(ev, d)}
                    />
                  );
                })}
              </div>
              <div className="gc-week-fg" style={{ '--rows': rows } as CSSProperties}>
                {w.map((d, i) => (
                  <button key={d} type="button" className={`gc-daynum${d === today ? ' is-today' : ''}${d.slice(0, 7) !== month ? ' is-out' : ''}`} style={{ gridColumn: i + 1 }} onClick={() => onPickDay(d)} aria-label={dayLabel(d, today)}>
                    {Number(d.slice(8)) === 1 && !compact ? `1 ב${MONTH_NAMES[Number(d.slice(5, 7)) - 1]}` : Number(d.slice(8))}
                  </button>
                ))}
                {shown.map((l) => {
                  const e = eventOf(l.item);
                  const movable = !!e && canMove(e) && !bulk?.active && !compact;
                  return (
                    <Chip
                      key={l.item.key}
                      item={l.item}
                      lane={l}
                      hourly={!compact}
                      past={dimPast && isPast(l.item, today, nowMin)}
                      onOpen={onOpen}
                      selected={!!(e && bulk?.selected.has(e.id))}
                      draggable={movable}
                      onDragStart={(ev) => {
                        dragged.current = e;
                        ev.dataTransfer.effectAllowed = 'move';
                        ev.dataTransfer.setData('text/plain', l.item.title);
                      }}
                      onDragEnd={() => {
                        dragged.current = null;
                        setOver(null);
                      }}
                    />
                  );
                })}
                {more.map((n, i) =>
                  n > 0 ? (
                    <button key={w[i]} type="button" className="gc-more" style={{ gridColumn: i + 1, gridRow: rows + 1 }} onClick={() => onPickDay(w[i])} aria-label={`עוד ${n}`}>
                      {compact ? <bdi dir="ltr">+{n}</bdi> : `עוד ${n}`}
                    </button>
                  ) : null,
                )}
                {draft && w.includes(draft.date) && (
                  <div className={`gc-chip is-bar is-ghost${draft.color ? ` c-${draft.color}` : ''}`} style={{ gridColumn: w.indexOf(draft.date) + 1, gridRow: Math.min(rows, laneCount(shown) + 1) + 1 }}>
                    {draftTitle}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------------- the year ----------------

/** how busy a day is, in four shades */
const shade = (n: number) => (n === 0 ? 0 : n <= 2 ? 1 : n <= 4 ? 2 : n <= 7 ? 3 : 4);

/**
 * Twelve months, each day as busy as it is (the events, the Google events and the deadlines on it), the
 * course's days underlined - its first and last marked - and a day picked opens it.
 */
export function YearGrid({
  date,
  today,
  items,
  weeks,
  onPickDay,
  onPickMonth,
}: {
  date: string;
  today: string;
  items: CalItem[];
  weeks: Week[];
  onPickDay: (d: string) => void;
  onPickMonth: (firstDay: string) => void;
}) {
  const load = loadByDay(items);
  const weekOf = (d: string) => weeks.find((w) => w.startDate <= d && w.endDate >= d);
  const first = weeks.reduce<string | null>((m, w) => (!m || w.startDate < m ? w.startDate : m), null);
  const last = weeks.reduce<string | null>((m, w) => (!m || w.endDate > m ? w.endDate : m), null);
  return (
    <div className="gc-year">
      {yearMonths(date).map((m) => {
        const inMonth = m.slice(0, 7);
        const days = monthWeeks(m).flat();
        while (days.length < 42) days.push(addDays(days[days.length - 1], 1));
        return (
          <section key={m} className="gc-ym" aria-label={`${MONTH_NAMES[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`}>
            <button type="button" className="gc-ym-title" onClick={() => onPickMonth(m)}>
              {MONTH_NAMES[Number(m.slice(5, 7)) - 1]}
            </button>
            <div className="gc-ym-grid">
              {WEEKDAY_LETTERS.map((l) => (
                <span key={l} className="gc-ym-w" aria-hidden="true">
                  {l}
                </span>
              ))}
              {days.map((d) => {
                if (d.slice(0, 7) !== inMonth) return <span key={d} className="gc-ym-day is-out" aria-hidden="true" />;
                const n = load.get(d) ?? 0;
                const wk = weekOf(d);
                const label = [dayLabel(d, today), n ? (n === 1 ? 'פריט אחד' : `${n} פריטים`) : '', wk?.name ?? '', d === first ? 'פתיחת הקורס' : '', d === last ? 'סיום הקורס' : ''].filter(Boolean).join(' · ');
                return (
                  <button
                    key={d}
                    type="button"
                    className={['gc-ym-day', `l-${shade(n)}`, d === today && 'is-today', wk && 'in-course', (d === first || d === last) && 'course-edge'].filter(Boolean).join(' ')}
                    title={label}
                    aria-label={label}
                    onClick={() => onPickDay(d)}
                  >
                    {Number(d.slice(8))}
                  </button>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}
