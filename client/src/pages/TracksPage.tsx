// The course's tracks (צירים בקורס) - its lines of work alongside the weeks: a lead, goals and the
// tasks marked with the track, with readiness by course week (server/src/tracks.ts).

import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { addDays } from '@shared/dates';
import type { Task, Track, TrackDetail } from '@shared/types';
import { BulkToggle } from '../components/Bulk';
import { ask } from '../components/Confirm';
import { Icon } from '../components/Icon';
import { UserPicker, useNewTask } from '../components/NewTask';
import { unlessHeld, useRowMenu } from '../components/RowMenu';
import { GroupTitle, TaskBulkScope, TaskList } from '../components/TaskRow';
import { useToast } from '../components/Toasts';
import { Bar, Empty, ErrorBox, Field, Loading, Modal, openable, PageError, PageHead, Ring, Seg, Select } from '../components/ui';
import { api, changedFields } from '../lib/api';
import { fmtDeadline, isoAt, todayKey } from '../lib/format';
import { emitLocalChange } from '../lib/realtime';
import { useSession } from '../lib/session';
import { useApi } from '../lib/useApi';

export function TracksPage() {
  const { tracks, isCommander } = useSession();
  const { data, loading } = useApi<Track[]>('/api/tracks', ['weeks', 'tasks']);
  const list = data ?? tracks;
  const [creating, setCreating] = useState(false);
  const [leads, setLeads] = useState(false);
  const noLead = list.filter((t) => !t.leadId).length;
  return (
    <div className="page">
      <PageHead
        title="צירים בקורס"
        sub="קווי העבודה של הקורס לצד השבועות: אחראי, משימות ואחוז מוכנות לכל ציר. משימה נכנסת לציר לפי השדה 'ציר בקורס' שלה."
        actions={
          isCommander && (
            <>
              {list.length > 0 && (
                <button className="btn" onClick={() => setLeads(true)}>
                  <Icon name="users" /> קביעת אחראים{noLead > 0 && <span className="count-pill">{noLead}</span>}
                </button>
              )}
              <button className="btn btn-primary" onClick={() => setCreating(true)}>
                <Icon name="plus" /> ציר
              </button>
            </>
          )
        }
      />
      {loading && !list.length ? (
        <Loading rows={3} />
      ) : !list.length ? (
        <Empty icon="route" title="עדיין אין צירים" text={isCommander ? 'הוסיפו את צירי הקורס - שם ואחראי לכל ציר.' : 'מפקד הקורס עדיין לא הגדיר צירים.'} />
      ) : (
        <div className="weeks-track fade-in">
          {list.map((t) => (
            <TrackCard key={t.id} t={t} />
          ))}
        </div>
      )}
      {creating && <TrackForm onClose={() => setCreating(false)} />}
      {leads && <LeadsDialog tracks={list} onClose={() => setLeads(false)} />}
    </div>
  );
}

/** one track: opened with a tap; held or right-clicked, a task for it or its tasks without opening it first */
function TrackCard({ t }: { t: Track }) {
  const navigate = useNavigate();
  const newTask = useNewTask();
  const { viewing } = useSession();
  const today = todayKey();
  const menu = useRowMenu({
    title: `ציר ${t.name}`,
    items: [
      { key: 'open', label: 'פתיחת הציר', icon: 'route', primary: true, run: () => navigate(`/tracks/${t.id}`) },
      ...(viewing ? [] : [{ key: 'task', label: 'משימה לציר', icon: 'plus', run: () => newTask({ trackId: t.id, ownerIds: t.leadId ? [t.leadId] : undefined, deadline: isoAt(addDays(today, 7), '18:00') }) }]),
      { key: 'tasks', label: 'משימות הציר בכל המשימות', icon: 'tasks', run: () => navigate(`/tasks?track=${t.id}&scope=all`) },
      ...(t.overdueTasks ? [{ key: 'late', label: `${t.overdueTasks} באיחור`, icon: 'clock', run: () => navigate(`/tasks?track=${t.id}&scope=overdue`) }] : []),
    ],
  });
  return (
            <div className={`card week-card track-card holdable${menu.lifted ? ' is-lifted' : ''}`} {...openable(unlessHeld(menu, () => navigate(`/tracks/${t.id}`)))} {...menu.bind}>
              <div>
                <div className="strong" style={{ fontSize: 19 }}>
                  {t.name}
                </div>
                <div className="small mt-8">{t.leadName ? `אחראי: ${t.leadName}` : <span className="text-orange">ללא אחראי</span>}</div>
              </div>
              <div className="row">
                <div className="grow">
                  <div className="tiny muted">
                    {t.totalTasks === 0 ? 'אין עדיין משימות' : `${t.doneTasks}/${t.totalTasks} משימות`}
                    {t.overdueTasks > 0 && <span className="text-red strong"> · {t.overdueTasks} באיחור</span>}
                    {t.blockedTasks > 0 && <span className="text-orange"> · {t.blockedTasks} חסומות</span>}
                  </div>
                  {t.nextDeadline && <div className="tiny muted mt-8">הבא: {fmtDeadline(t.nextDeadline)}</div>}
                </div>
                <Ring value={t.readiness} size={64} tone={t.totalTasks === 0 ? 'gray' : undefined} />
              </div>
              {menu.menu}
            </div>
  );
}

/** Every track's lead, set in one place. */
function LeadsDialog({ tracks, onClose }: { tracks: Track[]; onClose: () => void }) {
  const { staff, users } = useSession();
  const toast = useToast();
  const [chosen, setChosen] = useState<Record<number, string>>(() => Object.fromEntries(tracks.map((t) => [t.id, t.leadId ? String(t.leadId) : ''])));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const people = staff.length ? [...users.filter((u) => u.role === 'commander'), ...staff] : users;
  const changes = tracks.filter((t) => (chosen[t.id] || '') !== (t.leadId ? String(t.leadId) : ''));
  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      for (const t of changes) await api.patch(`/api/tracks/${t.id}`, { leadId: chosen[t.id] ? Number(chosen[t.id]) : null });
      emitLocalChange('weeks');
      toast({ title: changes.length === 1 ? 'האחראי נשמר' : `נשמרו ${changes.length} אחראים`, body: 'כל אחראי חדש קיבל הודעה', tone: 'green' });
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title="אחראים על הצירים"
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-primary" disabled={busy || !changes.length} onClick={() => void save()}>
            {changes.length > 1 ? `שמירת ${changes.length} שינויים` : 'שמירה'}
          </button>
          <button className="btn btn-ghost" onClick={onClose}>
            ביטול
          </button>
        </>
      }
    >
      <div className="col gap-6">
        {tracks.map((t) => (
          <div key={t.id} className="row gap-12 track-lead-row">
            <span className="strong grow">{t.name}</span>
            <Select value={chosen[t.id] ?? ''} onChange={(e) => setChosen({ ...chosen, [t.id]: e.target.value })} aria-label={`אחראי על ציר ${t.name}`} style={{ maxWidth: 220 }}>
              <option value="">ללא אחראי</option>
              {people.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.displayName}
                </option>
              ))}
            </Select>
          </div>
        ))}
        <ErrorBox error={error} />
      </div>
    </Modal>
  );
}

function TrackForm({ track, onClose }: { track?: Track; onClose: () => void }) {
  const { isCommander } = useSession();
  const toast = useToast();
  const [name, setName] = useState(track?.name ?? '');
  const [lead, setLead] = useState<number[]>(track?.leadId ? [track.leadId] : []);
  const [goals, setGoals] = useState(track?.goals ?? '');
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    setError(null);
    try {
      const body = isCommander ? { name: name.trim(), leadId: lead[0] ?? null, goals } : { goals };
      if (track) {
        const patch = changedFields<Record<string, unknown>>({ ...track }, body);
        if (Object.keys(patch).length) await api.patch(`/api/tracks/${track.id}`, patch);
      } else await api.post('/api/tracks', body);
      toast({ title: 'הציר נשמר', tone: 'green' });
      emitLocalChange('weeks');
      onClose();
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <Modal
      title={track ? `עריכת ציר ${track.name}` : 'ציר חדש'}
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
            <Field label="שם הציר" required className="span-2">
              <input className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} placeholder="לדוגמה: מסע פתיחה" />
            </Field>
            <Field label="אחראי על הציר" className="span-2">
              <UserPicker value={lead} onChange={setLead} multiple={false} />
            </Field>
          </>
        )}
        <Field label="מטרות הציר" className="span-2">
          <textarea className="textarea" value={goals} onChange={(e) => setGoals(e.target.value)} placeholder="מה הציר צריך להשיג בקורס, ואבני הדרך שלו" />
        </Field>
      </div>
      <div className="mt-12">
        <ErrorBox error={error} />
      </div>
    </Modal>
  );
}

type GroupBy = 'week' | 'status' | 'owner';

export function TrackPage() {
  const { id } = useParams();
  const { data, error, loading, status } = useApi<TrackDetail>(`/api/tracks/${id}`, ['weeks', 'tasks']);
  const { isCommander } = useSession();
  const newTask = useNewTask();
  const toast = useToast();
  const navigate = useNavigate();
  const [editing, setEditing] = useState(false);
  const [groupBy, setGroupBy] = useState<GroupBy>('week');
  // a week picked from the readiness bars: its tasks, grouped by week, come into view and light up
  const [pointed, setPointed] = useState<{ key: string; at: number } | null>(null);
  const showWeek = (name: string) => {
    setGroupBy('week');
    setPointed({ key: name, at: Date.now() });
  };

  if (loading && !data)
    return (
      <div className="page">
        <Loading rows={4} />
      </div>
    );
  if (!data)
    return (
      <div className="page">
        <PageError error={error} status={status} what="הציר" back="/tracks" backLabel="לצירים בקורס" />
      </div>
    );
  const t = data.track;
  const today = todayKey();
  const remove = async () => {
    const ok = await ask({
      title: `למחוק את הציר "${t.name}"?`,
      body: t.totalTasks ? `${t.totalTasks} המשימות שלו יישארו, בלי שיוך לציר.` : undefined,
      confirm: 'מחיקה',
      danger: true,
    });
    if (!ok) return;
    try {
      await api.del(`/api/tracks/${t.id}`);
      emitLocalChange('weeks');
      toast({ title: `הציר "${t.name}" נמחק`, tone: 'green' });
      navigate('/tracks');
    } catch (e) {
      toast({ title: (e as Error).message, tone: 'red' });
    }
  };

  return (
    <TaskBulkScope tasks={data.tasks}>
      <div className="page">
        <PageHead
          eyebrow={
            <Link to="/tracks" className="muted">
              צירים בקורס
            </Link>
          }
          title={`ציר ${t.name}`}
          sub={t.leadName ? `אחראי: ${t.leadName}` : 'ללא אחראי'}
          actions={
            <>
              <BulkToggle />
              {data.canManage && (
                <button className="btn btn-ghost" onClick={() => setEditing(true)}>
                  <Icon name="edit" /> עריכה
                </button>
              )}
              {isCommander && (
                <button className="btn btn-ghost" onClick={() => void remove()}>
                  <Icon name="trash" /> מחיקה
                </button>
              )}
              <Link to={`/tasks?track=${t.id}&scope=all`} className="btn btn-ghost">
                <Icon name="tasks" /> בכל המשימות
              </Link>
              <button className="btn btn-primary" onClick={() => newTask({ trackId: t.id, ownerIds: t.leadId ? [t.leadId] : undefined, deadline: isoAt(addDays(today, 7), '18:00') })}>
                <Icon name="plus" /> משימה לציר
              </button>
            </>
          }
        />

        <div className="grid-3 fade-in">
          <div className="card card-pad row">
            <Ring value={t.readiness} size={104} tone={t.totalTasks === 0 ? 'gray' : undefined} />
            <div>
              <div className="label-caps">מוכנות</div>
              <div className="strong" style={{ fontSize: 18 }}>
                {t.doneTasks} מתוך {t.totalTasks} הושלמו
              </div>
              {t.overdueTasks > 0 && <div className="small text-red strong">{t.overdueTasks} באיחור</div>}
              {t.blockedTasks > 0 && <div className="small text-orange">{t.blockedTasks} חסומות</div>}
              {t.nextDeadline && <div className="tiny muted">הדד-ליין הבא: {fmtDeadline(t.nextDeadline)}</div>}
            </div>
          </div>
          <div className="card card-pad grid-span-2">
            <div className="label-caps mb-12">מוכנות לפי שבוע בקורס</div>
            {data.byWeek.length === 0 ? (
              <p className="small muted">אין עדיין משימות בציר. משימה שתסמנו בה "ציר בקורס: {t.name}" תופיע כאן, מחולקת לפי השבועות.</p>
            ) : (
              <div className="col gap-6">
                {data.byWeek.map((w) => (
                  <button key={w.weekId ?? 'none'} type="button" className="row small track-week-bar" onClick={() => showWeek(w.name)} title={`משימות הציר ב${w.name}`}>
                    <span style={{ width: 130 }} className="strong clip-text">
                      {w.name}
                    </span>
                    <div className="grow">
                      <Bar value={w.readiness} label={`מוכנות ${w.name}`} />
                    </div>
                    <span className="mono" style={{ width: 90, textAlign: 'left' }}>
                      {w.readiness}% · {w.done}/{w.total}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="split mt-16">
          <div>
            <div className="row wrap">
              <div className="section-title grow" style={{ margin: '6px 0' }}>
                <h2>משימות הציר</h2>
                <span className="count-pill">{data.tasks.length}</span>
              </div>
              <Seg
                value={groupBy}
                onChange={setGroupBy}
                options={[
                  { value: 'week', label: 'לפי שבוע' },
                  { value: 'status', label: 'לפי מצב' },
                  { value: 'owner', label: 'לפי אחראי' },
                ]}
              />
            </div>
            <Grouped tasks={data.tasks} by={groupBy} pointed={pointed} />
          </div>
          <div className="col gap-16 sticky-side">
            <div className="card card-pad">
              <div className="label-caps">מטרות הציר</div>
              {t.goals ? (
                <p className="small mt-8" style={{ whiteSpace: 'pre-wrap' }}>
                  {t.goals}
                </p>
              ) : (
                <p className="small muted mt-8">{data.canManage ? 'עוד לא נכתבו מטרות - "עריכה" כדי להוסיף.' : 'עוד לא נכתבו מטרות.'}</p>
              )}
            </div>
            {data.byDomain.length > 0 && (
              <div className="card card-pad">
                <div className="label-caps mb-12">לפי תחום</div>
                <div className="col gap-6">
                  {data.byDomain.map((d) => (
                    <div key={d.domain} className="row small">
                      <span className="grow">{d.domain}</span>
                      <span className="mono">
                        {d.done}/{d.total}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
        {editing && <TrackForm track={t} onClose={() => setEditing(false)} />}
      </div>
    </TaskBulkScope>
  );
}

function Grouped({ tasks, by, pointed }: { tasks: Task[]; by: GroupBy; pointed?: { key: string; at: number } | null }) {
  const groups = useMemo(() => {
    const map = new Map<string, Task[]>();
    for (const t of tasks) {
      const key = by === 'week' ? t.weekName || 'ללא שבוע' : by === 'owner' ? t.ownerName : t.status === 'done' ? 'הושלמו' : t.overdue ? 'באיחור' : t.status === 'waiting' ? 'ממתינות' : 'פתוחות';
      map.set(key, [...(map.get(key) ?? []), t]);
    }
    return [...map.entries()];
  }, [tasks, by]);
  useEffect(() => {
    if (!pointed) return;
    const el = [...document.querySelectorAll<HTMLElement>('.track-group')].find((g) => g.dataset.group === pointed.key);
    if (!el) return;
    el.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
    el.classList.remove('is-pointed');
    void el.offsetWidth;
    el.classList.add('is-pointed');
  }, [pointed]);
  if (!tasks.length) return <Empty icon="route" title="אין משימות בציר" text='"משימה לציר" פותחת משימה שכבר משויכת אליו.' />;
  return (
    <>
      {groups.map(([k, list]) => (
        <div key={k} className="track-group" data-group={k}>
          <GroupTitle title={k} count={list.length} tone={list.every((t) => t.status === 'done') ? 'green' : list.some((t) => t.overdue) ? 'red' : undefined} />
          <TaskList tasks={list} />
        </div>
      ))}
    </>
  );
}
