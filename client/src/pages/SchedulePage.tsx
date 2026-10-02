// Sections 22-23 (daily schedule, linked tasks), 58 (activity workflow),
// 66-67 (schedule changes and cancellations ripple into tasks).

import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { type CalendarView as CalendarViewName, stepDate, viewDays, viewTitle } from '@shared/calendarGrid';
import { addDays, shortDate, weekdayName } from '@shared/dates';
import type { EventDetail, ExternalEvent, ScheduleEvent, Task, Template } from '@shared/types';
import { BulkCheck, bulkClick, BulkScope, BulkToggle, useBulk } from '../components/Bulk';
import { CalendarView } from '../components/CalendarView';
import { GoogleCalendarModal } from '../components/GoogleCalendar';
import { Icon } from '../components/Icon';
import { useNewTask } from '../components/NewTask';
import { TaskList } from '../components/TaskRow';
import { useToast } from '../components/Toasts';
import { Empty, ErrorBox, Field, Loading, Modal, PageHead, Seg } from '../components/ui';
import { api } from '../lib/api';
import { fileSize, fmtDeadline, fmtLongDate, fmtTime, isoAt, todayKey } from '../lib/format';
import { emitLocalChange } from '../lib/realtime';
import { useSession } from '../lib/session';
import { useApi, useTick } from '../lib/useApi';

type ScheduleView = 'list' | CalendarViewName;
const VIEWS: { value: ScheduleView; label: string }[] = [
  { value: 'list', label: 'רשימה' },
  { value: 'day', label: 'יום' },
  { value: 'week', label: 'שבוע' },
  { value: 'month', label: 'חודש' },
];
const VIEW_KEY = 'kks.scheduleView';
const isView = (v: unknown): v is ScheduleView => VIEWS.some((o) => o.value === v);
// a remembered view is a convenience: storage can be missing or blocked
function savedView(): ScheduleView {
  try {
    const v = localStorage.getItem(VIEW_KEY);
    return isView(v) ? v : 'list';
  } catch {
    return 'list';
  }
}
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
// keys by position, so they work with a Hebrew keyboard too (as in Google Calendar)
const VIEW_KEYS: Record<string, ScheduleView> = { KeyA: 'list', KeyD: 'day', KeyW: 'week', KeyM: 'month' };

export function SchedulePage() {
  const [params, setParams] = useSearchParams();
  const today = todayKey();
  const date = params.get('date') ?? today;
  const eventId = params.get('event');
  const viewParam = params.get('view');
  const view: ScheduleView = isView(viewParam) ? viewParam : savedView();
  // the list and the day view show the week's strip of days; the month view its whole weeks
  const days = view === 'month' ? viewDays('month', date) : viewDays('week', date);
  const from = days[0];
  const to = days[days.length - 1];
  const { data, error, loading, setData, reload } = useApi<ScheduleEvent[]>(`/api/events?from=${from}&to=${to}`, ['events', 'tasks']);
  // events of connected Google calendars (read-only); loaded on their own so the course schedule never waits for Google
  const external = useApi<ExternalEvent[]>(`/api/calendar/external?from=${from}&to=${to}`, ['events']);
  // deadlines of open tasks in the calendar views (routine recurring tasks left out)
  const [tasksShown, setTasksShownRaw] = useState<TasksShown>(savedTasksShown);
  const setTasksShown = (v: TasksShown) => {
    setTasksShownRaw(v);
    try {
      localStorage.setItem(TASKS_KEY, v);
    } catch {
      /* not remembered */
    }
  };
  const tasks = useApi<Task[]>(view !== 'list' && tasksShown !== 'none' ? `/api/tasks?from=${from}&to=${to}&hideClosed=1&recurring=0${tasksShown === 'mine' ? '&owner=me' : ''}` : null, ['tasks']);
  const { isCommander, weeks, user } = useSession();
  const navigate = useNavigate();
  const toast = useToast();
  const [creating, setCreating] = useState<{ date: string; start?: string; end?: string | null } | null>(params.get('new') === '1' ? { date } : null);
  const [editing, setEditing] = useState<ScheduleEvent | null>(null);
  const [google, setGoogle] = useState(false);
  const [peek, setPeek] = useState<ExternalEvent | null>(null);
  const [affected, setAffected] = useState<{ tasks: Task[]; delta: number; id: number } | null>(null);
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
  const setView = (v: ScheduleView) => {
    try {
      localStorage.setItem(VIEW_KEY, v);
    } catch {
      /* not remembered */
    }
    set({ view: v });
  };
  const step = (dir: 1 | -1) => set({ date: stepDate(view === 'list' ? 'day' : view, date, dir), event: null });

  // t: today, j/k: next/previous, a/d/w/m: list/day/week/month (n stays "new task", everywhere)
  const keys = useRef({ step, setView, set, today });
  keys.current = { step, setView, set, today };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)) return;
      if (document.querySelector('.modal')) return;
      const k = keys.current;
      if (e.code === 'KeyT') k.set({ date: k.today, event: null });
      else if (e.code === 'KeyJ') k.step(1);
      else if (e.code === 'KeyK') k.step(-1);
      else if (VIEW_KEYS[e.code]) k.setView(VIEW_KEYS[e.code]);
      else return;
      e.preventDefault();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const dayEvents = (data ?? []).filter((e) => e.date === date);
  const dayExternal = (external.data ?? []).filter((e) => e.date === date);
  const allDay = dayExternal.filter((e) => !e.startTime);
  // course events and timed Google events in one timeline
  const timeline: ({ kind: 'event'; at: string; e: ScheduleEvent } | { kind: 'external'; at: string; e: ExternalEvent })[] = [
    ...dayEvents.map((e) => ({ kind: 'event' as const, at: e.startTime, e })),
    ...dayExternal.filter((e) => e.startTime).map((e) => ({ kind: 'external' as const, at: e.startTime!, e })),
  ].sort((a, b) => a.at.localeCompare(b.at));
  const week = weeks.find((w) => w.startDate <= date && w.endDate >= date);
  const leadOn = (d: string) => weeks.find((w) => w.startDate <= d && w.endDate >= d)?.leadId === user.id;
  const canAdd = isCommander || week?.leadId === user.id;
  const canAddOn = (d: string) => isCommander || leadOn(d);
  const canMove = (e: ScheduleEvent) => isCommander || e.ownerId === user.id || leadOn(e.date);
  const nowTime = fmtTime(new Date().toISOString());
  const shown = view === 'list' ? days : viewDays(view, date);
  const shownEvents = (data ?? []).filter((e) => shown.includes(e.date));
  const bulkIds = (view === 'list' ? dayEvents : shownEvents).map((e) => e.id);
  const onToday = view === 'list' || view === 'day' ? date === today : shown.includes(today);

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
    <div className="page">
      <PageHead
        eyebrow={week ? week.name : 'לו"ז'}
        title={date === today && (view === 'list' || view === 'day') ? `לו"ז היום` : 'לו"ז'}
        sub={view === 'list' || view === 'day' ? fmtLongDate(date) : viewTitle(view, date)}
        actions={
          <>
            {canAdd && <BulkToggle />}
            <button className="btn" onClick={() => setGoogle(true)}>
              <Icon name="calendar" /> יומן Google
            </button>
            <button className="btn" onClick={() => window.print()}>
              <Icon name="print" /> הדפסה
            </button>
            {canAdd && (
              <button className="btn btn-primary" onClick={() => setCreating({ date })}>
                <Icon name="plus" /> אירוע
              </button>
            )}
          </>
        }
      />
      <div className="cal-toolbar mb-12">
        <button className="btn btn-sm" onClick={() => set({ date: today, event: null })} disabled={onToday} title="היום (T)">
          היום
        </button>
        <button className="icon-btn" aria-label={`${VIEW_STEP[view]} קודם`} title={`${VIEW_STEP[view]} קודם (K)`} onClick={() => step(-1)}>
          <Icon name="chevronRight" />
        </button>
        <button className="icon-btn" aria-label={`${VIEW_STEP[view]} הבא`} title={`${VIEW_STEP[view]} הבא (J)`} onClick={() => step(1)}>
          <Icon name="chevronLeft" />
        </button>
        <h2 className="cal-title">{viewTitle(view === 'list' ? 'day' : view, date)}</h2>
        <span className="grow" />
        {view !== 'list' && (
          <select className="select cal-tasks" value={tasksShown} onChange={(e) => setTasksShown(e.target.value as TasksShown)} aria-label="דד-ליינים של משימות ביומן">
            <option value="mine">דד-ליינים: שלי</option>
            <option value="all">דד-ליינים: כל המשימות</option>
            <option value="none">בלי דד-ליינים</option>
          </select>
        )}
        <Seg value={view} options={VIEWS} onChange={setView} />
      </div>
      {(view === 'list' || view === 'day') && (
        <div className="day-strip mb-12">
          {days.map((d) => {
            const n = (data ?? []).filter((e) => e.date === d && !e.cancelled).length + (external.data ?? []).filter((e) => e.date === d).length;
            return (
              <button key={d} className={`day-pill${d === date ? ' on' : ''}${d === today ? ' today' : ''}`} onClick={() => set({ date: d, event: null })}>
                <div className="dw">{weekdayName(d)}</div>
                <div className="dn">{Number(d.slice(8))}</div>
                <div className="dc">{n ? `${n} אירועים` : '·'}</div>
              </button>
            );
          })}
        </div>
      )}
      <ErrorBox error={error} />
      {view !== 'list' ? (
        loading && !data ? (
          <div className="card card-body">
            <Loading rows={6} />
          </div>
        ) : (
          <CalendarView
            view={view}
            date={date}
            today={today}
            ready={!loading}
            nowTime={nowTime}
            events={data ?? []}
            external={external.data ?? []}
            tasks={tasksShown === 'none' ? [] : (tasks.data ?? [])}
            canCreate={canAddOn}
            canMove={canMove}
            onOpen={(e) => set({ event: String(e.id) })}
            onOpenExternal={setPeek}
            onOpenTask={(t) => navigate(`/tasks/${t.id}`)}
            onCreate={(d, start, end) => setCreating({ date: d, start, end })}
            onMove={(e, to) => void move(e, to)}
            onPickDay={(d) => set({ date: d, view: 'day', event: null })}
          />
        )
      ) : (
      <div className="card">
        {loading && !data ? (
          <div className="card-body">
            <Loading rows={4} />
          </div>
        ) : timeline.length === 0 && allDay.length === 0 ? (
          <Empty icon="calendar" title="אין אירועים" text={canAdd ? 'הוסיפו אירועים ללו"ז היום - ולכל אירוע אחראי, מיקום ומשימות הכנה.' : undefined} />
        ) : (
          <>
            {allDay.map((e) => (
              <div key={e.id} className="event-row external">
                <div className="event-time small">כל היום</div>
                <div style={{ minWidth: 0 }}>
                  <div className="event-title">{e.title}</div>
                  <div className="task-meta">
                    <span>{e.sourceName}</span>
                    {e.location && (
                      <span className="sep">
                        <Icon name="pin" size={13} /> {e.location}
                      </span>
                    )}
                  </div>
                </div>
                <span className="badge t-blue">Google</span>
              </div>
            ))}
            {timeline.map((item) => {
              if (item.kind === 'external') {
                const e = item.e;
                return (
                  <div key={e.id} className="event-row external">
                    <div className="event-time">
                      {e.startTime}
                      {e.endTime && <span className="end">עד {e.endTime}</span>}
                    </div>
                    <div style={{ minWidth: 0 }}>
                      <div className="event-title">{e.title}</div>
                      <div className="task-meta">
                        <span>{e.sourceName}</span>
                        {e.location && (
                          <span className="sep">
                            <Icon name="pin" size={13} /> {e.location}
                          </span>
                        )}
                      </div>
                    </div>
                    <span className="badge t-blue">Google</span>
                  </div>
                );
              }
              const e = item.e;
              const isNow = date === today && e.startTime <= nowTime && (e.endTime ? e.endTime > nowTime : false);
              return <CourseEventRow key={e.id} e={e} isNow={isNow} onOpen={() => set({ event: String(e.id) })} />;
            })}
          </>
        )}
      </div>
      )}
      {view !== 'list' && (
        <div className="cal-hint small muted no-print">
          {canAdd ? 'לחיצה או גרירה על זמן פנוי - אירוע חדש · גרירת אירוע - הזזה · גרירת הקצה התחתון - שינוי משך · ' : ''}
          קיצורים: T היום, J/K הבא/הקודם, A/D/W/M רשימה/יום/שבוע/חודש
        </div>
      )}
      {creating && <EventForm defaultDate={creating.date} defaultStart={creating.start} defaultEnd={creating.end} onClose={() => setCreating(null)} />}
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

const VIEW_STEP: Record<ScheduleView, string> = { list: 'יום', day: 'יום', week: 'שבוע', month: 'חודש' };

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

function CourseEventRow({ e, isNow, onOpen }: { e: ScheduleEvent; isNow: boolean; onOpen: () => void }) {
  const bulk = useBulk();
  return (
    <div className={`event-row${e.cancelled ? ' cancelled' : ''}${isNow ? ' now' : ''}${bulk?.selected.has(e.id) ? ' selected' : ''}`} onClick={bulkClick(bulk, e.id, onOpen)}>
      <div className="event-time">
        <BulkCheck id={e.id} />
        {e.startTime}
        {e.endTime && <span className="end">עד {e.endTime}</span>}
      </div>
      <div style={{ minWidth: 0 }}>
        <div className="event-title">
          {e.title} {e.cancelled && <span className="badge t-red">בוטל</span>}
          {isNow && <span className="badge t-orange">עכשיו</span>}
        </div>
        <div className="task-meta">
          {e.location && (
            <span>
              <Icon name="pin" size={13} /> {e.location}
            </span>
          )}
          {e.ownerName && <span className={e.location ? 'sep' : ''}>אחראי: {e.ownerName}</span>}
          {e.notes && <span className="sep">{e.notes.slice(0, 60)}</span>}
        </div>
      </div>
      <div className="row gap-6">
        {e.taskTotal > 0 && (
          <span className={`badge t-${e.taskDone === e.taskTotal ? 'green' : 'orange'}`}>
            הכנה {e.taskDone}/{e.taskTotal}
          </span>
        )}
      </div>
    </div>
  );
}

function EventForm({
  event,
  defaultDate,
  defaultStart,
  defaultEnd,
  onClose,
}: {
  event?: ScheduleEvent;
  defaultDate?: string;
  defaultStart?: string;
  defaultEnd?: string | null;
  onClose: () => void;
}) {
  const { users } = useSession();
  const toast = useToast();
  const [date, setDate] = useState(event?.date ?? defaultDate ?? todayKey());
  const [start, setStart] = useState(event?.startTime ?? defaultStart ?? '08:00');
  const [end, setEnd] = useState(event?.endTime ?? defaultEnd ?? '');
  const [title, setTitle] = useState(event?.title ?? '');
  const [location, setLocation] = useState(event?.location ?? '');
  const [owner, setOwner] = useState<string>(event?.ownerId ? String(event.ownerId) : '');
  const [notes, setNotes] = useState(event?.notes ?? '');
  const [error, setError] = useState<string | null>(null);
  const [affected, setAffected] = useState<{ tasks: Task[]; delta: number; id: number } | null>(null);

  const save = async () => {
    setError(null);
    const body = { date, startTime: start, endTime: end || null, title, location, ownerId: owner ? Number(owner) : null, notes };
    try {
      if (event) {
        const res = await api.patch<EventDetail & { affectedTasks: Task[]; deltaMinutes: number }>(`/api/events/${event.id}`, body);
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
          <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <div className="row gap-6">
          <Field label="התחלה" required className="grow">
            <input className="input" type="time" value={start} onChange={(e) => setStart(e.target.value)} />
          </Field>
          <Field label="סיום" className="grow">
            <input className="input" type="time" value={end} onChange={(e) => setEnd(e.target.value)} />
          </Field>
        </div>
        <Field label="מיקום">
          <input className="input" value={location} onChange={(e) => setLocation(e.target.value)} />
        </Field>
        <Field label="אחראי">
          <select className="select" value={owner} onChange={(e) => setOwner(e.target.value)}>
            <option value="">ללא</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.displayName}
              </option>
            ))}
          </select>
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
          <div className="grow">
            <div className="mono strong" style={{ fontSize: 18 }}>
              {weekdayName(e.date)} {shortDate(e.date)} · {e.startTime}
              {e.endTime && `-${e.endTime}`}
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
                  onClick={() => {
                    if (confirm('למחוק את האירוע מהלו"ז? משימות מקושרות יישמרו כעצמאיות.')) void run(() => api.del(`/api/events/${e.id}`), 'האירוע נמחק').then(onClose);
                  }}
                >
                  <Icon name="trash" />
                </button>
              )}
            </div>
          )}
        </div>
        {e.notes && <div className="info-box" style={{ whiteSpace: 'pre-wrap' }}>{e.notes}</div>}

        <div>
          <div className="row mb-12">
            <h3 className="grow">משימות הכנה ({data.tasks.length})</h3>
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
          <TaskList tasks={data.tasks} empty={<p className="small muted">כל פעילות יכולה להפוך למרכז משימות: תיאום, מדריכים, רפואה, בטיחות, הסעות...</p>} />
        </div>

        <div>
          <div className="row mb-12">
            <h3 className="grow">תחקיר</h3>
            <button className="btn btn-sm" onClick={() => navigate(`/debriefs?event=${e.id}`)}>
              <Icon name="lightbulb" /> פתח תחקיר
            </button>
          </div>
          {data.debriefs.length === 0 ? (
            <p className="small muted">לאחר הפעילות - פתחו תחקיר: עובדות, ממצאים, מסקנות ולקחים שהופכים למשימות.</p>
          ) : (
            data.debriefs.map((d) => (
              <Link key={d.id} to={`/debriefs/${d.id}`} className="row small" onClick={onClose}>
                <Icon name="lightbulb" size={16} /> <b>{d.title}</b>
                <span className="tiny muted">
                  {d.itemCounts.lesson === 1 ? 'לקח אחד' : `${d.itemCounts.lesson} לקחים`} · {d.status === 'final' ? 'סוכם' : 'טיוטה'}
                </span>
              </Link>
            ))
          )}
        </div>

        <div>
          <h3 className="mb-12">קבצים וקישורים</h3>
          <div className="col gap-6">
            {data.attachments.map((a) => (
              <a key={a.id} href={a.url} target="_blank" rel="noreferrer noopener" className="row small">
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
            <input className="input" type="date" value={newDate} onChange={(e) => setNewDate(e.target.value)} />
            <input className="input" type="time" value={newTime} onChange={(e) => setNewTime(e.target.value)} />
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
