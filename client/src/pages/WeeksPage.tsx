// Sections 13-14, 37-38, 53-56, 70, 76: the course weeks.

import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { CARRY_ACTION_LABELS, LESSON_KIND_LABELS, LESSON_KINDS, WEEK_STATUS_LABELS, type CarryAction, type LessonKind } from '@shared/constants';
import { addDays, diffDays, shortDate, weekdayName, weekdayOf } from '@shared/dates';
import type { CarryDecision, CloseCheck, PreviousCycleWeek, Task, Template, Week, WeekDetail } from '@shared/types';
import { KindBadge, PriorLessons } from '../components/DebriefBits';
import { CalendarWeeksModal } from '../components/GoogleCalendar';
import { Icon } from '../components/Icon';
import { DateTimeInputs, UserPicker, useNewTask } from '../components/NewTask';
import { BulkCheck, bulkClick, BulkScope, BulkToggle, useBulk } from '../components/Bulk';
import { GroupTitle, TaskBulkScope, TaskList } from '../components/TaskRow';
import { useToast } from '../components/Toasts';
import { Bar, DateInput, Empty, ErrorBox, Field, Loading, Modal, openable, PageError, PageHead, Ring, Seg, Select } from '../components/ui';
import { api, changedFields } from '../lib/api';
import { dateKeyOf, fmtDeadline, fmtTime, isoAt, todayKey } from '../lib/format';
import { emitLocalChange } from '../lib/realtime';
import { useSession } from '../lib/session';
import { prefetch, useApi } from '../lib/useApi';

export function WeeksPage() {
  const { weeks, isCommander, staff } = useSession();
  const { data, loading } = useApi<Week[]>('/api/weeks', ['weeks', 'tasks']);
  const list = data ?? weeks;
  const [creating, setCreating] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [fromCalendar, setFromCalendar] = useState(false);
  const today = todayKey();

  return (
    <BulkScope
      entity="weeks"
      noun="שבועות"
      topics={['weeks', 'tasks']}
      ids={list.map((w) => w.id)}
      actions={[
        { key: 'lead', label: 'מפק"צ אחראי', icon: 'users', ask: { title: 'מפק"צ אחראי לשבועות', label: 'מפק"צ', options: [{ value: '', label: 'ללא מפק"צ' }, ...staff.map((u) => ({ value: String(u.id), label: u.displayName }))] } },
        { key: 'delete', label: 'מחיקה', icon: 'trash', danger: true, confirm: 'למחוק {n} שבועות? המשימות שלהם יישארו, בלי שיוך לשבוע.' },
      ]}
    >
    <div className="page">
      <PageHead
        title="שבועות הקורס"
        sub="ציר הזמן של הקורס: מפק״צ מוביל, משימות ואחוז מוכנות לכל שבוע."
        actions={
          <>
            <Link to="/tracks" className="btn btn-ghost">
              <Icon name="route" /> צירים בקורס
            </Link>
            {isCommander && (
            <>
              <BulkToggle />
              <button className="btn" onClick={() => setFromCalendar(true)}>
                <Icon name="calendar" /> מיומן Google
              </button>
              <button className="btn" onClick={() => setGenerating(true)}>
                <Icon name="layers" /> יצירת שבועות
              </button>
              <button className="btn btn-primary" onClick={() => setCreating(true)}>
                <Icon name="plus" /> שבוע
              </button>
            </>
            )}
          </>
        }
      />
      {loading && !list.length ? (
        <Loading rows={3} />
      ) : !list.length ? (
        <Empty icon="layers" title="עדיין אין שבועות" text={isCommander ? 'צרו את רשימת שבועות הקורס - שם, נושא ומפק"צ אחראי לכל שבוע.' : 'מפקד הקורס עדיין לא הגדיר שבועות.'} />
      ) : (
        <WeekCards list={list} today={today} />
      )}
      {creating && <WeekForm onClose={() => setCreating(false)} />}
      {generating && <GenerateWeeks onClose={() => setGenerating(false)} />}
      {fromCalendar && <CalendarWeeksModal onClose={() => setFromCalendar(false)} />}
    </div>
    </BulkScope>
  );
}

function WeekCards({ list, today }: { list: Week[]; today: string }) {
  const navigate = useNavigate();
  const bulk = useBulk();
  return (
        <div className="weeks-track fade-in">
          {list.map((w) => {
            const current = w.startDate <= today && w.endDate >= today;
            const until = diffDays(w.startDate, today);
            return (
              <div
                key={w.id}
                className={`card week-card${current ? ' current' : ''}${bulk?.selected.has(w.id) ? ' selected' : ''}`}
                {...openable(bulkClick(bulk, w.id, () => navigate(`/weeks/${w.id}`)))}
                onPointerEnter={() => prefetch(`/api/weeks/${w.id}`)}
                onFocus={() => prefetch(`/api/weeks/${w.id}`)}
              >
                <span className="week-num">{w.number}</span>
                <BulkCheck id={w.id} />
                <div style={{ position: 'relative' }}>
                  <div className="row gap-6 wrap">
                    {current && <span className="badge t-orange">השבוע</span>}
                    <span className={`badge${w.status === 'closed' ? ' t-green' : w.status === 'open' ? ' t-blue' : ''}`}>{WEEK_STATUS_LABELS[w.status]}</span>
                    {w.approvedAt && <span className="badge t-green">אושר</span>}
                  </div>
                  <div className="strong mt-8" style={{ fontSize: 19 }}>
                    {w.name}
                  </div>
                  {w.topic && <div className="small muted">{w.topic}</div>}
                  <div className="tiny muted mt-8">
                    <span className="mono">
                      {shortDate(w.startDate)}-{shortDate(w.endDate)}
                    </span>
                    {until > 0 && until <= 21 && ` · בעוד ${until} ימים`}
                  </div>
                </div>
                <div className="row">
                  <div className="grow">
                    <div className="small">{w.leadName ? `מפק"צ: ${w.leadName}` : <span className="text-orange">ללא מפק"צ אחראי</span>}</div>
                    <div className="tiny muted">
                      {w.doneTasks}/{w.totalTasks} משימות{w.overdueTasks > 0 && <span className="text-red strong"> · {w.overdueTasks} באיחור</span>}
                    </div>
                  </div>
                  <Ring value={w.readiness} size={64} tone={w.totalTasks === 0 ? 'gray' : undefined} />
                </div>
              </div>
            );
          })}
        </div>
  );
}

export function WeekForm({ week, onClose }: { week?: Week; onClose: () => void }) {
  const { staff, isCommander, weeks } = useSession();
  const toast = useToast();
  const last = weeks[weeks.length - 1];
  const defaultStart = week?.startDate ?? (last ? addDays(last.endDate, 1) : todayKey());
  const [name, setName] = useState(week?.name ?? `שבוע ${(last?.number ?? 0) + 1}`);
  const [topic, setTopic] = useState(week?.topic ?? '');
  const [goals, setGoals] = useState(week?.goals ?? '');
  const [start, setStart] = useState(defaultStart);
  const [end, setEnd] = useState(week?.endDate ?? addDays(defaultStart, 6));
  const [lead, setLead] = useState<number[]>(week?.leadId ? [week.leadId] : []);
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    setError(null);
    try {
      const body = isCommander ? { name, topic, goals, startDate: start, endDate: end, leadId: lead[0] ?? null } : { topic, goals };
      if (week) {
        const patch = changedFields<Record<string, unknown>>({ ...week }, body);
        if (Object.keys(patch).length) await api.patch(`/api/weeks/${week.id}`, patch);
      } else await api.post('/api/weeks', body);
      toast({ title: 'השבוע נשמר', tone: 'green' });
      emitLocalChange('weeks');
      onClose();
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <Modal
      title={week ? `עריכת ${week.name}` : 'שבוע חדש'}
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-primary" onClick={() => void save()}>
            שמור
          </button>
          <button className="btn btn-ghost" onClick={onClose}>
            ביטול
          </button>
        </>
      }
    >
      <div className="form-grid">
        {isCommander && (
          <>
            <Field label="שם השבוע" required className="span-2">
              <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="לדוגמה: שבוע התקפה" />
            </Field>
            <Field label="תאריך התחלה" required>
              <DateInput
                value={start}
                onChange={(v) => {
                  setStart(v);
                  if (v) setEnd(addDays(v, 6));
                }}
              />
            </Field>
            <Field label="תאריך סיום" required>
              <DateInput value={end} onChange={(v) => setEnd(v)} />
            </Field>
            <Field label='מפק"צ אחראי' className="span-2">
              <UserPicker value={lead} onChange={setLead} multiple={false} />
            </Field>
          </>
        )}
        <Field label="נושא" className="span-2">
          <input className="input" value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="לדוגמה: התקפה - מחלקה בהתקפה" />
        </Field>
        <Field label="מטרות השבוע" className="span-2">
          <textarea className="textarea" value={goals} onChange={(e) => setGoals(e.target.value)} />
        </Field>
      </div>
      {!staff.length && isCommander && <p className="tiny muted mt-8">טיפ: הוסיפו אנשי סגל במסך ההגדרות כדי לשייך מפק"צ אחראי.</p>}
      <div className="mt-12">
        <ErrorBox error={error} />
      </div>
    </Modal>
  );
}

export function GenerateWeeks({ onClose }: { onClose: () => void }) {
  const { staff, weeks } = useSession();
  const toast = useToast();
  const last = weeks[weeks.length - 1];
  const base = last ? addDays(last.endDate, 1) : addDays(todayKey(), (7 - weekdayOf(todayKey())) % 7);
  const [start, setStart] = useState(base);
  const [rows, setRows] = useState<{ name: string; lead: number | null }[]>(
    ['קליטה', 'יסודות', 'התקפה', 'הגנה', 'ניווט', 'תרגיל', 'סיכום'].map((n) => ({ name: `שבוע ${n}`, lead: null })),
  );
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    setError(null);
    try {
      await api.post('/api/weeks/generate', { startDate: start, count: rows.length, names: rows.map((r) => r.name), leadIds: rows.map((r) => r.lead) });
      toast({ title: `נוצרו ${rows.length} שבועות`, tone: 'green' });
      emitLocalChange('weeks');
      onClose();
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <Modal
      title="יצירת שבועות הקורס"
      onClose={onClose}
      wide
      footer={
        <>
          <button className="btn btn-primary" onClick={() => void save()} disabled={!rows.length}>
            צור {rows.length} שבועות
          </button>
          <button className="btn btn-ghost" onClick={onClose}>
            ביטול
          </button>
        </>
      }
    >
      <div className="col gap-16">
        <Field label="תאריך תחילת השבוע הראשון" hint={`${weekdayName(start || todayKey())} · כל שבוע נמשך 7 ימים`}>
          <DateInput value={start} onChange={(v) => setStart(v)} style={{ maxWidth: 220 }} />
        </Field>
        <div className="col gap-6">
          {rows.map((r, i) => (
            <div key={i} className="row wrap">
              <span className="mono small muted" style={{ width: 90 }}>
                {start && `${shortDate(addDays(start, i * 7))}-${shortDate(addDays(start, i * 7 + 6))}`}
              </span>
              <input className="input grow" value={r.name} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} style={{ minWidth: 160 }} />
              <Select
                className="select"
                style={{ width: 170 }}
                value={r.lead ?? ''}
                onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, lead: e.target.value ? Number(e.target.value) : null } : x)))}
                aria-label='מפק"צ אחראי'
              >
                <option value="">מפק"צ אחראי...</option>
                {staff.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.displayName}
                  </option>
                ))}
              </Select>
              <button className="icon-btn" aria-label="הסר" onClick={() => setRows(rows.filter((_, j) => j !== i))}>
                <Icon name="x" size={16} />
              </button>
            </div>
          ))}
          <button className="btn btn-sm" style={{ alignSelf: 'flex-start' }} onClick={() => setRows([...rows, { name: `שבוע ${rows.length + 1}`, lead: null }])}>
            <Icon name="plus" /> שבוע נוסף
          </button>
        </div>
        <ErrorBox error={error} />
      </div>
    </Modal>
  );
}

// ---------------- week page ----------------

type Dialog = null | 'edit' | 'open' | 'close';

/** what was done in this week in the previous course - and repeating it, at the same point of the week */
function PreviousCycle({ week: w, canCopy }: { week: Week; canCopy: boolean }) {
  const { viewing } = useSession();
  const { data } = useApi<PreviousCycleWeek | null>(viewing ? null : `/api/weeks/${w.id}/previous-cycle`, ['tasks', 'weeks']);
  const [picked, setPicked] = useState<Set<number> | null>(null);
  const [busy, setBusy] = useState(false);
  const [all, setAll] = useState(false);
  const toast = useToast();
  if (!data?.week || !data.tasks.length) return null;
  const FOLD = 8;
  const shown = all ? data.tasks : data.tasks.slice(0, FOLD);
  const open = data.tasks.filter((t) => !t.exists);
  const chosen = picked ?? new Set(open.map((t) => t.id));
  const toggle = (id: number) => {
    const next = new Set(chosen);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setPicked(next);
  };
  const when = (offset: number, time: string) => {
    const day = addDays(w.startDate, offset);
    return `${weekdayName(day)} ${shortDate(day)} ${time}`;
  };
  const copy = async () => {
    setBusy(true);
    try {
      const r = await api.post<{ created: number; skipped: number }>(`/api/weeks/${w.id}/previous-cycle/copy`, { archiveId: data.archiveId, taskIds: [...chosen] });
      toast({ title: r.created === 1 ? 'נפתחה משימה אחת בשבוע הזה' : `נפתחו ${r.created} משימות בשבוע הזה`, tone: 'green' });
      setPicked(null);
      emitLocalChange('tasks');
    } catch (e) {
      toast({ title: (e as Error).message, tone: 'red' });
    } finally {
      setBusy(false);
    }
  };
  const Row = canCopy ? 'label' : 'div';
  return (
    <div className="card">
      <div className="card-head">
        <Icon name="history" />
        <h3 className="grow">במחזור הקודם</h3>
        <span className="mono tiny muted">{data.tasks.length}</span>
      </div>
      <p className="card-body small muted prev-intro">
        המשימות של {data.week.name} ב{data.archiveName}, באותו מועד בשבוע הזה.
      </p>
      {shown.map((t) => (
        <Row key={t.id} className={`prev-task${t.exists ? ' done' : ''}`}>
          {canCopy && <input type="checkbox" disabled={t.exists} checked={!t.exists && chosen.has(t.id)} onChange={() => toggle(t.id)} />}
          <span className="grow">
            <span className="small strong">{t.title}</span>
            <span className="tiny muted prev-meta">
              {when(t.dayOffset, t.time)}
              {t.people > 1 ? ` · עותק לכל אחד (${t.people})` : t.assigneeName && ` · ${t.assigneeName}`}
              {t.ownerName && t.assigneeName && t.ownerName !== t.assigneeName && ` (במקום ${t.ownerName})`}
              {t.exists && ' · כבר בשבוע הזה'}
            </span>
          </span>
        </Row>
      ))}
      {data.tasks.length > FOLD && (
        <button type="button" className="btn btn-ghost btn-sm prev-more" onClick={() => setAll(!all)} aria-expanded={all}>
          {all ? 'פחות' : `הצגת כל ${data.tasks.length}`}
        </button>
      )}
      {canCopy && open.length > 0 && (
        <div className="card-body">
          <button className="btn btn-sm" onClick={() => void copy()} disabled={busy || !chosen.size}>
            <Icon name="plus" /> {busy ? 'פותח...' : `פתיחה בשבוע הזה (${chosen.size})`}
          </button>
        </div>
      )}
    </div>
  );
}

export function WeekPage() {
  const { id } = useParams();
  const { data, error, loading, status } = useApi<WeekDetail>(`/api/weeks/${id}`, ['weeks', 'tasks', 'events']);
  const { isCommander, user } = useSession();
  const newTask = useNewTask();
  const toast = useToast();
  const [dialog, setDialog] = useState<Dialog>(null);
  const [groupBy, setGroupBy] = useState<'domain' | 'status' | 'owner'>('domain');

  if (loading && !data)
    return (
      <div className="page">
        <Loading rows={4} />
      </div>
    );
  if (!data)
    return (
      <div className="page">
        <PageError error={error} status={status} what="השבוע" back="/weeks" backLabel="לשבועות הקורס" />
      </div>
    );
  const w = data.week;
  const canManage = isCommander || w.leadId === user.id;
  const today = todayKey();
  const until = diffDays(w.startDate, today);

  const approve = async () => {
    try {
      await api.post(`/api/weeks/${w.id}/approve`);
      toast({ title: `${w.name} אושר`, tone: 'green' });
      emitLocalChange('weeks');
    } catch (e) {
      toast({ title: (e as Error).message, tone: 'red' });
    }
  };

  return (
    <TaskBulkScope tasks={data.tasks}>
    <div className="page">
      <PageHead
        eyebrow={
          <Link to="/weeks" className="muted">
            שבועות הקורס · שבוע {w.number}
          </Link>
        }
        title={w.name}
        sub={
          <>
            <span className="mono">
              {shortDate(w.startDate)}-{shortDate(w.endDate)}
            </span>
            {' · '}
            {w.leadName ? `מפק"צ אחראי: ${w.leadName}` : 'ללא מפק"צ אחראי'}
            {' · '}
            {WEEK_STATUS_LABELS[w.status]}
            {w.approvedAt && ` · אושר ע"י ${w.approvedByName}`}
          </>
        }
        actions={
          <>
            <BulkToggle />
            {canManage && w.status !== 'closed' && (
              <button className="btn" onClick={() => setDialog('open')}>
                <Icon name="template" /> פתיחת שבוע
              </button>
            )}
            {isCommander && w.status !== 'closed' && (
              <button className="btn" onClick={() => void approve()}>
                <Icon name="check" /> {w.approvedAt ? 'אשר מחדש' : 'אשר שבוע'}
              </button>
            )}
            {canManage && w.status !== 'closed' && (
              <button className="btn" onClick={() => setDialog('close')}>
                <Icon name="lock" /> סגור שבוע
              </button>
            )}
            {canManage && (
              <button className="btn btn-ghost" onClick={() => setDialog('edit')}>
                <Icon name="edit" /> עריכה
              </button>
            )}
            <Link to={`/weekly/${w.id}`} className="btn btn-ghost">
              <Icon name="weekly" /> שבועי
            </Link>
            <Link to={`/weeks/${w.id}/order`} className="btn btn-ghost">
              <Icon name="file" /> פקודת שבוע
            </Link>
            <button className="btn btn-primary" onClick={() => newTask({ weekId: w.id, deadline: isoAt(w.startDate < today ? today : addDays(w.startDate, -1), '18:00') })}>
              <Icon name="plus" /> משימה לשבוע
            </button>
          </>
        }
      />

      <div className="grid-3 fade-in">
        <div className="card card-pad row">
          <Ring value={w.readiness} size={104} tone={w.totalTasks === 0 ? 'gray' : undefined} />
          <div>
            <div className="label-caps">מוכנות</div>
            <div className="strong" style={{ fontSize: 18 }}>
              {w.doneTasks} מתוך {w.totalTasks} הושלמו
            </div>
            {w.overdueTasks > 0 && <div className="small text-red strong">{w.overdueTasks} באיחור</div>}
            <div className="tiny muted">{until > 0 ? `מתחיל בעוד ${until} ימים` : w.endDate >= today ? 'השבוע מתקיים עכשיו' : 'השבוע הסתיים'}</div>
          </div>
        </div>
        <div className="card card-pad grid-span-2">
          <div className="label-caps mb-12">מוכנות לפי תחום</div>
          {data.byDomain.length === 0 ? (
            <p className="small muted">אין עדיין משימות לשבוע. השתמשו ב"פתיחת שבוע" כדי לפתוח את רשימת התיוג הקבועה.</p>
          ) : (
            <div className="col gap-6">
              {data.byDomain.map((d) => (
                <div key={d.domain} className="row small">
                  <span style={{ width: 110 }} className="strong">
                    {d.domain}
                  </span>
                  <div className="grow">
                    <Bar value={d.readiness} label={`מוכנות ${d.domain}`} />
                  </div>
                  <span className="mono" style={{ width: 90, textAlign: 'left' }}>
                    {d.readiness}% · {d.done}/{d.total}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="split mt-16">
        <div>
          <div className="row wrap">
            <div className="section-title grow" style={{ margin: '6px 0' }}>
              <h2>משימות השבוע</h2>
              <span className="count-pill">{data.tasks.length}</span>
            </div>
            <Seg
              value={groupBy}
              onChange={setGroupBy}
              options={[
                { value: 'domain', label: 'לפי תחום' },
                { value: 'status', label: 'לפי מצב' },
                { value: 'owner', label: 'לפי אחראי' },
              ]}
            />
          </div>
          <GroupedTasks tasks={data.tasks} by={groupBy} />
        </div>
        <div className="col gap-16 sticky-side">
          <LeadWorkflow week={w} />
          <PriorLessons title="לקחים מהמחזור הקודם לשבוע הזה" context={{ weekId: w.id, canDecide: isCommander || w.leadId === user.id, owner: w.leadId, due: addDays(w.startDate, -2) }} />
          <PreviousCycle week={w} canCopy={canManage} />
          {(w.topic || w.goals) && (
            <div className="card card-pad">
              <div className="label-caps">נושא ומטרות</div>
              {w.topic && <div className="strong mt-8">{w.topic}</div>}
              {w.goals && <p className="small mt-8" style={{ whiteSpace: 'pre-wrap' }}>{w.goals}</p>}
            </div>
          )}
          <div className="card">
            <div className="card-head">
              <h3 className="grow">אירועים מרכזיים</h3>
              <Link to={`/schedule?date=${w.startDate}&view=week`} className="btn btn-ghost btn-sm">
                ללו"ז
              </Link>
            </div>
            {data.events.length === 0 && <div className="card-body small muted">אין אירועים בלו"ז לשבוע זה.</div>}
            {data.events
              .filter((e) => !e.cancelled)
              .slice(0, 12)
              .map((e) => (
                <Link key={e.id} to={`/schedule?date=${e.date}&event=${e.id}`} className="health">
                  <span className="mono tiny" style={{ width: 74 }}>
                    {weekdayName(e.date)} {e.startTime}
                  </span>
                  <span className="grow small">{e.title}</span>
                  {e.taskTotal > 0 && (
                    <span className="tiny mono muted">
                      {e.taskDone}/{e.taskTotal}
                    </span>
                  )}
                </Link>
              ))}
          </div>
          <div className="card">
            <div className="card-head">
              <Icon name="lightbulb" />
              <h3 className="grow">תחקירים</h3>
              <Link to="/debriefs?new=1" className="btn btn-ghost btn-sm">
                <Icon name="plus" /> תחקיר
              </Link>
            </div>
            {/* the weekly debrief: one per week, about this week and the same week next cycle */}
            {!data.debriefs.some((d) => d.kind === 'weekly') && (
              <div className="card-body">
                <Link to={`/debriefs?new=weekly&week=${w.id}`} className="btn btn-sm">
                  <Icon name="calendar" /> פתיחת תחקיר שבועי
                </Link>
                <div className="tiny muted mt-8">מה הושג, מה לשמר ומה לשפר - ולקחים עם אחראי, להמשך המחזור ולשבוע הזה במחזור הבא.</div>
              </div>
            )}
            {data.debriefs.length === 0 && <div className="card-body small muted">לא נפתחו תחקירים בשבוע זה.</div>}
            {[...data.debriefs].sort((a, b) => Number(b.kind === 'weekly') - Number(a.kind === 'weekly')).map((d) => (
              <Link key={d.id} to={`/debriefs/${d.id}`} className="health">
                <span className="grow small strong">{d.title}</span>
                <KindBadge kind={d.kind} />
                <span className="tiny muted">{d.itemCounts.lesson === 1 ? 'לקח אחד' : `${d.itemCounts.lesson} לקחים`}</span>
                {d.kind !== 'general' && <span className={`badge ${d.status === 'final' ? 't-green' : 't-yellow'}`}>{d.status === 'final' ? 'סוכם' : 'טיוטה'}</span>}
                {d.openTasks > 0 && <span className="badge t-orange">{d.openTasks}</span>}
              </Link>
            ))}
          </div>
          {data.experiences.length > 0 && (
            <div className="card">
              <div className="card-head">
                <Icon name="target" />
                <h3 className="grow">התנסויות בשבוע</h3>
                <span className="mono tiny muted">{data.experiences.length}</span>
              </div>
              {data.experiences.map((x) => (
                <Link key={x.id} to={`/cadets/${x.cadetId}`} className="health">
                  <span className="grow small">
                    <b>{x.cadetName}</b> · {x.role}
                  </span>
                  <span className="tiny muted">{x.mentorName ?? ''}</span>
                  {x.status === 'done' ? <span className="badge t-green">הושלמה</span> : <span className="badge">{shortDate(x.startDate)}</span>}
                </Link>
              ))}
            </div>
          )}
          <Lessons detail={data} />
        </div>
      </div>

      {dialog === 'edit' && <WeekForm week={w} onClose={() => setDialog(null)} />}
      {dialog === 'open' && <OpenWeek detail={data} onClose={() => setDialog(null)} />}
      {dialog === 'close' && <CloseWeek detail={data} onClose={() => setDialog(null)} />}
    </div>
    </TaskBulkScope>
  );
}

function GroupedTasks({ tasks, by }: { tasks: Task[]; by: 'domain' | 'status' | 'owner' }) {
  const groups = useMemo(() => {
    const map = new Map<string, Task[]>();
    for (const t of tasks) {
      const key = by === 'domain' ? t.domain || 'ללא תחום' : by === 'owner' ? t.ownerName : t.status === 'done' ? 'הושלמו' : t.overdue ? 'באיחור' : t.status === 'waiting' ? 'ממתינות' : 'פתוחות';
      map.set(key, [...(map.get(key) ?? []), t]);
    }
    return [...map.entries()];
  }, [tasks, by]);
  if (!tasks.length) return <Empty title="אין משימות" text='התחילו ב"פתיחת שבוע" או הוסיפו משימה.' />;
  return (
    <>
      {groups.map(([k, list]) => (
        <div key={k}>
          <GroupTitle title={k} count={list.length} tone={list.every((t) => t.status === 'done') ? 'green' : list.some((t) => t.overdue) ? 'red' : undefined} />
          <TaskList tasks={list} />
        </div>
      ))}
    </>
  );
}

// Section 70 - the week lead's timeline, highlighting where we are now.
function LeadWorkflow({ week }: { week: Week }) {
  const today = todayKey();
  const until = diffDays(week.startDate, today);
  const phases = [
    { key: 'two', label: 'שבועיים לפני', items: ['קבלת אחריות', 'לקחי המחזור הקודם', 'פתיחת תבנית השבוע', 'בניית משימות', 'תיאומים ראשוניים'], active: until <= 14 && until > 7 },
    { key: 'one', label: 'שבוע לפני', items: ['סגירת לו"ז', 'סגירת מדריכים', 'סגירת שטחים', 'וידוא לוגיסטיקה'], active: until <= 7 && until > 2 },
    { key: '48', label: '48 שעות לפני', items: ['וידוא אחרון', 'טיפול בפערים', 'תדרוך הסגל'], active: until <= 2 && until > 0 },
    { key: 'during', label: 'בזמן השבוע', items: ['ניהול ביצוע', 'עדכון חריגות', 'טיפול בשינויים'], active: until <= 0 && week.endDate >= today },
    { key: 'end', label: 'בסוף השבוע', items: ['סגירת משימות', 'תחקיר שבועי', 'לקחים להמשך ולמחזור הבא', 'העברת משימות המשך'], active: diffDays(week.endDate, today) <= 1 && week.endDate >= today },
  ];
  return (
    <div className="card">
      <div className="card-head">
        <h3>מסלול מפק"צ השבוע</h3>
      </div>
      <div className="card-body">
        <div className="timeline">
          {phases.map((p) => (
            <div key={p.key} className="tl-item" style={p.active ? { fontWeight: 600 } : undefined}>
              <div className="row gap-6">
                {p.label}
                {p.active && <span className="badge t-orange">עכשיו</span>}
              </div>
              <div className="tiny muted">{p.items.join(' · ')}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function OpenWeek({ detail, onClose }: { detail: WeekDetail; onClose: () => void }) {
  const toast = useToast();
  const { userName } = useSession();
  const templates = detail.checklistTemplates;
  const [tplId, setTplId] = useState<number | null>(templates[0]?.id ?? null);
  const tpl: Template | undefined = templates.find((t) => t.id === tplId);
  const [selected, setSelected] = useState<Set<number>>(() => new Set(tpl?.items.map((_, i) => i) ?? []));
  const [owners, setOwners] = useState<Record<string, number>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const w = detail.week;
  const existing = new Set(detail.tasks.map((t) => t.title));
  const applied = tplId !== null && detail.appliedTemplateIds.includes(tplId);

  const pickTemplate = (id: number) => {
    setTplId(id);
    const t = templates.find((x) => x.id === id);
    setSelected(new Set((t?.items ?? []).map((_, i) => i).filter((i) => !existing.has(t!.items[i].title))));
    setOwners({});
  };

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await api.post<{ ids: number[] }>(`/api/weeks/${w.id}/open`, tpl ? { templateId: tpl.id, itemIndexes: [...selected], owners } : {});
      toast({ title: res.ids.length ? `נפתחו ${res.ids.length} משימות ל${w.name}` : `${w.name} נפתח`, tone: 'green' });
      emitLocalChange('tasks', 'weeks');
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const ownerLabel = (spec?: string) => (spec === 'week_lead' ? (w.leadName ?? 'מפק"צ השבוע') : spec && /^\d+$/.test(spec) ? userName(Number(spec)) : (w.leadName ?? 'מפק"צ השבוע'));

  return (
    <Modal
      title={`פתיחת שבוע - ${w.name}`}
      onClose={onClose}
      wide
      footer={
        <>
          <button className="btn btn-primary" onClick={() => void submit()} disabled={busy}>
            {tpl && selected.size ? `פתח ${selected.size} משימות` : 'סמן את השבוע כפתוח'}
          </button>
          <button className="btn btn-ghost" onClick={onClose}>
            ביטול
          </button>
        </>
      }
    >
      <div className="col gap-16">
        <div className="info-box">רשימת התיוג הקבועה לפתיחת שבוע. כל סעיף מסומן יהפוך למשימה עם אחראי ודד-ליין (יחסית לתחילת השבוע).</div>
        {templates.length === 0 ? (
          <p className="small muted">
            אין תבניות פתיחת שבוע. ניתן ליצור במסך <Link to="/templates">תבניות</Link>.
          </p>
        ) : (
          <>
            {templates.length > 1 && (
              <div className="chips">
                {templates.map((t) => (
                  <button key={t.id} className={`chip${t.id === tplId ? ' on' : ''}`} onClick={() => pickTemplate(t.id)}>
                    {t.name}
                  </button>
                ))}
              </div>
            )}
            {applied && <div className="info-box">תבנית זו כבר הופעלה על השבוע. סעיפים שכבר קיימים כמשימות אינם מסומנים.</div>}
            <div className="col gap-6">
              {tpl?.items.map((it, i) => {
                const deadlineDate = addDays(w.startDate, it.offsetDays);
                return (
                  <div key={i} className="row wrap" style={{ padding: '8px 10px', border: '1px solid var(--line)', borderRadius: 8, background: selected.has(i) ? 'var(--card)' : 'transparent' }}>
                    <label className="check grow">
                      <input
                        type="checkbox"
                        checked={selected.has(i)}
                        onChange={(e) => {
                          const n = new Set(selected);
                          if (e.target.checked) n.add(i);
                          else n.delete(i);
                          setSelected(n);
                        }}
                      />
                      <span>
                        <b>{it.title}</b>
                        {existing.has(it.title) && <span className="badge t-green" style={{ marginInlineStart: 6 }}>קיימת</span>}
                        <span className="tiny muted mono">
                          {' '}
                          · {weekdayName(deadlineDate)} {shortDate(deadlineDate)} {it.time || ''}
                        </span>
                      </span>
                    </label>
                    <Select
                      className="select"
                      style={{ width: 170, height: 32, fontSize: 13 }}
                      value={owners[String(i)] ?? ''}
                      onChange={(e) => {
                        const next = { ...owners };
                        if (e.target.value) next[String(i)] = Number(e.target.value);
                        else delete next[String(i)];
                        setOwners(next);
                      }}
                      aria-label="אחראי"
                    >
                      <option value="">{ownerLabel(it.owner)}</option>
                      <OwnerOptions />
                    </Select>
                  </div>
                );
              })}
            </div>
          </>
        )}
        <ErrorBox error={error} />
      </div>
    </Modal>
  );
}

function OwnerOptions() {
  const { users } = useSession();
  return (
    <>
      {users.map((u) => (
        <option key={u.id} value={u.id}>
          {u.displayName}
        </option>
      ))}
    </>
  );
}

function CloseWeek({ detail, onClose }: { detail: WeekDetail; onClose: () => void }) {
  const w = detail.week;
  const toast = useToast();
  const { data: check, error: checkError } = useApi<CloseCheck>(`/api/weeks/${w.id}/close-check`, ['tasks', 'weeks']);
  const [decisions, setDecisions] = useState<Record<number, CarryDecision>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const unfinished = check ? [...check.overdue, ...check.open] : [];
  const decisionFor = (t: Task): CarryDecision => decisions[t.id] ?? { taskId: t.id, action: check?.nextWeek ? 'move' : 'keep' };
  // the date shown for "move" is the date sent - a week after the deadline, or after today if already late
  const defaultMoveDate = (t: Task) => addDays(dateKeyOf(t.deadline) < todayKey() ? todayKey() : dateKeyOf(t.deadline), 7);
  const moveDeadline = (t: Task, d: CarryDecision) => d.newDeadline ?? isoAt(defaultMoveDate(t), fmtTime(t.deadline));
  const update = (t: Task, patch: Partial<CarryDecision>) => setDecisions({ ...decisions, [t.id]: { ...decisionFor(t), ...patch } });

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const list = unfinished.map((t) => {
        const d = decisionFor(t);
        return d.action === 'move' ? { ...d, newDeadline: moveDeadline(t, d) } : d;
      });
      if (list.some((d) => d.action === 'cancel' && !(d.reason ?? '').trim())) throw new Error('יש לכתוב סיבת ביטול לכל משימה שמבוטלת');
      await api.post(`/api/weeks/${w.id}/close`, { decisions: list });
      toast({ title: `${w.name} נסגר`, tone: 'green' });
      emitLocalChange('tasks', 'weeks');
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const checks = check
    ? [
        { ok: check.overdue.length === 0, text: check.overdue.length ? `${check.overdue.length} משימות באיחור` : 'אין משימות באיחור' },
        { ok: check.open.length === 0, text: check.open.length ? `${check.open.length} משימות פתוחות` : 'אין משימות פתוחות' },
        { ok: check.blocked.length === 0, text: check.blocked.length ? `${check.blocked.length} חסמים פתוחים` : 'אין חסמים' },
        { ok: check.lessonsCount > 0, text: check.lessonsCount ? check.lessonsCount === 1 ? 'הוזן לקח אחד' : `הוזנו ${check.lessonsCount} לקחים` : 'עדיין לא הוזנו לקחים' },
        { ok: !!check.nextWeek, text: check.nextWeek ? `משימות להמשך יועברו ל${check.nextWeek.name}` : 'אין שבוע הבא מוגדר' },
      ]
    : [];

  return (
    <Modal
      title={`סגירת ${w.name}`}
      onClose={onClose}
      wide
      footer={
        <>
          <button className="btn btn-primary" onClick={() => void submit()} disabled={busy || !check}>
            <Icon name="lock" /> סגור שבוע
          </button>
          <button className="btn btn-ghost" onClick={onClose}>
            ביטול
          </button>
        </>
      }
    >
      <ErrorBox error={checkError} />
      {!check ? (
        <Loading rows={2} />
      ) : (
        <div className="col gap-16">
          <div className="col gap-4">
            <div className="label-caps">בדיקות לפני סגירה</div>
            {checks.map((c) => (
              <div key={c.text} className="row small">
                <span className={`dot t-${c.ok ? 'green' : 'orange'}`} /> {c.text}
              </div>
            ))}
          </div>
          {unfinished.length > 0 && (
            <div className="col gap-6">
              <div className="label-caps">מה עושים עם כל משימה שלא הסתיימה?</div>
              {unfinished.map((t) => {
                const d = decisionFor(t);
                return (
                  <div key={t.id} className="card card-pad" style={{ padding: 12 }}>
                    <div className="row wrap">
                      <div className="grow">
                        <div className="strong">{t.title}</div>
                        <div className="tiny muted">
                          {t.ownerName} · <span className={t.overdue ? 'text-red' : ''}>{fmtDeadline(t.deadline)}</span>
                        </div>
                      </div>
                      <Seg
                        value={d.action}
                        onChange={(v: CarryAction) => update(t, { action: v })}
                        options={(['keep', 'move', 'cancel'] as CarryAction[]).filter((a) => a !== 'move' || check.nextWeek).map((a) => ({ value: a, label: CARRY_ACTION_LABELS[a] }))}
                      />
                    </div>
                    {d.action === 'move' && (
                      <div className="row mt-8 wrap">
                        <span className="small muted">דד-ליין חדש:</span>
                        <div style={{ width: 280 }}>
                          <DateTimeInputs
                            date={dateKeyOf(moveDeadline(t, d))}
                            time={fmtTime(moveDeadline(t, d))}
                            onDate={(v) => v && update(t, { newDeadline: isoAt(v, fmtTime(moveDeadline(t, d))) })}
                            onTime={(v) => v && update(t, { newDeadline: isoAt(dateKeyOf(moveDeadline(t, d)), v) })}
                          />
                        </div>
                      </div>
                    )}
                    {d.action === 'cancel' && (
                      <input className="input mt-8" placeholder="סיבת ביטול" value={d.reason ?? ''} onChange={(e) => update(t, { reason: e.target.value })} />
                    )}
                  </div>
                );
              })}
            </div>
          )}
          {check.lessonsCount === 0 && <div className="info-box">מומלץ להזין לקחים לפני הסגירה (בצד ימין של עמוד השבוע): מה עבד טוב, מה לא, מה לשנות.</div>}
          <ErrorBox error={error} />
        </div>
      )}
    </Modal>
  );
}

function Lessons({ detail }: { detail: WeekDetail }) {
  const { isCommander, user, staff, users } = useSession();
  const toast = useToast();
  const w = detail.week;
  const canAssign = isCommander || w.leadId === user.id;
  const [kind, setKind] = useState<LessonKind>('change');
  const [body, setBody] = useState('');
  const [withTask, setWithTask] = useState(false);
  const [taskTitle, setTaskTitle] = useState('');
  const [owner, setOwner] = useState<number[]>([detail.nextWeek?.id && staff[0] ? staff[0].id : user.id]);
  const next = detail.nextWeek;
  const [date, setDate] = useState(next ? addDays(next.startDate, 2) : addDays(todayKey(), 7));
  const [time, setTime] = useState('18:00');
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setError(null);
    try {
      await api.post(`/api/weeks/${w.id}/lessons`, {
        kind,
        body: body.trim(),
        task: withTask ? { title: taskTitle.trim() || body.trim(), ownerId: canAssign ? owner[0] : user.id, deadline: isoAt(date, time) } : undefined,
      });
      toast({ title: withTask ? 'הלקח נשמר ונפתחה משימה' : 'הלקח נשמר', tone: 'green' });
      setBody('');
      setTaskTitle('');
      setWithTask(false);
      emitLocalChange('weeks', 'tasks');
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <div className="card">
      <div className="card-head">
        <Icon name="lightbulb" />
        <h3 className="grow">לקחים</h3>
        <span className="mono tiny muted">{detail.lessons.length}</span>
      </div>
      <div className="card-body col gap-6">
        {LESSON_KINDS.map((k) => {
          const list = detail.lessons.filter((l) => l.kind === k);
          if (!list.length) return null;
          return (
            <div key={k}>
              <div className="label-caps mt-8">{LESSON_KIND_LABELS[k]}</div>
              {list.map((l) => (
                <div key={l.id} className="small" style={{ padding: '6px 0', borderBottom: '1px dashed var(--line)' }}>
                  {l.body}
                  <div className="tiny muted">
                    {l.createdByName}
                    {l.taskId && (
                      <>
                        {' · משימה: '}
                        <Link to={`/tasks/${l.taskId}`}>{l.taskTitle}</Link>
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
          );
        })}
        <div className="divider" />
        <Seg value={kind} onChange={setKind} options={LESSON_KINDS.map((k) => ({ value: k, label: LESSON_KIND_LABELS[k] }))} />
        <textarea className="textarea" placeholder="לדוגמה: יש לסגור מדריכים מוקדם יותר" value={body} onChange={(e) => setBody(e.target.value)} style={{ minHeight: 60 }} />
        <label className="check small">
          <input type="checkbox" checked={withTask} onChange={(e) => setWithTask(e.target.checked)} />
          צור משימה בעקבות הלקח{next ? ` (ל${next.name})` : ''}
        </label>
        {withTask && (
          <div className="col gap-6">
            <input className="input" placeholder="שם המשימה (לדוגמה: סגירת מדריכים עד יום שלישי)" value={taskTitle} onChange={(e) => setTaskTitle(e.target.value)} />
            {canAssign ? (
              <Select className="select" value={owner[0]} onChange={(e) => setOwner([Number(e.target.value)])} aria-label="אחראי">
                {users.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.displayName}
                  </option>
                ))}
              </Select>
            ) : (
              <div className="tiny muted">המשימה תיפתח עליך</div>
            )}
            <DateTimeInputs date={date} time={time} onDate={setDate} onTime={setTime} />
          </div>
        )}
        <button className="btn btn-sm" style={{ alignSelf: 'flex-start' }} disabled={body.trim().length < 2} onClick={() => void submit()}>
          הוסף לקח
        </button>
        <ErrorBox error={error} />
      </div>
    </div>
  );
}

