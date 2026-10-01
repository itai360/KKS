// Sections 22-23 (daily schedule, linked tasks), 58 (activity workflow),
// 66-67 (schedule changes and cancellations ripple into tasks).

import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { addDays, shortDate, startOfWeek, weekdayName } from '@shared/dates';
import type { EventDetail, ScheduleEvent, Task, Template } from '@shared/types';
import { Icon } from '../components/Icon';
import { useNewTask } from '../components/NewTask';
import { TaskList } from '../components/TaskRow';
import { useToast } from '../components/Toasts';
import { Empty, ErrorBox, Field, Loading, Modal, PageHead, Seg } from '../components/ui';
import { api } from '../lib/api';
import { fileSize, fmtDeadline, fmtLongDate, fmtTime, isoAt, todayKey } from '../lib/format';
import { emitLocalChange } from '../lib/realtime';
import { useSession } from '../lib/session';
import { useApi } from '../lib/useApi';

export function SchedulePage() {
  const [params, setParams] = useSearchParams();
  const today = todayKey();
  const date = params.get('date') ?? today;
  const eventId = params.get('event');
  const weekStart = startOfWeek(date);
  const { data, error, loading } = useApi<ScheduleEvent[]>(`/api/events?from=${weekStart}&to=${addDays(weekStart, 6)}`, ['events', 'tasks']);
  const { isCommander, weeks, user } = useSession();
  const [creating, setCreating] = useState(params.get('new') === '1');
  const [editing, setEditing] = useState<ScheduleEvent | null>(null);

  const set = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) {
      if (v === null) next.delete(k);
      else next.set(k, v);
    }
    next.delete('new');
    setParams(next, { replace: true });
  };

  const dayEvents = (data ?? []).filter((e) => e.date === date);
  const week = weeks.find((w) => w.startDate <= date && w.endDate >= date);
  const canAdd = isCommander || week?.leadId === user.id;
  const nowTime = fmtTime(new Date().toISOString());

  return (
    <div className="page">
      <PageHead
        eyebrow={week ? week.name : 'לו"ז'}
        title={date === today ? `לו"ז היום` : 'לו"ז'}
        sub={fmtLongDate(date)}
        actions={
          <>
            <button className="btn" onClick={() => window.print()}>
              <Icon name="print" /> הדפסה
            </button>
            {canAdd && (
              <button className="btn btn-primary" onClick={() => setCreating(true)}>
                <Icon name="plus" /> אירוע
              </button>
            )}
          </>
        }
      />
      <div className="row mb-12">
        <button className="icon-btn" aria-label="שבוע קודם" onClick={() => set({ date: addDays(weekStart, -7) })}>
          <Icon name="chevronRight" />
        </button>
        <div className="day-strip grow">
          {Array.from({ length: 7 }, (_, i) => {
            const d = addDays(weekStart, i);
            const n = (data ?? []).filter((e) => e.date === d && !e.cancelled).length;
            return (
              <button key={d} className={`day-pill${d === date ? ' on' : ''}${d === today ? ' today' : ''}`} onClick={() => set({ date: d, event: null })}>
                <div className="dw">{weekdayName(d)}</div>
                <div className="dn">{Number(d.slice(8))}</div>
                <div className="dc">{n ? `${n} אירועים` : '·'}</div>
              </button>
            );
          })}
        </div>
        <button className="icon-btn" aria-label="שבוע הבא" onClick={() => set({ date: addDays(weekStart, 7) })}>
          <Icon name="chevronLeft" />
        </button>
        {date !== today && (
          <button className="btn btn-sm" onClick={() => set({ date: today, event: null })}>
            היום
          </button>
        )}
      </div>
      <ErrorBox error={error} />
      <div className="card">
        {loading && !data ? (
          <div className="card-body">
            <Loading rows={4} />
          </div>
        ) : dayEvents.length === 0 ? (
          <Empty icon="calendar" title="אין אירועים" text={canAdd ? 'הוסיפו אירועים ללו"ז היום - ולכל אירוע אחראי, מיקום ומשימות הכנה.' : undefined} />
        ) : (
          dayEvents.map((e) => {
            const isNow = date === today && e.startTime <= nowTime && (e.endTime ? e.endTime > nowTime : false);
            return (
              <div key={e.id} className={`event-row${e.cancelled ? ' cancelled' : ''}${isNow ? ' now' : ''}`} onClick={() => set({ event: String(e.id) })}>
                <div className="event-time">
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
          })
        )}
      </div>
      {creating && <EventForm defaultDate={date} onClose={() => setCreating(false)} />}
      {eventId && <EventDrawer id={Number(eventId)} onClose={() => set({ event: null })} onEdit={(e) => setEditing(e)} />}
      {/* after the drawer so the edit form stacks on top of it */}
      {editing && <EventForm event={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function EventForm({ event, defaultDate, onClose }: { event?: ScheduleEvent; defaultDate?: string; onClose: () => void }) {
  const { users } = useSession();
  const toast = useToast();
  const [date, setDate] = useState(event?.date ?? defaultDate ?? todayKey());
  const [start, setStart] = useState(event?.startTime ?? '08:00');
  const [end, setEnd] = useState(event?.endTime ?? '');
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
