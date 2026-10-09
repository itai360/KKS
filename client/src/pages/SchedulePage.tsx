// Sections 22-23 (daily schedule, linked tasks), 58 (activity workflow),
// 66-67 (schedule changes and cancellations ripple into tasks).
// Read the way the calendar apps people keep opening are read: on a phone one running list of days
// ("סדר יום") under a strip of the week, three days side by side, a month with dots over the day
// picked; on a computer the week, the day or the list with the month beside them, and the month.
// Adding is a line of text (components/Agenda.tsx).

import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { type CalendarView as CalendarViewName, MONTH_NAMES, monthWeeks, stepDate, viewDays, viewTitle } from '@shared/calendarGrid';
import { addDays, diffDays, parseDateKey, shortDate, startOfWeek, weekdayName } from '@shared/dates';
import type { EventDetail, ExternalEvent, ScheduleEvent, Task, Template } from '@shared/types';
import { AgendaList, MonthDots, QuickAdd, scrollToDay, UpNext, WeekStrip, type EventPrefill } from '../components/Agenda';
import { BulkScope, BulkToggle } from '../components/Bulk';
import { CalendarView } from '../components/CalendarView';
import { KindBadge, PriorLessons } from '../components/DebriefBits';
import { GoogleCalendarModal } from '../components/GoogleCalendar';
import { Icon } from '../components/Icon';
import { usePeriodSwipe } from '../components/periodSwipe';
import { useNewTask } from '../components/NewTask';
import { OpenTaskList } from '../components/TaskRow';
import { useToast } from '../components/Toasts';
import { DateInput, ErrorBox, Field, Loading, Modal, PageHead, Ring, Seg, Select, TimeInput } from '../components/ui';
import { agendaDays, endMinutes, foldQuiet, isMine, type AgendaRow } from '../lib/agenda';
import { api, changedFields } from '../lib/api';
import { BOTTOM_BAR_MEDIA } from '../lib/bottomBar';
import { dateKeyOf, fileSize, fmtDeadline, fmtLongDate, fmtTime, isoAt, todayKey } from '../lib/format';
import { useMedia } from '../lib/media';
import { emitLocalChange } from '../lib/realtime';
import { useSession } from '../lib/session';
import { useApi, useTick } from '../lib/useApi';
import { safeUrl } from '../lib/safeUrl';
import { ask } from '../components/Confirm';

type ScheduleView = 'agenda' | CalendarViewName;
const ALL_VIEWS: ScheduleView[] = ['agenda', 'day', 'three', 'week', 'month'];
const PHONE_VIEWS: { value: ScheduleView; label: string }[] = [
  { value: 'agenda', label: 'סדר יום' },
  { value: 'day', label: 'יום' },
  { value: 'three', label: '3 ימים' },
  { value: 'month', label: 'חודש' },
];
const DESK_VIEWS: { value: ScheduleView; label: string }[] = [
  { value: 'agenda', label: 'סדר יום' },
  { value: 'day', label: 'יום' },
  { value: 'week', label: 'שבוע' },
  { value: 'month', label: 'חודש' },
];
const VIEW_KEY = 'kks.scheduleView';
/** "list" was a list of one day: the running list took its place */
const asView = (v: string | null): ScheduleView | null => (v === 'list' ? 'agenda' : ALL_VIEWS.includes(v as ScheduleView) ? (v as ScheduleView) : null);
// a remembered view is a convenience: storage can be missing or blocked
function savedView(): ScheduleView | null {
  try {
    return asView(localStorage.getItem(VIEW_KEY));
  } catch {
    return null;
  }
}
/** seven columns do not fit a phone; a computer has room for the whole week */
const fitView = (v: ScheduleView, phone: boolean): ScheduleView => (phone && v === 'week' ? 'three' : !phone && v === 'three' ? 'week' : v);
/** the running list: two weeks from the day picked, and a week more at a time */
const AGENDA_DAYS = 14;
type TasksShown = 'mine' | 'all' | 'none';
const TASKS_KEY = 'kks.scheduleTasks';
function savedTasksShown(): TasksShown {
  try {
    const v = localStorage.getItem(TASKS_KEY);
    return v === 'all' || v === 'none' ? v : 'mine';
  } catch {
    return 'mine';
  }
}
/** only the reader's own events: remembered, as the view is */
const MINE_KEY = 'kks.scheduleMine';
function savedMine(): boolean {
  try {
    return localStorage.getItem(MINE_KEY) === '1';
  } catch {
    return false;
  }
}
const MINE_OPTIONS: { value: 'all' | 'mine'; label: string }[] = [
  { value: 'all', label: 'הכל' },
  { value: 'mine', label: 'רק שלי' },
];
const TASKS_OPTIONS: { value: TasksShown; label: string }[] = [
  { value: 'mine', label: 'שלי' },
  { value: 'all', label: 'של כולם' },
  { value: 'none', label: 'בלי' },
];
// keys by position, so they work with a Hebrew keyboard too (as in Google Calendar)
const VIEW_KEYS: Record<string, ScheduleView> = { KeyA: 'agenda', KeyD: 'day', KeyW: 'week', KeyM: 'month' };
const VIEW_STEP: Record<ScheduleView, string> = { agenda: 'שבוע', day: 'יום', three: '3 ימים', week: 'שבוע', month: 'חודש' };

const earliest = (a: string[]) => a.reduce((m, x) => (x < m ? x : m));
const latest = (a: string[]) => a.reduce((m, x) => (x > m ? x : m));
/** whole months' grids around the days needed: moving inside them asks the server for nothing new */
function fetchRange(days: string[]): { from: string; to: string } {
  const last = monthWeeks(latest(days));
  return { from: monthWeeks(earliest(days))[0][0], to: last[last.length - 1][6] };
}
const deadlineAt = (t: Task) => ({ date: dateKeyOf(t.deadline), time: fmtTime(t.deadline) });
// nothing yet, always the same nothing - so what is built from it is not built again on every render
const NO_EVENTS: ScheduleEvent[] = [];
const NO_EXTERNAL: ExternalEvent[] = [];
const NO_TASKS: Task[] = [];
const minutesOf = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));

export function SchedulePage() {
  const [params, setParams] = useSearchParams();
  const phone = useMedia(BOTTOM_BAR_MEDIA);
  const today = todayKey();
  const date = params.get('date') ?? today;
  const eventId = params.get('event');
  const view = fitView(asView(params.get('view')) ?? savedView() ?? (phone ? 'agenda' : 'week'), phone);
  const { isCommander, weeks, user, viewing } = useSession();
  const navigate = useNavigate();
  const toast = useToast();
  useTick(60_000);

  // the running list: from the day picked; the day at its top as it scrolls, which the strip follows
  const [more, setMore] = useState({ date, days: AGENDA_DAYS });
  const span = more.date === date ? more.days : AGENDA_DAYS;
  const agendaTo = addDays(date, span - 1);
  const [focusFor, setFocusFor] = useState({ date, day: date });
  const focus = view === 'agenda' && focusFor.date === date ? focusFor.day : date;
  // the month to jump by: on a phone under the title, on a computer beside the day and the list
  const [pickerOpen, setPickerOpen] = useState(false);
  const side = !phone && (view === 'agenda' || view === 'day');
  const [miniFor, setMiniFor] = useState<{ day: string; month: string } | null>(null);
  const miniMonth = miniFor?.day === focus ? miniFor.month : focus;
  const miniShown = side || (phone && (pickerOpen || view === 'month'));

  const shown = view === 'agenda' ? [] : viewDays(view, date);
  const needed =
    view === 'agenda' ? [startOfWeek(date), addDays(startOfWeek(agendaTo), 6)] : [shown[0], shown[shown.length - 1], ...(phone ? viewDays('week', date) : [])];
  if (miniShown) needed.push(miniMonth);
  const { from, to } = fetchRange(needed);
  const { data, error, loading, setData, reload } = useApi<ScheduleEvent[]>(`/api/events?from=${from}&to=${to}`, ['events', 'tasks']);
  // events of connected Google calendars (read-only); loaded on their own so the course schedule never waits for Google
  const external = useApi<ExternalEvent[]>(`/api/calendar/external?from=${from}&to=${to}`, ['events']);
  // deadlines of open tasks (routine recurring tasks left out)
  const [tasksShown, setTasksShownRaw] = useState<TasksShown>(savedTasksShown);
  const setTasksShown = (v: TasksShown) => {
    setTasksShownRaw(v);
    try {
      localStorage.setItem(TASKS_KEY, v);
    } catch {
      /* not remembered */
    }
  };
  // only mine: the events this person runs or prepares for, their own deadlines, and no shared Google calendars
  const [onlyMine, setOnlyMineRaw] = useState(savedMine);
  const setOnlyMine = (v: boolean) => {
    setOnlyMineRaw(v);
    try {
      localStorage.setItem(MINE_KEY, v ? '1' : '0');
    } catch {
      /* not remembered */
    }
  };
  const deadlines: TasksShown = onlyMine && tasksShown === 'all' ? 'mine' : tasksShown;
  const tasks = useApi<Task[]>(deadlines !== 'none' ? `/api/tasks?from=${from}&to=${to}&hideClosed=1&recurring=0${deadlines === 'mine' ? '&owner=me' : ''}` : null, ['tasks']);
  const allEvents = data ?? NO_EVENTS;
  const events = useMemo(() => (onlyMine ? allEvents.filter((e) => isMine(e, user.id)) : allEvents), [allEvents, onlyMine, user.id]);
  const externalEvents = onlyMine ? NO_EXTERNAL : (external.data ?? NO_EXTERNAL);
  const taskList = deadlines === 'none' ? NO_TASKS : (tasks.data ?? NO_TASKS);

  const [creating, setCreating] = useState<EventPrefill | null>(null);
  const [editing, setEditing] = useState<ScheduleEvent | null>(null);
  const [google, setGoogle] = useState(false);
  const [peek, setPeek] = useState<ExternalEvent | null>(null);
  const [affected, setAffected] = useState<{ tasks: Task[]; delta: number; id: number } | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const set = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) {
      if (v === null) next.delete(k);
      else next.set(k, v);
    }
    next.delete('new');
    setParams(next, { replace: true });
  };
  const setView = (v: ScheduleView) => {
    try {
      localStorage.setItem(VIEW_KEY, v);
    } catch {
      /* not remembered */
    }
    // the day being read goes along to the next view
    set({ view: v, date: focus === today ? null : focus });
    setPickerOpen(false);
  };
  const step = (dir: 1 | -1) => set({ date: view === 'agenda' ? addDays(date, 7 * dir) : stepDate(view, date, dir), event: null });
  // while the list is brought to a day, the day picked is the one being read - not each day passed on the way
  const steering = useRef(0);
  const steer = () => void (steering.current = Date.now() + 1000);
  // the list started again from a day: once it is on the screen, that day is in sight
  const pendingDay = useRef<string | null>(null);
  /** to a day: in the list already - there; otherwise the list (or the view) starts from it */
  const goTo = (d: string) => {
    if (view === 'agenda' && d >= date && d <= agendaTo && scrollToDay(listRef.current, d)) {
      steer();
      setFocusFor({ date, day: d });
      return;
    }
    set({ date: d === today ? null : d, event: null });
    if (view === 'agenda' && d !== date) pendingDay.current = d;
  };
  useEffect(() => {
    const d = pendingDay.current;
    if (!d || view !== 'agenda') return;
    pendingDay.current = null;
    steer();
    scrollToDay(listRef.current, d, true);
  }, [date, view]);
  const goToday = () => (view === 'agenda' && date === today ? goTo(today) : set({ date: null, event: null }));
  const asked = params.get('new') === '1';
  useEffect(() => {
    if (!asked) return;
    setCreating({ date: focus });
    set({});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [asked]);
  const swipeArea = useRef<HTMLDivElement>(null);
  const grid = view !== 'agenda' && !(phone && view === 'month');
  usePeriodSwipe(swipeArea, { enabled: phone && grid, onStep: step });

  // t: today, j/k: next/previous, a/d/w/m: list/day/week/month (n stays "new task", everywhere)
  const keys = useRef({ step, setView, goToday });
  keys.current = { step, setView, goToday };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)) return;
      if (document.querySelector('.modal')) return;
      const k = keys.current;
      if (e.code === 'KeyT') k.goToday();
      else if (e.code === 'KeyJ') k.step(1);
      else if (e.code === 'KeyK') k.step(-1);
      else if (VIEW_KEYS[e.code]) k.setView(VIEW_KEYS[e.code]);
      else return;
      e.preventDefault();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const weekOf = (d: string) => weeks.find((w) => w.startDate <= d && w.endDate >= d);
  const week = weekOf(focus);
  const leadOn = (d: string) => weekOf(d)?.leadId === user.id;
  const canAdd = !viewing && (isCommander || week?.leadId === user.id);
  const canAddOn = (d: string) => !viewing && (isCommander || leadOn(d));
  // as the server has it: the commander, the week's lead - or anyone, for an event in their own charge
  const mayAdd = (d: string, ownerId: number | null) => canAddOn(d) || (!viewing && ownerId === user.id);
  const canQuick = !viewing && (isCommander || weeks.some((w) => w.leadId === user.id));
  const canMove = (e: ScheduleEvent) => !viewing && (isCommander || e.ownerId === user.id || leadOn(e.date));
  const nowTime = fmtTime(new Date().toISOString());

  const loadOf = useMemo(() => {
    const n = new Map<string, number>();
    for (const e of events) if (!e.cancelled) n.set(e.date, (n.get(e.date) ?? 0) + 1);
    for (const x of externalEvents) n.set(x.date, (n.get(x.date) ?? 0) + 1);
    return (d: string) => n.get(d) ?? 0;
  }, [events, externalEvents]);
  const rows: AgendaRow[] = useMemo(() => {
    if (view === 'agenda') return foldQuiet(agendaDays(date, span, events, externalEvents, taskList, deadlineAt), new Set([today, date]));
    if (phone && view === 'month') return agendaDays(date, 1, events, externalEvents, taskList, deadlineAt).map((d) => ({ kind: 'day' as const, ...d }));
    return [];
  }, [view, phone, date, span, events, externalEvents, taskList, today]);
  const listed = view === 'agenda' ? (d: string) => d >= date && d <= agendaTo : phone && view === 'month' ? (d: string) => d === date : (d: string) => shown.includes(d);
  const bulkIds = events.filter((e) => listed(e.date)).map((e) => e.id);
  const onToday = view === 'agenda' ? date === today && focus === today : view === 'day' ? date === today : listed(today);
  const title = view === 'agenda' ? viewTitle('day', focus) : viewTitle(view, date);
  const stripDate = view === 'agenda' ? focus : date;
  // a phone's title is the month: a tap on it opens the month to jump by
  const phoneTitle = phone && view !== 'month';
  const monthName = (d: string) => {
    const { year, month } = parseDateKey(d);
    return `${MONTH_NAMES[month - 1]}${year !== Number(today.slice(0, 4)) ? ` ${year}` : ''}`;
  };
  const inView = (d: string) => (view === 'agenda' || view === 'month' ? d === stripDate : shown.includes(d));
  const openEvent = (e: ScheduleEvent) => set({ event: String(e.id) });
  const monthPick = (d: string) => {
    setPickerOpen(false);
    goTo(d);
  };
  const monthStep = (dir: 1 | -1) => setMiniFor({ day: focus, month: stepDate('month', miniMonth, dir) });

  // dragged in the calendar: shown at once, saved, and put back if the server refuses
  const move = async (e: ScheduleEvent, to: { date: string; startTime: string; endTime: string | null }) => {
    if (data) setData(data.map((x) => (x.id === e.id ? { ...x, ...to } : x)));
    try {
      const res = await api.patch<EventDetail & { affectedTasks: Task[]; deltaMinutes: number }>(`/api/events/${e.id}`, to);
      emitLocalChange('events');
      if (res.affectedTasks.length) setAffected({ tasks: res.affectedTasks, delta: res.deltaMinutes, id: e.id });
      else {
        const when = `${to.startTime}${to.endTime ? ` - ${to.endTime}` : ''}`;
        const title =
          to.date !== e.date ? `"${e.title}" הוזז ליום ${weekdayName(to.date)} ${shortDate(to.date)}, ${when}` : to.startTime === e.startTime ? `"${e.title}" עודכן: ${when}` : `"${e.title}" הוזז ל-${when}`;
        toast({ title, tone: 'green' });
      }
    } catch (err) {
      toast({ title: (err as Error).message, tone: 'red' });
      void reload();
    }
  };

  const dayList = loading && !data ? (
    <div className="card card-body">
      <Loading rows={3} />
    </div>
  ) : (
    <AgendaList
      rows={rows}
      today={today}
      nowTime={nowTime}
      weeks={weeks}
      canAddOn={canAddOn}
      onAdd={(d) => setCreating({ date: d })}
      onOpen={openEvent}
      onOpenExternal={setPeek}
      onOpenTask={(t) => navigate(`/tasks/${t.id}`)}
      onlyMine={onlyMine}
    />
  );
  const list = (
    <>
      {canQuick && <QuickAdd defaultDate={focus} today={today} allowed={mayAdd} onMore={setCreating} onAdded={openEvent} />}
      {loading && !data ? (
        <div className="card card-body">
          <Loading rows={5} />
        </div>
      ) : (
        <div ref={listRef}>
          <AgendaList
            rows={rows}
            today={today}
            nowTime={nowTime}
            weeks={weeks}
            canAddOn={canAddOn}
            onAdd={(d) => setCreating({ date: d })}
            onOpen={openEvent}
            onOpenExternal={setPeek}
            onOpenTask={(t) => navigate(`/tasks/${t.id}`)}
            onFocusDay={view === 'agenda' ? (d) => Date.now() > steering.current && setFocusFor({ date, day: d }) : undefined}
            onlyMine={onlyMine}
          />
          {view === 'agenda' && (
            <button type="button" className="btn agenda-more no-print" onClick={() => setMore({ date, days: span + 7 })}>
              <Icon name="chevronDown" size={16} /> עוד שבוע
            </button>
          )}
        </div>
      )}
    </>
  );

  return (
    <BulkScope
      entity="events"
      noun="אירועים"
      topics={['events', 'tasks']}
      ids={bulkIds}
      actions={[
        { key: 'shift', label: 'הזזה בימים', icon: 'calendar', ask: { title: 'הזזת אירועים', label: 'בכמה ימים להזיז (שלילי - להקדים)', type: 'number', initial: '1' } },
        { key: 'cancel', label: 'ביטול', confirm: 'לבטל {n} אירועים? המשימות המקושרות יישארו כפי שהן.' },
        { key: 'restore', label: 'שחזור' },
        { key: 'delete', label: 'מחיקה', icon: 'trash', danger: true, confirm: 'למחוק {n} אירועים?' },
      ]}
    >
    <div className={`page schedule-page view-${view}${phone ? ' is-phone' : ''}${phone && view !== 'month' && !pickerOpen ? ' has-strip' : ''}`}>
      <PageHead
        eyebrow={phoneTitle ? `לו"ז${week ? ` · ${week.name}` : ''}` : week?.name}
        title={
          phoneTitle ? (
            // the month, in the title's own font - a tap on it (or on its arrow) opens the month to jump by
            <span className="cal-month-title" onClick={() => setPickerOpen((o) => !o)}>
              {monthName(stripDate)}
              <button
                type="button"
                className="icon-btn cal-month-btn"
                aria-expanded={pickerOpen}
                aria-label={pickerOpen ? 'סגירת החודש' : 'בחירת יום מהחודש'}
                onClick={(e) => {
                  e.stopPropagation();
                  setPickerOpen((o) => !o);
                }}
              >
                <Icon name="chevronDown" size={20} />
              </button>
            </span>
          ) : (
            'לו"ז'
          )
        }
        docTitle='לו"ז'
        actions={
          <>
            {canAdd && <BulkToggle />}
            <button className="btn" onClick={() => setGoogle(true)}>
              <Icon name="calendar" /> יומן Google
            </button>
            <button className="btn" onClick={() => window.print()}>
              <Icon name="print" /> הדפסה
            </button>
            {phone && (
              <div className="more-field">
                <span className="small muted">אירועים בלו"ז</span>
                <Seg value={onlyMine ? 'mine' : 'all'} options={MINE_OPTIONS} onChange={(v) => setOnlyMine(v === 'mine')} />
              </div>
            )}
            {phone && (
              <div className="more-field">
                <span className="small muted">דד-ליינים של משימות</span>
                <Seg value={tasksShown} options={TASKS_OPTIONS} onChange={setTasksShown} />
              </div>
            )}
            {canAdd && (
              <button className="btn btn-primary" onClick={() => setCreating({ date: focus })}>
                <Icon name="plus" /> אירוע
              </button>
            )}
          </>
        }
      />
      {phone ? (
        <>
          <div className="cal-toolbar">
            <Seg value={view} options={PHONE_VIEWS} onChange={setView} />
            <span className="grow" />
            <button className="btn btn-sm" onClick={goToday} disabled={onToday}>
              היום
            </button>
          </div>
          {view !== 'month' &&
            (pickerOpen ? (
              <div className="card mdots-card">
                <MonthDots month={miniMonth} selected={stripDate} today={today} load={loadOf} onPick={monthPick} onStep={monthStep} />
              </div>
            ) : (
              <div className="ws-sticky">
                <WeekStrip date={stripDate} today={today} inView={inView} load={loadOf} onPick={goTo} onStep={(dir) => goTo(addDays(stripDate, 7 * dir))} />
              </div>
            ))}
        </>
      ) : (
        <div className="cal-toolbar mb-12">
          <button className="btn btn-sm" onClick={goToday} disabled={onToday} title="היום (T)">
            היום
          </button>
          <button className="icon-btn" aria-label={`${VIEW_STEP[view]} קודם`} title={`${VIEW_STEP[view]} קודם (K)`} onClick={() => step(-1)}>
            <Icon name="chevronRight" />
          </button>
          <button className="icon-btn" aria-label={`${VIEW_STEP[view]} הבא`} title={`${VIEW_STEP[view]} הבא (J)`} onClick={() => step(1)}>
            <Icon name="chevronLeft" />
          </button>
          <h2 className="cal-title">{title}</h2>
          <span className="grow" />
          <button
            type="button"
            className={`btn btn-sm cal-mine${onlyMine ? ' on' : ''}`}
            aria-pressed={onlyMine}
            title="האירועים שאתה אחראי עליהם או שיש לך בהם משימת הכנה"
            onClick={() => setOnlyMine(!onlyMine)}
          >
            <Icon name="my" size={15} /> רק שלי
          </button>
          <Select className="select cal-tasks" value={tasksShown} onChange={(e) => setTasksShown(e.target.value as TasksShown)} aria-label="דד-ליינים של משימות ביומן">
            <option value="mine">דד-ליינים: שלי</option>
            <option value="all">דד-ליינים: כל המשימות</option>
            <option value="none">בלי דד-ליינים</option>
          </Select>
          <Seg value={view} options={DESK_VIEWS} onChange={setView} />
        </div>
      )}
      {phone && onlyMine && (
        <div className="mine-bar" role="status">
          <Icon name="my" size={15} />
          <span className="grow">רק האירועים שלך - אחראי או משימת הכנה</span>
          <button type="button" className="btn btn-sm" onClick={() => setOnlyMine(false)}>
            הצג הכל
          </button>
        </div>
      )}
      <ErrorBox error={error} />
      <div className={`schedule-body${side ? ' with-side' : ''}`}>
        <div className="schedule-main">
          {view === 'agenda' ? (
            list
          ) : phone && view === 'month' ? (
            <>
              <div className="card mdots-card">
                <MonthDots month={date} selected={date} today={today} load={loadOf} onPick={(d) => set({ date: d === today ? null : d, event: null })} onStep={step} />
              </div>
              {dayList}
            </>
          ) : loading && !data ? (
            <div className="card card-body">
              <Loading rows={6} />
            </div>
          ) : (
            // on a phone the day or the three days turn with the finger, like a page
            <div className="period-clip">
              <div className="period-swipe" ref={swipeArea}>
                <CalendarView
                  view={view}
                  date={date}
                  today={today}
                  ready={!loading}
                  nowTime={nowTime}
                  events={events}
                  external={externalEvents}
                  tasks={taskList}
                  canCreate={canAddOn}
                  canMove={canMove}
                  onOpen={openEvent}
                  onOpenExternal={setPeek}
                  onOpenTask={(t) => navigate(`/tasks/${t.id}`)}
                  onCreate={(d, start, end) => setCreating({ date: d, start, end })}
                  onMove={(e, to) => void move(e, to)}
                  onPickDay={(d) => set({ date: d, view: 'day', event: null })}
                />
              </div>
            </div>
          )}
          {grid && !phone && (
            <div className="cal-hint small muted no-print">
              {canAdd ? 'לחיצה או גרירה על זמן פנוי - אירוע חדש · גרירת אירוע - הזזה · גרירת הקצה התחתון - שינוי משך · ' : ''}
              קיצורים: T היום, J/K הבא/הקודם, A/D/W/M סדר יום/יום/שבוע/חודש
            </div>
          )}
        </div>
        {side && (
          <aside className="schedule-side no-print" aria-label="החודש והשבוע">
            <UpNext events={events} today={today} nowTime={nowTime} onOpen={openEvent} />
            <div className="card mdots-card">
              <MonthDots month={miniMonth} selected={focus} today={today} load={loadOf} onPick={goTo} onStep={monthStep} />
            </div>
            {week && <SideWeek week={week} />}
          </aside>
        )}
      </div>
      {creating && <EventForm prefill={creating} onClose={() => setCreating(null)} />}
      {google && <GoogleCalendarModal onClose={() => setGoogle(false)} />}
      {peek && <ExternalEventModal event={peek} onClose={() => setPeek(null)} />}
      {affected && <ShiftTasks {...affected} onClose={() => setAffected(null)} />}
      {eventId && <EventDrawer id={Number(eventId)} onClose={() => set({ event: null })} onEdit={(e) => setEditing(e)} />}
      {/* after the drawer so the edit form stacks on top of it */}
      {editing && <EventForm event={editing} onClose={() => setEditing(null)} />}
    </div>
    </BulkScope>
  );
}

/** The course week of the day being read, beside the calendar: its lead, how ready it is, its page. */
function SideWeek({ week: w }: { week: { id: number; name: string; startDate: string; endDate: string; leadName: string | null; readiness: number; totalTasks: number } }) {
  return (
    <Link className="card side-week" to={`/weeks/${w.id}`}>
      <span className="grow">
        <span className="label-caps">השבוע בקורס</span>
        <b className="side-week-name">{w.name}</b>
        <span className="small muted">
          {shortDate(w.startDate)} - {shortDate(w.endDate)}
          {w.leadName ? ` · ${w.leadName}` : ''}
        </span>
      </span>
      <Ring value={w.readiness} size={48} tone={w.totalTasks === 0 ? 'gray' : undefined} />
    </Link>
  );
}

/** An event of a connected Google calendar: read-only, so just its details. */
function ExternalEventModal({ event: e, onClose }: { event: ExternalEvent; onClose: () => void }) {
  return (
    <Modal
      title={e.title}
      onClose={onClose}
      footer={
        <button className="btn" onClick={onClose}>
          סגירה
        </button>
      }
    >
      <dl className="kv">
        <dt>מתי</dt>
        <dd>
          {fmtLongDate(e.date)} · {e.startTime ? `${e.startTime}${e.endTime ? ` - ${e.endTime}` : ''}` : 'כל היום'}
        </dd>
        {e.location && (
          <>
            <dt>מיקום</dt>
            <dd>{e.location}</dd>
          </>
        )}
        <dt>יומן</dt>
        <dd>
          {e.sourceName} <span className="badge t-blue">Google</span>
        </dd>
      </dl>
      <p className="small muted mt-12">אירוע מיומן Google מחובר - לשינוי, ערכו אותו ב-Google Calendar.</p>
    </Modal>
  );
}

function EventForm({
  event,
  prefill,
  onClose,
}: {
  event?: ScheduleEvent;
  /** a new event: the day, and what is already known (a time chosen in the calendar, a line written) */
  prefill?: EventPrefill;
  onClose: () => void;
}) {
  const { users } = useSession();
  const toast = useToast();
  const [date, setDate] = useState(event?.date ?? prefill?.date ?? todayKey());
  const [start, setStart] = useState(event?.startTime ?? prefill?.start ?? '08:00');
  const [end, setEnd] = useState(event?.endTime ?? prefill?.end ?? '');
  const [title, setTitle] = useState(event?.title ?? prefill?.title ?? '');
  const [location, setLocation] = useState(event?.location ?? prefill?.location ?? '');
  const ownerId = event ? event.ownerId : prefill?.ownerId;
  const [owner, setOwner] = useState<string>(ownerId ? String(ownerId) : '');
  const [notes, setNotes] = useState(event?.notes ?? '');
  const [error, setError] = useState<string | null>(null);
  const [affected, setAffected] = useState<{ tasks: Task[]; delta: number; id: number } | null>(null);

  const save = async () => {
    setError(null);
    const body = { date, startTime: start, endTime: end || null, title, location, ownerId: owner ? Number(owner) : null, notes };
    try {
      if (event) {
        const patch = changedFields<typeof body>({ ...event, endTime: event.endTime || null }, body);
        if (!Object.keys(patch).length) return onClose();
        const res = await api.patch<EventDetail & { affectedTasks: Task[]; deltaMinutes: number }>(`/api/events/${event.id}`, patch);
        emitLocalChange('events');
        if (res.affectedTasks.length) return setAffected({ tasks: res.affectedTasks, delta: res.deltaMinutes, id: event.id });
        toast({ title: 'האירוע עודכן', tone: 'green' });
      } else {
        await api.post('/api/events', body);
        toast({ title: 'האירוע נוסף ללו"ז', tone: 'green' });
        emitLocalChange('events');
      }
      onClose();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  if (affected) return <ShiftTasks {...affected} onClose={onClose} />;

  return (
    <Modal
      title={event ? 'עריכת אירוע' : 'אירוע חדש בלו"ז'}
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-primary" onClick={() => void save()} disabled={!title.trim()}>
            שמור
          </button>
          <button className="btn btn-ghost" onClick={onClose}>
            ביטול
          </button>
        </>
      }
    >
      <div className="form-grid">
        <Field label="שם הפעילות" required className="span-2">
          <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="לדוגמה: מטווח" data-autofocus />
        </Field>
        <Field label="תאריך" required>
          <DateInput value={date} onChange={(v) => setDate(v)} />
        </Field>
        <div className="row gap-6">
          <Field label="התחלה" required className="grow">
            <TimeInput value={start} onChange={setStart} />
          </Field>
          <Field label="סיום" className="grow">
            <TimeInput value={end} onChange={setEnd} />
          </Field>
        </div>
        <Field label="מיקום">
          <input className="input" value={location} onChange={(e) => setLocation(e.target.value)} />
        </Field>
        <Field label="אחראי">
          <Select className="select" value={owner} onChange={(e) => setOwner(e.target.value)}>
            <option value="">ללא</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.displayName}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="הערות" className="span-2">
          <textarea className="textarea" value={notes} onChange={(e) => setNotes(e.target.value)} style={{ minHeight: 60 }} />
        </Field>
      </div>
      <div className="mt-12">
        <ErrorBox error={error} />
      </div>
    </Modal>
  );
}

function deltaText(min: number): string {
  const abs = Math.abs(min);
  const d = Math.floor(abs / 1440);
  const h = Math.floor((abs % 1440) / 60);
  const m = abs % 60;
  const parts = [d && `${d} ימים`, h && `${h} שעות`, m && `${m} דקות`].filter(Boolean).join(' ו-');
  return `${min > 0 ? 'קדימה' : 'אחורה'} ${parts}`;
}

function ShiftTasks({ tasks, delta, id, onClose }: { tasks: Task[]; delta: number; id: number; onClose: () => void }) {
  const toast = useToast();
  const [selected, setSelected] = useState<Set<number>>(new Set(tasks.map((t) => t.id)));
  const [error, setError] = useState<string | null>(null);
  const shift = async () => {
    try {
      const r = await api.post<{ shifted: number }>(`/api/events/${id}/shift-tasks`, { taskIds: [...selected], deltaMinutes: delta });
      toast({ title: `עודכנו ${r.shifted} דד-ליינים`, tone: 'green' });
      emitLocalChange('tasks');
      onClose();
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <Modal
      title="משימות שעשויות להיות מושפעות"
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-primary" onClick={() => void shift()} disabled={!selected.size}>
            הזז {selected.size} דד-ליינים
          </button>
          <button className="btn btn-ghost" onClick={onClose}>
            השאר כמו שהן
          </button>
        </>
      }
    >
      <div className="col gap-16">
        <div className="info-box">
          הפעילות הוזזה <b>{deltaText(delta)}</b>. לעדכן גם את הדד-ליינים של משימות ההכנה המקושרות?
        </div>
        {tasks.map((t) => (
          <label key={t.id} className="check">
            <input
              type="checkbox"
              checked={selected.has(t.id)}
              onChange={(e) => {
                const n = new Set(selected);
                if (e.target.checked) n.add(t.id);
                else n.delete(t.id);
                setSelected(n);
              }}
            />
            <span className="grow">
              <b>{t.title}</b>
              <span className="tiny muted">
                {' '}
                · {t.ownerName} · {fmtDeadline(t.deadline)} ← {fmtDeadline(new Date(Date.parse(t.deadline) + delta * 60000).toISOString())}
              </span>
            </span>
          </label>
        ))}
        <ErrorBox error={error} />
      </div>
    </Modal>
  );
}

function EventDrawer({ id, onClose, onEdit }: { id: number; onClose: () => void; onEdit: (e: ScheduleEvent) => void }) {
  const { data, error } = useApi<EventDetail>(`/api/events/${id}`, ['events', 'tasks', 'debriefs']);
  const navigate = useNavigate();
  const { isCommander, user, weeks } = useSession();
  const newTask = useNewTask();
  const toast = useToast();
  const [cancelOpen, setCancelOpen] = useState(false);
  const [tplOpen, setTplOpen] = useState(false);
  const [url, setUrl] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const [err, setErr] = useState<string | null>(null);
  if (!data) return <Modal title="טוען..." onClose={onClose}>{error ? <ErrorBox error={error} /> : <Loading rows={2} />}</Modal>;
  const e = data.event;
  const week = weeks.find((w) => w.startDate <= e.date && w.endDate >= e.date);
  const canManage = isCommander || e.ownerId === user.id || week?.leadId === user.id;
  const today = todayKey();
  const nowMin = minutesOf(fmtTime(new Date().toISOString()));
  // over, and lately: the debrief is asked for while it is still fresh
  const ended = !e.cancelled && (e.date < today || (e.date === today && endMinutes(e) <= nowMin));
  const askDebrief = ended && !data.debriefs.length && diffDays(today, e.date) <= 7;
  const prep = data.tasks.filter((t) => t.status !== 'cancelled');
  const prepDone = prep.filter((t) => t.status === 'done').length;

  const run = async (fn: () => Promise<unknown>, ok?: string) => {
    setErr(null);
    try {
      await fn();
      if (ok) toast({ title: ok, tone: 'green' });
      emitLocalChange('events', 'tasks');
    } catch (x) {
      setErr((x as Error).message);
    }
  };

  return (
    <Modal title={e.title} onClose={onClose} wide>
      <div className="col gap-16">
        <div className="row wrap">
          {/* at least 240px: on a phone the buttons go below rather than squeezing the details */}
          <div style={{ flex: '1 1 240px', minWidth: 0 }}>
            <div className="mono strong" style={{ fontSize: 18 }}>
              {weekdayName(e.date)} {shortDate(e.date)} · <span style={{ whiteSpace: 'nowrap' }}>{e.endTime ? `${e.startTime} - ${e.endTime}` : e.startTime}</span>
            </div>
            <div className="small muted">
              {[e.location && `מיקום: ${e.location}`, e.ownerName && `אחראי: ${e.ownerName}`, week?.name].filter(Boolean).join(' · ')}
            </div>
            {e.cancelled && <span className="badge t-red mt-8">הפעילות בוטלה</span>}
          </div>
          {canManage && (
            <div className="row gap-6 wrap">
              <button className="btn btn-sm" onClick={() => onEdit(e)}>
                <Icon name="edit" /> עריכה / הזזה
              </button>
              {e.cancelled ? (
                <button className="btn btn-sm" onClick={() => void run(() => api.post(`/api/events/${e.id}/restore`), 'הפעילות הוחזרה')}>
                  החזר ללו"ז
                </button>
              ) : (
                <button className="btn btn-sm btn-danger" onClick={() => setCancelOpen(true)}>
                  ביטול פעילות
                </button>
              )}
              {isCommander && (
                <button
                  className="btn btn-sm btn-ghost text-red"
                  aria-label="מחיקת האירוע"
                  title="מחיקת האירוע"
                  onClick={async () => {
                    if (await ask({ title: 'למחוק את האירוע מהלו"ז?', body: 'משימות מקושרות יישמרו כמשימות עצמאיות.', confirm: 'מחיקה', danger: true }))
                      void run(() => api.del(`/api/events/${e.id}`), 'האירוע נמחק').then(onClose);
                  }}
                >
                  <Icon name="trash" />
                </button>
              )}
            </div>
          )}
        </div>
        {askDebrief && (
          <div className="info-box drawer-prompt">
            <Icon name="lightbulb" size={18} />
            <span className="grow">הפעילות הסתיימה - זה הזמן לתחקיר, כשהפרטים עוד טריים.</span>
            <button className="btn btn-sm btn-primary" onClick={() => navigate(`/debriefs?event=${e.id}`)}>
              פתח תחקיר
            </button>
          </div>
        )}
        {e.notes && <div className="info-box" style={{ whiteSpace: 'pre-wrap' }}>{e.notes}</div>}

        <div>
          <div className="row mb-12">
            <h3 className="grow">
              משימות הכנה{' '}
              {prep.length > 0 && (
                <span className={`badge t-${prepDone === prep.length ? 'green' : ended ? 'red' : 'orange'}`}>
                  {prepDone}/{prep.length} הושלמו
                </span>
              )}
            </h3>
            {canManage && (
              <button className="btn btn-sm" onClick={() => setTplOpen(true)}>
                <Icon name="template" /> מתבנית פעילות
              </button>
            )}
            <button
              className="btn btn-sm btn-primary"
              onClick={() =>
                newTask({
                  eventId: e.id,
                  ownerIds: e.ownerId ? [e.ownerId] : undefined,
                  // the evening before, or the activity's start when it is today
                  deadline: addDays(e.date, -1) < todayKey() ? isoAt(e.date, e.startTime) : isoAt(addDays(e.date, -1), '18:00'),
                  heading: `משימת הכנה: ${e.title}`,
                })
              }
            >
              <Icon name="plus" /> משימה
            </button>
          </div>
          {/* what is still to prepare; what is done in a line under it (ticked here, it folds into it) */}
          <OpenTaskList tasks={data.tasks} drawerId="event-prep-done" empty={<p className="small muted">כל פעילות יכולה להפוך למרכז משימות: תיאום, מדריכים, רפואה, בטיחות, הסעות...</p>} />
        </div>

        <div>
          <div className="row mb-12">
            <h3 className="grow">תחקיר</h3>
            <button className="btn btn-sm" onClick={() => navigate(`/debriefs?event=${e.id}`)}>
              <Icon name="lightbulb" /> פתח תחקיר
            </button>
          </div>
          {data.debriefs.length === 0 ? (
            <p className="small muted">לאחר הפעילות - פתחו תחקיר. אחרי מופע עצים (מארס, תרגיל מסכם) - טופס תחקיר מופע: מטרות, בטיחות, לוגיסטיקה ולקחים עם אחראי.</p>
          ) : (
            data.debriefs.map((d) => (
              <Link key={d.id} to={`/debriefs/${d.id}`} className="row small" onClick={onClose}>
                <Icon name="lightbulb" size={16} /> <b>{d.title}</b>
                <KindBadge kind={d.kind} />
                <span className="tiny muted">
                  {d.itemCounts.lesson === 1 ? 'לקח אחד' : `${d.itemCounts.lesson} לקחים`} · {d.status === 'final' ? 'סוכם' : 'טיוטה'}
                </span>
              </Link>
            ))
          )}
        </div>

        <PriorLessons title="לקחים ממופעים קודמים" context={{ eventId: e.id, canDecide: canManage, owner: e.ownerId, due: addDays(e.date, -2) }} card={false} onOpen={onClose} />

        <div>
          <h3 className="mb-12">קבצים וקישורים</h3>
          <div className="col gap-6">
            {data.attachments.map((a) => (
              <a key={a.id} href={safeUrl(a.url)} target="_blank" rel="noreferrer noopener" className="row small">
                <Icon name={a.kind === 'file' ? 'file' : 'link'} size={16} /> <b>{a.title}</b> <span className="tiny muted">{fileSize(a.size)}</span>
              </a>
            ))}
            {!data.attachments.length && <p className="small muted">אין קבצים.</p>}
            {canManage && (
              <form
                className="row wrap"
                onSubmit={(ev) => {
                  ev.preventDefault();
                  if (url.trim()) void run(() => api.post(`/api/events/${e.id}/links`, { url: url.trim() }), 'הקישור נוסף').then(() => setUrl(''));
                }}
              >
                <input className="input grow" dir="ltr" type="url" placeholder="https://..." value={url} onChange={(ev) => setUrl(ev.target.value)} />
                <button className="btn btn-sm" disabled={!url.trim()}>
                  <Icon name="link" /> קישור
                </button>
                <button type="button" className="btn btn-sm" onClick={() => fileRef.current?.click()}>
                  <Icon name="upload" /> קובץ
                </button>
                <input
                  ref={fileRef}
                  type="file"
                  hidden
                  onChange={(ev) => {
                    const f = ev.target.files?.[0];
                    if (f) void run(() => api.upload(`/api/events/${e.id}/files`, f), 'הקובץ צורף');
                    ev.target.value = '';
                  }}
                />
              </form>
            )}
          </div>
        </div>
        <ErrorBox error={err} />
      </div>
      {cancelOpen && <CancelEvent event={e} openTasks={data.tasks.filter((t) => t.status !== 'done' && t.status !== 'cancelled').length} onClose={() => setCancelOpen(false)} />}
      {tplOpen && <ApplyActivityTemplate event={e} onClose={() => setTplOpen(false)} />}
    </Modal>
  );
}

function CancelEvent({ event, openTasks, onClose }: { event: ScheduleEvent; openTasks: number; onClose: () => void }) {
  const toast = useToast();
  const [action, setAction] = useState<'cancel' | 'move' | 'keep'>(openTasks ? 'cancel' : 'keep');
  const [newDate, setNewDate] = useState(addDays(event.date, 7));
  const [newTime, setNewTime] = useState(event.startTime);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const submit = async () => {
    try {
      await api.post(`/api/events/${event.id}/cancel`, { taskAction: action, newDate: action === 'move' ? newDate : undefined, newStartTime: action === 'move' ? newTime : undefined, reason: reason || undefined });
      toast({ title: action === 'move' ? 'הפעילות הועברה' : 'הפעילות בוטלה', tone: 'green' });
      emitLocalChange('events', 'tasks');
      onClose();
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <Modal
      title={`ביטול "${event.title}"`}
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-primary" onClick={() => void submit()}>
            אישור
          </button>
          <button className="btn btn-ghost" onClick={onClose}>
            חזרה
          </button>
        </>
      }
    >
      <div className="col gap-16">
        <p>{openTasks ? `יש ${openTasks} משימות פתוחות הקשורות לפעילות. מה לעשות איתן?` : 'אין משימות פתוחות הקשורות לפעילות.'}</p>
        <Seg
          value={action}
          onChange={setAction}
          options={[
            { value: 'cancel', label: 'לבטל אותן' },
            { value: 'move', label: 'להעביר לתאריך אחר' },
            { value: 'keep', label: 'לשמור כעצמאיות' },
          ]}
        />
        {action === 'move' ? (
          <div className="row gap-6">
            <DateInput value={newDate} onChange={(v) => setNewDate(v)} />
            <TimeInput value={newTime} onChange={setNewTime} />
          </div>
        ) : (
          <Field label="סיבה (לא חובה)">
            <input className="input" value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
        )}
        <ErrorBox error={error} />
      </div>
    </Modal>
  );
}

function ApplyActivityTemplate({ event, onClose }: { event: ScheduleEvent; onClose: () => void }) {
  const { data } = useApi<Template[]>('/api/templates', ['templates']);
  const toast = useToast();
  const list = useMemo(() => (data ?? []).filter((t) => t.kind !== 'week'), [data]);
  const [id, setId] = useState<number | null>(null);
  useEffect(() => {
    if (id === null && list.length) setId(list[0].id);
  }, [list, id]);
  const tpl = list.find((t) => t.id === id);
  const [error, setError] = useState<string | null>(null);
  const apply = async () => {
    if (!tpl) return;
    try {
      const r = await api.post<{ ids: number[] }>(`/api/templates/${tpl.id}/apply`, { eventId: event.id });
      toast({ title: `נפתחו ${r.ids.length} משימות הכנה`, tone: 'green' });
      emitLocalChange('tasks', 'events');
      onClose();
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <Modal
      title="משימות הכנה מתבנית"
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-primary" onClick={() => void apply()} disabled={!tpl}>
            פתח {tpl?.items.length ?? 0} משימות
          </button>
          <button className="btn btn-ghost" onClick={onClose}>
            ביטול
          </button>
        </>
      }
    >
      {!list.length ? (
        <p className="muted">אין תבניות פעילות. צרו תבנית במסך התבניות.</p>
      ) : (
        <div className="col gap-16">
          <div className="chips">
            {list.map((t) => (
              <button key={t.id} className={`chip${t.id === id ? ' on' : ''}`} onClick={() => setId(t.id)}>
                {t.name}
              </button>
            ))}
          </div>
          {tpl && (
            <div className="col gap-4">
              {tpl.items.map((it, i) => (
                <div key={i} className="row small">
                  {it.stage && <span className="badge">{it.stage}</span>}
                  <span className="grow">{it.title}</span>
                  <span className="mono tiny muted">
                    {weekdayName(addDays(event.date, it.offsetDays))} {shortDate(addDays(event.date, it.offsetDays))}
                  </span>
                </div>
              ))}
            </div>
          )}
          <ErrorBox error={error} />
        </div>
      )}
    </Modal>
  );
}
