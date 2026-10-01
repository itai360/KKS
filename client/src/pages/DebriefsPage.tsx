// Section 31 (debriefs) and 57: facts -> findings -> conclusions -> lessons -> tasks.

import { useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { DEBRIEF_ITEM_KINDS, DEBRIEF_ITEM_LABELS, PRIORITIES, PRIORITY_LABELS, STATUS_LABELS, WEEKDAY_NAMES, type DebriefItemKind, type Priority } from '@shared/constants';
import { addDays, shortDate } from '@shared/dates';
import type { Debrief, DebriefDetail, DebriefItem, ScheduleEvent, Template } from '@shared/types';
import { Icon } from '../components/Icon';
import { DateTimeInputs, UserPicker } from '../components/NewTask';
import { TaskList } from '../components/TaskRow';
import { useToast } from '../components/Toasts';
import { Empty, ErrorBox, Field, Loading, Modal, PageHead, Seg } from '../components/ui';
import { api } from '../lib/api';
import { isoAt, todayKey } from '../lib/format';
import { emitLocalChange } from '../lib/realtime';
import { useSession } from '../lib/session';
import { useApi } from '../lib/useApi';

const ADD_PLACEHOLDER: Record<DebriefItemKind, string> = {
  fact: 'הוספת עובדה...',
  finding: 'הוספת ממצא...',
  conclusion: 'הוספת מסקנה...',
  lesson: 'הוספת לקח...',
};

const KIND_HINT: Record<DebriefItemKind, string> = {
  fact: 'מה קרה - בלי פרשנות',
  finding: 'מה זיהינו',
  conclusion: 'למה זה קרה',
  lesson: 'מה עושים אחרת מעכשיו',
};

export function DebriefsPage() {
  const [params, setParams] = useSearchParams();
  const { data, error, loading } = useApi<Debrief[]>('/api/debriefs', ['debriefs', 'tasks']);
  const navigate = useNavigate();
  const creatingFromEvent = params.get('event');
  const [creating, setCreating] = useState(!!creatingFromEvent || params.get('new') === '1');

  return (
    <div className="page">
      <PageHead
        title="תחקירים"
        sub="אירוע, עובדות, ממצאים, מסקנות, לקחים - וכל לקח הופך למשימה, למשימה חוזרת או לשלב בתבנית."
        actions={
          <button className="btn btn-primary" onClick={() => setCreating(true)}>
            <Icon name="plus" /> תחקיר
          </button>
        }
      />
      <ErrorBox error={error} />
      {loading && !data ? (
        <Loading rows={3} />
      ) : !data?.length ? (
        <Empty icon="lightbulb" title="אין תחקירים" text="פתחו תחקיר אחרי פעילות - מתוך הלו״ז או מכאן." />
      ) : (
        <div className="list">
          {data.map((d) => (
            <div key={d.id} className="task-row t-gray" style={{ gridTemplateColumns: '1fr auto' }} onClick={() => navigate(`/debriefs/${d.id}`)} role="link" tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && navigate(`/debriefs/${d.id}`)}>
              <div className="task-main">
                <div className="task-title">{d.title}</div>
                <div className="task-meta">
                  <span className="mono">{shortDate(d.occurredOn)}</span>
                  {d.eventTitle && <span className="sep">{d.eventTitle}</span>}
                  {d.weekName && <span className="sep">{d.weekName}</span>}
                  {d.facilitatorName && <span className="sep">מנחה: {d.facilitatorName}</span>}
                </div>
              </div>
              <div className="task-side">
                {DEBRIEF_ITEM_KINDS.map((k) => (
                  <span key={k} className="badge" title={DEBRIEF_ITEM_LABELS[k]}>
                    {DEBRIEF_ITEM_LABELS[k]} {d.itemCounts[k]}
                  </span>
                ))}
                {d.openTasks > 0 && <span className="badge t-orange">{d.openTasks} משימות פתוחות</span>}
                <span className={`badge ${d.status === 'final' ? 't-green' : 't-yellow'}`}>{d.status === 'final' ? 'סוכם' : 'טיוטה'}</span>
              </div>
            </div>
          ))}
        </div>
      )}
      {creating && (
        <DebriefForm
          eventId={creatingFromEvent ? Number(creatingFromEvent) : undefined}
          onClose={() => {
            setCreating(false);
            if (params.size) setParams({}, { replace: true });
          }}
        />
      )}
    </div>
  );
}

function DebriefForm({ debrief, eventId, onClose }: { debrief?: Debrief; eventId?: number; onClose: () => void }) {
  const toast = useToast();
  const navigate = useNavigate();
  const { users, user } = useSession();
  const today = todayKey();
  const events = useApi<ScheduleEvent[]>(`/api/events?from=${addDays(today, -30)}&to=${today}`, ['events']);
  const preset = events.data?.find((e) => e.id === eventId);
  const [title, setTitle] = useState(debrief?.title ?? '');
  const [date, setDate] = useState(debrief?.occurredOn ?? today);
  const [event, setEvent] = useState<string>(String(debrief?.eventId ?? eventId ?? ''));
  const [facilitator, setFacilitator] = useState<string>(String(debrief?.facilitatorId ?? user.id));
  const [participants, setParticipants] = useState(debrief?.participants ?? '');
  const [summary, setSummary] = useState(debrief?.summary ?? '');
  const [error, setError] = useState<string | null>(null);
  const effectiveTitle = title || (preset ? `תחקיר ${preset.title}` : '');
  const effectiveDate = debrief ? date : preset && !title ? preset.date : date;

  const save = async () => {
    setError(null);
    const body = { title: effectiveTitle, occurredOn: effectiveDate, eventId: event ? Number(event) : null, facilitatorId: facilitator ? Number(facilitator) : null, participants, summary };
    try {
      const created = debrief ? null : await api.post<DebriefDetail>('/api/debriefs', body);
      if (debrief) await api.patch(`/api/debriefs/${debrief.id}`, body);
      toast({ title: 'התחקיר נשמר', tone: 'green' });
      emitLocalChange('debriefs');
      // close first: closing clears ?event= from the list URL, and the
      // navigation to the new debrief has to be the last one
      onClose();
      if (created) navigate(`/debriefs/${created.debrief.id}`);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <Modal
      title={debrief ? 'עריכת תחקיר' : 'תחקיר חדש'}
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-primary" onClick={() => void save()} disabled={!effectiveTitle.trim()}>
            {debrief ? 'שמור' : 'פתח תחקיר'}
          </button>
          <button className="btn btn-ghost" onClick={onClose}>
            ביטול
          </button>
        </>
      }
    >
      <div className="form-grid">
        <Field label="נושא התחקיר" required className="span-2">
          <input className="input" value={effectiveTitle} onChange={(e) => setTitle(e.target.value)} placeholder="לדוגמה: תחקיר מטווח הפעלת כוח" data-autofocus />
        </Field>
        <Field label="תאריך האירוע">
          <input className="input" type="date" value={effectiveDate} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Field label='פעילות בלו"ז'>
          <select className="select" value={event} onChange={(e) => setEvent(e.target.value)}>
            <option value="">ללא</option>
            {(events.data ?? []).map((e) => (
              <option key={e.id} value={e.id}>
                {shortDate(e.date)} · {e.title}
              </option>
            ))}
          </select>
        </Field>
        <Field label="מנחה">
          <select className="select" value={facilitator} onChange={(e) => setFacilitator(e.target.value)}>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.displayName}
              </option>
            ))}
          </select>
        </Field>
        <Field label="משתתפים">
          <input className="input" value={participants} onChange={(e) => setParticipants(e.target.value)} placeholder="לדוגמה: סגל הצוות, מדריכי ירי" />
        </Field>
        <Field label="תיאור האירוע" className="span-2">
          <textarea className="textarea" value={summary} onChange={(e) => setSummary(e.target.value)} />
        </Field>
      </div>
      <div className="mt-12">
        <ErrorBox error={error} />
      </div>
    </Modal>
  );
}

type ItemDialog = null | { item: DebriefItem; to: 'task' | 'recurring' | 'template' };

export function DebriefPage() {
  const { id } = useParams();
  const { data, error, loading, setData } = useApi<DebriefDetail>(`/api/debriefs/${id}`, ['debriefs', 'tasks']);
  const { isCommander } = useSession();
  const toast = useToast();
  const navigate = useNavigate();
  const [editing, setEditing] = useState(false);
  const [dialog, setDialog] = useState<ItemDialog>(null);

  if (loading && !data)
    return (
      <div className="page">
        <Loading rows={4} />
      </div>
    );
  if (!data)
    return (
      <div className="page">
        <ErrorBox error={error} />
      </div>
    );
  const d = data.debrief;

  const run = async (fn: () => Promise<DebriefDetail | void>, ok?: string) => {
    try {
      const res = await fn();
      if (res) setData(res);
      if (ok) toast({ title: ok, tone: 'green' });
      emitLocalChange('debriefs', 'tasks');
    } catch (e) {
      toast({ title: (e as Error).message, tone: 'red' });
    }
  };

  return (
    <div className="page">
      <PageHead
        eyebrow={
          <Link to="/debriefs" className="muted">
            תחקירים
          </Link>
        }
        title={d.title}
        sub={[shortDate(d.occurredOn), d.eventTitle, d.weekName, d.facilitatorName && `מנחה: ${d.facilitatorName}`, d.status === 'final' ? 'סוכם' : 'טיוטה'].filter(Boolean).join(' · ')}
        actions={
          d.canEdit && (
            <>
              <button className="btn" onClick={() => setEditing(true)}>
                <Icon name="edit" /> עריכה
              </button>
              {d.status === 'draft' ? (
                <button className="btn btn-primary" onClick={() => void run(() => api.patch<DebriefDetail>(`/api/debriefs/${d.id}`, { status: 'final' }), 'התחקיר סוכם')}>
                  <Icon name="check" /> סיכום התחקיר
                </button>
              ) : (
                <button className="btn" onClick={() => void run(() => api.patch<DebriefDetail>(`/api/debriefs/${d.id}`, { status: 'draft' }))}>
                  החזר לטיוטה
                </button>
              )}
              <button className="btn btn-ghost text-red" onClick={() => confirm('למחוק את התחקיר?') && void api.del(`/api/debriefs/${d.id}`).then(() => navigate('/debriefs'))} aria-label="מחיקה">
                <Icon name="trash" />
              </button>
            </>
          )
        }
      />
      {(d.summary || d.participants) && (
        <div className="card card-pad mb-12" style={{ marginBottom: 16 }}>
          {d.summary && <p style={{ whiteSpace: 'pre-wrap' }}>{d.summary}</p>}
          {d.participants && <div className="tiny muted mt-8">משתתפים: {d.participants}</div>}
        </div>
      )}
      <div className="grid-2">
        {DEBRIEF_ITEM_KINDS.map((k, idx) => (
          <ItemColumn
            key={k}
            kind={k}
            step={idx + 1}
            items={data.items.filter((i) => i.kind === k)}
            canEdit={d.canEdit}
            isCommander={isCommander}
            onAdd={(body) => run(() => api.post<DebriefDetail>(`/api/debriefs/${d.id}/items`, { kind: k, body }))}
            onEdit={(item, body) => run(() => api.patch<DebriefDetail>(`/api/debrief-items/${item.id}`, { body }))}
            onDelete={(item) => run(() => api.del<DebriefDetail>(`/api/debrief-items/${item.id}`))}
            onConvert={(item, to) => setDialog({ item, to })}
          />
        ))}
      </div>
      <div className="section-title">
        <h2>משימות בעקבות התחקיר</h2>
        <span className="count-pill">{data.tasks.length}</span>
      </div>
      <TaskList tasks={data.tasks} empty={<p className="small muted">הפכו לקח או מסקנה למשימה עם אחראי ודד-ליין - כך הלקח לא נשאר רק כטקסט.</p>} />
      {editing && <DebriefForm debrief={d} onClose={() => setEditing(false)} />}
      {dialog?.to === 'task' && <ItemToTask item={dialog.item} onClose={() => setDialog(null)} onDone={setData} />}
      {dialog?.to === 'recurring' && <ItemToRecurring item={dialog.item} onClose={() => setDialog(null)} onDone={setData} />}
      {dialog?.to === 'template' && <ItemToTemplate item={dialog.item} onClose={() => setDialog(null)} onDone={setData} />}
    </div>
  );
}

function ItemColumn({
  kind,
  step,
  items,
  canEdit,
  isCommander,
  onAdd,
  onEdit,
  onDelete,
  onConvert,
}: {
  kind: DebriefItemKind;
  step: number;
  items: DebriefItem[];
  canEdit: boolean;
  isCommander: boolean;
  onAdd: (body: string) => Promise<void>;
  onEdit: (item: DebriefItem, body: string) => Promise<void>;
  onDelete: (item: DebriefItem) => Promise<void>;
  onConvert: (item: DebriefItem, to: 'task' | 'recurring' | 'template') => void;
}) {
  const [text, setText] = useState('');
  const [editing, setEditing] = useState<number | null>(null);
  const [draft, setDraft] = useState('');
  const actionable = kind === 'conclusion' || kind === 'lesson';
  return (
    <div className="card">
      <div className="card-head">
        <span className="mono tiny muted">{step}</span>
        <h3 className="grow">{DEBRIEF_ITEM_LABELS[kind]}</h3>
        <span className="tiny muted">{KIND_HINT[kind]}</span>
      </div>
      <div className="card-body col gap-6">
        {items.length === 0 && !canEdit && <p className="small muted">-</p>}
        {items.map((i) => (
          <div key={i.id} className="update" style={{ padding: '10px 12px' }}>
            {editing === i.id ? (
              <div className="col gap-6">
                <textarea className="textarea" value={draft} onChange={(e) => setDraft(e.target.value)} style={{ minHeight: 60 }} />
                <div className="row gap-6">
                  <button className="btn btn-sm btn-primary" onClick={() => void onEdit(i, draft).then(() => setEditing(null))}>
                    שמור
                  </button>
                  <button className="btn btn-sm btn-ghost" onClick={() => setEditing(null)}>
                    ביטול
                  </button>
                </div>
              </div>
            ) : (
              <>
                <div className="update-body" style={{ fontSize: 14.5 }}>
                  {i.body}
                </div>
                {(i.taskId || i.recurringRuleId) && (
                  <div className="row wrap gap-6 mt-8">
                    {i.taskId && (
                      <Link to={`/tasks/${i.taskId}`} className="badge t-blue">
                        <Icon name="tasks" size={11} /> {i.taskTitle} · {i.taskStatus ? STATUS_LABELS[i.taskStatus] : ''}
                      </Link>
                    )}
                    {i.recurringRuleId && (
                      <Link to="/recurring" className="badge t-purple">
                        <Icon name="repeat" size={11} /> {i.recurringTitle}
                      </Link>
                    )}
                  </div>
                )}
                {canEdit && (
                  <div className="row wrap gap-6 mt-8">
                    {actionable && (
                      <button className="btn btn-sm" onClick={() => onConvert(i, 'task')}>
                        <Icon name="plus" /> משימה
                      </button>
                    )}
                    {actionable && isCommander && (
                      <>
                        <button className="btn btn-sm" onClick={() => onConvert(i, 'recurring')}>
                          <Icon name="repeat" /> משימה חוזרת
                        </button>
                        <button className="btn btn-sm" onClick={() => onConvert(i, 'template')}>
                          <Icon name="template" /> לתבנית
                        </button>
                      </>
                    )}
                    <span className="grow" />
                    <button
                      className="icon-btn"
                      style={{ width: 28, height: 28 }}
                      aria-label="עריכה"
                      onClick={() => {
                        setEditing(i.id);
                        setDraft(i.body);
                      }}
                    >
                      <Icon name="edit" size={14} />
                    </button>
                    <button className="icon-btn" style={{ width: 28, height: 28 }} aria-label="מחיקה" onClick={() => confirm('למחוק?') && void onDelete(i)}>
                      <Icon name="trash" size={14} />
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        ))}
        {canEdit && (
          <form
            className="row"
            onSubmit={(e) => {
              e.preventDefault();
              if (text.trim()) void onAdd(text.trim()).then(() => setText(''));
            }}
          >
            <input className="input grow" value={text} onChange={(e) => setText(e.target.value)} placeholder={ADD_PLACEHOLDER[kind]} />
            <button className="btn btn-sm" disabled={!text.trim()}>
              <Icon name="plus" />
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

function ItemToTask({ item, onClose, onDone }: { item: DebriefItem; onClose: () => void; onDone: (d: DebriefDetail) => void }) {
  const { isCommander, settings } = useSession();
  const toast = useToast();
  const [title, setTitle] = useState(item.body.length <= 80 ? item.body : '');
  const [owners, setOwners] = useState<number[]>([]);
  const [all, setAll] = useState(false);
  const [date, setDate] = useState(addDays(todayKey(), 7));
  const [time, setTime] = useState(settings.defaultDeadlineTime);
  const [priority, setPriority] = useState<Priority>('normal');
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    setError(null);
    try {
      const d = await api.post<DebriefDetail>(`/api/debrief-items/${item.id}/task`, { title, ownerIds: owners, allStaff: all, deadline: isoAt(date, time), priority });
      onDone(d);
      toast({ title: 'נפתחה משימה בעקבות התחקיר', tone: 'green' });
      emitLocalChange('tasks', 'debriefs');
      onClose();
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <Modal
      title="משימה בעקבות התחקיר"
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-primary" disabled={!title.trim() || (!all && !owners.length)} onClick={() => void save()}>
            שלח
          </button>
          <button className="btn btn-ghost" onClick={onClose}>
            ביטול
          </button>
        </>
      }
    >
      <div className="col gap-16">
        <div className="info-box">{item.body}</div>
        <Field label="שם המשימה" required>
          <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="לדוגמה: סגירת מדריכים עד יום שלישי" data-autofocus />
        </Field>
        <Field label="אחראי" required>
          <UserPicker value={owners} onChange={setOwners} allowAll={isCommander} all={all} onAll={setAll} />
        </Field>
        <Field label="דד-ליין" required>
          <DateTimeInputs date={date} time={time} onDate={setDate} onTime={setTime} />
        </Field>
        <Field label="עדיפות">
          <Seg value={priority} onChange={setPriority} options={PRIORITIES.map((p) => ({ value: p, label: PRIORITY_LABELS[p] }))} />
        </Field>
        <ErrorBox error={error} />
      </div>
    </Modal>
  );
}

function ItemToRecurring({ item, onClose, onDone }: { item: DebriefItem; onClose: () => void; onDone: (d: DebriefDetail) => void }) {
  const { users } = useSession();
  const toast = useToast();
  const [title, setTitle] = useState(item.body.length <= 80 ? item.body : '');
  const [frequency, setFrequency] = useState<'daily' | 'weekly'>('weekly');
  const [weekdays, setWeekdays] = useState<number[]>([0]);
  const [time, setTime] = useState('10:00');
  const [assignee, setAssignee] = useState('week_lead');
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    setError(null);
    try {
      const d = await api.post<DebriefDetail>(`/api/debrief-items/${item.id}/recurring`, { title, frequency, weekdays, time, assignee });
      onDone(d);
      toast({ title: 'נוצרה משימה חוזרת', tone: 'green' });
      emitLocalChange('recurring', 'debriefs', 'tasks');
      onClose();
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <Modal
      title="משימה חוזרת בעקבות לקח"
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-primary" disabled={!title.trim()} onClick={() => void save()}>
            צור משימה חוזרת
          </button>
          <button className="btn btn-ghost" onClick={onClose}>
            ביטול
          </button>
        </>
      }
    >
      <div className="col gap-16">
        <div className="info-box">{item.body}</div>
        <Field label="שם המשימה" required>
          <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} data-autofocus />
        </Field>
        <Seg value={frequency} onChange={setFrequency} options={[{ value: 'daily', label: 'כל יום' }, { value: 'weekly', label: 'בימים מסוימים' }]} />
        {frequency === 'weekly' && (
          <div className="chips">
            {WEEKDAY_NAMES.map((n, i) => (
              <button key={n} className={`chip${weekdays.includes(i) ? ' on' : ''}`} onClick={() => setWeekdays(weekdays.includes(i) ? weekdays.filter((x) => x !== i) : [...weekdays, i])}>
                {n}
              </button>
            ))}
          </div>
        )}
        <div className="form-grid">
          <Field label="שעה">
            <input className="input" type="time" value={time} onChange={(e) => setTime(e.target.value)} />
          </Field>
          <Field label="אחראי">
            <select className="select" value={assignee} onChange={(e) => setAssignee(e.target.value)}>
              <option value="week_lead">מפק"צ השבוע</option>
              <option value="all">כל הסגל</option>
              {users.map((u) => (
                <option key={u.id} value={String(u.id)}>
                  {u.displayName}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <ErrorBox error={error} />
      </div>
    </Modal>
  );
}

function ItemToTemplate({ item, onClose, onDone }: { item: DebriefItem; onClose: () => void; onDone: (d: DebriefDetail) => void }) {
  const toast = useToast();
  const { data } = useApi<Template[]>('/api/templates', ['templates']);
  const [templateId, setTemplateId] = useState<string>('');
  const [title, setTitle] = useState(item.body.length <= 80 ? item.body : '');
  const [offset, setOffset] = useState(-2);
  const [error, setError] = useState<string | null>(null);
  const list = data ?? [];
  const chosen = templateId || (list.find((t) => t.kind === 'activity') ?? list[0])?.id?.toString() || '';
  const save = async () => {
    setError(null);
    try {
      const d = await api.post<DebriefDetail>(`/api/debrief-items/${item.id}/template`, { templateId: Number(chosen), title, offsetDays: offset });
      onDone(d);
      toast({ title: 'הלקח נוסף לתבנית', body: 'מעכשיו הוא ייפתח אוטומטית בכל הפעלה של התבנית', tone: 'green' });
      emitLocalChange('templates', 'debriefs');
      onClose();
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const tpl = list.find((t) => String(t.id) === chosen);
  return (
    <Modal
      title="הוספת הלקח כשלב קבוע בתבנית"
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-primary" disabled={!title.trim() || !chosen} onClick={() => void save()}>
            הוסף לתבנית
          </button>
          <button className="btn btn-ghost" onClick={onClose}>
            ביטול
          </button>
        </>
      }
    >
      <div className="col gap-16">
        <div className="info-box">
          לדוגמה: "שיחת תיאום עם מדריך - 48 שעות לפני כל פעילות". כל פעם שהתבנית מופעלת על פעילות או שבוע, המשימה תיפתח בזמן היחסי שתבחרו.
        </div>
        {!list.length ? (
          <p className="small muted">
            אין תבניות. צרו תבנית במסך <Link to="/templates">תבניות</Link>.
          </p>
        ) : (
          <>
            <Field label="תבנית">
              <select className="select" value={chosen} onChange={(e) => setTemplateId(e.target.value)}>
                {list.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name} ({t.kind === 'activity' ? 'פעילות' : t.kind === 'week' ? 'שבוע' : 'כללית'})
                  </option>
                ))}
              </select>
            </Field>
            <Field label="שם השלב">
              <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} data-autofocus />
            </Field>
            <Field label={`מתי? (ימים ביחס ל${tpl?.kind === 'activity' ? 'פעילות' : 'תחילת השבוע'})`} hint={offset < 0 ? `${-offset} ימים לפני` : offset === 0 ? 'באותו יום' : `${offset} ימים אחרי`}>
              <input className="input" type="number" value={offset} min={-60} max={60} onChange={(e) => setOffset(Number(e.target.value))} style={{ maxWidth: 120 }} />
            </Field>
          </>
        )}
        <ErrorBox error={error} />
      </div>
    </Modal>
  );
}
