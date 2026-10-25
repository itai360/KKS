// The calendar - the home page - in Google Calendar's way (sections 22-23, 58 and 66-67 of the course's
// schedule). A computer has the day, four days, the week, the month, the year and the running list
// ("סדר יום"), its controls in the top bar and its layers in the side bar; a phone has the running list
// under a strip of the week, a day, three days and a month with the day picked under it. A click on free
// time opens the quick create beside it, a click on anything opens its card. The course's events, the
// deadlines, the course weeks, the experiences, the debriefs, who is away and the connected Google
// calendars are layers - each loaded only while it is shown, through the API that says what each person
// may see.

import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { MONTH_NAMES, monthWeeks, stepDate, viewDays, viewTitle } from '@shared/calendarGrid';
import {
  CAL_COLOR_LABELS,
  CAL_COLORS,
  dedupe,
  externalColor,
  sourceColor,
  fromAbsence,
  fromDebrief,
  fromEvent,
  fromExperience,
  fromExternal,
  fromTask,
  fromWeek,
  isCalColor,
  layerShown,
  matchesTaskFilter,
  taskQuery,
  type CalColor,
  type CalItem,
  type LayerId,
} from '@shared/calendarLayers';
import { addDays, diffDays, isDateKey, parseDateKey, shortDate, startOfWeek, weekdayName } from '@shared/dates';
import { REPEAT_FREQS, REPEAT_LABELS, repeatText, seriesSpan, type RepeatFreq } from '@shared/eventSeries';
import type { Absence, CalendarSource, Debrief, EventDetail, Experience, ExternalEvent, ScheduleEvent, Task, Template } from '@shared/types';
import { AgendaList, MonthDots, QuickAdd, scrollToDay, WeekStrip } from '../components/Agenda';
import { BulkScope, BulkToggle, useBulk } from '../components/Bulk';
import { CalendarView, YearGrid, type GridView } from '../components/CalendarView';
import { ContextPanel, PanelStrip } from '../components/ContextPanel';
import { KindBadge, PriorLessons } from '../components/DebriefBits';
import { GoogleCalendarModal } from '../components/GoogleCalendar';
import { Icon } from '../components/Icon';
import { ItemCard, type EventActions, kindLabel } from '../components/ItemCard';
import { usePeriodSwipe } from '../components/periodSwipe';
import { anchorOf, Popover, type Anchor } from '../components/Popover';
import { useNewTask } from '../components/NewTask';
import { QuickCreate, type Draft } from '../components/QuickCreate';
import { OpenTaskList } from '../components/TaskRow';
import { useToast } from '../components/Toasts';
import { DateInput, ErrorBox, Field, Loading, Modal, PageHead, Seg, Select, TimeInput } from '../components/ui';
import { agendaDays, endMinutes, foldQuiet, isMine, type AgendaRow } from '../lib/agenda';
import { api, changedFields } from '../lib/api';
import { BOTTOM_BAR_MEDIA } from '../lib/bottomBar';
import { PHONE_VIEWS, setCalendarBar, VIEW_LABELS, type CalView } from '../lib/calendarBar';
import { setCalendarPrefs, useCalendarPrefs } from '../lib/calendarPrefs';
import { dateKeyOf, fileSize, fmtDeadline, fmtTime, isoAt, todayKey } from '../lib/format';
import { useMedia } from '../lib/media';
import { emitLocalChange } from '../lib/realtime';
import { useSession } from '../lib/session';
import { usePageTitle } from '../lib/title';
import { useApi, useTick } from '../lib/useApi';
import { safeUrl } from '../lib/safeUrl';
import { ask } from '../components/Confirm';
import { Link } from 'react-router';
import { takesKeys } from '../lib/keyboard';

const ALL_VIEWS: CalView[] = ['agenda', 'day', 'three', 'four', 'week', 'month', 'year'];
const VIEW_KEY = 'kks.scheduleView';
/** the day the calendar was left on, in this tab */
const DATE_KEY = 'kks.calendarDate';
/** "list" was a list of one day: the running list took its place */
const asView = (v: string | null): CalView | null => (v === 'list' ? 'agenda' : ALL_VIEWS.includes(v as CalView) ? (v as CalView) : null);
// a remembered view is a convenience: storage can be missing or blocked
function savedView(): CalView | null {
  try {
    return asView(localStorage.getItem(VIEW_KEY));
  } catch {
    return null;
  }
}
/** seven columns, or a year, do not fit a phone; a computer shows four days for a phone's three */
const fitView = (v: CalView, phone: boolean): CalView => (phone ? (v === 'week' || v === 'four' ? 'three' : v === 'year' ? 'month' : v) : v === 'three' ? 'four' : v);
/** the running list: two weeks from the day picked, and a week more at a time */
const AGENDA_DAYS = 14;
// keys by position, so they work with a Hebrew keyboard too: a letter and a number for each view, as in Google Calendar
const VIEW_CODES: Record<string, CalView> = {
  KeyD: 'day',
  Digit1: 'day',
  KeyW: 'week',
  Digit2: 'week',
  KeyM: 'month',
  Digit3: 'month',
  KeyX: 'four',
  Digit4: 'four',
  KeyA: 'agenda',
  Digit5: 'agenda',
  KeyY: 'year',
  Digit6: 'year',
};
const VIEW_STEP: Record<CalView, string> = { agenda: 'שבוע', day: 'יום', three: '3 ימים', four: '4 ימים', week: 'שבוע', month: 'חודש', year: 'שנה' };

const earliest = (a: string[]) => a.reduce((m, x) => (x < m ? x : m));
const latest = (a: string[]) => a.reduce((m, x) => (x > m ? x : m));
/** whole months' grids around the days needed: moving inside them asks the server for nothing new */
function fetchRange(days: string[]): { from: string; to: string } {
  const last = monthWeeks(latest(days));
  return { from: monthWeeks(earliest(days))[0][0], to: last[last.length - 1][6] };
}
/** an instant as the course's day and hour */
const atIso = (iso: string) => ({ date: dateKeyOf(iso), time: fmtTime(iso) });
const deadlineAt = (t: Task) => atIso(t.deadline);
// nothing yet, always the same nothing - so what is built from it is not built again on every render
const NO_EVENTS: ScheduleEvent[] = [];
const NO_EXTERNAL: ExternalEvent[] = [];
const NO_TASKS: Task[] = [];
const minutesOf = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
/** the next whole hour from now (a new event from "יצירה" starts there), and an hour after it */
function nextHour(): { start: string; end: string } {
  const h = Math.min(22, new Date().getHours() + 1);
  const pad = (n: number) => String(n).padStart(2, '0');
  return { start: `${pad(h)}:00`, end: `${pad(h + 1)}:00` };
}
/** the middle of the screen, for a card opened by the keyboard or from a list */
const middle = (): Anchor => ({ top: innerHeight / 2 - 120, bottom: innerHeight / 2 - 120, left: innerWidth / 2, right: innerWidth / 2 });

/** the selection of the events shown, started from the view's menu in the top bar */
function BulkBridge({ onReady }: { onReady: (toggle: (() => void) | null) => void }) {
  const bulk = useBulk();
  useEffect(() => {
    onReady(bulk ? () => bulk.setActive(!bulk.active) : null);
    return () => onReady(null);
  }, [bulk, onReady]);
  return null;
}

export function SchedulePage() {
  const [params, setParams] = useSearchParams();
  const phone = useMedia(BOTTOM_BAR_MEDIA);
  const today = todayKey();
  const date = params.get('date') ?? today;
  const eventId = params.get('event');
  const view = fitView(asView(params.get('view')) ?? savedView() ?? (phone ? 'agenda' : 'week'), phone);
  const { can, weeks, user, viewing, isCommander: commanderRole } = useSession();
  const isCommander = can('schedule');
  const prefs = useCalendarPrefs();
  const on = (id: LayerId) => layerShown(prefs.layers, id);
  const toast = useToast();
  usePageTitle('לו"ז');
  useTick(60_000);

  const set = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) {
      if (v === null) next.delete(k);
      else next.set(k, v);
    }
    next.delete('new');
    setParams(next, { replace: true });
  };

  // the day: back where it was left in this tab - moving through other screens and back keeps it
  const restored = useRef(false);
  useEffect(() => {
    if (restored.current) return;
    restored.current = true;
    if (params.get('date')) return;
    try {
      const d = sessionStorage.getItem(DATE_KEY);
      if (d && isDateKey(d) && d !== today) set({ date: d });
    } catch {
      /* today */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    try {
      sessionStorage.setItem(DATE_KEY, date);
    } catch {
      /* not kept */
    }
  }, [date]);

  // the running list: from the day picked; the day at its top as it scrolls, which the strip follows
  const [more, setMore] = useState({ date, days: AGENDA_DAYS });
  const span = more.date === date ? more.days : AGENDA_DAYS;
  const agendaTo = addDays(date, span - 1);
  const [focusFor, setFocusFor] = useState({ date, day: date });
  const focus = view === 'agenda' && focusFor.date === date ? focusFor.day : date;
  // the month to jump by on a phone, under the title
  const [pickerOpen, setPickerOpen] = useState(false);
  const [miniFor, setMiniFor] = useState<{ day: string; month: string } | null>(null);
  const miniMonth = miniFor?.day === focus ? miniFor.month : focus;
  const miniShown = phone && (pickerOpen || view === 'month');

  const shown = view === 'agenda' ? [] : viewDays(view, date);
  const needed = view === 'agenda' ? [startOfWeek(date), addDays(startOfWeek(agendaTo), 6)] : [shown[0], shown[shown.length - 1], ...(phone ? viewDays('week', date) : [])];
  if (miniShown) needed.push(miniMonth);
  const { from, to } = fetchRange(needed);

  // ---------------- the layers: each asked for only while it is shown ----------------
  const eventsApi = useApi<ScheduleEvent[]>(on('events') ? `/api/events?from=${from}&to=${to}` : null, ['events', 'tasks']);
  const sources = useApi<CalendarSource[]>('/api/calendar/sources', ['events']);
  const sourceIndex = useMemo(() => new Map((sources.data ?? []).map((s, i) => [s.id, i])), [sources.data]);
  // each connected calendar in its colour - the one chosen for it as in Google, else by its place
  const colorOf = useMemo(() => {
    const m = new Map((sources.data ?? []).map((s, i) => [s.id, sourceColor(s.color, i)]));
    return (id: number) => m.get(id) ?? externalColor(0);
  }, [sources.data]);
  const extOn = !prefs.onlyMine && (sources.data ?? []).some((s) => on(`ext:${s.id}`));
  const external = useApi<ExternalEvent[]>(extOn ? `/api/calendar/external?from=${from}&to=${to}` : null, ['events']);
  const myTasks = useApi<Task[]>(on('myTasks') ? taskQuery(prefs.taskFilter, true, from, to) : null, ['tasks']);
  const staffOn = on('staffTasks') && can('tasks');
  const staffTasks = useApi<Task[]>(staffOn ? taskQuery(prefs.taskFilter, false, from, to) : null, ['tasks']);
  const experiences = useApi<Experience[]>(on('experiences') ? '/api/experiences' : null, ['cadets', 'tasks']);
  const debriefs = useApi<Debrief[]>(on('debriefs') ? '/api/debriefs' : null, ['debriefs', 'tasks']);
  const absences = useApi<Absence[]>(on('absences') ? `/api/absences?from=${from}&to=${to}` : null, ['users', 'tasks']);

  const allEvents = on('events') ? (eventsApi.data ?? NO_EVENTS) : NO_EVENTS;
  const events = useMemo(() => (prefs.onlyMine ? allEvents.filter((e) => isMine(e, user.id)) : allEvents), [allEvents, prefs.onlyMine, user.id]);
  const externalEvents = useMemo(
    () => (extOn ? (external.data ?? NO_EXTERNAL).filter((x) => sourceIndex.has(x.sourceId) && layerShown(prefs.layers, `ext:${x.sourceId}`)) : NO_EXTERNAL),
    [extOn, external.data, sourceIndex, prefs.layers],
  );
  const taskList = useMemo(() => {
    const mine = on('myTasks') ? (myTasks.data ?? NO_TASKS) : NO_TASKS;
    const staff = staffOn ? (staffTasks.data ?? NO_TASKS) : NO_TASKS;
    const seen = new Set<number>();
    return [...mine, ...staff].filter((t) => matchesTaskFilter(t, prefs.taskFilter) && !seen.has(t.id) && (seen.add(t.id), true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [myTasks.data, staffTasks.data, staffOn, prefs.layers, prefs.taskFilter]);

  const items = useMemo(() => {
    const out: CalItem[] = events.map(fromEvent);
    for (const x of externalEvents) out.push(fromExternal(x, colorOf(x.sourceId)));
    const mineIds = new Set((on('myTasks') ? (myTasks.data ?? []) : []).map((t) => t.id));
    for (const t of taskList) out.push(fromTask(t, mineIds.has(t.id) ? 'myTasks' : 'staffTasks', atIso));
    if (on('weeks')) for (const w of weeks) if (w.startDate <= to && w.endDate >= from) out.push(fromWeek(w));
    if (on('experiences')) for (const x of experiences.data ?? []) if (x.startDate <= to && x.endDate >= from) out.push(fromExperience(x));
    if (on('debriefs')) for (const d of debriefs.data ?? []) if (d.occurredOn >= from && d.occurredOn <= to) out.push(fromDebrief(d));
    if (on('absences')) for (const a of absences.data ?? []) out.push(fromAbsence(a, commanderRole || a.userId === user.id));
    return dedupe(out);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [events, externalEvents, taskList, weeks, experiences.data, debriefs.data, absences.data, prefs.layers, from, to, colorOf, commanderRole, user.id]);
  const loading = on('events') && eventsApi.loading && !eventsApi.data;
  const error = eventsApi.error;

  // ---------------- what is open over the calendar ----------------
  const [creating, setCreating] = useState<FormPrefill | null>(null);
  const [editing, setEditing] = useState<ScheduleEvent | null>(null);
  const [google, setGoogle] = useState(false);
  const [card, setCard] = useState<{ item: CalItem; anchor: Anchor } | null>(null);
  const [draft, setDraft] = useState<(Draft & { anchor: Anchor }) | null>(null);
  const [askDate, setAskDate] = useState(false);
  const [cancelling, setCancelling] = useState<{ event: ScheduleEvent; openTasks: number } | null>(null);
  const [affected, setAffected] = useState<{ tasks: Task[]; delta: number; id: number } | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  // where the pointer last went down: a card opened from a list (which says only what was opened) opens there
  const lastDown = useRef<Anchor | null>(null);
  const bulkToggle = useRef<(() => void) | null>(null);

  const setView = (v: CalView) => {
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

  const weekOf = (d: string) => weeks.find((w) => w.startDate <= d && w.endDate >= d);
  const week = weekOf(focus);
  const leadOn = (d: string) => weekOf(d)?.leadId === user.id;
  const canAdd = !viewing && (isCommander || week?.leadId === user.id);
  const canAddOn = (d: string) => !viewing && (isCommander || leadOn(d));
  // as the server has it: the commander, the week's lead - or anyone, for an event in their own charge
  const mayAdd = (d: string, ownerId: number | null) => canAddOn(d) || (!viewing && ownerId === user.id);
  const canQuick = !viewing && (isCommander || weeks.some((w) => w.leadId === user.id));
  const canManage = (e: ScheduleEvent) => !viewing && (isCommander || e.ownerId === user.id || leadOn(e.date));
  const nowTime = fmtTime(new Date().toISOString());

  /** a new event from "יצירה", C or ?new=1: the quick create in the middle of the screen, at the next hour */
  const createHere = (d = focus) => {
    if (viewing) return;
    setCard(null);
    const h = nextHour();
    setDraft({ date: d, start: h.start, end: h.end, anchor: middle() });
  };
  const asked = params.get('new') === '1';
  useEffect(() => {
    if (!asked) return;
    createHere();
    set({});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [asked]);

  const swipeArea = useRef<HTMLDivElement>(null);
  const grid = view !== 'agenda' && view !== 'year' && !(phone && view === 'month');
  usePeriodSwipe(swipeArea, { enabled: phone && grid, onStep: step });

  // t: today, j/k: next/previous, d/w/m/x/a/y or 1-6: the views, c: a new event, g: a day to go to
  // (n stays "new task", everywhere - Layout, NewTask)
  const keys = useRef({ step, setView, goToday, createHere, askDate: () => setAskDate(true) });
  keys.current = { step, setView, goToday, createHere, askDate: () => setAskDate(true) };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
      if (takesKeys(el)) return;
      if (document.querySelector('.modal, .cal-pop, .dd-panel, .pop')) return;
      const k = keys.current;
      if (e.code === 'KeyT') k.goToday();
      else if (e.code === 'KeyJ') k.step(1);
      else if (e.code === 'KeyK') k.step(-1);
      else if (e.code === 'KeyC') k.createHere();
      else if (e.code === 'KeyG') k.askDate();
      else if (VIEW_CODES[e.code]) k.setView(VIEW_CODES[e.code]);
      else return;
      e.preventDefault();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

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
  const onToday = view === 'agenda' ? date === today && focus === today : view === 'day' ? date === today : view === 'year' ? date.slice(0, 4) === today.slice(0, 4) : listed(today);
  const title = view === 'agenda' ? viewTitle('day', focus) : viewTitle(view, date);
  const stripDate = view === 'agenda' ? focus : date;
  // a phone's title is the month: a tap on it opens the month to jump by
  const phoneTitle = phone && view !== 'month';
  const monthName = (d: string) => {
    const { year, month } = parseDateKey(d);
    return `${MONTH_NAMES[month - 1]}${year !== Number(today.slice(0, 4)) ? ` ${year}` : ''}`;
  };
  const inView = (d: string) => (view === 'agenda' || view === 'month' ? d === stripDate : shown.includes(d));
  const monthPick = (d: string) => {
    setPickerOpen(false);
    goTo(d);
  };
  const monthStep = (dir: 1 | -1) => setMiniFor({ day: focus, month: stepDate('month', miniMonth, dir) });

  // ---------------- the top bar: the calendar's controls (a computer) ----------------
  const bar = useRef({ today: goToday, step, setView, goTo, askDate: () => setAskDate(true) });
  bar.current = { today: goToday, step, setView, goTo, askDate: () => setAskDate(true) };
  const markShown = view === 'week' || view === 'four' || view === 'three' ? shown : view === 'day' ? [date] : [];
  const extrasKey = `${canAdd}`;
  useEffect(() => {
    setCalendarBar({
      view,
      date: focus,
      shown: markShown,
      title,
      todayShown: onToday,
      stepLabel: VIEW_STEP[view],
      today: () => bar.current.today(),
      step: (dir) => bar.current.step(dir),
      setView: (v) => bar.current.setView(v),
      goTo: (d) => bar.current.goTo(d),
      askDate: () => bar.current.askDate(),
      extras: [
        ...(canAdd ? [{ label: 'בחירת אירועים לפעולה משותפת', icon: 'check', run: () => bulkToggle.current?.() }] : []),
        { label: 'הדפסה', icon: 'print', run: () => window.print() },
      ],
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, focus, markShown.join(','), title, onToday, extrasKey]);
  useEffect(() => {
    return () => setCalendarBar(null);
  }, []);

  // ---------------- doing things ----------------
  // dragged in the calendar: shown at once, saved, and put back if the server refuses
  const move = async (e: ScheduleEvent, to: { date: string; startTime: string; endTime: string | null }) => {
    const span = e.endDate ? diffDays(e.endDate, e.date) : 0;
    if (eventsApi.data) eventsApi.setData(eventsApi.data.map((x) => (x.id === e.id ? { ...x, ...to, endDate: span ? addDays(to.date, span) : x.endDate } : x)));
    try {
      const res = await api.patch<EventDetail & { affectedTasks: Task[]; deltaMinutes: number }>(`/api/events/${e.id}`, e.allDay ? { date: to.date } : to);
      emitLocalChange('events');
      if (res.affectedTasks.length) setAffected({ tasks: res.affectedTasks, delta: res.deltaMinutes, id: e.id });
      else {
        const when = e.allDay ? 'כל היום' : `${to.startTime}${to.endTime ? ` - ${to.endTime}` : ''}`;
        const title =
          to.date !== e.date ? `"${e.title}" הוזז ליום ${weekdayName(to.date)} ${shortDate(to.date)}, ${when}` : to.startTime === e.startTime ? `"${e.title}" עודכן: ${when}` : `"${e.title}" הוזז ל-${when}`;
        toast({ title, body: e.seriesId ? 'רק האירוע הזה בסדרה' : undefined, tone: 'green' });
      }
    } catch (err) {
      toast({ title: (err as Error).message, tone: 'red' });
      void eventsApi.reload();
    }
  };
  const run = async (fn: () => Promise<unknown>, ok: string) => {
    try {
      await fn();
      toast({ title: ok, tone: 'green' });
      emitLocalChange('events', 'tasks');
    } catch (err) {
      toast({ title: (err as Error).message, tone: 'red' });
    }
  };
  const [scopeFor, setScopeFor] = useState<{ event: ScheduleEvent; verb: 'delete' } | null>(null);
  const remove = async (e: ScheduleEvent, scope: 'one' | 'following' | 'all' = 'one') => {
    setScopeFor(null);
    setCard(null);
    await run(() => api.del(`/api/events/${e.id}${scope !== 'one' ? `?scope=${scope}` : ''}`), scope === 'one' ? 'האירוע נמחק' : 'האירועים נמחקו');
  };
  const actions: EventActions = {
    canManage,
    onEdit: (e) => {
      setCard(null);
      setEditing(e);
    },
    onDetails: (e) => {
      setCard(null);
      set({ event: String(e.id) });
    },
    onDuplicate: (e) => {
      setCard(null);
      setCreating({ date: e.date, start: e.startTime, end: e.endTime, title: e.title, location: e.location, ownerId: e.ownerId, allDay: e.allDay, endDate: e.endDate ?? undefined, color: e.color ?? null, notes: e.notes });
    },
    onCancel: (e) => {
      setCard(null);
      setCancelling({ event: e, openTasks: Math.max(0, e.taskTotal - e.taskDone) });
    },
    onRestore: (e) => {
      setCard(null);
      void run(() => api.post(`/api/events/${e.id}/restore`), 'הפעילות הוחזרה ללו"ז');
    },
    onDelete: async (e) => {
      if (e.seriesId) return setScopeFor({ event: e, verb: 'delete' });
      if (await ask({ title: 'למחוק את האירוע מהלו"ז?', body: 'משימות מקושרות יישמרו כמשימות עצמאיות.', confirm: 'מחיקה', danger: true })) void remove(e);
    },
  };
  const openItem = (item: CalItem, el: HTMLElement) => {
    setDraft(null);
    setCard({ item, anchor: anchorOf(el) });
  };
  /** a card opened from the running list: beside where it was pressed */
  const openFromList = (item: CalItem) => setCard({ item, anchor: lastDown.current ?? middle() });
  const openEvent = (e: ScheduleEvent) => openFromList(fromEvent(e));

  const agenda = (
    <AgendaList
      rows={rows}
      today={today}
      nowTime={nowTime}
      weeks={weeks}
      canAddOn={canAddOn}
      onAdd={(d) => createHere(d)}
      onOpen={openEvent}
      onOpenExternal={(x) => openFromList(fromExternal(x, colorOf(x.sourceId)))}
      onOpenTask={(t) => openFromList(fromTask(t, 'myTasks', atIso))}
      onFocusDay={view === 'agenda' ? (d) => Date.now() > steering.current && setFocusFor({ date, day: d }) : undefined}
      onlyMine={prefs.onlyMine}
    />
  );
  const list = (
    <>
      {canQuick && <QuickAdd defaultDate={focus} today={today} allowed={mayAdd} onMore={(p) => setCreating(p)} onAdded={openEvent} />}
      {loading ? (
        <div className="card card-body">
          <Loading rows={5} />
        </div>
      ) : (
        <div ref={listRef}>
          {agenda}
          {view === 'agenda' && (
            <button type="button" className="btn agenda-more no-print" onClick={() => setMore({ date, days: span + 7 })}>
              <Icon name="chevronDown" size={16} /> עוד שבוע
            </button>
          )}
        </div>
      )}
    </>
  );

  const calendar =
    view === 'agenda' ? (
      list
    ) : view === 'year' ? (
      <YearGrid
        date={date}
        today={today}
        items={items}
        weeks={on('weeks') ? weeks : []}
        onPickDay={(d) => set({ date: d === today ? null : d, view: 'day', event: null })}
        onPickMonth={(m) => set({ date: m, view: 'month', event: null })}
      />
    ) : phone && view === 'month' ? (
      <>
        <div className="card mdots-card">
          <MonthDots month={date} selected={date} today={today} load={loadOf} onPick={(d) => set({ date: d === today ? null : d, event: null })} onStep={step} />
        </div>
        {loading ? (
          <div className="card card-body">
            <Loading rows={3} />
          </div>
        ) : (
          agenda
        )}
      </>
    ) : loading ? (
      <div className="card card-body">
        <Loading rows={6} />
      </div>
    ) : (
      // on a phone the day or the three days turn with the finger, like a page
      <div className="period-clip">
        <div className="period-swipe" ref={swipeArea}>
          <CalendarView
            view={view as GridView}
            date={date}
            today={today}
            ready={!loading}
            nowTime={nowTime}
            items={items}
            draft={draft ? { date: draft.date, start: draft.allDay ? null : (draft.start ?? null), end: draft.end ?? null } : null}
            allDayOpen={prefs.allDayOpen}
            onAllDayToggle={() => setCalendarPrefs((p) => ({ allDayOpen: !p.allDayOpen }))}
            canCreate={() => !viewing}
            canMove={canManage}
            onOpen={openItem}
            onCreate={(d, at) => {
              setCard(null);
              setDraft({ date: d.date, start: d.start ?? undefined, end: d.end, allDay: d.start === null, endDate: d.date, anchor: at });
            }}
            onMove={(e, to) => void move(e, to)}
            onPickDay={(d) => set({ date: d, view: 'day', event: null })}
          />
        </div>
      </div>
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
      <BulkBridge onReady={(fn) => void (bulkToggle.current = fn)} />
      <div
        className={`page schedule-page cal-page view-${view}${phone ? ' is-phone' : ' is-desk'}${phone && view !== 'month' && !pickerOpen ? ' has-strip' : ''}${!phone && prefs.panel ? ' has-panel' : ''}`}
        onPointerDownCapture={(e) => void (lastDown.current = { top: e.clientY - 10, bottom: e.clientY + 10, left: e.clientX - 10, right: e.clientX + 10 })}
      >
        {phone ? (
          <>
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
                  {!viewing && (
                    <button className="btn btn-primary" onClick={() => createHere()}>
                      <Icon name="plus" /> אירוע
                    </button>
                  )}
                </>
              }
            />
            <div className="cal-toolbar">
              <Seg value={view} options={PHONE_VIEWS.map((v) => ({ value: v, label: VIEW_LABELS[v] }))} onChange={setView} />
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
            {prefs.onlyMine && (
              <div className="mine-bar" role="status">
                <Icon name="my" size={15} />
                <span className="grow">רק האירועים שלך - אחראי או משימת הכנה</span>
                <button type="button" className="btn btn-sm" onClick={() => setCalendarPrefs({ onlyMine: false })}>
                  הצג הכל
                </button>
              </div>
            )}
            <ErrorBox error={error} />
            {calendar}
          </>
        ) : (
          <>
            {/* the title of the days is in the top bar; this names the screen for screen readers */}
            <h1 className="sr-only">לו"ז - {title}</h1>
            <ErrorBox error={error} />
            <div className="cal-main">
              <div className={`cal-sheet${view === 'agenda' ? ' is-list' : ''}`}>{calendar}</div>
              {prefs.panel && <ContextPanel tab={prefs.panel} date={focus} items={items} week={week} onOpen={openItem} />}
              <PanelStrip panel={prefs.panel} />
            </div>
          </>
        )}
        {card && <PopCard card={card} actions={actions} onClose={() => setCard(null)} />}
        {draft && (
          <QuickCreate
            anchor={draft.anchor}
            draft={draft}
            canEvent={canAddOn}
            onChange={(d) => setDraft({ ...d, anchor: draft.anchor })}
            onClose={() => setDraft(null)}
            onMore={(d) => {
              setDraft(null);
              setCreating(d);
            }}
            onSaved={() => setDraft(null)}
          />
        )}
        {askDate && (
          <GoToDate
            initial={focus}
            onClose={() => setAskDate(false)}
            onGo={(d) => {
              setAskDate(false);
              goTo(d);
            }}
          />
        )}
        {creating && <EventForm prefill={creating} onClose={() => setCreating(null)} />}
        {google && <GoogleCalendarModal onClose={() => setGoogle(false)} />}
        {affected && <ShiftTasks {...affected} onClose={() => setAffected(null)} />}
        {cancelling && <CancelEvent event={cancelling.event} openTasks={cancelling.openTasks} onClose={() => setCancelling(null)} />}
        {scopeFor && <SeriesScope title={`מחיקת "${scopeFor.event.title}"`} verb="מחיקה" danger onClose={() => setScopeFor(null)} onPick={(scope) => void remove(scopeFor.event, scope)} />}
        {eventId && <EventDrawer id={Number(eventId)} onClose={() => set({ event: null })} onEdit={(e) => setEditing(e)} />}
        {/* after the drawer so the edit form stacks on top of it */}
        {editing && <EventForm event={editing} onClose={() => setEditing(null)} />}
      </div>
    </BulkScope>
  );
}

/** a thing's card, beside it (a phone: a sheet) */
function PopCard({ card, actions, onClose }: { card: { item: CalItem; anchor: Anchor }; actions: EventActions; onClose: () => void }) {
  return (
    <Popover anchor={card.anchor} label={card.item.title} sheetTitle={kindLabel(card.item)} onClose={onClose} className="item-pop">
      <ItemCard item={card.item} onClose={onClose} actions={actions} />
    </Popover>
  );
}

/** "מעבר לתאריך" (G), as Google Calendar's: a day, and the calendar goes there */
function GoToDate({ initial, onClose, onGo }: { initial: string; onClose: () => void; onGo: (d: string) => void }) {
  const [d, setD] = useState(initial);
  return (
    <Modal
      title="מעבר לתאריך"
      narrow
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn btn-primary" onClick={() => onGo(d)} disabled={!isDateKey(d)}>
            מעבר
          </button>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            ביטול
          </button>
        </>
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (isDateKey(d)) onGo(d);
        }}
      >
        <Field label="תאריך">
          <DateInput value={d} onChange={(v) => setD(v)} data-autofocus />
        </Field>
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}

/** one event of a repeating series: this one, it and the later ones, or all of it */
function SeriesScope({ title, verb, danger, onClose, onPick }: { title: string; verb: string; danger?: boolean; onClose: () => void; onPick: (scope: 'one' | 'following' | 'all') => void }) {
  const [scope, setScope] = useState<'one' | 'following' | 'all'>('one');
  return (
    <Modal
      title={title}
      narrow
      onClose={onClose}
      footer={
        <>
          <button type="button" className={`btn ${danger ? 'btn-danger-solid' : 'btn-primary'}`} onClick={() => onPick(scope)}>
            {verb}
          </button>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            ביטול
          </button>
        </>
      }
    >
      <div className="col gap-6" role="radiogroup" aria-label="אילו אירועים בסדרה">
        {(
          [
            ['one', 'רק האירוע הזה'],
            ['following', 'האירוע הזה וכל הבאים אחריו'],
            ['all', 'כל האירועים בסדרה'],
          ] as const
        ).map(([v, l]) => (
          <label key={v} className="check">
            <input type="radio" name="series-scope" checked={scope === v} onChange={() => setScope(v)} /> {l}
          </label>
        ))}
      </div>
    </Modal>
  );
}

/** what a new event's form starts from: the day, and what is already known */
type FormPrefill = Draft & { color?: string | null; notes?: string };

/** The whole form of an event: its day and hours (or all day, over days), what, where, who, its colour, and for a new one - repeating. */
function EventForm({ event, prefill, onClose }: { event?: ScheduleEvent; prefill?: FormPrefill; onClose: () => void }) {
  const { users, weeks, settings } = useSession();
  const toast = useToast();
  const [date, setDate] = useState(event?.date ?? prefill?.date ?? todayKey());
  const [start, setStart] = useState(event?.startTime ?? prefill?.start ?? '08:00');
  const [end, setEnd] = useState(event?.endTime ?? prefill?.end ?? '');
  const [allDay, setAllDay] = useState(event?.allDay ?? prefill?.allDay ?? false);
  const [endDate, setEndDate] = useState(event?.endDate ?? prefill?.endDate ?? '');
  const [title, setTitle] = useState(event?.title ?? prefill?.title ?? '');
  const [location, setLocation] = useState(event?.location ?? prefill?.location ?? '');
  const ownerId = event ? event.ownerId : prefill?.ownerId;
  const [owner, setOwner] = useState<string>(ownerId ? String(ownerId) : '');
  const [notes, setNotes] = useState(event?.notes ?? prefill?.notes ?? '');
  const initialColor = event?.color ?? prefill?.color;
  const [color, setColor] = useState<CalColor | null>(isCalColor(initialColor) && initialColor !== 'blue' ? initialColor : null);
  // repeating (a new event): how often and up to which day - by default the course's last day, or three months
  const courseEnd = settings.endDate ?? weeks.reduce<string | null>((m, w) => (!m || w.endDate > m ? w.endDate : m), null);
  const [repeat, setRepeat] = useState<RepeatFreq | ''>('');
  const [every, setEvery] = useState(1);
  const [until, setUntil] = useState(courseEnd && courseEnd > date ? courseEnd : addDays(date, 90));
  const [error, setError] = useState<string | null>(null);
  const [affected, setAffected] = useState<{ tasks: Task[]; delta: number; id: number } | null>(null);
  const [askScope, setAskScope] = useState(false);
  const rule = repeat ? { freq: repeat, interval: every, until } : null;
  const span = rule ? seriesSpan(date, rule) : null;

  const save = async (scope?: 'one' | 'following' | 'all') => {
    setError(null);
    const body = {
      date,
      startTime: allDay ? '00:00' : start,
      endTime: allDay ? null : end || null,
      allDay,
      endDate: allDay && endDate && endDate > date ? endDate : null,
      color,
      title,
      location,
      ownerId: owner ? Number(owner) : null,
      notes,
    };
    try {
      if (event) {
        const patch = changedFields<typeof body>({ ...event, endTime: event.endTime || null, allDay: !!event.allDay, endDate: event.endDate ?? null, color: isCalColor(event.color) && event.color !== 'blue' ? event.color : null }, body);
        if (!Object.keys(patch).length) return onClose();
        // one of a series: which of them it takes
        if (event.seriesId && !scope) return setAskScope(true);
        const res = await api.patch<EventDetail & { affectedTasks: Task[]; deltaMinutes: number }>(`/api/events/${event.id}`, { ...patch, ...(scope && scope !== 'one' ? { scope } : {}) });
        emitLocalChange('events');
        if (res.affectedTasks.length) return setAffected({ tasks: res.affectedTasks, delta: res.deltaMinutes, id: event.id });
        toast({ title: scope === 'following' || scope === 'all' ? 'האירועים עודכנו' : 'האירוע עודכן', tone: 'green' });
      } else {
        await api.post('/api/events', { ...body, repeat: rule ?? undefined });
        toast({ title: rule ? `נוספו ללו"ז ${span?.count ?? ''} אירועים` : 'האירוע נוסף ללו"ז', body: rule ? `${title} · ${repeatText(rule)}` : undefined, tone: 'green' });
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
          <button className="btn btn-primary" onClick={() => void save()} disabled={!title.trim() || (!!rule && !span?.count)}>
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
        <Field label={allDay ? 'מתאריך' : 'תאריך'} required>
          <DateInput value={date} onChange={(v) => v && (setDate(v), endDate && endDate < v && setEndDate(v))} />
        </Field>
        {allDay ? (
          <Field label="עד תאריך" hint="ליום אחד - אותו תאריך">
            <DateInput value={endDate || date} min={date} onChange={(v) => setEndDate(v)} />
          </Field>
        ) : (
          <div className="row gap-6">
            <Field label="התחלה" required className="grow">
              <TimeInput value={start} onChange={setStart} />
            </Field>
            <Field label="סיום" className="grow">
              <TimeInput value={end} onChange={setEnd} />
            </Field>
          </div>
        )}
        <label className="check span-2">
          <input type="checkbox" checked={allDay} onChange={(e) => setAllDay(e.target.checked)} /> כל היום (או כמה ימים)
        </label>
        <Field label="מיקום">
          <input className="input" value={location} onChange={(e) => setLocation(e.target.value)} />
        </Field>
        <Field label="אחראי">
          <Select className="select" value={owner} onChange={(e) => setOwner(e.target.value)} searchable>
            <option value="">ללא</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.displayName}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="צבע ביומן" className="span-2">
          <div className="qc-swatches" role="radiogroup" aria-label="צבע ביומן">
            {CAL_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                role="radio"
                aria-checked={(color ?? 'blue') === c}
                className={`qc-swatch c-${c}${(color ?? 'blue') === c ? ' on' : ''}`}
                onClick={() => setColor(c === 'blue' ? null : c)}
                aria-label={CAL_COLOR_LABELS[c]}
                title={CAL_COLOR_LABELS[c]}
              />
            ))}
          </div>
        </Field>
        {!event && (
          <>
            <Field label="חזרה">
              <Select className="select" value={repeat} onChange={(e) => setRepeat(e.target.value as RepeatFreq | '')}>
                <option value="">לא חוזר</option>
                {REPEAT_FREQS.map((f) => (
                  <option key={f} value={f}>
                    {REPEAT_LABELS[f]}
                  </option>
                ))}
              </Select>
            </Field>
            {repeat && (
              <div className="row gap-6">
                {repeat !== 'weekdays' && (
                  <Field label="כל כמה" className="grow">
                    <Select className="select" value={String(every)} onChange={(e) => setEvery(Number(e.target.value))}>
                      {[1, 2, 3, 4].map((n) => (
                        <option key={n} value={n}>
                          {repeatText({ freq: repeat, interval: n })}
                        </option>
                      ))}
                    </Select>
                  </Field>
                )}
                <Field label="עד" className="grow">
                  <DateInput value={until} min={date} onChange={(v) => v && setUntil(v)} />
                </Field>
              </div>
            )}
            {span && (
              <p className="small muted span-2">
                {span.count ? `${span.count} אירועים, כל אחד אירוע שלם משלו (משימות הכנה, תחקיר וקבצים) - עד ${shortDate(span.last!)}.` : 'אין אף יום שבו האירוע חוזר עד התאריך שנבחר.'}
              </p>
            )}
          </>
        )}
        {event?.seriesId && <p className="small muted span-2">האירוע חלק מסדרה חוזרת - בשמירה אפשר לבחור אם לשנות רק אותו, אותו ואת הבאים, או את כולם.</p>}
        <Field label="הערות" className="span-2">
          <textarea className="textarea" value={notes} onChange={(e) => setNotes(e.target.value)} style={{ minHeight: 60 }} />
        </Field>
      </div>
      <div className="mt-12">
        <ErrorBox error={error} />
      </div>
      {askScope && (
        <SeriesScope
          title="עריכת אירוע חוזר"
          verb="שמירה"
          onClose={() => setAskScope(false)}
          onPick={(scope) => {
            setAskScope(false);
            void save(scope);
          }}
        />
      )}
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
  const { can, user, weeks } = useSession();
  const isCommander = can('schedule');
  const newTask = useNewTask();
  const toast = useToast();
  const [cancelOpen, setCancelOpen] = useState(false);
  const [scopeOpen, setScopeOpen] = useState(false);
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
              {weekdayName(e.date)} {shortDate(e.date)}
              {e.allDay && e.endDate && e.endDate !== e.date ? ` - ${weekdayName(e.endDate)} ${shortDate(e.endDate)}` : ''} ·{' '}
              <span style={{ whiteSpace: 'nowrap' }}>{e.allDay ? 'כל היום' : e.endTime ? `${e.startTime} - ${e.endTime}` : e.startTime}</span>
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
                    if (e.seriesId) return setScopeOpen(true);
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
      {scopeOpen && (
        <SeriesScope
          title={`מחיקת "${e.title}"`}
          verb="מחיקה"
          danger
          onClose={() => setScopeOpen(false)}
          onPick={(scope) => {
            setScopeOpen(false);
            void run(() => api.del(`/api/events/${e.id}${scope !== 'one' ? `?scope=${scope}` : ''}`), scope === 'one' ? 'האירוע נמחק' : 'האירועים נמחקו').then(onClose);
          }}
        />
      )}
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
