// Section 31 - experiences: role, goals, mentor, tasks, feedback and evaluation.

import { useState } from 'react';
import { Link } from 'react-router';
import { shortDate } from '@shared/dates';
import type { Cadet, Experience } from '@shared/types';
import { Icon } from '../components/Icon';
import { useToast } from '../components/Toasts';
import { Empty, ErrorBox, Field, Loading, Modal, PageHead } from '../components/ui';
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

type Tab = 'all' | 'mine' | 'awaiting_feedback' | 'active' | 'planned' | 'done';

export function ExperiencesPage() {
  const { user } = useSession();
  const { data, error, loading } = useApi<Experience[]>('/api/experiences', ['cadets', 'tasks']);
  const [tab, setTab] = useState<Tab>('all');
  const [creating, setCreating] = useState(false);
  const cadets = useApi<Cadet[]>('/api/cadets', ['cadets']);
  const canCreate = (cadets.data ?? []).some((c) => c.canManage);
  // what needs action first: missing feedback, then running, then upcoming, then done
  const list = (data ?? [])
    .filter((x) => (tab === 'all' ? true : tab === 'mine' ? x.mentorId === user.id : x.phase === tab))
    .sort((a, b) => PHASE_ORDER[a.phase] - PHASE_ORDER[b.phase] || (a.phase === 'planned' ? a.startDate.localeCompare(b.startDate) : 0));
  const count = (t: Tab) => (data ?? []).filter((x) => (t === 'mine' ? x.mentorId === user.id : x.phase === t)).length;

  return (
    <div className="page">
      <PageHead
        title="התנסויות"
        sub="שיבוץ צוערים לתפקידים, מטרות, מפקד חונך, משוב והערכה. המשוב נכנס אוטומטית לתיק הצוער."
        actions={
          canCreate && (
            <button className="btn btn-primary" onClick={() => setCreating(true)}>
              <Icon name="plus" /> התנסות
            </button>
          )
        }
      />
      <div className="tabs">
        {(
          [
            ['all', 'הכל'],
            ['mine', 'אני החונך'],
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
  );
}

export function ExperienceCard({ x, compact }: { x: Experience; compact?: boolean }) {
  const [feedback, setFeedback] = useState(false);
  const [editing, setEditing] = useState(false);
  const p = PHASE[x.phase];
  return (
    <div className={`card card-pad t-${p.tone}`} style={{ borderRight: '4px solid var(--tone)', padding: compact ? 12 : 16 }}>
      <div className="row wrap gap-6">
        <span className={`badge t-${p.tone}`}>{p.label}</span>
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
  );
}

export function ExperienceForm({ cadetId, experience, onClose }: { cadetId?: number; experience?: Experience; onClose: () => void }) {
  const toast = useToast();
  const { users } = useSession();
  const cadets = useApi<Cadet[]>(experience || cadetId ? null : '/api/cadets', ['cadets']);
  const [cadet, setCadet] = useState<string>(String(experience?.cadetId ?? cadetId ?? ''));
  const [role, setRole] = useState(experience?.role ?? '');
  const [start, setStart] = useState(experience?.startDate ?? todayKey());
  const [end, setEnd] = useState(experience?.endDate ?? todayKey());
  const [mentor, setMentor] = useState<string>(experience?.mentorId ? String(experience.mentorId) : '');
  const [goals, setGoals] = useState(experience?.goals ?? '');
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    setError(null);
    try {
      const body = { role, startDate: start, endDate: end, goals, mentorId: mentor ? Number(mentor) : null };
      if (experience) await api.patch(`/api/experiences/${experience.id}`, body);
      else await api.post('/api/experiences', { ...body, cadetId: Number(cadet) });
      toast({ title: experience ? 'ההתנסות עודכנה' : 'ההתנסות שובצה - נפתחה משימת משוב לחונך', tone: 'green' });
      emitLocalChange('cadets', 'tasks');
      onClose();
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <Modal
      title={experience ? 'עריכת התנסות' : 'שיבוץ להתנסות'}
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-primary" onClick={() => void save()} disabled={!role.trim() || !cadet}>
            שמור
          </button>
          <button className="btn btn-ghost" onClick={onClose}>
            ביטול
          </button>
        </>
      }
    >
      <div className="form-grid">
        {!experience && !cadetId && (
          <Field label="צוער" required className="span-2">
            <select className="select" value={cadet} onChange={(e) => setCadet(e.target.value)}>
              <option value="">בחירת צוער...</option>
              {(cadets.data ?? [])
                .filter((c) => c.canManage)
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.fullName} {c.teamName ? `(${c.teamName})` : ''}
                  </option>
                ))}
            </select>
          </Field>
        )}
        <Field label="תפקיד" required className="span-2">
          <input className="input" value={role} onChange={(e) => setRole(e.target.value)} placeholder='לדוגמה: מ"מ בתרגיל התקפה' data-autofocus />
        </Field>
        <Field label="מתאריך">
          <input className="input" type="date" value={start} onChange={(e) => (setStart(e.target.value), end < e.target.value && setEnd(e.target.value))} />
        </Field>
        <Field label="עד תאריך">
          <input className="input" type="date" value={end} onChange={(e) => setEnd(e.target.value)} />
        </Field>
        <Field label="מפקד חונך" className="span-2" hint="יקבל משימת משוב שמסתיימת ביום האחרון של ההתנסות">
          <select className="select" value={mentor} onChange={(e) => setMentor(e.target.value)}>
            <option value="">ללא (המשימה תיפתח עליך)</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.displayName}
              </option>
            ))}
          </select>
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
