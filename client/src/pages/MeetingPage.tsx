// Sections 68-69: open tasks during a staff meeting, then save a summary to the history.

import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router';
import { parseTaskText } from '@shared/parser';
import type { Meeting } from '@shared/types';
import { Icon } from '../components/Icon';
import { useToast } from '../components/Toasts';
import { Empty, ErrorBox, Field, Loading, PageHead } from '../components/ui';
import { api } from '../lib/api';
import { fmtDateTime, fmtDeadline, getTz } from '../lib/format';
import { useFresh } from '../lib/fresh';
import { haptic } from '../lib/haptics';
import { leaveClass, useLeaving } from '../lib/leaving';
import { emitLocalChange } from '../lib/realtime';
import { useSession } from '../lib/session';
import { useApi, useTick } from '../lib/useApi';

const MISSING: Record<string, string> = { title: 'שם משימה', owner: 'אחראי', deadline: 'דד-ליין' };

/** how long the meeting has been going: "12 דק'", "1:05 שעות" */
function elapsed(since: string): string {
  const min = Math.max(0, Math.floor((Date.now() - new Date(since).getTime()) / 60_000));
  if (min < 60) return min < 1 ? 'עכשיו' : `${min} דק'`;
  return `${Math.floor(min / 60)}:${String(min % 60).padStart(2, '0')} שעות`;
}

export function MeetingPage() {
  const active = useApi<Meeting | null>('/api/meetings/active', ['meetings', 'tasks']);
  const history = useApi<Meeting[]>('/api/meetings', ['meetings']);
  const toast = useToast();
  const [error, setError] = useState<string | null>(null);

  const start = async () => {
    try {
      await api.post('/api/meetings', { title: 'ישיבת סגל' });
      emitLocalChange('meetings');
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <div className="page">
      <PageHead
        title="ישיבת סגל"
        sub="כל החלטה הופכת לפעולה עם אחראי ודד-ליין - ושום דבר לא נשאר רק בשיחה."
        actions={
          !active.data &&
          !active.loading && (
            <button className="btn btn-primary" onClick={() => void start()}>
              <Icon name="play" /> פתח ישיבה
            </button>
          )
        }
      />
      <ErrorBox error={error} />
      {active.loading && active.data === undefined ? (
        <Loading rows={3} />
      ) : active.data ? (
        <ActiveMeeting meeting={active.data} onEnded={() => toast({ title: 'סיכום הישיבה נשמר', tone: 'green' })} />
      ) : (
        <Empty icon="message" title="אין ישיבה פתוחה" text="פתחו ישיבה כדי לרשום משימות והחלטות תוך כדי." />
      )}
      <div className="section-title">
        <h2>ישיבות קודמות</h2>
      </div>
      {(history.data ?? [])
        .filter((m) => m.endedAt)
        .map((m) => (
          <details key={m.id} className="card mb-12">
            <summary className="card-head" style={{ cursor: 'pointer', listStyle: 'none' }}>
              <Icon name="message" />
              <span className="strong grow">{m.title}</span>
              <span className="tiny muted mono">{fmtDateTime(m.startedAt)}</span>
              {m.summary && (
                <span className="tiny muted">
                  {m.summary.newTasks.length} משימות · {m.summary.decisions.length} החלטות
                </span>
              )}
            </summary>
            {m.summary && <SummaryView meeting={m} />}
          </details>
        ))}
    </div>
  );
}

function ActiveMeeting({ meeting, onEnded }: { meeting: Meeting; onEnded: () => void }) {
  const { users, weeks, settings } = useSession();
  const [line, setLine] = useState('');
  const [decisions, setDecisions] = useState(meeting.decisions);
  const [followUps, setFollowUps] = useState(meeting.followUps);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useTick(30_000);
  // what was written is kept as it is typed - and says so
  const [saved, setSaved] = useState<'saving' | 'saved' | 'failed' | null>(null);
  const typed = useRef(false);
  useEffect(() => {
    if (!typed.current) return;
    setSaved('saving');
    const t = setTimeout(() => {
      api
        .patch(`/api/meetings/${meeting.id}`, { decisions, followUps })
        .then(() => setSaved('saved'))
        .catch(() => setSaved('failed'));
    }, 700);
    return () => clearTimeout(t);
  }, [decisions, followUps, meeting.id]);
  const write = (set: (v: string) => void) => (v: string) => {
    typed.current = true;
    set(v);
  };
  const fresh = useFresh(meeting.summary?.newTasks.map((t) => t.id));
  const freshClosed = useFresh(meeting.summary?.closedTasks.map((t) => t.id));
  // a task from the meeting closed while it goes on: a moment ticked, then it folds - over to "נסגרו"
  const { open, closedIds } = useMemo(() => {
    const closedIds = new Set(meeting.summary?.closedTasks.map((t) => t.id));
    return { open: (meeting.summary?.newTasks ?? []).filter((t) => !closedIds.has(t.id)), closedIds };
  }, [meeting.summary]);
  const leaving = useLeaving(open, (t) => t.id, (id, last) => closedIds.has(id) && last);

  const parsed = useMemo(
    () =>
      line.trim()
        ? parseTaskText(line, {
            users: users.map((u) => ({ id: u.id, displayName: u.displayName, title: u.title })),
            weeks: weeks.map((w) => ({ id: w.id, name: w.name })),
            domains: settings.domains,
            tz: getTz(),
            defaultTime: settings.defaultDeadlineTime,
          })
        : null,
    [line, users, weeks, settings],
  );

  const add = async () => {
    if (!parsed) return;
    setError(null);
    if (parsed.missing.length) {
      setError(`חסר: ${parsed.missing.map((m) => MISSING[m]).join(', ')}. לדוגמה: "מפק"צ 4 - לבדוק הקדמת מטווח עד מחר 10:00"`);
      return;
    }
    setBusy(true);
    try {
      await api.post('/api/tasks', {
        title: parsed.title,
        assignMode: parsed.allStaff ? 'all' : 'shared',
        ownerIds: parsed.allStaff ? [] : parsed.ownerIds,
        deadline: parsed.deadline,
        priority: parsed.priority ?? 'normal',
        domain: parsed.domain ?? '',
        weekId: parsed.weekId ?? undefined,
        meetingId: meeting.id,
      });
      setLine('');
      haptic('success');
      emitLocalChange('tasks', 'meetings');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const end = async () => {
    setBusy(true);
    try {
      await api.patch(`/api/meetings/${meeting.id}`, { decisions, followUps });
      await api.post(`/api/meetings/${meeting.id}/end`);
      emitLocalChange('meetings');
      onEnded();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const s = meeting.summary;
  return (
    <div className="split">
      <div className="col gap-16">
        <div className="card card-pad">
          <div className="row mb-12">
            <span className="badge t-orange meeting-live">
              <span className="meeting-live-dot" aria-hidden="true" />
              ישיבה פתוחה
            </span>
            <span className="small muted grow" title={fmtDateTime(meeting.startedAt)}>
              {elapsed(meeting.startedAt)}
            </span>
            <button className="btn btn-primary" onClick={() => void end()} disabled={busy}>
              <Icon name="check" /> סיים ושמור סיכום
            </button>
          </div>
          <form
            className="nl-box"
            onSubmit={(e) => {
              e.preventDefault();
              void add();
            }}
          >
            <input className="input" value={line} onChange={(e) => setLine(e.target.value)} placeholder='מפק"צ 4 - לבדוק אפשרות להקדים את המטווח עד מחר ב-10:00' autoFocus aria-label="משימה מהישיבה" />
            <button className="btn btn-primary btn-sm" disabled={busy || !line.trim()}>
              <Icon name="plus" /> הוסף
            </button>
          </form>
          {parsed && (
            <div className="parse-preview">
              {parsed.title && <span className="badge">משימה: {parsed.title}</span>}
              {parsed.allStaff && <span className="badge t-blue">כל הסגל</span>}
              {parsed.ownerIds.map((id) => (
                <span key={id} className="badge t-blue">
                  {users.find((u) => u.id === id)?.displayName}
                </span>
              ))}
              {parsed.deadline && <span className="badge t-green">{fmtDeadline(parsed.deadline)}</span>}
              {parsed.missing.map((m) => (
                <span key={m} className="badge t-red">
                  חסר {MISSING[m]}
                </span>
              ))}
            </div>
          )}
          <div className="mt-12">
            <ErrorBox error={error} />
          </div>
        </div>
        <div className="card">
          <div className="card-head">
            <h3 className="grow">משימות חדשות מהישיבה</h3>
            <span className="mono tiny muted">{open.length}</span>
          </div>
          <div className="card-body col gap-6">
            {!s?.newTasks.length && <p className="small muted">משימות שתוסיפו יופיעו כאן.</p>}
            {s && s.newTasks.length > 0 && !leaving.rows.length && (
              <p className="small all-done-line">
                <Icon name="check" size={15} /> כל המשימות מהישיבה כבר נסגרו.
              </p>
            )}
            {leaving.rows.map((t) => {
              const phase = leaving.phaseOf(t.id);
              return (
                <div key={t.id} className={leaveClass(phase)}>
                  <Link to={`/tasks/${t.id}`} className={`row small meeting-task${fresh(t.id) ? ' is-arrived' : ''}${phase ? ' done' : ''}`}>
                    <Icon name={phase ? 'check' : 'tasks'} size={14} className={phase ? 'text-green' : 'muted'} />
                    <span className="grow strong">{t.title}</span>
                    <span className="muted">{t.ownerName}</span>
                    <span className="mono tiny">{phase ? 'נסגרה' : fmtDeadline(t.deadline)}</span>
                  </Link>
                </div>
              );
            })}
          </div>
        </div>
      </div>
      <div className="col gap-16">
        <div className="card card-pad col gap-16">
          <Field label="החלטות" hint="שורה לכל החלטה (שינוי לו״ז, שינוי אחריות, הנחיות)">
            <textarea className="textarea" value={decisions} onChange={(e) => write(setDecisions)(e.target.value)} style={{ minHeight: 120 }} />
          </Field>
          <Field label="נקודות למעקב">
            <textarea className="textarea" value={followUps} onChange={(e) => write(setFollowUps)(e.target.value)} />
          </Field>
          {saved && (
            <span className={`tiny meeting-saved${saved === 'failed' ? ' text-red' : ' muted'}`} role="status">
              {saved === 'saving' ? 'שומר...' : saved === 'saved' ? (
                <>
                  <Icon name="check" size={12} /> נשמר
                </>
              ) : (
                'לא נשמר - יישמר עם השינוי הבא'
              )}
            </span>
          )}
        </div>
        {s && s.closedTasks.length > 0 && (
          <div className="card">
            <div className="card-head">
              <h3>נסגרו מתחילת הישיבה</h3>
            </div>
            <div className="card-body col gap-4">
              {s.closedTasks.map((t) => (
                <div key={t.id} className={`small${freshClosed(t.id) ? ' is-arrived' : ''}`}>
                  <Icon name="check" size={13} className="text-green" /> {t.title} <span className="muted">· {t.ownerName}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function SummaryView({ meeting }: { meeting: Meeting }) {
  const s = meeting.summary!;
  return (
    <div className="card-body grid-2">
      <div>
        <div className="label-caps">החלטות</div>
        <ul className="small">{s.decisions.length ? s.decisions.map((d, i) => <li key={i}>{d}</li>) : <li className="muted">-</li>}</ul>
        <div className="label-caps">נקודות למעקב</div>
        <ul className="small">{s.followUps.length ? s.followUps.map((d, i) => <li key={i}>{d}</li>) : <li className="muted">-</li>}</ul>
      </div>
      <div>
        <div className="label-caps">משימות חדשות ({s.newTasks.length})</div>
        <ul className="small">
          {s.newTasks.map((t) => (
            <li key={t.id}>
              <Link to={`/tasks/${t.id}`}>{t.title}</Link> <span className="muted">· {t.ownerName}</span>
            </li>
          ))}
        </ul>
        <div className="label-caps">משימות שנסגרו ({s.closedTasks.length})</div>
        <ul className="small">
          {s.closedTasks.map((t) => (
            <li key={t.id}>{t.title}</li>
          ))}
        </ul>
      </div>
    </div>
  );
}
