// Small debrief pieces other screens show: the kind of a debrief, and the lessons bank
// where it is needed - what an earlier cycle wrote for this week or this event, and what
// was decided about each lesson here (a task, applied, not relevant).

import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router';
import { STATUS_LABELS } from '@shared/constants';
import { addDays, shortDate } from '@shared/dates';
import { LESSON_DECISION_LABELS, type DebriefKind, type LessonDecision } from '@shared/debriefForms';
import type { BankLesson } from '@shared/types';
import { Icon } from './Icon';
import { DateTimeInputs } from './NewTask';
import { useToast } from './Toasts';
import { ErrorBox, Field, Modal } from './ui';
import { api } from '../lib/api';
import { isoAt, todayKey } from '../lib/format';
import { emitLocalChange } from '../lib/realtime';
import { useSession } from '../lib/session';
import { useApi } from '../lib/useApi';

/** where the lessons are looked at, and whether this person decides about them */
export interface LessonContext {
  weekId?: number;
  eventId?: number;
  canDecide: boolean;
  /** the task a lesson becomes: its owner and day, by default */
  owner: number | null;
  due: string;
}

const DECISION_TONES: Record<LessonDecision, string> = { task: 't-blue', applied: 't-green', skip: 't-gray' };

export function PriorLessons({ title, context, card = true, onOpen }: { title: string; context: LessonContext; card?: boolean; onOpen?: () => void }) {
  const query = context.weekId ? `week=${context.weekId}` : `event=${context.eventId}`;
  const { data, setData } = useApi<BankLesson[]>(`/api/lessons?${query}`, ['debriefs', 'tasks']);
  const toast = useToast();
  const location = useLocation();
  const [asTask, setAsTask] = useState<BankLesson | null>(null);
  const [busy, setBusy] = useState<number | null>(null);
  // opened from a reminder (".../weeks/8#prior"): straight to the lessons
  useEffect(() => {
    if (data?.length && location.hash === '#prior') document.getElementById('prior')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [data?.length, location.hash]);
  // nothing kept for it yet: no empty box
  if (!data?.length) return null;
  const pending = data.filter((l) => !l.review).length;

  const decide = async (l: BankLesson, decision: LessonDecision | null, extra: object = {}) => {
    setBusy(l.id);
    try {
      setData(await api.post<BankLesson[]>(`/api/lessons/${l.id}/review`, { weekId: context.weekId, eventId: context.eventId, decision, ...extra }));
      emitLocalChange('debriefs', 'tasks');
      if (decision) toast({ title: decision === 'task' ? 'נפתחה משימה מהלקח' : `סומן: ${LESSON_DECISION_LABELS[decision]}`, tone: 'green' });
      return true;
    } catch (e) {
      toast({ title: (e as Error).message, tone: 'red' });
      return false;
    } finally {
      setBusy(null);
    }
  };

  const list = (
    <ul className="prior-lessons">
      {data.map((l) => (
        <li key={l.id} className={l.review ? 'decided' : ''}>
          <div className="small prewrap">{l.body}</div>
          <div className="tiny muted">
            <Link to={`/debriefs/${l.debriefId}`} onClick={onOpen}>
              {l.debriefTitle}
            </Link>
            {' · '}
            <span className="mono">{shortDate(l.occurredOn)}</span>
            {l.ownerName && ` · ${l.ownerName}`}
          </div>
          {l.review ? (
            <div className="row wrap gap-6">
              {l.review.decision === 'task' && l.review.taskId ? (
                <Link to={`/tasks/${l.review.taskId}`} className="badge t-blue" onClick={onOpen}>
                  <Icon name="tasks" size={11} /> {l.review.taskTitle} · {l.review.taskStatus ? STATUS_LABELS[l.review.taskStatus] : ''}
                </Link>
              ) : (
                <span className={`badge ${DECISION_TONES[l.review.decision]}`}>{LESSON_DECISION_LABELS[l.review.decision]}</span>
              )}
              {l.review.decidedByName && <span className="tiny muted">{l.review.decidedByName}</span>}
              {context.canDecide && (
                <button className="btn btn-ghost btn-sm" disabled={busy === l.id} onClick={() => void decide(l, null)}>
                  ביטול
                </button>
              )}
            </div>
          ) : (
            context.canDecide && (
              <div className="row wrap gap-6 prior-actions" role="group" aria-label={`החלטה על הלקח: ${l.body.slice(0, 60)}`}>
                <button className="btn btn-sm" disabled={busy === l.id} onClick={() => setAsTask(l)}>
                  <Icon name="plus" /> משימה
                </button>
                <button className="btn btn-sm" disabled={busy === l.id} onClick={() => void decide(l, 'applied')}>
                  <Icon name="check" /> יושם
                </button>
                <button className="btn btn-sm btn-ghost" disabled={busy === l.id} onClick={() => void decide(l, 'skip')}>
                  לא רלוונטי
                </button>
              </div>
            )
          )}
        </li>
      ))}
    </ul>
  );
  const counter = pending > 0 && context.canDecide ? <span className="badge t-orange">{pending} ממתינים להחלטה</span> : <span className="mono tiny muted">{data.length}</span>;
  const dialog = asTask && <LessonToTask lesson={asTask} context={context} onClose={() => setAsTask(null)} onSave={(task) => decide(asTask, 'task', { task })} />;
  if (!card)
    return (
      <div id="prior">
        <h3 className="mb-12 row gap-6">
          <Icon name="history" size={16} /> {title} {counter}
        </h3>
        {list}
        {dialog}
      </div>
    );
  return (
    <div className="card prior-card" id="prior">
      <div className="card-head">
        <Icon name="history" />
        <h3 className="grow">{title}</h3>
        {counter}
      </div>
      <div className="card-body">{list}</div>
      {dialog}
    </div>
  );
}

function LessonToTask({ lesson, context, onClose, onSave }: { lesson: BankLesson; context: LessonContext; onClose: () => void; onSave: (task: { title: string; ownerId: number; deadline: string }) => Promise<boolean> }) {
  const { users, user, settings } = useSession();
  const [title, setTitle] = useState(lesson.body.split('\n')[0].slice(0, 120));
  const [owner, setOwner] = useState<number>(context.owner ?? user.id);
  // the day before the week or event - or soon, when that has passed
  const [date, setDate] = useState(context.due < todayKey() ? addDays(todayKey(), 2) : context.due);
  const [time, setTime] = useState(settings.defaultDeadlineTime);
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    setError(null);
    if (await onSave({ title: title.trim(), ownerId: owner, deadline: isoAt(date, time) })) onClose();
    else setError('המשימה לא נפתחה - בדקו את הפרטים');
  };
  return (
    <Modal
      title="משימה מלקח של המחזור הקודם"
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-primary" disabled={!title.trim()} onClick={() => void save()}>
            פתח משימה
          </button>
          <button className="btn btn-ghost" onClick={onClose}>
            ביטול
          </button>
        </>
      }
    >
      <div className="col gap-16">
        <div className="info-box prewrap">{lesson.body}</div>
        <Field label="שם המשימה" required>
          <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} data-autofocus />
        </Field>
        <Field label="אחראי" required>
          <select className="select" value={owner} onChange={(e) => setOwner(Number(e.target.value))}>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.id === user.id ? `אני (${u.displayName})` : u.displayName}
              </option>
            ))}
          </select>
        </Field>
        <Field label="דד-ליין" required>
          <DateTimeInputs date={date} time={time} onDate={setDate} onTime={setTime} />
        </Field>
        <ErrorBox error={error} />
      </div>
    </Modal>
  );
}

export function KindBadge({ kind }: { kind: DebriefKind }) {
  if (kind === 'general') return null;
  return <span className={`badge ${kind === 'event' ? 't-purple' : 't-blue'}`}>{kind === 'event' ? 'מופע עצים' : 'שבועי'}</span>;
}
