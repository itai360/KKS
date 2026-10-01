// Sections 68-69: open tasks during a staff meeting, then save a summary to the history.

import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { parseTaskText } from '@shared/parser';
import type { Meeting } from '@shared/types';
import { Icon } from '../components/Icon';
import { useToast } from '../components/Toasts';
import { Empty, ErrorBox, Field, Loading, PageHead } from '../components/ui';
import { api } from '../lib/api';
import { fmtAgo, fmtDateTime, fmtDeadline, getTz } from '../lib/format';
import { emitLocalChange } from '../lib/realtime';
import { useSession } from '../lib/session';
import { useApi } from '../lib/useApi';

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

  useEffect(() => {
    const t = setTimeout(() => {
      if (decisions !== meeting.decisions || followUps !== meeting.followUps) {
        void api.patch(`/api/meetings/${meeting.id}`, { decisions, followUps });
      }
    }, 700);
    return () => clearTimeout(t);
  }, [decisions, followUps, meeting.id, meeting.decisions, meeting.followUps]);

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
      setError(`חסר: ${parsed.missing.map((m) => ({ title: 'שם משימה', owner: 'אחראי', deadline: 'דד-ליין' })[m]).join(', ')}. לדוגמה: "מפק"צ 4 - לבדוק הקדמת מטווח עד מחר 10:00"`);
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
            <span className="badge t-orange">ישיבה פתוחה</span>
            <span className="small muted grow">נפתחה {fmtAgo(meeting.startedAt)}</span>
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
            </div>
          )}
          <div className="mt-12">
            <ErrorBox error={error} />
          </div>
        </div>
        <div className="card">
          <div className="card-head">
            <h3 className="grow">משימות חדשות מהישיבה</h3>
            <span className="mono tiny muted">{s?.newTasks.length ?? 0}</span>
          </div>
          <div className="card-body col gap-6">
            {!s?.newTasks.length && <p className="small muted">משימות שתוסיפו יופיעו כאן.</p>}
            {s?.newTasks.map((t) => (
              <Link key={t.id} to={`/tasks/${t.id}`} className="row small">
                <Icon name="check" size={14} className="text-green" />
                <span className="grow strong">{t.title}</span>
                <span className="muted">{t.ownerName}</span>
                <span className="mono tiny">{fmtDeadline(t.deadline)}</span>
              </Link>
            ))}
          </div>
        </div>
      </div>
      <div className="col gap-16">
        <div className="card card-pad col gap-16">
          <Field label="החלטות" hint="שורה לכל החלטה (שינוי לו״ז, שינוי אחריות, הנחיות)">
            <textarea className="textarea" value={decisions} onChange={(e) => setDecisions(e.target.value)} style={{ minHeight: 120 }} />
          </Field>
          <Field label="נקודות למעקב">
            <textarea className="textarea" value={followUps} onChange={(e) => setFollowUps(e.target.value)} />
          </Field>
        </div>
        {s && s.closedTasks.length > 0 && (
          <div className="card">
            <div className="card-head">
              <h3>נסגרו מתחילת הישיבה</h3>
            </div>
            <div className="card-body col gap-4">
              {s.closedTasks.map((t) => (
                <div key={t.id} className="small">
                  {t.title} <span className="muted">· {t.ownerName}</span>
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
