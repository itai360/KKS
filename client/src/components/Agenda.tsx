// The schedule read day by day, as Google Calendar's Schedule view: one running list of days, each with
// its date at the start and its events as rows; a month with dots to jump by; and what goes on now and
// what comes next (the "Up Next" widgets). The list's arithmetic is in lib/agenda.ts.

import { useEffect, useRef, type ReactNode } from 'react';
import { Link } from 'react-router';
import { MONTH_NAMES, monthWeeks } from '@shared/calendarGrid';
import { diffDays, parseDateKey, shortDate, weekdayName, weekdayOf } from '@shared/dates';
import type { ExternalEvent, ScheduleEvent, Task, Week } from '@shared/types';
import { endMinutes, inMinutes, leftMinutes, nowAndNext, type AgendaItem, type AgendaRow } from '../lib/agenda';
import { finishedJustNow, leaveClass, useLeaving } from '../lib/leaving';
import { BulkCheck, bulkClick, SwipeRow, useBulk } from './Bulk';
import { DoneDrawer } from './DoneDrawer';
import { Icon } from './Icon';
import { usePeriodSwipe } from './periodSwipe';
import { usePhonePicker } from './pickers';
import { openable } from './ui';

export const WEEKDAY_LETTERS = ['א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ש'] as const;

/** "היום", "מחר", "אתמול" - or nothing for a day further away */
export function relDay(date: string, today: string): string | null {
  const d = diffDays(date, today);
  return d === 0 ? 'היום' : d === 1 ? 'מחר' : d === -1 ? 'אתמול' : null;
}

/** "היום · חמישי 8.10", "ראשון 11.10" */
export function dayLabel(date: string, today: string): string {
  const rel = relDay(date, today);
  return `${rel ? `${rel} · ` : ''}${weekdayName(date)} ${shortDate(date)}`;
}

/** Google's short forms for the side of the schedule: "ג׳", "אוק׳" */
const WEEKDAY_SHORT = ['א׳', 'ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳', 'ש׳'] as const;
const MONTH_SHORT = ['ינו׳', 'פבר׳', 'מרץ', 'אפר׳', 'מאי', 'יוני', 'יולי', 'אוג׳', 'ספט׳', 'אוק׳', 'נוב׳', 'דצמ׳'] as const;
/** a day's label, with its year when it is not this year's */
const withYear = (d: string, today: string) => `${dayLabel(d, today)}${d.slice(0, 4) !== today.slice(0, 4) ? `.${d.slice(2, 4)}` : ''}`;
const countLabel = (n: number) => (n === 1 ? 'אירוע אחד' : `${n} אירועים`);
const minutesOf = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));

// ---------------- the month, with dots ----------------

/** A month to jump by: each day with a dot for what is on it, the day picked and today marked. */
export function MonthDots({
  month,
  selected,
  today,
  load,
  onPick,
  onStep,
}: {
  /** any day in the month shown */
  month: string;
  selected: string;
  today: string;
  load: (d: string) => number;
  onPick: (d: string) => void;
  onStep: (dir: 1 | -1) => void;
}) {
  const { year, month: mo } = parseDateKey(month);
  const inMonth = month.slice(0, 7);
  const swipe = useRef<HTMLDivElement>(null);
  usePeriodSwipe(swipe, { enabled: usePhonePicker(), onStep });
  return (
    <div className="mdots">
      <div className="mdots-head">
        <button type="button" className="icon-btn" aria-label="החודש הקודם" onClick={() => onStep(-1)}>
          <Icon name="chevronRight" />
        </button>
        <b className="grow" aria-live="polite">
          {MONTH_NAMES[mo - 1]} {year}
        </b>
        <button type="button" className="icon-btn" aria-label="החודש הבא" onClick={() => onStep(1)}>
          <Icon name="chevronLeft" />
        </button>
      </div>
      <div className="period-clip">
        <div className="mdots-grid period-swipe" ref={swipe}>
          {WEEKDAY_LETTERS.map((l) => (
            <span key={l} className="mdots-w" aria-hidden="true">
              {l}
            </span>
          ))}
          {monthWeeks(month)
            .flat()
            .map((d) => {
              const n = load(d);
              return (
                <button
                  key={d}
                  type="button"
                  className={`mdots-day${d.slice(0, 7) !== inMonth ? ' out' : ''}${d === today ? ' today' : ''}${d === selected ? ' on' : ''}`}
                  aria-pressed={d === selected}
                  aria-label={`${dayLabel(d, today)}${n ? `, ${countLabel(n)}` : ''}`}
                  onClick={() => onPick(d)}
                >
                  <span className="n">{Number(d.slice(8))}</span>
                  <span className="ws-dots" aria-hidden="true">
                    {Array.from({ length: Math.min(3, n) }, (_, k) => (
                      <i key={k} />
                    ))}
                  </span>
                </button>
              );
            })}
        </div>
      </div>
    </div>
  );
}

// ---------------- now and next ----------------

/**
 * Today's event going on now (how far it is, how long is left) and the next one (how soon), like an
 * "Up Next" widget - nothing when the day has nothing more.
 */
export function UpNext({
  events,
  today,
  nowTime,
  onOpen,
  head,
}: {
  events: ScheduleEvent[];
  today: string;
  nowTime: string;
  onOpen: (e: ScheduleEvent) => void;
  /** a line above, where the card stands away from the schedule (a link to it) */
  head?: ReactNode;
}) {
  const { now, progress, left, next, until } = nowAndNext(events, today, nowTime);
  if (!now && !next) return null;
  return (
    <section className="card up-next" aria-label='עכשיו ובהמשך בלו"ז'>
      {head && <div className="un-head">{head}</div>}
      {now && (
        <button type="button" className="un-row is-now" onClick={() => onOpen(now)}>
          <span className="un-label">
            <span className="un-pulse" aria-hidden="true" /> עכשיו
          </span>
          <span className="un-title">{now.title}</span>
          <span className="un-meta">
            {[`${now.startTime}${now.endTime ? ` - ${now.endTime}` : ''}`, now.location, now.ownerName && `אחראי: ${now.ownerName}`].filter(Boolean).join(' · ')}
          </span>
          <span className="un-bar" aria-hidden="true">
            <i style={{ inlineSize: `${Math.round(progress * 100)}%` }} />
          </span>
          <span className="un-left">{leftMinutes(left)}</span>
        </button>
      )}
      {next && (
        <button type="button" className="un-row" onClick={() => onOpen(next)}>
          <span className="un-label">הבא · {inMinutes(until)}</span>
          <span className="un-title">{next.title}</span>
          <span className="un-meta">{[`${next.startTime}${next.endTime ? ` - ${next.endTime}` : ''}`, next.location].filter(Boolean).join(' · ')}</span>
        </button>
      )}
    </section>
  );
}

// ---------------- adding by writing one line ----------------

export interface EventPrefill {
  date: string;
  start?: string;
  end?: string | null;
  title?: string;
  location?: string;
  ownerId?: number | null;
}

// ---------------- the running list ----------------

export interface AgendaProps {
  rows: AgendaRow[];
  today: string;
  nowTime: string;
  weeks: Week[];
  canAddOn: (d: string) => boolean;
  onAdd: (d: string) => void;
  onOpen: (e: ScheduleEvent) => void;
  onOpenExternal: (e: ExternalEvent) => void;
  onOpenTask: (t: Task) => void;
  /** the day at the top of the list, as it scrolls */
  onFocusDay?: (d: string) => void;
  /** only the reader's own events are shown: an empty day says so */
  onlyMine?: boolean;
}

/** where the list goes under what stays on top (the top bar, the strip of days) */
function stickyLine(from: HTMLElement): number {
  // the calendar's bar on a phone, or the search's in its place - whichever stays on top
  const bars = [...(from.closest('.schedule-page')?.querySelectorAll<HTMLElement>('.gph-bar, .cal-search-bar') ?? [])].filter((b) => getComputedStyle(b).position === 'sticky');
  const top = document.querySelector<HTMLElement>('.topbar');
  return Math.max(top?.getBoundingClientRect().bottom ?? 0, ...bars.map((b) => b.getBoundingClientRect().bottom));
}

/** Brings a day of the list to the top, under what stays there - `unlessSeen`: only when it is out of sight. */
export function scrollToDay(list: HTMLElement | null, d: string, unlessSeen = false): boolean {
  const row = list?.querySelector<HTMLElement>(`[data-day="${d}"]`) ?? [...(list?.querySelectorAll<HTMLElement>('[data-from]') ?? [])].find((g) => g.dataset.from! <= d && g.dataset.to! >= d);
  if (!row || !list) return false;
  const line = stickyLine(list);
  const top = row.getBoundingClientRect().top;
  if (unlessSeen && top >= line && top < window.innerHeight * 0.6) return true;
  const smooth = !matchMedia('(prefers-reduced-motion: reduce)').matches;
  window.scrollTo({ top: Math.max(0, top + window.scrollY - line - 6), behavior: smooth ? 'smooth' : 'auto' });
  return true;
}

export function AgendaList({ rows, today, nowTime, weeks, canAddOn, onAdd, onOpen, onOpenExternal, onOpenTask, onFocusDay, onlyMine }: AgendaProps) {
  const ref = useRef<HTMLDivElement>(null);
  const focusFn = useRef(onFocusDay);
  focusFn.current = onFocusDay;

  // the day at the top, as the page scrolls - the strip of days follows it
  useEffect(() => {
    const list = ref.current;
    if (!list || !focusFn.current) return;
    let frame = 0;
    let last = '';
    const measure = () => {
      frame = 0;
      const line = stickyLine(list) + 12;
      let day = '';
      for (const el of list.querySelectorAll<HTMLElement>('[data-day], [data-from]')) {
        if (el.getBoundingClientRect().top > line) break;
        day = el.dataset.day ?? el.dataset.from!;
      }
      day ||= list.querySelector<HTMLElement>('[data-day], [data-from]')?.dataset.day ?? '';
      if (day && day !== last) {
        last = day;
        focusFn.current?.(day);
      }
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(measure);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      cancelAnimationFrame(frame);
    };
  }, [rows]);

  const weekOf = (d: string) => weeks.find((w) => w.startDate <= d && w.endDate >= d);
  return (
    <div className="agenda" ref={ref}>
      {rows.map((r, i) => {
        // a course week is named where the list goes into it (the page names the one it starts in)
        const first = r.kind === 'day' ? r.date : r.from;
        const week = weekOf(first);
        const prev = i > 0 ? rows[i - 1] : null;
        const prevDay = prev ? (prev.kind === 'day' ? prev.date : prev.to) : null;
        const weekHead = week && prevDay && weekOf(prevDay)?.id !== week.id ? week : null;
        return (
          <div key={first} className="agenda-block">
            {weekHead && <WeekHead week={weekHead} />}
            {r.kind === 'gap' ? (
              <div className="agenda-gap" data-from={r.from} data-to={r.to}>
                <span>{r.from === r.to ? withYear(r.from, today) : `${withYear(r.from, today)} - ${withYear(r.to, today)}`}</span>
                <span className="muted">· {onlyMine ? 'אין אירועים שלך' : 'אין אירועים'}</span>
                <span className="grow" />
                {canAddOn(r.from) && (
                  <button type="button" className="icon-btn agenda-add" aria-label={`אירוע חדש ב${dayLabel(r.from, today)}`} title="אירוע חדש" onClick={() => onAdd(r.from)}>
                    <Icon name="plus" size={16} />
                  </button>
                )}
              </div>
            ) : (
              <AgendaDaySection
                date={r.date}
                items={r.items}
                today={today}
                nowTime={nowTime}
                canAdd={canAddOn(r.date)}
                onlyMine={onlyMine}
                onAdd={() => onAdd(r.date)}
                onOpen={onOpen}
                onOpenExternal={onOpenExternal}
                onOpenTask={onOpenTask}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

/** where a course week starts: its name, its days and its lead - and its page, a tap away */
function WeekHead({ week }: { week: Week }) {
  return (
    <Link className="agenda-week" to={`/weeks/${week.id}`}>
      <Icon name="layers" size={14} />
      <b>{week.name}</b>
      <span className="muted">
        {shortDate(week.startDate)} - {shortDate(week.endDate)}
        {week.leadName ? ` · מפק"צ השבוע: ${week.leadName}` : ''}
      </span>
      <Icon name="chevronLeft" size={14} />
    </Link>
  );
}

function AgendaDaySection({
  date,
  items,
  today,
  nowTime,
  canAdd,
  onlyMine,
  onAdd,
  onOpen,
  onOpenExternal,
  onOpenTask,
}: {
  date: string;
  items: AgendaItem[];
  today: string;
  nowTime: string;
  canAdd: boolean;
  onlyMine?: boolean;
  onAdd: () => void;
  onOpen: (e: ScheduleEvent) => void;
  onOpenExternal: (e: ExternalEvent) => void;
  onOpenTask: (t: Task) => void;
}) {
  const isToday = date === today;
  const events = items.filter((i) => i.kind === 'event').map((i) => i.e as ScheduleEvent);
  const live = isToday ? nowAndNext(events, today, nowTime) : null;
  const at = minutesOf(nowTime);
  // as Google's schedule: what is over today stays in the list, dimmed (each row knows it is past)
  const over: AgendaItem[] = [];
  const rest = items;
  // a deadline gone because its task was done here (its page, the bell) goes done too, then folds
  const leaving = useLeaving(
    rest,
    (it) => it.key,
    (k, last) => over.find((it) => it.key === k) ?? (last.kind === 'task' && finishedJustNow('tasks', last.t.id) && { ...last, t: { ...last.t, status: 'done' as const, overdue: false } }),
  );
  const rows = leaving.rows;
  // the line of now goes before the first thing that has not started yet
  const nowAt = isToday ? rows.findIndex((i) => i.at && minutesOf(i.at) > at) : -2;
  const count = items.filter((i) => i.kind !== 'task' && !(i.kind === 'event' && i.e.cancelled)).length;
  const dueCount = items.length - items.filter((i) => i.kind !== 'task').length;
  const nowLine = (
    <div key="now" className="agenda-now" aria-hidden="true">
      <span>{nowTime}</span>
    </div>
  );
  // after the last thing of the day only once it is over: an event still going on shows now itself
  const nowLast = isToday && rows.length > 0 && nowAt === -1 && !live?.now;
  const row = (it: AgendaItem) => <ItemRow key={it.key} it={it} date={date} today={today} at={at} live={live} onOpen={onOpen} onOpenExternal={onOpenExternal} onOpenTask={onOpenTask} />;
  const { year, month, day } = parseDateKey(date);
  const label = [count ? countLabel(count) : '', dueCount ? (dueCount === 1 ? 'דד-ליין אחד' : `${dueCount} דד-ליינים`) : ''].filter(Boolean).join(', ');
  return (
    <section className={`agenda-day gs-day${isToday ? ' is-today' : ''}${date < today ? ' is-past' : ''}`} data-day={date} aria-labelledby={`ad-${date}`}>
      {/* the day as Google's schedule has it: its date on the side - the weekday small, the day of the month large */}
      <h3 className="gs-date" id={`ad-${date}`} aria-label={`${dayLabel(date, today)}${label ? `, ${label}` : ''}`}>
        <span className="gs-wd">{WEEKDAY_SHORT[weekdayOf(date)]}</span>
        <span className="gs-num">{day}</span>
        <span className="gs-mon">
          {MONTH_SHORT[month - 1]}
          {year !== Number(today.slice(0, 4)) ? ` ${year}` : ''}
        </span>
      </h3>
      <div className="agenda-items gs-items">
        {over.length > 0 && (
          <DoneDrawer row id="agenda-earlier" count={over.length} label="מוקדם יותר היום">
            {over.map(row)}
          </DoneDrawer>
        )}
        {over.length > 0 && !rows.length ? (
          <div className="agenda-empty">אין עוד אירועים היום</div>
        ) : items.length === 0 ? (
          <button type="button" className="agenda-empty gs-empty" onClick={canAdd ? onAdd : undefined} disabled={!canAdd}>
            {`אין אירועים${onlyMine ? ' שלך' : ''}${isToday ? ' היום' : ''}`}
            {canAdd && <span className="gs-empty-add">· הוספה</span>}
          </button>
        ) : (
          rows.flatMap((it, i) => {
            const one = (
              <div key={it.key} className={leaveClass(leaving.phaseOf(it.key))}>
                {row(it)}
              </div>
            );
            return i === nowAt ? [nowLine, one] : [one];
          })
        )}
        {nowLast && nowLine}
      </div>
    </section>
  );
}

function ItemRow({
  it,
  date,
  today,
  at,
  live,
  onOpen,
  onOpenExternal,
  onOpenTask,
}: {
  it: AgendaItem;
  date: string;
  today: string;
  at: number;
  live: ReturnType<typeof nowAndNext> | null;
  onOpen: (e: ScheduleEvent) => void;
  onOpenExternal: (e: ExternalEvent) => void;
  onOpenTask: (t: Task) => void;
}) {
  if (it.kind === 'task') return <DeadlineRow t={it.t} time={it.at} onOpen={() => onOpenTask(it.t)} />;
  if (it.kind === 'external') {
    const x = it.e;
    const past = date < today || (date === today && !!x.startTime && endMinutes({ startTime: x.startTime, endTime: x.endTime }) <= at);
    return <ExternalRow x={x} past={past} onOpen={() => onOpenExternal(x)} />;
  }
  const e = it.e;
  const past = date < today || (date === today && endMinutes(e) <= at);
  const isNow = live?.now?.id === e.id;
  return (
    <CourseEventRow
      e={e}
      past={past && !isNow}
      now={isNow ? { progress: live!.progress, left: live!.left } : null}
      until={live?.next?.id === e.id ? live.until : null}
      onOpen={() => onOpen(e)}
    />
  );
}

/** A course event in a list: its hours, what and where, who, and how its preparation goes. */
export function CourseEventRow({
  e,
  past,
  now,
  until,
  onOpen,
}: {
  e: ScheduleEvent;
  past?: boolean;
  now?: { progress: number; left: number } | null;
  /** minutes until it starts, for the next one today */
  until?: number | null;
  onOpen: () => void;
}) {
  const bulk = useBulk();
  return (
    <SwipeRow itemId={e.id} label={e.title}>
      <div
        className={`event-row c-${e.color || 'blue'}${e.cancelled ? ' cancelled' : ''}${now ? ' now' : ''}${past ? ' past' : ''}${bulk?.selected.has(e.id) ? ' selected' : ''}`}
        {...openable(bulkClick(bulk, e.id, onOpen))}
      >
        <span className="gs-dot" aria-hidden="true" />
        <div className={`event-time${e.allDay ? ' small' : ''}`}>
          <BulkCheck id={e.id} />
          {e.allDay ? 'כל היום' : e.startTime}
          {!e.allDay && e.endTime && <span className="end"> – {e.endTime}</span>}
          {e.allDay && e.endDate && e.endDate !== e.date && <span className="end"> עד {shortDate(e.endDate)}</span>}
        </div>
        <div style={{ minWidth: 0 }}>
          <div className="event-title">
            {e.title} {e.cancelled && <span className="badge t-red">בוטל</span>}
            {now && <span className="badge t-orange">עכשיו</span>}
            {until != null && <span className="badge t-blue">{inMinutes(until)}</span>}
          </div>
          <div className="task-meta dotted">
            {e.location && (
              <span>
                <Icon name="pin" size={13} /> {e.location}
              </span>
            )}
            {e.ownerName && <span className={e.location ? 'sep' : ''}>אחראי: {e.ownerName}</span>}
            {e.notes && <span className="sep event-notes">{e.notes.slice(0, 60)}</span>}
          </div>
          {now && (
            <div className="event-progress">
              <span className="un-bar" aria-hidden="true">
                <i style={{ inlineSize: `${Math.round(now.progress * 100)}%` }} />
              </span>
              <span className="tiny muted">{leftMinutes(now.left)}</span>
            </div>
          )}
        </div>
        <div className="row gap-6">
          {e.taskTotal > 0 && (
            <span className={`badge t-${e.taskDone === e.taskTotal ? 'green' : 'orange'}`} title="משימות הכנה שהושלמו">
              הכנה {e.taskDone}/{e.taskTotal}
            </span>
          )}
        </div>
      </div>
    </SwipeRow>
  );
}

/** An event of a connected Google calendar: read-only, so it only opens its details. */
export function ExternalRow({ x, past, onOpen }: { x: ExternalEvent; past?: boolean; onOpen: () => void }) {
  return (
    <div className={`event-row external c-teal${past ? ' past' : ''}`} {...openable(onOpen)}>
      <span className="gs-dot" aria-hidden="true" />
      <div className={`event-time${x.startTime ? '' : ' small'}`}>
        {x.startTime ?? 'כל היום'}
        {x.endTime && <span className="end"> – {x.endTime}</span>}
      </div>
      <div style={{ minWidth: 0 }}>
        <div className="event-title">{x.title}</div>
        <div className="task-meta dotted">
          <span>{x.sourceName}</span>
          {x.location && (
            <span className="sep">
              <Icon name="pin" size={13} /> {x.location}
            </span>
          )}
        </div>
      </div>
      <span className="badge t-blue">Google</span>
    </div>
  );
}

/** A task's deadline in the timeline: a flag at its hour, never a block of time. */
function DeadlineRow({ t, time, onOpen }: { t: Task; time: string; onOpen: () => void }) {
  const done = t.status === 'done';
  return (
    <div className={`event-row deadline${t.overdue ? ' overdue' : ''}${done ? ' done' : ''}`} {...openable(onOpen)}>
      <span className="gs-dot gs-flag" aria-hidden="true">
        <Icon name={done ? 'check' : 'flag'} size={12} />
      </span>
      <div className="event-time">{time}</div>
      <div style={{ minWidth: 0 }}>
        <div className="event-title">{t.title}</div>
        <div className="task-meta dotted">
          <span>דד-ליין</span>
          {t.ownerName && <span className="sep">{t.ownerName}</span>}
        </div>
      </div>
      {done ? <span className="badge t-green">הושלם</span> : t.overdue && <span className="badge t-red">באיחור</span>}
    </div>
  );
}
