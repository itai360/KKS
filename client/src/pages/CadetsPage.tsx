// Section 31 - cadets: list by team, profile with notes, personal talks,
// discipline, evaluations, development tracking and experiences.

import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import {
  CADET_STATUS_LABELS,
  CADET_STATUSES,
  DISCIPLINE_SEVERITIES,
  EVALUATION_CRITERIA,
  RECORD_KIND_LABELS,
  RECORD_KINDS,
  RESTRICTED_RECORD_KINDS,
  TALK_TYPES,
  type CadetStatus,
  type RecordKind,
} from '@shared/constants';
import { shortDate } from '@shared/dates';
import type { Cadet, CadetDetail, CadetRecord, Team } from '@shared/types';
import { Icon } from '../components/Icon';
import { DateTimeInputs, useNewTask } from '../components/NewTask';
import { TaskList } from '../components/TaskRow';
import { useToast } from '../components/Toasts';
import { Empty, ErrorBox, Field, Loading, Modal, PageHead, Seg, initials } from '../components/ui';
import { api, qs } from '../lib/api';
import { fmtAgo, isoAt, todayKey } from '../lib/format';
import { emitLocalChange } from '../lib/realtime';
import { useSession } from '../lib/session';
import { useApi } from '../lib/useApi';
import { ExperienceCard, ExperienceForm } from './ExperiencesPage';

export function CadetsPage() {
  const { isCommander, user } = useSession();
  const [params, setParams] = useSearchParams();
  const team = params.get('team') ?? '';
  const status = params.get('status') ?? 'active';
  const [q, setQ] = useState('');
  const teams = useApi<Team[]>('/api/teams', ['cadets']);
  const cadets = useApi<Cadet[]>(`/api/cadets${qs({ team, status })}`, ['cadets']);
  const [dialog, setDialog] = useState<null | 'cadet' | 'import' | 'teams'>(null);
  const navigate = useNavigate();
  const myTeams = (teams.data ?? []).filter((t) => t.commanderId === user.id);
  const canAdd = isCommander || myTeams.length > 0;

  const shown = (cadets.data ?? []).filter((c) => !q || [c.fullName, c.personalNumber].some((f) => f.includes(q)));
  const grouped = useMemo(() => {
    const map = new Map<string, Cadet[]>();
    for (const c of shown) map.set(c.teamName ?? 'ללא צוות', [...(map.get(c.teamName ?? 'ללא צוות') ?? []), c]);
    return [...map.entries()];
  }, [shown]);

  const set = (k: string, v: string) => {
    const next = new URLSearchParams(params);
    if (v) next.set(k, v);
    else next.delete(k);
    setParams(next, { replace: true });
  };

  return (
    <div className="page">
      <PageHead
        title="צוערים"
        sub="רשימת צוערים לפי צוותים, הערות, שיחות אישיות, משמעת, הערכות ומעקב התפתחות."
        actions={
          <>
            {isCommander && (
              <>
                <button className="btn" onClick={() => setDialog('teams')}>
                  <Icon name="users" /> צוותים
                </button>
                <button className="btn" onClick={() => setDialog('import')}>
                  <Icon name="upload" /> ייבוא רשימה
                </button>
              </>
            )}
            {canAdd && (
              <button className="btn btn-primary" onClick={() => setDialog('cadet')}>
                <Icon name="plus" /> צוער
              </button>
            )}
          </>
        }
      />
      <div className="chips chips-scroll mb-12">
        <button className={`chip${!team ? ' on' : ''}`} onClick={() => set('team', '')}>
          כל הצוותים
        </button>
        {(teams.data ?? []).map((t) => (
          <button key={t.id} className={`chip${team === String(t.id) ? ' on' : ''}`} onClick={() => set('team', String(t.id))}>
            {t.name} <span className="mono tiny">{t.cadetCount}</span>
          </button>
        ))}
      </div>
      <div className="filters">
        <input className="input" placeholder="חיפוש לפי שם או מספר אישי" value={q} onChange={(e) => setQ(e.target.value)} />
        <select className="select" value={status} onChange={(e) => set('status', e.target.value === 'active' ? '' : e.target.value)} aria-label="סטטוס">
          {CADET_STATUSES.map((s) => (
            <option key={s} value={s}>
              {CADET_STATUS_LABELS[s]}
            </option>
          ))}
          <option value="all">הכל</option>
        </select>
      </div>
      <ErrorBox error={cadets.error} />
      {cadets.loading && !cadets.data ? (
        <Loading rows={4} />
      ) : !shown.length ? (
        <Empty icon="users" title="אין צוערים" text={isCommander ? 'הוסיפו צוערים אחד-אחד או הדביקו רשימה מאקסל בעזרת "ייבוא רשימה".' : undefined} />
      ) : (
        grouped.map(([teamName, list]) => {
          const t = (teams.data ?? []).find((x) => x.name === teamName);
          return (
            <section key={teamName} className="mb-12">
              <div className="group-title">
                <span>{teamName}</span>
                {t?.commanderName && <span className="tiny muted">מפקד הצוות: {t.commanderName}</span>}
                <span className="n">{list.length}</span>
                <span className="line" />
              </div>
              <div className="card">
                {list.map((c) => (
                  <div key={c.id} className="health" onClick={() => navigate(`/cadets/${c.id}`)} role="link" tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && navigate(`/cadets/${c.id}`)}>
                    <div className="avatar">{initials(c.fullName)}</div>
                    <div className="grow">
                      <div className="strong">{c.fullName}</div>
                      <div className="tiny muted">
                        {c.personalNumber && <span className="mono">{c.personalNumber} · </span>}
                        {c.recordCount ? (
                          <>
                            {c.recordCount} רישומים<span className="hide-mobile"> · עודכן {fmtAgo(c.lastRecordAt!)}</span>
                          </>
                        ) : (
                          'אין רישומים עדיין'
                        )}
                      </div>
                    </div>
                    {c.status !== 'active' && <span className="badge">{CADET_STATUS_LABELS[c.status]}</span>}
                    {c.disciplineCount > 0 && <span className="badge t-orange">{c.disciplineCount} משמעת</span>}
                    {c.talkCount > 0 && <span className="badge t-blue">{c.talkCount} שיחות</span>}
                    {c.avgScore !== null && (
                      <span className="mono strong" title="ממוצע הערכות (1-5)">
                        {c.avgScore.toFixed(1)}
                      </span>
                    )}
                    <Icon name="chevronLeft" size={16} className="faint" />
                  </div>
                ))}
              </div>
            </section>
          );
        })
      )}
      {dialog === 'cadet' && <CadetForm teams={isCommander ? (teams.data ?? []) : myTeams} defaultTeam={team ? Number(team) : undefined} onClose={() => setDialog(null)} />}
      {dialog === 'import' && <ImportCadets teams={teams.data ?? []} onClose={() => setDialog(null)} />}
      {dialog === 'teams' && <TeamsDialog teams={teams.data ?? []} onClose={() => setDialog(null)} />}
    </div>
  );
}

function CadetForm({ cadet, teams, defaultTeam, onClose }: { cadet?: Cadet; teams: Team[]; defaultTeam?: number; onClose: () => void }) {
  const toast = useToast();
  const navigate = useNavigate();
  const { isCommander } = useSession();
  const [firstName, setFirstName] = useState(cadet?.firstName ?? '');
  const [lastName, setLastName] = useState(cadet?.lastName ?? '');
  const [personalNumber, setPersonalNumber] = useState(cadet?.personalNumber ?? '');
  const [phone, setPhone] = useState(cadet?.phone ?? '');
  const [teamId, setTeamId] = useState<string>(String(cadet?.teamId ?? defaultTeam ?? teams[0]?.id ?? ''));
  const [status, setStatus] = useState<CadetStatus>(cadet?.status ?? 'active');
  const [notes, setNotes] = useState(cadet?.notes ?? '');
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    setError(null);
    const body = { firstName, lastName, personalNumber, phone, notes, status, ...(isCommander || !cadet ? { teamId: teamId ? Number(teamId) : null } : {}) };
    try {
      if (cadet) await api.patch(`/api/cadets/${cadet.id}`, body);
      else {
        const d = await api.post<CadetDetail>('/api/cadets', body);
        navigate(`/cadets/${d.cadet.id}`);
      }
      toast({ title: 'הצוער נשמר', tone: 'green' });
      emitLocalChange('cadets');
      onClose();
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <Modal
      title={cadet ? `עריכת ${cadet.fullName}` : 'צוער חדש'}
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-primary" onClick={() => void save()} disabled={!firstName.trim()}>
            שמור
          </button>
          <button className="btn btn-ghost" onClick={onClose}>
            ביטול
          </button>
        </>
      }
    >
      <div className="form-grid">
        <Field label="שם פרטי" required>
          <input className="input" value={firstName} onChange={(e) => setFirstName(e.target.value)} />
        </Field>
        <Field label="שם משפחה">
          <input className="input" value={lastName} onChange={(e) => setLastName(e.target.value)} />
        </Field>
        <Field label="מספר אישי">
          <input className="input" dir="ltr" value={personalNumber} onChange={(e) => setPersonalNumber(e.target.value)} />
        </Field>
        <Field label="טלפון">
          <input className="input" dir="ltr" value={phone} onChange={(e) => setPhone(e.target.value)} />
        </Field>
        <Field label="צוות">
          <select className="select" value={teamId} onChange={(e) => setTeamId(e.target.value)} disabled={!!cadet && !isCommander}>
            {isCommander && <option value="">ללא צוות</option>}
            {teams.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </Field>
        {cadet && (
          <Field label="סטטוס">
            <select className="select" value={status} onChange={(e) => setStatus(e.target.value as CadetStatus)}>
              {CADET_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {CADET_STATUS_LABELS[s]}
                </option>
              ))}
            </select>
          </Field>
        )}
        <Field label="הערות כלליות (גלויות למפקד הצוות ולמפקד הקורס)" className="span-2">
          <textarea className="textarea" value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
      </div>
      <div className="mt-12">
        <ErrorBox error={error} />
      </div>
    </Modal>
  );
}

function ImportCadets({ teams, onClose }: { teams: Team[]; onClose: () => void }) {
  const toast = useToast();
  const [text, setText] = useState('');
  const [teamId, setTeamId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const lines = text.split('\n').filter((l) => l.trim()).length;
  const submit = async () => {
    setError(null);
    try {
      const r = await api.post<{ imported: number; skipped: number }>('/api/cadets/import', { text, teamId: teamId ? Number(teamId) : null });
      toast({ title: `יובאו ${r.imported} צוערים${r.skipped ? ` (${r.skipped} כבר היו ברשימה ודולגו)` : ''}`, tone: 'green' });
      emitLocalChange('cadets');
      onClose();
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <Modal
      title="ייבוא רשימת צוערים"
      onClose={onClose}
      wide
      footer={
        <>
          <button className="btn btn-primary" onClick={() => void submit()} disabled={!lines}>
            ייבא {lines || ''} שורות
          </button>
          <button className="btn btn-ghost" onClick={onClose}>
            ביטול
          </button>
        </>
      }
    >
      <div className="col gap-16">
        <div className="info-box">
          הדביקו רשימה מאקסל או כתבו שורה לכל צוער: <b>שם מלא, מספר אישי, טלפון, צוות</b>. רק השם חובה. אפשר להדביק גם עם שורת כותרות (למשל "שם פרטי", "שם משפחה", "מספר אישי", "צוות") - העמודות יזוהו לפי הכותרות. צוותים שלא קיימים ייווצרו אוטומטית, וצוער שהמספר האישי שלו כבר ברשימה לא ייווסף שוב.
        </div>
        <Field label="שיוך כל הרשימה לצוות (לא חובה)">
          <select className="select" value={teamId} onChange={(e) => setTeamId(e.target.value)} style={{ maxWidth: 260 }}>
            <option value="">לפי עמודת הצוות ברשימה</option>
            {teams.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </Field>
        <textarea className="textarea" style={{ minHeight: 220, fontFamily: 'var(--mono)' }} value={text} onChange={(e) => setText(e.target.value)} placeholder={'דניאל כהן, 8123456, 050-1234567, צוות 1\nמאיה לוי, 8123457, , צוות 2'} data-autofocus />
        <ErrorBox error={error} />
      </div>
    </Modal>
  );
}

function TeamsDialog({ teams, onClose }: { teams: Team[]; onClose: () => void }) {
  const { staff } = useSession();
  const toast = useToast();
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const run = async (fn: () => Promise<unknown>) => {
    setError(null);
    try {
      await fn();
      emitLocalChange('cadets');
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <Modal title="צוותים ומפקדי צוות" onClose={onClose}>
      <div className="col gap-6">
        {teams.map((t) => (
          <div key={t.id} className="row wrap">
            <input
              className="input grow"
              defaultValue={t.name}
              onBlur={(e) => e.target.value.trim() && e.target.value !== t.name && void run(() => api.put(`/api/teams/${t.id}`, { name: e.target.value.trim(), commanderId: t.commanderId }))}
              aria-label="שם הצוות"
            />
            <select
              className="select"
              style={{ width: 180 }}
              value={t.commanderId ?? ''}
              onChange={(e) => void run(() => api.put(`/api/teams/${t.id}`, { name: t.name, commanderId: e.target.value ? Number(e.target.value) : null }))}
              aria-label="מפקד הצוות"
            >
              <option value="">מפקד צוות...</option>
              {staff.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.displayName}
                </option>
              ))}
            </select>
            <span className="tiny muted mono">{t.cadetCount}</span>
            <button
              className="icon-btn"
              aria-label="מחיקת צוות"
              onClick={() => confirm(`למחוק את ${t.name}? הצוערים יישארו ללא צוות.`) && void run(() => api.del(`/api/teams/${t.id}`))}
            >
              <Icon name="trash" size={16} />
            </button>
          </div>
        ))}
        <form
          className="row mt-12"
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim()) void run(() => api.post('/api/teams', { name: name.trim() })).then(() => {
              setName('');
              toast({ title: 'הצוות נוסף', tone: 'green' });
            });
          }}
        >
          <input className="input grow" value={name} onChange={(e) => setName(e.target.value)} placeholder="צוות חדש" />
          <button className="btn" disabled={!name.trim()}>
            <Icon name="plus" /> הוסף
          </button>
        </form>
        <p className="tiny muted">מפקד הצוות רואה ומנהל את הצוערים בצוות שלו, כולל שיחות אישיות ומשמעת.</p>
        <ErrorBox error={error} />
      </div>
    </Modal>
  );
}

// ---------------- profile ----------------

export function CadetPage() {
  const { id } = useParams();
  const { data, error, loading } = useApi<CadetDetail>(`/api/cadets/${id}`, ['cadets', 'tasks']);
  const teams = useApi<Team[]>('/api/teams', ['cadets']);
  const { isCommander, user } = useSession();
  const newTask = useNewTask();
  const [kind, setKind] = useState<RecordKind | 'all'>('all');
  const [dialog, setDialog] = useState<null | 'edit' | 'experience'>(null);
  const navigate = useNavigate();

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
  const c = data.cadet;
  const records = data.records.filter((r) => kind === 'all' || r.kind === kind);

  return (
    <div className="page">
      <PageHead
        eyebrow={
          <Link to={`/cadets${c.teamId ? `?team=${c.teamId}` : ''}`} className="muted">
            צוערים · {c.teamName ?? 'ללא צוות'}
          </Link>
        }
        title={c.fullName}
        sub={[c.personalNumber && `מ.א. ${c.personalNumber}`, c.phone, CADET_STATUS_LABELS[c.status]].filter(Boolean).join(' · ')}
        actions={
          <>
            {c.canManage && (
              <button className="btn" onClick={() => setDialog('edit')}>
                <Icon name="edit" /> עריכה
              </button>
            )}
            {c.canManage && (
              <button className="btn" onClick={() => setDialog('experience')}>
                <Icon name="target" /> שיבוץ להתנסות
              </button>
            )}
            <button className="btn btn-primary" onClick={() => newTask({ heading: `משימה בנושא ${c.fullName}`, ownerIds: [user.id], domain: 'צוערים', description: `בנושא הצוער ${c.fullName}` })}>
              <Icon name="plus" /> משימה
            </button>
          </>
        }
      />
      <div className="split">
        <div className="col gap-16">
          <RecordForm cadet={c} />
          <div>
            <div className="row wrap mb-12">
              <div className="section-title grow" style={{ margin: 0 }}>
                <h2 style={{ whiteSpace: 'nowrap' }}>תיק הצוער</h2>
                <span className="count-pill">{data.records.length}</span>
              </div>
              <div className="chips">
                <button className={`chip chip-sm${kind === 'all' ? ' on' : ''}`} onClick={() => setKind('all')}>
                  הכל
                </button>
                {RECORD_KINDS.filter((k) => data.records.some((r) => r.kind === k)).map((k) => (
                  <button key={k} className={`chip chip-sm${kind === k ? ' on' : ''}`} onClick={() => setKind(k)}>
                    {RECORD_KIND_LABELS[k]}
                  </button>
                ))}
              </div>
            </div>
            {records.length === 0 ? <Empty icon="file" title="אין רישומים" text="הערות, שיחות אישיות, משמעת והערכות יופיעו כאן לפי תאריך." /> : <Records records={records} />}
          </div>
        </div>
        <div className="col gap-16 sticky-side">
          <Development detail={data} />
          {c.notes && (
            <div className="card card-pad">
              <div className="label-caps">הערות כלליות</div>
              <p className="small mt-8" style={{ whiteSpace: 'pre-wrap' }}>
                {c.notes}
              </p>
            </div>
          )}
          <div className="card">
            <div className="card-head">
              <Icon name="target" />
              <h3 className="grow">התנסויות</h3>
              <span className="mono tiny muted">{data.experiences.length}</span>
            </div>
            <div className="card-body col gap-6">
              {data.experiences.length === 0 ? <p className="small muted">לא שובץ להתנסויות.</p> : data.experiences.map((x) => <ExperienceCard key={x.id} x={x} compact />)}
            </div>
          </div>
          <div className="card">
            <div className="card-head">
              <h3 className="grow">משימות בנושא הצוער</h3>
            </div>
            <div className="card-body">
              <TaskList tasks={data.tasks} empty={<p className="small muted">אין משימות מקושרות.</p>} />
            </div>
          </div>
          {isCommander && (
            <button
              className="btn btn-ghost btn-sm text-red"
              style={{ alignSelf: 'flex-start' }}
              onClick={() => {
                if (confirm(`למחוק את ${c.fullName} וכל התיק שלו? לסיום קורס או הדחה עדיף לשנות סטטוס.`)) void api.del(`/api/cadets/${c.id}`).then(() => navigate('/cadets'));
              }}
            >
              <Icon name="trash" /> מחיקת צוער
            </button>
          )}
        </div>
      </div>
      {dialog === 'edit' && <CadetForm cadet={c} teams={teams.data ?? []} onClose={() => setDialog(null)} />}
      {dialog === 'experience' && <ExperienceForm cadetId={c.id} onClose={() => setDialog(null)} />}
    </div>
  );
}

const KIND_TONE: Record<RecordKind, string> = { note: 'gray', talk: 'blue', discipline: 'orange', evaluation: 'green' };

function RecordForm({ cadet }: { cadet: Cadet }) {
  const toast = useToast();
  const { user, users, settings } = useSession();
  const kinds = RECORD_KINDS.filter((k) => cadet.canManage || !RESTRICTED_RECORD_KINDS.includes(k));
  const [kind, setKind] = useState<RecordKind>('note');
  const [category, setCategory] = useState('');
  const [body, setBody] = useState('');
  const [score, setScore] = useState<number | null>(null);
  const [followUp, setFollowUp] = useState('');
  const [priv, setPriv] = useState(false);
  const [date, setDate] = useState(todayKey());
  const [withTask, setWithTask] = useState(false);
  const [taskTitle, setTaskTitle] = useState('');
  const [taskOwner, setTaskOwner] = useState(user.id);
  const [taskDate, setTaskDate] = useState(todayKey());
  const [taskTime, setTaskTime] = useState(settings.defaultDeadlineTime);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const categories = kind === 'evaluation' ? EVALUATION_CRITERIA : kind === 'discipline' ? DISCIPLINE_SEVERITIES : kind === 'talk' ? TALK_TYPES : [];

  const reset = () => {
    setBody('');
    setScore(null);
    setFollowUp('');
    setCategory('');
    setWithTask(false);
    setTaskTitle('');
  };
  const submit = async () => {
    setError(null);
    setBusy(true);
    try {
      await api.post(`/api/cadets/${cadet.id}/records`, {
        kind,
        category,
        body: body.trim(),
        score: kind === 'evaluation' ? score : null,
        followUp,
        private: priv,
        occurredOn: date,
        followUpTask: withTask ? { title: taskTitle.trim() || `המשך: ${cadet.fullName}`, deadline: isoAt(taskDate, taskTime), ownerId: cadet.canManage ? taskOwner : user.id } : undefined,
      });
      toast({ title: `${RECORD_KIND_LABELS[kind]} נשמרה בתיק`, tone: 'green' });
      reset();
      emitLocalChange('cadets', 'tasks');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card card-pad col gap-16">
      <Seg value={kind} onChange={(k) => (setKind(k), setCategory(''))} options={kinds.map((k) => ({ value: k, label: RECORD_KIND_LABELS[k] }))} />
      {categories.length > 0 && (
        <div className="chips">
          {categories.map((x) => (
            <button key={x} type="button" className={`chip chip-sm${category === x ? ' on' : ''}`} onClick={() => setCategory(category === x ? '' : x)}>
              {x}
            </button>
          ))}
        </div>
      )}
      {kind === 'evaluation' && (
        <Field label="ציון" required>
          <div className="chips">
            {[1, 2, 3, 4, 5].map((n) => (
              <button key={n} type="button" className={`chip${score === n ? ' on' : ''}`} onClick={() => setScore(n)} style={{ minWidth: 44, justifyContent: 'center' }}>
                {n}
              </button>
            ))}
            <span className="tiny muted" style={{ alignSelf: 'center' }}>
              1 - חלש · 5 - מצוין
            </span>
          </div>
        </Field>
      )}
      <textarea
        className="textarea"
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder={kind === 'talk' ? 'עיקרי השיחה...' : kind === 'discipline' ? 'מה קרה ומה הצעד שננקט...' : kind === 'evaluation' ? 'על מה מבוססת ההערכה...' : 'הערה...'}
        style={{ minHeight: 80 }}
      />
      {kind === 'talk' && <input className="input" value={followUp} onChange={(e) => setFollowUp(e.target.value)} placeholder="על מה סוכם / צעדי המשך" />}
      <div className="row wrap">
        <label className="field" style={{ width: 170 }}>
          <span>תאריך</span>
          <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
        {!RESTRICTED_RECORD_KINDS.includes(kind) && (
          <label className="check small">
            <input type="checkbox" checked={priv} onChange={(e) => setPriv(e.target.checked)} />
            פרטי (רק אני, מפקד הצוות ומפקד הקורס)
          </label>
        )}
        <label className="check small">
          <input type="checkbox" checked={withTask} onChange={(e) => setWithTask(e.target.checked)} />
          פתח משימת המשך
        </label>
      </div>
      {RESTRICTED_RECORD_KINDS.includes(kind) && <div className="tiny muted">שיחות אישיות ומשמעת גלויות רק לך, למפקד הצוות ולמפקד הקורס.</div>}
      {withTask && (
        <div className="form-grid">
          <Field label="משימת המשך" className="span-2">
            <input className="input" value={taskTitle} onChange={(e) => setTaskTitle(e.target.value)} placeholder={`לדוגמה: שיחה חוזרת עם ${cadet.firstName}`} />
          </Field>
          {cadet.canManage && (
            <Field label="אחראי">
              <select className="select" value={taskOwner} onChange={(e) => setTaskOwner(Number(e.target.value))}>
                {users.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.displayName}
                  </option>
                ))}
              </select>
            </Field>
          )}
          <Field label="דד-ליין">
            <DateTimeInputs date={taskDate} time={taskTime} onDate={setTaskDate} onTime={setTaskTime} />
          </Field>
        </div>
      )}
      <div className="row">
        <button className="btn btn-primary" disabled={busy || !body.trim() || (kind === 'evaluation' && !score)} onClick={() => void submit()}>
          שמור בתיק
        </button>
        <ErrorBox error={error} />
      </div>
    </div>
  );
}

function Records({ records }: { records: CadetRecord[] }) {
  const toast = useToast();
  return (
    <div className="list">
      {records.map((r) => (
        <div key={r.id} className={`card card-pad t-${KIND_TONE[r.kind]}`} style={{ borderRight: '4px solid var(--tone)', padding: 14 }}>
          <div className="row wrap gap-6">
            <span className={`badge t-${KIND_TONE[r.kind]}`}>{RECORD_KIND_LABELS[r.kind]}</span>
            {r.category && <span className="badge">{r.category}</span>}
            {r.score !== null && <span className="badge t-gray mono">ציון {r.score}/5</span>}
            {r.private && (
              <span className="badge" title="גלוי רק לכותב, למפקד הצוות ולמפקד הקורס">
                <Icon name="lock" size={11} /> פרטי
              </span>
            )}
            <span className="grow" />
            <span className="tiny muted">
              {r.authorName} · <span className="mono">{shortDate(r.occurredOn)}</span>
              {r.weekName && ` · ${r.weekName}`}
            </span>
            {r.canDelete && (
              <button
                className="icon-btn"
                style={{ width: 28, height: 28 }}
                aria-label="מחיקת רישום"
                onClick={() =>
                  confirm('למחוק את הרישום?') &&
                  void api.del(`/api/records/${r.id}`).then(() => {
                    toast({ title: 'הרישום נמחק', tone: 'green' });
                    emitLocalChange('cadets');
                  })
                }
              >
                <Icon name="trash" size={14} />
              </button>
            )}
          </div>
          {r.title && <div className="strong mt-8">{r.title}</div>}
          {r.body && (
            <p className="mt-8" style={{ whiteSpace: 'pre-wrap', fontSize: 14.5 }}>
              {r.body}
            </p>
          )}
          {r.followUp && <p className="small mt-8"><b>סוכם:</b> {r.followUp}</p>}
          {r.taskId && (
            <Link to={`/tasks/${r.taskId}`} className="small mt-8" style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
              <Icon name="tasks" size={14} /> {r.taskTitle}
            </Link>
          )}
        </div>
      ))}
    </div>
  );
}

/**
 * Development tracking: average evaluation score per date (one series, 1-5 scale),
 * plus the average per criterion. The record list below is the table view.
 */
function Development({ detail }: { detail: CadetDetail }) {
  const [hover, setHover] = useState<number | null>(null);
  const points = useMemo(() => {
    const byDate = new Map<string, { sum: number; n: number; criteria: string[] }>();
    for (const s of detail.scores) {
      const e = byDate.get(s.date) ?? { sum: 0, n: 0, criteria: [] };
      e.sum += s.score;
      e.n++;
      e.criteria.push(`${s.criterion} ${s.score}`);
      byDate.set(s.date, e);
    }
    return [...byDate.entries()].map(([date, e]) => ({ date, avg: Math.round((e.sum / e.n) * 10) / 10, criteria: e.criteria }));
  }, [detail.scores]);
  const byCriterion = useMemo(() => {
    const m = new Map<string, number[]>();
    for (const s of detail.scores) m.set(s.criterion, [...(m.get(s.criterion) ?? []), s.score]);
    return [...m.entries()].map(([k, v]) => ({ criterion: k, avg: Math.round((v.reduce((a, b) => a + b, 0) / v.length) * 10) / 10, n: v.length })).sort((a, b) => b.avg - a.avg);
  }, [detail.scores]);

  // right-to-left: the first evaluation sits on the right, like the rest of the page
  const W = 320;
  const H = 150;
  const pad = { l: 22, r: 24, t: 16, b: 24 };
  // points sit inside the grid so the end markers never touch the axis labels
  const inset = 18;
  const plotW = W - pad.l - pad.r - inset * 2;
  const x = (i: number) => (points.length === 1 ? pad.l + inset + plotW / 2 : W - pad.r - inset - (i * plotW) / (points.length - 1));
  const y = (v: number) => pad.t + ((5 - v) * (H - pad.t - pad.b)) / 4;
  const path = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.avg).toFixed(1)}`).join(' ');
  const last = points[points.length - 1];
  const hp = hover !== null ? points[hover] : null;

  return (
    <div className="card">
      <div className="card-head">
        <Icon name="chart" />
        <h3 className="grow">מעקב התפתחות</h3>
        {detail.cadet.avgScore !== null && (
          <span className="tiny muted">
            ממוצע <b className="mono" style={{ color: 'var(--ink)' }}>{detail.cadet.avgScore.toFixed(1)}</b>
          </span>
        )}
      </div>
      <div className="card-body">
        {points.length === 0 ? (
          <p className="small muted">אין עדיין הערכות. הערכות מהתנסויות ומהסגל יופיעו כאן לאורך הקורס.</p>
        ) : (
          <>
            <div className="small muted mb-12">ציון ממוצע לפי תאריך הערכה (1-5)</div>
            <div style={{ position: 'relative' }}>
              <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="ציוני הערכה לאורך הקורס" style={{ display: 'block', overflow: 'visible' }}>
                {[1, 2, 3, 4, 5].map((v) => (
                  <g key={v}>
                    <line x1={pad.l} x2={W - pad.r} y1={y(v)} y2={y(v)} stroke="var(--line)" strokeWidth={1} />
                    <text x={W - pad.r + 8} y={y(v) + 3.5} fontSize={10} fill="var(--muted)" fontFamily="var(--mono)" textAnchor="start">
                      {v}
                    </text>
                  </g>
                ))}
                {points.length > 1 && <path d={path} fill="none" stroke="var(--ink)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />}
                {points.map((p, i) => (
                  <g key={p.date} onPointerEnter={() => setHover(i)} onPointerLeave={() => setHover(null)} onFocus={() => setHover(i)} onBlur={() => setHover(null)} tabIndex={0} aria-label={`${shortDate(p.date)}: ${p.avg}`}>
                    <circle cx={x(i)} cy={y(p.avg)} r={12} fill="transparent" />
                    <circle cx={x(i)} cy={y(p.avg)} r={hover === i ? 6 : 4.5} fill="var(--ink)" stroke="var(--card)" strokeWidth={2} />
                  </g>
                ))}
                {points.map((p, i) =>
                  i === 0 || i === points.length - 1 ? (
                    <text key={`d${p.date}`} x={x(i)} y={H - 6} fontSize={10} fill="var(--muted)" textAnchor="middle" fontFamily="var(--mono)">
                      {shortDate(p.date)}
                    </text>
                  ) : null,
                )}
                {last && hover === null && (
                  <text x={x(points.length - 1)} y={y(last.avg) - 11} fontSize={11} fontWeight={700} fill="var(--ink)" textAnchor="middle" fontFamily="var(--mono)">
                    {last.avg.toFixed(1)}
                  </text>
                )}
              </svg>
              {hp && (
                <div className="chart-tip" style={{ left: `${(x(hover!) / W) * 100}%`, top: `${(y(hp.avg) / H) * 100}%` }}>
                  <b className="mono">{hp.avg.toFixed(1)}</b> · <span className="mono">{shortDate(hp.date)}</span>
                  <div className="tiny muted">{hp.criteria.join(' · ')}</div>
                </div>
              )}
            </div>
            {byCriterion.length > 0 && (
              <div className="col gap-6 mt-16">
                <div className="label-caps">לפי קריטריון</div>
                {byCriterion.map((cr) => (
                  <div key={cr.criterion} className="row small">
                    <span style={{ width: 120 }}>{cr.criterion}</span>
                    <div className="grow bar" style={{ height: 6 }}>
                      <div className="bar-fill" style={{ width: `${(cr.avg / 5) * 100}%`, background: 'var(--ink-2)' }} />
                    </div>
                    <span className="mono" style={{ width: 54, textAlign: 'left' }}>
                      {cr.avg.toFixed(1)} <span className="faint">({cr.n})</span>
                    </span>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
