// The schedule as a calendar, like Google Calendar: a time grid for a day or a
// week, and a month grid. With a mouse, a course event can be dragged to another
// time or day and stretched from its bottom edge; dragging over empty time (or
// clicking it) starts a new event there. In the month view an event is dragged
// to another day. Events of connected Google calendars are shown read-only. The
// arithmetic is in shared/calendarGrid.ts. Task deadlines can be shown too, as
// Google Calendar shows tasks - in a row of their own above the hours, since a
// deadline is a moment and should not crowd the events.

import { useEffect, useRef, useState, type CSSProperties, type DragEvent, type MouseEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { type CalendarView as View, DAY_MINUTES, eventSpan, fromMinutes, layoutDay, MIN_VISIBLE, monthWeeks, movedSpan, resizedEnd, snap, viewDays } from '@shared/calendarGrid';
import { WEEKDAY_NAMES } from '@shared/constants';
import { weekdayName } from '@shared/dates';
import type { ExternalEvent, ScheduleEvent, Task } from '@shared/types';
import { dateKeyOf, fmtTime } from '../lib/format';
import { useBulk } from './Bulk';
import { Icon } from './Icon';

export interface CalendarProps {
  view: View;
  date: string;
  today: string;
  /** false while the events of the days shown are loading */
  ready: boolean;
  /** "HH:MM" now, for the line across today */
  nowTime: string;
  events: ScheduleEvent[];
  external: ExternalEvent[];
  /** tasks whose deadline falls in the days shown */
  tasks: Task[];
  canCreate: (date: string) => boolean;
  canMove: (e: ScheduleEvent) => boolean;
  onOpen: (e: ScheduleEvent) => void;
  onOpenExternal: (e: ExternalEvent) => void;
  onOpenTask: (t: Task) => void;
  onCreate: (date: string, startTime: string, endTime: string | null) => void;
  onMove: (e: ScheduleEvent, to: { date: string; startTime: string; endTime: string | null }) => void;
  onPickDay: (date: string) => void;
}

export function CalendarView(props: CalendarProps) {
  return props.view === 'month' ? <MonthGrid {...props} /> : <TimeGrid {...props} />;
}

// ---------------- day and week ----------------

type Drag =
  | { kind: 'move' | 'resize'; id: number; date: string; start: number; end: number }
  | { kind: 'create'; date: string; start: number; end: number };

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

/** a deadline's day and time in the course's time zone */
const deadlineOf = (t: Task) => ({ date: dateKeyOf(t.deadline), time: fmtTime(t.deadline) });
const byDeadline = (a: Task, b: Task) => a.deadline.localeCompare(b.deadline);
const DEADLINES_MAX = 3;
const taskTitle = (t: Task) => [`דד-ליין: ${t.title}`, `${fmtTime(t.deadline)} · ${t.ownerName}`, t.overdue ? 'באיחור' : ''].filter(Boolean).join('\n');

function TimeGrid({ view, date, today, ready, nowTime, events, external, tasks, canCreate, canMove, onOpen, onOpenExternal, onOpenTask, onCreate, onMove, onPickDay }: CalendarProps) {
  const days = viewDays(view, date);
  const bulk = useBulk();
  const scrollRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const suppressClick = useRef(false);

  // open on the morning (or the first event, if earlier) - once per day or week shown, not on every refresh
  const firstStart = Math.min(
    8 * 60,
    ...events.filter((e) => days.includes(e.date)).map((e) => eventSpan(e.startTime, e.endTime).start),
    ...external.filter((e) => days.includes(e.date) && e.startTime).map((e) => eventSpan(e.startTime!, e.endTime).start),
  );
  const scrollKey = `${view}:${days[0]}`;
  const scrolledFor = useRef('');
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !ready || scrolledFor.current === scrollKey) return;
    scrolledFor.current = scrollKey;
    const body = el.querySelector<HTMLElement>('.cal-col');
    if (body) el.scrollTop = Math.max(0, (body.offsetHeight / DAY_MINUTES) * (firstStart - 45));
  }, [scrollKey, firstStart, ready]);

  const columns = () => [...(scrollRef.current?.querySelectorAll<HTMLElement>('.cal-col') ?? [])];
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
        if (!cancelled) onCreate(day, fromMinutes(current.start), fromMinutes(current.end));
      },
    );
  };

  // a click on empty time (any pointer, touch included): an hour from the half hour clicked
  const clickColumn = (ev: MouseEvent<HTMLDivElement>, day: string) => {
    if (suppressClick.current) {
      suppressClick.current = false;
      return;
    }
    if (ev.target !== ev.currentTarget || bulk?.active || !canCreate(day)) return;
    const start = Math.min(DAY_MINUTES - 30, Math.floor(minutesAt(ev.currentTarget, ev.clientY) / 30) * 30);
    onCreate(day, fromMinutes(start), fromMinutes(Math.min(DAY_MINUTES, start + 60)));
  };
  const clickEvent = (ev: MouseEvent, e: ScheduleEvent) => {
    ev.stopPropagation();
    if (suppressClick.current) {
      suppressClick.current = false;
      return;
    }
    if (bulk?.active) bulk.toggle(e.id);
    else onOpen(e);
  };

  const allDay = external.filter((e) => !e.startTime && days.includes(e.date));
  const shownTasks = tasks.filter((t) => days.includes(deadlineOf(t).date)).sort(byDeadline);
  const nowMin = eventSpan(nowTime, null).start;

  return (
    <div className={`cal cal-${view}`} style={{ '--days': days.length } as CSSProperties}>
      <div className="cal-scroll" ref={scrollRef}>
        <div className="cal-head">
          <div className="cal-gutter" />
          {days.map((d) => (
            <div key={d} className={`cal-dayhead${d === today ? ' today' : ''}`}>
              <span className="dw">{weekdayName(d)}</span>
              <button className="dn" onClick={() => onPickDay(d)} aria-label={`יום ${weekdayName(d)} ${Number(d.slice(8))}`} disabled={view === 'day'}>
                {Number(d.slice(8))}
              </button>
            </div>
          ))}
          {allDay.length > 0 && (
            <>
              <div className="cal-gutter cal-allday-label">כל היום</div>
              {days.map((d) => (
                <div key={d} className="cal-allday">
                  {allDay
                    .filter((e) => e.date === d)
                    .map((e) => (
                      <button key={e.id} className="cal-chip external" onClick={() => onOpenExternal(e)} title={`${e.title} · ${e.sourceName}`}>
                        {e.title}
                      </button>
                    ))}
                </div>
              ))}
            </>
          )}
          {shownTasks.length > 0 && (
            <>
              <div className="cal-gutter cal-allday-label">דד-ליינים</div>
              {days.map((d) => {
                const list = shownTasks.filter((t) => deadlineOf(t).date === d);
                const cut = view !== 'day' && list.length > DEADLINES_MAX ? list.slice(0, DEADLINES_MAX - 1) : list;
                return (
                  <div key={d} className="cal-allday">
                    {cut.map((t) => (
                      <TaskChip key={t.id} t={t} onOpen={onOpenTask} />
                    ))}
                    {cut.length < list.length && (
                      <button className="cal-more" onClick={() => onPickDay(d)}>
                        עוד {list.length - cut.length}
                      </button>
                    )}
                  </div>
                );
              })}
            </>
          )}
        </div>
        <div className="cal-body">
          <div className="cal-gutter cal-hours" aria-hidden>
            {Array.from({ length: 23 }, (_, i) => (
              <span key={i} style={{ top: `calc(var(--hour) * ${i + 1})` }}>
                {String(i + 1).padStart(2, '0')}:00
              </span>
            ))}
          </div>
          {days.map((d) => {
            const own = events.filter((e) => e.date === d && !(drag && drag.kind !== 'create' && drag.id === e.id));
            const moving = drag && drag.kind !== 'create' && drag.date === d ? events.find((e) => e.id === drag.id) : undefined;
            const items = [
              ...own.map((e) => ({ kind: 'event' as const, e, span: eventSpan(e.startTime, e.endTime) })),
              ...(moving && drag ? [{ kind: 'event' as const, e: moving, span: { start: drag.start, end: drag.end } }] : []),
              ...external.filter((x) => x.date === d && x.startTime).map((x) => ({ kind: 'external' as const, e: x, span: eventSpan(x.startTime!, x.endTime) })),
            ];
            return (
              <div
                key={d}
                className={`cal-col${d === today ? ' today' : ''}${canCreate(d) ? ' can-create' : ''}`}
                data-date={d}
                onPointerDown={(ev) => startCreate(ev, d)}
                onClick={(ev) => clickColumn(ev, d)}
              >
                {layoutDay(items, (i) => i.span).map((p) => {
                  const height = Math.max(p.end - p.start, MIN_VISIBLE);
                  const style: CSSProperties = {
                    top: `calc(var(--hour) * ${hours(p.start)})`,
                    height: `calc(var(--hour) * ${hours(height)} - 2px)`,
                    insetInlineStart: `calc(${(p.col / p.cols) * 100}% + 1px)`,
                    width: `calc(${(100 * p.span) / p.cols}% - 3px)`,
                  };
                  const short = p.end - p.start < 50;
                  if (p.item.kind === 'external') {
                    const x = p.item.e;
                    return (
                      <button
                        key={x.id}
                        className={`cal-event external${short ? ' short' : ''}`}
                        style={style}
                        onPointerDown={(ev) => ev.stopPropagation()}
                        onClick={(ev) => {
                          ev.stopPropagation();
                          onOpenExternal(x);
                        }}
                        title={[x.title, range(p.start, p.end), x.location, x.sourceName].filter(Boolean).join('\n')}
                      >
                        <span className="t">{x.title}</span>
                        <span className="m">{range(p.start, p.end)}</span>
                      </button>
                    );
                  }
                  const e = p.item.e;
                  const isDragged = drag?.kind !== 'create' && drag?.id === e.id;
                  const isNow = d === today && !e.cancelled && nowMin >= p.start && nowMin < p.end;
                  const movable = canMove(e) && !bulk?.active;
                  const prep = e.taskTotal > 0 ? `הכנה ${e.taskDone}/${e.taskTotal}` : '';
                  return (
                    <button
                      key={e.id}
                      className={`cal-event${short ? ' short' : ''}${e.cancelled ? ' cancelled' : ''}${isNow ? ' now' : ''}${isDragged ? ' dragging' : ''}${movable ? ' movable' : ''}${bulk?.selected.has(e.id) ? ' selected' : ''}`}
                      style={style}
                      onPointerDown={(ev) => startMove(ev, e, 'move')}
                      onClick={(ev) => clickEvent(ev, e)}
                      aria-pressed={bulk?.active ? bulk.selected.has(e.id) : undefined}
                      title={[e.title, range(p.start, p.end), e.location, e.ownerName && `אחראי: ${e.ownerName}`, prep].filter(Boolean).join('\n')}
                    >
                      <span className="t">
                        {bulk?.active && <span className="cal-check" aria-hidden />}
                        {e.title}
                      </span>
                      <span className="m">
                        {range(p.start, p.end)}
                        {e.location && !short ? ` · ${e.location}` : ''}
                      </span>
                      {!short && prep && <span className={`prep${e.taskDone === e.taskTotal ? ' done' : ''}`}>{prep}</span>}
                      {movable && <span className="cal-resize" onPointerDown={(ev) => startMove(ev, e, 'resize')} aria-hidden />}
                    </button>
                  );
                })}
                {drag?.kind === 'create' && drag.date === d && (
                  <div className="cal-event ghost" style={{ top: `calc(var(--hour) * ${hours(drag.start)})`, height: `calc(var(--hour) * ${hours(drag.end - drag.start)} - 2px)` }}>
                    <span className="t">אירוע חדש</span>
                    <span className="m">{range(drag.start, drag.end)}</span>
                  </div>
                )}
                {d === today && <div className="cal-now" style={{ top: `calc(var(--hour) * ${hours(nowMin)})` }} aria-hidden />}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ---------------- month ----------------

const MONTH_MAX = 4;

function MonthGrid({ date, today, events, external, tasks, canCreate, canMove, onOpen, onOpenExternal, onOpenTask, onCreate, onMove, onPickDay }: CalendarProps) {
  const bulk = useBulk();
  const weeks = monthWeeks(date);
  const month = date.slice(0, 7);
  const dragged = useRef<ScheduleEvent | null>(null);
  const [over, setOver] = useState<string | null>(null);

  const drop = (ev: DragEvent, day: string) => {
    ev.preventDefault();
    setOver(null);
    const e = dragged.current;
    dragged.current = null;
    if (e && e.date !== day) onMove(e, { date: day, startTime: e.startTime, endTime: e.endTime });
  };

  return (
    <div className="cal cal-month">
      <div className="cal-month-head">
        {WEEKDAY_NAMES.map((n) => (
          <div key={n}>{n}</div>
        ))}
      </div>
      {weeks.map((w) => (
        <div key={w[0]} className="cal-month-row">
          {w.map((d) => {
            const allDay = external.filter((x) => x.date === d && !x.startTime);
            const timed = [
              ...events.filter((e) => e.date === d).map((e) => ({ at: e.startTime, node: { kind: 'event' as const, e } })),
              ...external.filter((x) => x.date === d && x.startTime).map((x) => ({ at: x.startTime!, node: { kind: 'external' as const, e: x } })),
            ].sort((a, b) => a.at.localeCompare(b.at));
            // events first: deadlines take what room is left, then go under "עוד"
            const due = tasks
              .filter((t) => deadlineOf(t).date === d)
              .sort(byDeadline)
              .map((t) => ({ kind: 'task' as const, e: t }));
            const items = [...allDay.map((x) => ({ kind: 'allday' as const, e: x })), ...timed.map((t) => t.node), ...due];
            const shown = items.length > MONTH_MAX ? items.slice(0, MONTH_MAX - 1) : items;
            const more = items.length - shown.length;
            const creatable = canCreate(d) && !bulk?.active;
            return (
              <div
                key={d}
                className={`cal-cell${d.slice(0, 7) !== month ? ' out' : ''}${d === today ? ' today' : ''}${over === d ? ' over' : ''}${creatable ? ' can-create' : ''}`}
                onClick={(ev) => {
                  if (ev.target !== ev.currentTarget) return;
                  if (creatable) onCreate(d, '08:00', null);
                  else onPickDay(d);
                }}
                onDragOver={(ev) => {
                  if (!dragged.current) return;
                  ev.preventDefault();
                  setOver(d);
                }}
                onDragLeave={() => setOver((o) => (o === d ? null : o))}
                onDrop={(ev) => drop(ev, d)}
              >
                <button className="cal-cell-day" onClick={() => onPickDay(d)} aria-label={`יום ${weekdayName(d)} ${Number(d.slice(8))}`}>
                  {Number(d.slice(8))}
                </button>
                {shown.map((it) => {
                  if (it.kind === 'allday') {
                    return (
                      <button key={it.e.id} className="cal-chip external" onClick={() => onOpenExternal(it.e)} title={`${it.e.title} · ${it.e.sourceName}`}>
                        {it.e.title}
                      </button>
                    );
                  }
                  if (it.kind === 'task') return <TaskChip key={`t${it.e.id}`} t={it.e} onOpen={onOpenTask} />;
                  if (it.kind === 'external') {
                    return (
                      <button key={it.e.id} className="cal-chip timed external" onClick={() => onOpenExternal(it.e)} title={`${it.e.startTime} ${it.e.title} · ${it.e.sourceName}`}>
                        <i />
                        <b>{it.e.startTime}</b> {it.e.title}
                      </button>
                    );
                  }
                  const e = it.e;
                  const movable = canMove(e) && !bulk?.active;
                  return (
                    <button
                      key={e.id}
                      className={`cal-chip timed${e.cancelled ? ' cancelled' : ''}${bulk?.selected.has(e.id) ? ' selected' : ''}`}
                      draggable={movable}
                      onDragStart={(ev) => {
                        dragged.current = e;
                        ev.dataTransfer.effectAllowed = 'move';
                        ev.dataTransfer.setData('text/plain', e.title);
                      }}
                      onDragEnd={() => {
                        dragged.current = null;
                        setOver(null);
                      }}
                      onClick={() => (bulk?.active ? bulk.toggle(e.id) : onOpen(e))}
                      aria-pressed={bulk?.active ? bulk.selected.has(e.id) : undefined}
                      title={[`${e.startTime} ${e.title}`, e.location, e.ownerName && `אחראי: ${e.ownerName}`].filter(Boolean).join('\n')}
                    >
                      {bulk?.active && <span className="cal-check" aria-hidden />}
                      <i />
                      <b>{e.startTime}</b> {e.title}
                    </button>
                  );
                })}
                {more > 0 && (
                  <button className="cal-more" onClick={() => onPickDay(d)}>
                    עוד {more}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

function TaskChip({ t, onOpen }: { t: Task; onOpen: (t: Task) => void }) {
  return (
    <button className={`cal-chip timed task${t.overdue ? ' overdue' : ''}${t.status === 'done' ? ' done' : ''}`} onClick={() => onOpen(t)} title={taskTitle(t)}>
      <Icon name="flag" size={11} />
      <b>{deadlineOf(t).time}</b> {t.title}
    </button>
  );
}
