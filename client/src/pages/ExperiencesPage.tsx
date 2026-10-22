// Section 31 - experiences: role, goals, mentor, tasks, feedback and evaluation.

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router';
import { diffDays, shortDate } from '@shared/dates';
import { BROAD_EXPERIENCES, EXPERIENCE_KIND_LABELS, EXPERIENCE_SPANS, SPAN_LABELS, SPAN_SHORT, spanDates, type ExperienceKind, type ExperienceSpan } from '@shared/experiences';
import { byHe } from '@shared/sort';
import type { Cadet, Experience, Team } from '@shared/types';
import { BulkCheck, BulkScope, BulkToggle, SwipeRow } from '../components/Bulk';
import { DoneDrawer } from '../components/DoneDrawer';
import { FeedbackDialog, FeedbackView, ScoreBadge } from '../components/ExperienceFeedback';
import { Icon } from '../components/Icon';
import { useToast } from '../components/Toasts';
import { DateInput, Empty, ErrorBox, Field, Loading, Modal, PageHead, Seg, Select } from '../components/ui';
import { api } from '../lib/api';
import { dateKeyOf, todayKey } from '../lib/format';
import { haptic } from '../lib/haptics';
import { useLeaving, type LeavePhase } from '../lib/leaving';
import { emitLocalChange } from '../lib/realtime';
import { useSession } from '../lib/session';
import { useApi } from '../lib/useApi';

const PHASE: Record<Experience['phase'], { label: string; tone: string }> = {
  planned: { label: 'מתוכננת', tone: 'gray' },
  active: { label: 'מתבצעת', tone: 'yellow' },
  awaiting_feedback: { label: 'ממתינה למשוב', tone: 'orange' },
  done: { label: 'הושלמה', tone: 'green' },
};
const PHASE_ORDER: Record<Experience['phase'], number> = { awaiting_feedback: 0, active: 1, planned: 2, done: 3 };

type Tab = 'all' | 'mine' | 'broad' | 'awaiting_feedback' | 'active' | 'planned' | 'done';
const inTab = (t: Tab, x: Experience, userId: number) => (t === 'all' ? true : t === 'mine' ? x.mentorId === userId : t === 'broad' ? x.kind === 'broad' : x.phase === t);

type ExpView = 'list' | 'table';
// the view one chose is a convenience: storage can be missing or blocked
function readView(): ExpView {
  try {
    return localStorage.getItem('kks.experiencesView') === 'table' ? 'table' : 'list';
  } catch {
    return 'list';
  }
}
function saveView(v: ExpView): void {
  try {
    localStorage.setItem('kks.experiencesView', v);
  } catch {
    /* not kept */
  }
}

export function ExperiencesPage() {
  const { user } = useSession();
  const { data, error, loading } = useApi<Experience[]>('/api/experiences', ['cadets', 'tasks']);
  const [view, setView] = useState<ExpView>(readView);
  const [tab, setTab] = useState<Tab>('all');
  const [creating, setCreating] = useState(false);
  const cadets = useApi<Cadet[]>('/api/cadets', ['cadets']);
  const canCreate = (cadets.data ?? []).some((c) => c.canEdit);
  // what needs action first: missing feedback, then running, then upcoming - and the done ones (outside their
  // own tab) in a drawer under them; one given its feedback goes there, a moment marked, then folded away
  const list = useMemo(
    () =>
      (data ?? [])
        .filter((x) => inTab(tab, x, user.id))
        .sort((a, b) => PHASE_ORDER[a.phase] - PHASE_ORDER[b.phase] || (a.phase === 'planned' ? a.startDate.localeCompare(b.startDate) : 0)),
    [data, tab, user.id],
  );
  const tucks = tab === 'all' || tab === 'mine' || tab === 'broad';
  const open = useMemo(() => (tucks ? list.filter((x) => x.phase !== 'done') : list), [list, tucks]);
  const done = useMemo(() => (tucks ? list.filter((x) => x.phase === 'done') : []), [list, tucks]);
  const leaving = useLeaving(open, (x) => x.id, (id) => done.find((x) => x.id === id));
  const count = (t: Tab) => (data ?? []).filter((x) => inTab(t, x, user.id)).length;
  // from the feedback task ("?feedback=<id>"): the experience's feedback form opens at once
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const asked = Number(params.get('feedback')) || null;
  const [giving, setGiving] = useState<number | null>(null);
  useEffect(() => {
    if (!asked || !data) return;
    const x = data.find((e) => e.id === asked);
    if (x?.status === 'done') toast({ title: 'המשוב על ההתנסות הזו כבר נמסר' });
    else if (x?.canGiveFeedback) setGiving(x.id);
    setParams(
      (p) => {
        p.delete('feedback');
        return p;
      },
      { replace: true },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [asked, data]);
  const givingX = giving === null ? undefined : data?.find((x) => x.id === giving && x.status !== 'done');

  return (
    <BulkScope entity="experiences" noun="התנסויות" topics={['cadets', 'tasks']} ids={list.filter((x) => x.canEdit).map((x) => x.id)} actions={[{ key: 'delete', label: 'מחיקה', icon: 'trash', danger: true, confirm: 'למחוק {n} התנסויות?' }]}>
    <div className="page">
      <PageHead
        title="התנסויות"
        sub="שיבוץ צוערים לתפקידים, מטרות, מפקד חונך, משוב והערכה. המשוב נכנס אוטומטית לתיק הצוער."
        actions={
          canCreate && (
            <>
              {view === 'list' && <BulkToggle />}
              <button className="btn btn-primary" onClick={() => setCreating(true)}>
                <Icon name="plus" /> התנסות
              </button>
            </>
          )
        }
      />
      <div className="exp-view">
        <Seg<ExpView>
          value={view}
          onChange={(v) => {
            setView(v);
            saveView(v);
          }}
          options={[
            { value: 'list', label: 'רשימה', icon: 'tasks' },
            { value: 'table', label: 'טבלת מעקב', icon: 'board' },
          ]}
        />
      </div>
      {view === 'table' ? (
        loading && !data ? (
          <Loading rows={3} />
        ) : (
          <TrackingTable experiences={data ?? []} />
        )
      ) : (
      <>
      <div className="tabs">
        {(
          [
            ['all', 'הכל'],
            ['mine', 'אני החונך'],
            ['broad', 'התנסויות רוחב'],
            ['awaiting_feedback', 'ממתינות למשוב'],
            ['active', 'מתבצעות'],
            ['planned', 'מתוכננות'],
            ['done', 'הושלמו'],
          ] as [Tab, string][]
        ).map(([k, l]) => (
          <button key={k} className={`tab${tab === k ? ' on' : ''}`} onClick={() => setTab(k)}>
            {l}
            {k !== 'all' && <span className="n">{count(k)}</span>}
          </button>
        ))}
      </div>
      <ErrorBox error={error} />
      {loading && !data ? (
        <Loading rows={3} />
      ) : !list.length ? (
        <Empty icon="target" title="אין התנסויות" text={canCreate ? 'שבצו צוער לתפקיד (מ"מ, מ"כ, סמל תורן...) עם מטרות ומפקד חונך.' : undefined} />
      ) : (
        <>
          {leaving.rows.length > 0 ? (
            <div className="grid-2">
              {leaving.rows.map((x) => (
                <ExperienceCard key={x.id} x={x} leaving={leaving.phaseOf(x.id)} />
              ))}
            </div>
          ) : (
            <p className="small muted">כל ההתנסויות כאן הושלמו.</p>
          )}
          <DoneDrawer id="experiences-done" count={done.length} label="הושלמו">
            <div className="grid-2">
              {done.map((x) => (
                <ExperienceCard key={x.id} x={x} />
              ))}
            </div>
          </DoneDrawer>
        </>
      )}
      </>
      )}
      {creating && <ExperienceForm onClose={() => setCreating(false)} />}
      {givingX && <FeedbackDialog x={givingX} onClose={() => setGiving(null)} />}
    </div>
    </BulkScope>
  );
}

/** where an experience is in its days: starting in N days, day N of M (with a bar), or over */
function Period({ x }: { x: Experience }) {
  const today = todayKey();
  const total = diffDays(x.endDate, x.startDate) + 1;
  if (x.phase === 'planned') {
    const n = diffDays(x.startDate, today);
    return <div className="tiny muted exp-period">{n <= 0 ? 'מתחילה היום' : n === 1 ? 'מתחילה מחר' : `מתחילה בעוד ${n} ימים`}</div>;
  }
  if (x.phase !== 'active' || total < 2) return null;
  const day = Math.min(total, Math.max(1, diffDays(today, x.startDate) + 1));
  return (
    <div className="tiny muted exp-period">
      יום {day} מתוך {total}
      <span className="mini-bar exp-bar" aria-hidden="true">
        <i style={{ width: `${(day / total) * 100}%` }} />
      </span>
      {day === total && <span>· מסתיימת היום</span>}
    </div>
  );
}

export function ExperienceCard({ x, compact, leaving }: { x: Experience; compact?: boolean; leaving?: LeavePhase }) {
  const [feedback, setFeedback] = useState(false);
  const [editing, setEditing] = useState(false);
  // the feedback just given: the card turns done with a glow (and a buzz) - the moment, not every visit
  const wasStatus = useRef(x.status);
  const [justDone, setJustDone] = useState(false);
  useEffect(() => {
    if (wasStatus.current !== 'done' && x.status === 'done') {
      haptic('success');
      setJustDone(true);
    }
    wasStatus.current = x.status;
  }, [x.status]);
  const p = PHASE[x.phase];
  return (
    <SwipeRow itemId={x.id} label={`${x.role} - ${x.cadetName}`} leaving={leaving}>
    <div className={`card card-pad t-${p.tone}${justDone ? ' just-cleared' : ''}`} style={{ borderRight: '4px solid var(--tone)', padding: compact ? 12 : 16 }}>
      <div className="row wrap gap-6">
        {x.canEdit && <BulkCheck id={x.id} />}
        <span className={`badge t-${p.tone}`}>{p.label}</span>
        {x.kind === 'broad' && <span className="badge t-blue">רוחב{x.span ? ` · ${SPAN_SHORT[x.span]}` : ''}</span>}
        <span className="tiny muted mono">
          {shortDate(x.startDate)}
          {x.endDate !== x.startDate && `-${shortDate(x.endDate)}`}
        </span>
        {x.weekName && <span className="tiny muted">{x.weekName}</span>}
        <span className="grow" />
        <ScoreBadge x={x} />
      </div>
      <div className="strong mt-8" style={{ fontSize: compact ? 15 : 17 }}>
        {x.role}
      </div>
      {!compact && (
        <Link to={`/cadets/${x.cadetId}`} className="small">
          {x.cadetName}
          {x.teamName && <span className="muted"> · {x.teamName}</span>}
        </Link>
      )}
      <div className="tiny muted">מפקד חונך: {x.mentorName ?? 'לא נקבע'}</div>
      <Period x={x} />
      {x.goals && !compact && (
        <p className="small mt-8" style={{ whiteSpace: 'pre-wrap' }}>
          <b>מטרות:</b> {x.goals}
        </p>
      )}
      {x.status === 'done' && x.canSeeFeedback && x.feedbackForm && <FeedbackView form={x.feedbackForm} by={x.evaluatedByName} compact={compact} />}
      {x.status === 'done' && x.canSeeFeedback && !x.feedbackForm && (x.strengths || x.improvements || x.feedback) && (
        <div className="update mt-8" style={{ padding: 10 }}>
          {x.strengths && <div className="small"><b>חוזקות:</b> {x.strengths}</div>}
          {x.improvements && <div className="small"><b>לשיפור:</b> {x.improvements}</div>}
          {x.feedback && <div className="small">{x.feedback}</div>}
          <div className="tiny muted mt-8">משוב: {x.evaluatedByName}</div>
        </div>
      )}
      {(x.canGiveFeedback || x.canEdit) && (
        <div className="row gap-6 mt-12 wrap">
          {x.canGiveFeedback && x.status !== 'done' && (
            <button className={`btn btn-sm${x.phase === 'awaiting_feedback' ? ' btn-primary' : ''}`} onClick={() => setFeedback(true)}>
              <Icon name="message" /> מתן משוב
            </button>
          )}
          {x.canEdit && x.status !== 'done' && (
            <button className="btn btn-sm btn-ghost" onClick={() => setEditing(true)}>
              <Icon name="edit" /> עריכה
            </button>
          )}
          {x.feedbackTaskId && (
            <Link to={`/tasks/${x.feedbackTaskId}`} className="btn btn-sm btn-ghost">
              <Icon name="tasks" /> משימת המשוב
            </Link>
          )}
        </div>
      )}
      {feedback && <FeedbackDialog x={x} onClose={() => setFeedback(false)} />}
      {editing && <ExperienceForm experience={x} onClose={() => setEditing(false)} />}
    </div>
    </SwipeRow>
  );
}

/** a field whose input is a row of choices: named as a group (a <label> would name only the first choice) */
function ChoiceField({ label, id, hint, required, children }: { label: string; id: string; hint?: string; required?: boolean; children: ReactNode }) {
  return (
    <div className="field span-2" role="group" aria-labelledby={`${id}-l`}>
      <span id={`${id}-l`}>
        {label}
        {required && <span className="req"> *</span>}
      </span>
      {children}
      {hint && <span className="hint">{hint}</span>}
    </div>
  );
}

export function ExperienceForm({ cadetId, experience, onClose }: { cadetId?: number; experience?: Experience; onClose: () => void }) {
  const toast = useToast();
  const { users, settings, weeks } = useSession();
  const cadets = useApi<Cadet[]>(experience || cadetId ? null : '/api/cadets', ['cadets']);
  const [cadet, setCadet] = useState<string>(String(experience?.cadetId ?? cadetId ?? ''));
  const [kind, setKind] = useState<ExperienceKind>(experience?.kind ?? 'role');
  const [role, setRole] = useState(experience?.role ?? '');
  const [broad, setBroad] = useState(experience?.kind === 'broad' ? experience.role : '');
  const [span, setSpan] = useState<ExperienceSpan | null>(experience?.span ?? null);
  const [start, setStart] = useState(experience?.startDate ?? todayKey());
  const [end, setEnd] = useState(experience?.endDate ?? todayKey());
  // the course's first and last day: as set in the settings, or its first and last week
  const courseStart = settings.startDate ?? weeks.reduce<string | null>((m, w) => (!m || w.startDate < m ? w.startDate : m), null);
  const courseEnd = settings.endDate ?? weeks.reduce<string | null>((m, w) => (!m || w.endDate > m ? w.endDate : m), null);
  const pickSpan = (s: ExperienceSpan) => {
    setSpan(s);
    if (courseStart && courseEnd && courseEnd >= courseStart) {
      const d = spanDates(s, courseStart, courseEnd);
      setStart(d.startDate);
      setEnd(d.endDate);
    }
  };
  const isBroad = kind === 'broad';
  const name = isBroad ? broad : role;
  const [mentor, setMentor] = useState<string>(experience?.mentorId ? String(experience.mentorId) : '');
  const [goals, setGoals] = useState(experience?.goals ?? '');
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    setError(null);
    try {
      const body = { role: name, startDate: start, endDate: end, goals, mentorId: mentor ? Number(mentor) : null, ...(isBroad ? { span } : {}) };
      if (experience) await api.patch(`/api/experiences/${experience.id}`, body);
      else await api.post('/api/experiences', { ...body, kind, cadetId: Number(cadet) });
      toast({ title: experience ? 'ההתנסות עודכנה' : 'ההתנסות שובצה - שבוע לפני סופה תיפתח לחונך משימת משוב', tone: 'green' });
      emitLocalChange('cadets', 'tasks');
      onClose();
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <Modal
      title={experience ? (experience.kind === 'broad' ? 'עריכת התנסות רוחב' : 'עריכת התנסות') : 'שיבוץ להתנסות'}
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-primary" onClick={() => void save()} disabled={!name.trim() || !cadet || (isBroad && !span)}>
            שמור
          </button>
          <button className="btn btn-ghost" onClick={onClose}>
            ביטול
          </button>
        </>
      }
    >
      <div className="form-grid">
        {!experience && (
          <ChoiceField label="סוג ההתנסות" id="exp-kind" hint={isBroad ? 'תפקיד לצד הקורס, לחצי קורס או לקורס שלם' : 'תפקיד באירוע או בשבוע מסוים'}>
            <Seg<ExperienceKind> value={kind} onChange={setKind} options={(['role', 'broad'] as const).map((k) => ({ value: k, label: EXPERIENCE_KIND_LABELS[k] }))} />
          </ChoiceField>
        )}
        {!experience && !cadetId && (
          <Field label="צוער" required className="span-2">
            <Select className="select" value={cadet} onChange={(e) => setCadet(e.target.value)}>
              <option value="">בחירת צוער...</option>
              {(cadets.data ?? [])
                .filter((c) => c.canEdit)
                .sort((a, b) => byHe(a.fullName, b.fullName))
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.fullName} {c.teamName ? `(${c.teamName})` : ''}
                  </option>
                ))}
            </Select>
          </Field>
        )}
        {isBroad ? (
          <>
            <Field label="סוג התנסות רוחב" required className="span-2">
              <Select className="select" value={broad} onChange={(e) => setBroad(e.target.value)} data-autofocus>
                <option value="">בחירה...</option>
                {BROAD_EXPERIENCES.map((b) => (
                  <option key={b} value={b}>
                    {b}
                  </option>
                ))}
              </Select>
            </Field>
            <ChoiceField label="תקופה" id="exp-span" required hint={courseStart && courseEnd ? 'התאריכים מתמלאים לפי תאריכי הקורס, ואפשר לשנות אותם' : 'תאריכי הקורס לא הוגדרו - מלאו את התאריכים ידנית'}>
              <Seg<ExperienceSpan> wrap value={span ?? ('' as ExperienceSpan)} onChange={pickSpan} options={EXPERIENCE_SPANS.map((s) => ({ value: s, label: SPAN_LABELS[s] }))} />
            </ChoiceField>
          </>
        ) : (
          <Field label="תפקיד" required className="span-2">
            <input className="input" value={role} onChange={(e) => setRole(e.target.value)} placeholder='לדוגמה: מ"מ בתרגיל התקפה' data-autofocus />
          </Field>
        )}
        <Field label="מתאריך">
          <DateInput value={start} onChange={(v) => (setStart(v), end < v && setEnd(v))} />
        </Field>
        <Field label="עד תאריך">
          <DateInput value={end} onChange={(v) => setEnd(v)} />
        </Field>
        <Field label="מפקד חונך" className="span-2" hint="שבוע לפני סוף ההתנסות יקבל משימת משוב, עם דד-ליין ביום האחרון שלה. בלי חונך - מפקד הצוות">
          <Select className="select" value={mentor} onChange={(e) => setMentor(e.target.value)}>
            <option value="">ללא (המשימה תיפתח עליך)</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.displayName}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="מטרות ההתנסות" className="span-2">
          <textarea className="textarea" value={goals} onChange={(e) => setGoals(e.target.value)} placeholder="לדוגמה: קבלת החלטות תחת לחץ, שליטה בקשר, הוצאת פקודות" />
        </Field>
      </div>
      <div className="mt-12">
        <ErrorBox error={error} />
      </div>
    </Modal>
  );
}

// ---------------- the tracking table (טבלת מעקב) ----------------

/**
 * Each team's cadets with the experiences they were placed in - by their team commanders, and in the roles of
 * the schedule's events (which move with their event) - where each stands, its mentor and a mark. A team
 * commander starts on their own team; the commander chooses who follows every team.
 */
function TrackingTable({ experiences }: { experiences: Experience[] }) {
  const { user, users, isCommander } = useSession();
  const cadets = useApi<Cadet[]>('/api/cadets', ['cadets']);
  const teams = useApi<Team[]>('/api/teams', ['cadets']);
  const mine = teams.data?.find((t) => t.commanderId === user.id)?.id;
  const [team, setTeam] = useState('');
  const [mentor, setMentor] = useState('');
  const [openId, setOpenId] = useState<number | null>(null);
  const [adding, setAdding] = useState<number | null>(null);
  const teamF = team || (mine ? String(mine) : 'all');
  const open = openId === null ? undefined : experiences.find((x) => x.id === openId);

  const groups = useMemo(() => {
    const byCadet = new Map<number, Experience[]>();
    for (const x of [...experiences].sort((a, b) => a.startDate.localeCompare(b.startDate))) {
      if (mentor && String(x.mentorId ?? '') !== mentor) continue;
      byCadet.set(x.cadetId, [...(byCadet.get(x.cadetId) ?? []), x]);
    }
    const active = (cadets.data ?? []).filter((c) => c.status === 'active').sort((a, b) => byHe(a.fullName, b.fullName));
    const rows = (list: Cadet[]) => list.map((c) => ({ cadet: c, xs: byCadet.get(c.id) ?? [] })).filter((r) => !mentor || r.xs.length > 0);
    const out: { key: string; team: Team | null; rows: { cadet: Cadet; xs: Experience[] }[] }[] = (teams.data ?? [])
      .filter((t) => teamF === 'all' || String(t.id) === teamF)
      .map((t) => ({ key: String(t.id), team: t, rows: rows(active.filter((c) => c.teamId === t.id)) }));
    if (teamF === 'all') out.push({ key: 'none', team: null, rows: rows(active.filter((c) => !c.teamId)) });
    return out.filter((g) => g.rows.length > 0);
  }, [experiences, cadets.data, teams.data, teamF, mentor]);

  const mentors = useMemo(() => {
    const ids = new Set(experiences.map((x) => x.mentorId).filter((v): v is number => v !== null));
    return users.filter((u) => ids.has(u.id)).sort((a, b) => byHe(a.displayName, b.displayName));
  }, [experiences, users]);

  if ((cadets.loading && !cadets.data) || (teams.loading && !teams.data)) return <Loading rows={3} />;
  return (
    <div className="col gap-16 fade-in">
      {isCommander && <TrackersLine />}
      <div className="track-filters">
        <Select value={teamF} onChange={(e) => setTeam(e.target.value)} aria-label="צוות">
          <option value="all">כל הצוותים</option>
          {(teams.data ?? []).map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
              {t.commanderName ? ` - ${t.commanderName}` : ''}
            </option>
          ))}
        </Select>
        <Select value={mentor} onChange={(e) => setMentor(e.target.value)} aria-label="מפקד חונך">
          <option value="">כל החונכים</option>
          {mentors.map((u) => (
            <option key={u.id} value={u.id}>
              חונך: {u.displayName}
            </option>
          ))}
        </Select>
      </div>
      {!groups.length ? (
        <Empty icon="target" title={mentor ? 'אין התנסויות לחונך הזה' : 'אין צוערים בצוות הזה'} />
      ) : (
        groups.map((g) => <TrackingTeam key={g.key} team={g.team} rows={g.rows} onOpen={setOpenId} onAdd={setAdding} />)
      )}
      <div className="track-legend tiny muted">
        {(['planned', 'active', 'awaiting_feedback', 'done'] as const).map((ph) => (
          <span key={ph} className={`t-${PHASE[ph].tone}`}>
            <i aria-hidden="true" /> {PHASE[ph].label}
          </span>
        ))}
        <span>
          <Icon name="check" size={12} /> מסומן
        </span>
      </div>
      {open && <TrackingSheet x={open} onClose={() => setOpenId(null)} />}
      {adding !== null && <ExperienceForm cadetId={adding} onClose={() => setAdding(null)} />}
    </div>
  );
}

function TrackingTeam({ team, rows, onOpen, onAdd }: { team: Team | null; rows: { cadet: Cadet; xs: Experience[] }[]; onOpen: (id: number) => void; onAdd: (cadetId: number) => void }) {
  const all = rows.flatMap((r) => r.xs);
  const waiting = all.filter((x) => x.phase === 'awaiting_feedback').length;
  const done = all.filter((x) => x.status === 'done').length;
  const none = rows.filter((r) => !r.xs.length).length;
  return (
    <section className="card track-team">
      <div className="card-head">
        <Icon name="users" />
        <h3 className="grow">
          {team ? team.name : 'בלי צוות'}
          {team?.commanderName && <span className="muted track-cmd"> · {team.commanderName}</span>}
        </h3>
        <span className="tiny muted track-sum">
          {rows.length} צוערים · {done}/{all.length} משובים
          {waiting > 0 && <b className="text-orange"> · {waiting} ממתינות למשוב</b>}
          {none > 0 && <> · {none} בלי התנסות</>}
        </span>
      </div>
      <div className="track-rows">
        {rows.map(({ cadet: c, xs }) => {
          const late = xs.filter((x) => x.phase === 'awaiting_feedback').length;
          return (
            <div key={c.id} className={`track-row${xs.length ? '' : ' is-empty'}`}>
              <div className="track-cadet">
                <Link to={`/cadets/${c.id}`} className="strong">
                  {c.fullName}
                </Link>
                <span className="tiny muted">
                  {xs.length ? `${xs.filter((x) => x.status === 'done').length}/${xs.length} משובים` : 'אין התנסויות עדיין'}
                  {late > 0 && <span className="text-orange"> · {late} ממתינות</span>}
                </span>
              </div>
              <div className="track-chips">
                {xs.map((x) => (
                  <TrackChip key={x.id} x={x} onOpen={() => onOpen(x.id)} />
                ))}
                {c.canEdit && (
                  <button type="button" className="track-add" onClick={() => onAdd(c.id)} aria-label={`שיבוץ התנסות ל${c.fullName}`} title="שיבוץ התנסות">
                    <Icon name="plus" size={14} />
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

/** one experience in the table: its role, days, mentor and where it stands - and its mark, a tap away */
function TrackChip({ x, onOpen }: { x: Experience; onOpen: () => void }) {
  const toast = useToast();
  const p = PHASE[x.phase];
  const mark = async () => {
    try {
      await api.post(`/api/experiences/${x.id}/mark`, { marked: !x.markedAt });
      haptic('tick');
      emitLocalChange('cadets');
    } catch (e) {
      toast({ title: (e as Error).message, tone: 'red' });
    }
  };
  const days = `${shortDate(x.startDate)}${x.endDate !== x.startDate ? `-${shortDate(x.endDate)}` : ''}`;
  return (
    <span className={`track-chip t-${p.tone}${x.markedAt ? ' is-marked' : ''}`}>
      {x.canMark ? (
        <button
          type="button"
          className="track-mark"
          onClick={() => void mark()}
          aria-pressed={!!x.markedAt}
          aria-label={x.markedAt ? `ביטול הסימון: ${x.role} - ${x.cadetName}` : `סימון: ${x.role} - ${x.cadetName}`}
          title={x.markedAt ? `סומן${x.markedByName ? ` - ${x.markedByName}` : ''}` : 'סימון'}
        >
          {x.markedAt && <Icon name="check" size={12} />}
        </button>
      ) : (
        x.markedAt && (
          <span className="track-mark is-static" title={`סומן${x.markedByName ? ` - ${x.markedByName}` : ''}`}>
            <Icon name="check" size={12} />
          </span>
        )
      )}
      <button type="button" className="track-chip-body" onClick={onOpen} title={`${x.role} · ${days} · ${p.label}`}>
        <span className="track-role">{x.role}</span>
        <span className="track-meta">
          {days} · {x.mentorName ?? 'בלי חונך'} · {p.label}
        </span>
      </button>
    </span>
  );
}

/** an experience opened from the table: the card itself, its mentor to change, and its mark */
function TrackingSheet({ x, onClose }: { x: Experience; onClose: () => void }) {
  const { users } = useSession();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const staff = users.filter((u) => u.active).sort((a, b) => byHe(a.displayName, b.displayName));
  const setMentor = async (v: string) => {
    setBusy(true);
    try {
      await api.patch(`/api/experiences/${x.id}`, { mentorId: v ? Number(v) : null });
      emitLocalChange('cadets', 'tasks');
      toast({ title: v ? `החונך: ${staff.find((u) => String(u.id) === v)?.displayName ?? ''}` : 'החונך הוסר', body: `${x.role} - ${x.cadetName}`, tone: 'green' });
    } catch (e) {
      toast({ title: (e as Error).message, tone: 'red' });
    } finally {
      setBusy(false);
    }
  };
  const mark = async () => {
    setBusy(true);
    try {
      await api.post(`/api/experiences/${x.id}/mark`, { marked: !x.markedAt });
      emitLocalChange('cadets');
    } catch (e) {
      toast({ title: (e as Error).message, tone: 'red' });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title={`${x.role} - ${x.cadetName}`} onClose={onClose}>
      <div className="col gap-12">
        <ExperienceCard x={x} compact />
        {x.canEdit && x.status !== 'done' && (
          <Field label="מפקד חונך" hint="משימת המשוב עוברת אליו">
            <Select value={x.mentorId ? String(x.mentorId) : ''} onChange={(e) => void setMentor(e.target.value)} disabled={busy}>
              <option value="">לא נקבע</option>
              {staff.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.displayName}
                </option>
              ))}
            </Select>
          </Field>
        )}
        {(x.canMark || x.markedAt) && (
          <div className="row wrap gap-8 small">
            {x.canMark && (
              <button type="button" className={`btn btn-sm${x.markedAt ? '' : ' btn-primary'}`} onClick={() => void mark()} disabled={busy}>
                <Icon name="check" /> {x.markedAt ? 'ביטול הסימון' : 'סימון'}
              </button>
            )}
            {x.markedAt && <span className="muted">סומן{x.markedByName ? ` על ידי ${x.markedByName}` : ''} · {shortDate(dateKeyOf(x.markedAt))}</span>}
          </div>
        )}
      </div>
    </Modal>
  );
}

/** the commander's: who follows the experiences and feedback of every team (sees the feedback, marks) */
function TrackersLine() {
  const { users, settings } = useSession();
  const [editing, setEditing] = useState(false);
  const names = (settings.experienceTrackers ?? []).map((id) => users.find((u) => u.id === id)?.displayName).filter(Boolean);
  return (
    <div className="track-access small">
      <Icon name="eye" size={15} />
      <span className="grow">{names.length ? `עוקבים אחרי כל הצוותים: ${names.join(', ')}` : 'אפשר לתת לאנשי סגל לעקוב אחרי ההתנסויות והמשובים של כל הצוותים.'}</span>
      <button type="button" className="link-btn tiny" onClick={() => setEditing(true)}>
        {names.length ? 'שינוי' : 'בחירה'}
      </button>
      {editing && <TrackersDialog onClose={() => setEditing(false)} />}
    </div>
  );
}

function TrackersDialog({ onClose }: { onClose: () => void }) {
  const { users, settings } = useSession();
  const toast = useToast();
  const [chosen, setChosen] = useState<Set<number>>(() => new Set(settings.experienceTrackers ?? []));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const staff = users.filter((u) => u.active && u.role !== 'commander').sort((a, b) => byHe(a.displayName, b.displayName));
  const toggle = (id: number) =>
    setChosen((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.patch('/api/settings', { experienceTrackers: [...chosen] });
      emitLocalChange('settings', 'cadets');
      toast({ title: 'נשמר', body: chosen.size ? `${chosen.size} עוקבים אחרי ההתנסויות` : 'אין עוקבים מעבר למפקדי הצוותים', tone: 'green' });
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title="מי עוקב אחרי ההתנסויות"
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-primary" onClick={() => void save()} disabled={busy}>
            <Icon name="check" /> שמירה
          </button>
          <button className="btn btn-ghost" onClick={onClose}>
            ביטול
          </button>
        </>
      }
    >
      <p className="small muted">מי שנבחר רואה את ההתנסויות והמשובים של כל הצוותים ויכול לסמן אותם בטבלת המעקב. מפקד כל צוות עוקב ממילא אחרי הצוות שלו.</p>
      <div className="col gap-6 mt-12">
        {staff.map((u) => (
          <label key={u.id} className="check track-pick">
            <input type="checkbox" checked={chosen.has(u.id)} onChange={() => toggle(u.id)} />
            <span>
              {u.displayName}
              {u.title && <span className="muted"> · {u.title}</span>}
            </span>
          </label>
        ))}
        {!staff.length && <p className="small muted">אין עדיין אנשי סגל במערכת - מוסיפים בהגדרות, משתמשים.</p>}
      </div>
      <ErrorBox error={error} />
    </Modal>
  );
}
