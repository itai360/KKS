// The calendar, in Google Calendar's way: the hours of a day, a few days or a week, with what lasts all
// day - a course week, an absence, an experience, a deadline - in rows above them; a month of weeks, its
// things in rows inside each week; a year of months, each day as busy as it is. With a mouse a course
// event is dragged to another time or day and stretched from its bottom edge; dragging over free time
// (or clicking it) starts a new one there; in the month an event is dragged to another day. Things of a
// connected Google calendar are read only. The arithmetic is in shared/calendarGrid.ts, and what each
// thing is in shared/calendarLayers.ts.

import { useEffect, useRef, useState, type CSSProperties, type DragEvent, type MouseEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { DAY_MINUTES, eventSpan, fitLanes, fromMinutes, laneCount, layoutDay, layoutSpans, MIN_VISIBLE, MONTH_NAMES, monthWeeks, movedSpan, resizedEnd, snap, viewDays, yearMonths, type Lane } from '@shared/calendarGrid';
import { dayOrder, isTimed, itemDays, loadByDay, type CalItem } from '@shared/calendarLayers';
import { WEEKDAY_NAMES } from '@shared/constants';
import { addDays, shortDate, weekdayName } from '@shared/dates';
import type { ScheduleEvent, Week } from '@shared/types';
import { useBulk } from './Bulk';
import { Icon } from './Icon';
import type { Anchor } from './Popover';
import { dayLabel, WEEKDAY_LETTERS } from './Agenda';

export type GridView = 'day' | 'three' | 'four' | 'week' | 'month';

export interface Draft {
  date: string;
  start: string | null;
  end: string | null;
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
  onPickDay: (date: string) => void;
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

function Chip({ item, lane, hourly, onOpen, draggable, onDragStart, onDragEnd, selected }: {
  item: CalItem;
  lane?: Lane<CalItem>;
  /** the month: an event with hours is a dot, its hour and its title - not a bar */
  hourly?: boolean;
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
      <span className="gc-chip-title">{k === 'week' && item.sub ? `${item.title} · ${item.sub.replace('מפק"צ מוביל: ', '')}` : item.title}</span>
    </button>
  );
}

// ---------------- day, a few days and the week ----------------

type Drag = { kind: 'move' | 'resize'; id: number; date: string; start: number; end: number } | { kind: 'create'; date: string; start: number; end: number };

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

function TimeGrid({ view, date, today, ready, nowTime, items, draft, allDayOpen, onAllDayToggle, canCreate, canMove, onOpen, onCreate, onMove, onPickDay }: CalendarProps) {
  const days = viewDays(view, date);
  const bulk = useBulk();
  const scrollRef = useRef<HTMLDivElement>(null);
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

  // open on the morning (or the first event, if earlier) - once per day or week shown, not on every refresh
  const firstStart = Math.min(8 * 60, ...timed.map((i) => eventSpan(i.start!, i.end).start));
  const scrollKey = `${view}:${days[0]}`;
  const scrolledFor = useRef('');
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !ready || scrolledFor.current === scrollKey) return;
    scrolledFor.current = scrollKey;
    const body = el.querySelector<HTMLElement>('.gc-col');
    if (body) el.scrollTop = Math.max(0, (body.offsetHeight / DAY_MINUTES) * (firstStart - 45));
  }, [scrollKey, firstStart, ready]);

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
    const grab = minutesAt(home, down.clientY) - span.start;
    const x0 = down.clientX;
    const y0 = down.clientY;
    let current: Drag | null = null;
    track(
      down,
      (m) => {
        if (!current && Math.hypot(m.clientX - x0, m.clientY - y0) < 5) return;
        if (kind === 'resize') {
          current = { kind, id: e.id, date: e.date, start: span.start, end: resizedEnd(span.start, span.end, minutesAt(home, m.clientY) - span.end) };
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

  const startCreate = (down: ReactPointerEvent<HTMLDivElement>, day: string) => {
    suppressClick.current = false;
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
    // right to left: the first day is on the right
    const i = Math.min(days.length - 1, Math.max(0, Math.floor(((r.right - ev.clientX) / r.width) * days.length)));
    const day = days[i];
    if (!canCreate(day)) return;
    const w = r.width / days.length;
    onCreate({ date: day, start: null, end: null }, { top: r.top, bottom: r.bottom, right: r.right - i * w, left: r.right - (i + 1) * w });
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

  return (
    <div className={`gc gc-${view}`} style={{ '--days': days.length } as CSSProperties}>
      <div className="gc-head">
        <div className="gc-gutter gc-tz" aria-hidden="true" />
        {days.map((d) => (
          <div key={d} className={`gc-dayhead${d === today ? ' is-today' : ''}${d < today ? ' is-past' : ''}`}>
            <span className="gc-dw">{weekdayName(d)}</span>
            <button type="button" className="gc-dn" onClick={() => onPickDay(d)} aria-label={dayLabel(d, today)} disabled={view === 'day'}>
              {Number(d.slice(8))}
            </button>
          </div>
        ))}
        {/* what lasts all day, the course's weeks, who is away, the deadlines - rows over the days */}
        <div className="gc-gutter gc-allday-gutter">
          {canOpen && (
            <button type="button" className="icon-btn gc-allday-toggle" onClick={onAllDayToggle} aria-expanded={allDayOpen} aria-label={allDayOpen ? 'צמצום השורות שמעל השעות' : 'הצגת כל מה שמעל השעות'} title={allDayOpen ? 'צמצום' : 'הכל'}>
              <Icon name="chevronDown" size={16} />
            </button>
          )}
        </div>
        <div className="gc-allday" style={{ '--rows': Math.max(1, rows) } as CSSProperties} onClick={clickAllDay}>
          {fit.shown.map((l) => (
            <Chip key={l.item.key} item={l.item} lane={l} onOpen={onOpen} selected={!!(bulk?.active && eventOf(l.item) && bulk.selected.has(eventOf(l.item)!.id))} />
          ))}
          {fit.more.map((n, i) =>
            n > 0 ? (
              <button key={days[i]} type="button" className="gc-more" style={{ gridColumn: i + 1, gridRow: ALLDAY_ROWS }} onClick={onAllDayToggle}>
                עוד {n}
              </button>
            ) : null,
          )}
          {draft && !draft.start && days.includes(draft.date) && (
            <div className="gc-chip is-bar is-ghost" style={{ gridColumn: days.indexOf(draft.date) + 1, gridRow: rows + 1 > ALLDAY_ROWS && !allDayOpen ? ALLDAY_ROWS : rows + 1 }}>
              (ללא כותרת)
            </div>
          )}
        </div>
      </div>
      <div className="gc-scroll" ref={scrollRef}>
        <div className="gc-body">
          <div className="gc-gutter gc-hours" aria-hidden="true">
            {Array.from({ length: 23 }, (_, i) => (
              <span key={i} style={{ top: `calc(var(--hour) * ${i + 1})` }}>
                {String(i + 1).padStart(2, '0')}:00
              </span>
            ))}
          </div>
          {days.map((d) => {
            const own = timed.filter((i) => i.date === d && !(drag && drag.kind !== 'create' && eventOf(i)?.id === drag.id));
            const movingItem = drag && drag.kind !== 'create' && drag.date === d ? timed.find((i) => eventOf(i)?.id === drag.id) : undefined;
            const placed = layoutDay(
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
              >
                {placed.map((p) => {
                  const item = p.item.i;
                  const e = eventOf(item);
                  const height = Math.max(p.end - p.start, MIN_VISIBLE);
                  const style: CSSProperties = {
                    top: `calc(var(--hour) * ${hours(p.start)})`,
                    height: `calc(var(--hour) * ${hours(height)} - 2px)`,
                    insetInlineStart: `calc(${(p.col / p.cols) * 100}% + 1px)`,
                    width: `calc(${(100 * p.span) / p.cols}% - 4px)`,
                  };
                  const short = p.end - p.start < 50;
                  const isDragged = !!e && drag?.kind !== 'create' && drag?.id === e.id;
                  const isNow = d === today && !item.faded && nowMin >= p.start && nowMin < p.end;
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
                        isDragged && 'is-dragging',
                        movable && 'is-movable',
                        p.col > 0 && 'is-overlap',
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
                      <span className="gc-event-meta">
                        {range(p.start, p.end)}
                        {item.sub && !short ? ` · ${item.sub}` : ''}
                      </span>
                      {!short && prep && <span className={`gc-prep${e!.taskDone === e!.taskTotal ? ' is-done' : ''}`}>{prep}</span>}
                      {movable && <span className="gc-resize" onPointerDown={(ev) => startMove(ev, e!, 'resize')} aria-hidden="true" />}
                    </button>
                  );
                })}
                {drag?.kind === 'create' && drag.date === d && (
                  <div className="gc-event is-ghost" style={{ top: `calc(var(--hour) * ${hours(drag.start)})`, height: `calc(var(--hour) * ${hours(drag.end - drag.start)} - 2px)` }}>
                    <span className="gc-event-title">(ללא כותרת)</span>
                    <span className="gc-event-meta">{range(drag.start, drag.end)}</span>
                  </div>
                )}
                {draftShown && draft!.date === d && !drag && (
                  <div className="gc-event is-ghost" style={{ top: `calc(var(--hour) * ${hours(draftShown.start)})`, height: `calc(var(--hour) * ${hours(Math.max(draftShown.end - draftShown.start, MIN_VISIBLE))} - 2px)` }}>
                    <span className="gc-event-title">(ללא כותרת)</span>
                    <span className="gc-event-meta">{range(draftShown.start, draftShown.end)}</span>
                  </div>
                )}
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

/** a row of a month's week: its height in rows of things, as the screen has room for */
const ROW_PX = 22;
const DAYNUM_PX = 26;

function MonthGrid({ date, today, items, draft, canCreate, canMove, onOpen, onCreate, onMove, onPickDay }: CalendarProps) {
  const bulk = useBulk();
  const weeks = monthWeeks(date);
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
      setRows(Math.max(1, Math.floor((h - DAYNUM_PX - 4) / ROW_PX)));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [weeks.length]);

  const drop = (ev: DragEvent, day: string) => {
    ev.preventDefault();
    setOver(null);
    const e = dragged.current;
    dragged.current = null;
    if (e && e.date !== day) onMove(e, { date: day, startTime: e.startTime, endTime: e.endTime });
  };

  return (
    <div className="gc-month">
      <div className="gc-month-head" aria-hidden="true">
        {WEEKDAY_NAMES.map((n) => (
          <div key={n}>{n}</div>
        ))}
      </div>
      <div className="gc-month-body" ref={body} style={{ '--weeks': weeks.length } as CSSProperties}>
        {weeks.map((w) => {
          const lanes = layoutSpans(
            items.filter((i) => i.date <= w[6] && i.endDate >= w[0]),
            w,
            itemDays,
            dayOrder,
          );
          const { shown, more } = fitLanes(lanes, 7, rows);
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
                    {Number(d.slice(8)) === 1 ? `${Number(d.slice(8))} ב${MONTH_NAMES[Number(d.slice(5, 7)) - 1]}` : Number(d.slice(8))}
                  </button>
                ))}
                {shown.map((l) => {
                  const e = eventOf(l.item);
                  const movable = !!e && canMove(e) && !bulk?.active;
                  return (
                    <Chip
                      key={l.item.key}
                      item={l.item}
                      lane={l}
                      hourly
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
                    <button key={w[i]} type="button" className="gc-more" style={{ gridColumn: i + 1, gridRow: rows + 1 }} onClick={() => onPickDay(w[i])}>
                      עוד {n}
                    </button>
                  ) : null,
                )}
                {draft && w.includes(draft.date) && (
                  <div className="gc-chip is-bar is-ghost" style={{ gridColumn: w.indexOf(draft.date) + 1, gridRow: Math.min(rows, laneCount(shown) + 1) + 1 }}>
                    (ללא כותרת)
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
