// Section 31 - experiences: role, goals, mentor, tasks, feedback and evaluation.

import { useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { shortDate } from '@shared/dates';
import { BROAD_EXPERIENCES, EXPERIENCE_KIND_LABELS, EXPERIENCE_SPANS, SPAN_LABELS, SPAN_SHORT, spanDates, type ExperienceKind, type ExperienceSpan } from '@shared/experiences';
import { byHe } from '@shared/sort';
import type { Cadet, Experience } from '@shared/types';
import { BulkCheck, BulkScope, BulkToggle, SwipeRow } from '../components/Bulk';
import { Icon } from '../components/Icon';
import { useToast } from '../components/Toasts';
import { DateInput, Empty, ErrorBox, Field, Loading, Modal, PageHead, Seg, Select } from '../components/ui';
import { api } from '../lib/api';
import { todayKey } from '../lib/format';
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

export function ExperiencesPage() {
  const { user } = useSession();
  const { data, error, loading } = useApi<Experience[]>('/api/experiences', ['cadets', 'tasks']);
  const [tab, setTab] = useState<Tab>('all');
  const [creating, setCreating] = useState(false);
  const cadets = useApi<Cadet[]>('/api/cadets', ['cadets']);
  const canCreate = (cadets.data ?? []).some((c) => c.canManage);
  // what needs action first: missing feedback, then running, then upcoming, then done
  const list = (data ?? [])
    .filter((x) => inTab(tab, x, user.id))
    .sort((a, b) => PHASE_ORDER[a.phase] - PHASE_ORDER[b.phase] || (a.phase === 'planned' ? a.startDate.localeCompare(b.startDate) : 0));
  const count = (t: Tab) => (data ?? []).filter((x) => inTab(t, x, user.id)).length;

  return (
    <BulkScope entity="experiences" noun="התנסויות" topics={['cadets', 'tasks']} ids={list.filter((x) => x.canEdit).map((x) => x.id)} actions={[{ key: 'delete', label: 'מחיקה', icon: 'trash', danger: true, confirm: 'למחוק {n} התנסויות?' }]}>
    <div className="page">
      <PageHead
        title="התנסויות"
        sub="שיבוץ צוערים לתפקידים, מטרות, מפקד חונך, משוב והערכה. המשוב נכנס אוטומטית לתיק הצוער."
        actions={
          canCreate && (
            <>
              <BulkToggle />
              <button className="btn btn-primary" onClick={() => setCreating(true)}>
                <Icon name="plus" /> התנסות
              </button>
            </>
          )
        }
      />
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
        <div className="grid-2">
          {list.map((x) => (
            <ExperienceCard key={x.id} x={x} />
          ))}
        </div>
      )}
      {creating && <ExperienceForm onClose={() => setCreating(false)} />}
    </div>
    </BulkScope>
  );
}

export function ExperienceCard({ x, compact }: { x: Experience; compact?: boolean }) {
  const [feedback, setFeedback] = useState(false);
  const [editing, setEditing] = useState(false);
  const p = PHASE[x.phase];
  return (
    <SwipeRow itemId={x.id} label={`${x.role} - ${x.cadetName}`}>
    <div className={`card card-pad t-${p.tone}`} style={{ borderRight: '4px solid var(--tone)', padding: compact ? 12 : 16 }}>
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
        {x.score !== null && <span className="badge t-gray mono">ציון {x.score}/5</span>}
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
      {x.goals && !compact && (
        <p className="small mt-8" style={{ whiteSpace: 'pre-wrap' }}>
          <b>מטרות:</b> {x.goals}
        </p>
      )}
      {x.status === 'done' && x.canSeeFeedback && (x.strengths || x.improvements || x.feedback) && (
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
      toast({ title: experience ? 'ההתנסות עודכנה' : 'ההתנסות שובצה - נפתחה משימת משוב לחונך', tone: 'green' });
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
                .filter((c) => c.canManage)
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
        <Field label="מפקד חונך" className="span-2" hint="יקבל משימת משוב שמסתיימת ביום האחרון של ההתנסות">
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

function FeedbackDialog({ x, onClose }: { x: Experience; onClose: () => void }) {
  const toast = useToast();
  const [strengths, setStrengths] = useState('');
  const [improvements, setImprovements] = useState('');
  const [feedback, setFeedback] = useState('');
  const [score, setScore] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    setError(null);
    try {
      await api.post(`/api/experiences/${x.id}/feedback`, { strengths, improvements, feedback, score });
      toast({ title: 'המשוב נשמר ונכנס לתיק הצוער', tone: 'green' });
      emitLocalChange('cadets', 'tasks');
      onClose();
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <Modal
      title={`משוב: ${x.cadetName} - ${x.role}`}
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-primary" disabled={!score} onClick={() => void save()}>
            שמור משוב
          </button>
          <button className="btn btn-ghost" onClick={onClose}>
            ביטול
          </button>
        </>
      }
    >
      <div className="col gap-16">
        {x.goals && <div className="info-box"><b>מטרות:</b> {x.goals}</div>}
        <Field label="חוזקות">
          <textarea className="textarea" value={strengths} onChange={(e) => setStrengths(e.target.value)} style={{ minHeight: 64 }} data-autofocus />
        </Field>
        <Field label="נקודות לשיפור">
          <textarea className="textarea" value={improvements} onChange={(e) => setImprovements(e.target.value)} style={{ minHeight: 64 }} />
        </Field>
        <Field label="משוב כללי">
          <textarea className="textarea" value={feedback} onChange={(e) => setFeedback(e.target.value)} style={{ minHeight: 64 }} />
        </Field>
        <Field label="הערכה" required>
          <div className="chips">
            {[1, 2, 3, 4, 5].map((n) => (
              <button key={n} type="button" className={`chip${score === n ? ' on' : ''}`} onClick={() => setScore(n)} style={{ minWidth: 44, justifyContent: 'center' }}>
                {n}
              </button>
            ))}
          </div>
        </Field>
        <ErrorBox error={error} />
      </div>
    </Modal>
  );
}
