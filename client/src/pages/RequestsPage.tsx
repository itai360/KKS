// Sections 46, 62, 63 - completion approvals, deadline extensions and transfers in one inbox.

import { useState } from 'react';
import { Link } from 'react-router';
import { REQUEST_TYPE_LABELS } from '@shared/constants';
import { diffDays } from '@shared/dates';
import type { Task, TaskRequest } from '@shared/types';
import { BulkCheck, BulkScope, BulkToggle } from '../components/Bulk';
import { Decided, useDecision } from '../components/Decision';
import { Icon } from '../components/Icon';
import { NoteDialog } from '../components/TaskActions';
import { Empty, Loading, PageHead } from '../components/ui';
import { api } from '../lib/api';
import { dateKeyOf, fmtAgo, fmtDateTime, fmtDeadline } from '../lib/format';
import { useSession } from '../lib/session';
import { useApi } from '../lib/useApi';

export function RequestsPage() {
  const { isCommander, user } = useSession();
  const pending = useApi<TaskRequest[]>('/api/requests', ['requests', 'tasks']);
  const history = useApi<TaskRequest[]>('/api/requests?status=all', ['requests', 'tasks']);
  const approvals = useApi<Task[]>('/api/tasks?status=pending_approval', ['tasks']);
  // decided while the page is open: each emptied list says how many of its own were handled
  const [handled, setHandled] = useState({ approvals: 0, requests: 0 });
  const decided = (k: keyof typeof handled) => () => setHandled((h) => ({ ...h, [k]: h[k] + 1 }));

  const toDecide = (pending.data ?? []).filter((r) => r.requestedBy !== user.id);
  const mine = (history.data ?? []).filter((r) => r.requestedBy === user.id);
  const myApprovals = (approvals.data ?? []).filter((t) => isCommander || (t.createdBy === user.id && t.ownerId !== user.id));
  const allClear = (n: number) => (n > 0 ? `טיפלת ב${n === 1 ? 'בקשה אחת' : `-${n} בקשות`} - אין עוד` : undefined);

  return (
    <div className="page narrow">
      <PageHead title={isCommander ? 'אישורים ובקשות' : 'הבקשות שלי'} sub="בקשות סגירה, הארכת דד-ליין והעברת אחריות." />
      {(pending.loading && !pending.data) || (approvals.loading && !approvals.data) ? (
        <Loading rows={3} />
      ) : (
        <div className="col gap-16 fade-in">
          {(isCommander || myApprovals.length > 0) && (
            <BulkScope entity="tasks" noun="משימות" topics={['tasks', 'requests']} ids={myApprovals.map((t) => t.id)} actions={[{ key: 'approve', label: 'אישור וסגירה', icon: 'check' }]}>
            <section className="card">
              <div className="card-head">
                <Icon name="check" />
                <h3 className="grow">ממתינות לאישור סגירה</h3>
                <span className="mono tiny muted">{myApprovals.length}</span>
                {myApprovals.length > 1 && <BulkToggle />}
              </div>
              {myApprovals.length === 0 ? (
                <Empty title={allClear(handled.approvals) ?? 'אין בקשות סגירה'} />
              ) : (
                myApprovals.map((t) => <ApprovalRow key={t.id} task={t} onDecided={decided('approvals')} />)
              )}
            </section>
            </BulkScope>
          )}

          {(isCommander || toDecide.length > 0) && (
            <BulkScope
              entity="requests"
              noun="בקשות"
              topics={['tasks', 'requests']}
              ids={toDecide.map((r) => r.id)}
              actions={[
                { key: 'approve', label: 'אישור', icon: 'check' },
                { key: 'reject', label: 'דחייה', ask: { title: 'דחיית בקשות', label: 'הסבר (לא חובה)', type: 'text' } },
              ]}
            >
            <section className="card">
              <div className="card-head">
                <Icon name="inbox" />
                <h3 className="grow">בקשות שינוי</h3>
                <span className="mono tiny muted">{toDecide.length}</span>
                {toDecide.length > 1 && <BulkToggle />}
              </div>
              {toDecide.length === 0 ? (
                <Empty title={allClear(handled.requests) ?? 'אין בקשות פתוחות'} />
              ) : (
                toDecide.map((r) => <RequestRow key={r.id} request={r} onDecided={decided('requests')} />)
              )}
            </section>
            </BulkScope>
          )}

          <section className="card">
            <div className="card-head">
              <Icon name="history" />
              <h3 className="grow">הבקשות שהגשתי</h3>
            </div>
            {mine.length === 0 ? (
              <div className="card-body small muted">לא הגשת בקשות. בקשת הארכה או העברה מוגשת מתוך עמוד המשימה.</div>
            ) : (
              mine.map((r) => (
                <div key={r.id} className="health" style={{ cursor: 'default' }}>
                  <span className={`dot t-${r.status === 'approved' ? 'green' : r.status === 'rejected' ? 'red' : 'blue'}`} />
                  <div className="grow">
                    <Link to={`/tasks/${r.taskId}`} className="strong">
                      {r.taskTitle}
                    </Link>
                    <div className="tiny muted">
                      {REQUEST_TYPE_LABELS[r.type]} · {r.status === 'pending' ? 'ממתינה' : r.status === 'approved' ? `אושרה ע"י ${r.decidedByName}` : `נדחתה ע"י ${r.decidedByName}`}
                      {r.decisionNote && ` · ${r.decisionNote}`}
                    </div>
                  </div>
                </div>
              ))
            )}
          </section>
        </div>
      )}
    </div>
  );
}

function ApprovalRow({ task: t, onDecided }: { task: Task; onDecided: () => void }) {
  const d = useDecision(onDecided);
  const [returning, setReturning] = useState(false);
  return (
    <div className={`swipe-wrap decision${d.fold ? ' is-removing' : ''}`}>
      <div className="swipe-row">
        <div className="attn-item t-blue" style={{ cursor: 'default' }}>
          <span className="attn-bar" />
          <BulkCheck id={t.id} />
          <div>
            <Link to={`/tasks/${t.id}`} className="attn-title">
              {t.title}
            </Link>
            <div className="attn-sub">
              {t.ownerName} ביקש לסגור · דד-ליין {fmtDeadline(t.deadline)}
            </div>
            {d.error && <div className="tiny text-red">{d.error}</div>}
          </div>
          {d.verdict ? (
            <Decided verdict={d.verdict} />
          ) : (
            <div className="row gap-6">
              <button className="btn btn-sm btn-primary" onClick={() => void d.decide('approved', () => api.post(`/api/tasks/${t.id}/transition`, { action: 'approve' }), 'המשימה אושרה ונסגרה')}>
                אשר
              </button>
              <button className="btn btn-sm" onClick={() => setReturning(true)}>
                החזר להשלמה
              </button>
            </div>
          )}
        </div>
      </div>
      {returning && (
        <NoteDialog
          title="החזרה להשלמה"
          label="מה חסר?"
          required
          submitLabel="החזר"
          m={{ busy: false, error: null }}
          onClose={() => setReturning(false)}
          onSubmit={(note) => {
            setReturning(false);
            void d.decide('returned', () => api.post(`/api/tasks/${t.id}/transition`, { action: 'return', note }), 'הוחזר להשלמה');
          }}
        />
      )}
    </div>
  );
}

/** how far a deadline request moves the deadline, in words: "דחייה ב-3 ימים", "דחייה בשבוע", "הקדמה ביום" */
function shiftOf(from: string, to: string): string {
  const days = diffDays(dateKeyOf(to), dateKeyOf(from));
  const way = (n: number) => (n > 0 ? 'דחייה' : 'הקדמה');
  if (days === 0) {
    const h = Math.round((Date.parse(to) - Date.parse(from)) / 3_600_000);
    const n = Math.abs(h);
    return h === 0 ? 'אותו יום' : `${way(h)} ${n === 1 ? 'בשעה' : n === 2 ? 'בשעתיים' : `ב-${n} שעות`}`;
  }
  const n = Math.abs(days);
  return `${way(days)} ${n === 1 ? 'ביום' : n === 2 ? 'ביומיים' : n === 7 ? 'בשבוע' : n === 14 ? 'בשבועיים' : `ב-${n} ימים`}`;
}

function RequestRow({ request: r, onDecided }: { request: TaskRequest; onDecided: () => void }) {
  const d = useDecision(onDecided);
  const [rejecting, setRejecting] = useState(false);
  return (
    <div className={`swipe-wrap decision${d.fold ? ' is-removing' : ''}`}>
      <div className="swipe-row">
        <div className="attn-item t-blue" style={{ cursor: 'default' }}>
          <span className="attn-bar" />
          <BulkCheck id={r.id} />
          <div>
            <div className="attn-kind">{REQUEST_TYPE_LABELS[r.type]}</div>
            <Link to={`/tasks/${r.taskId}`} className="attn-title">
              {r.taskTitle}
            </Link>
            <div className="attn-sub">
              {r.requestedByName} · {fmtAgo(r.createdAt)} ·{' '}
              {r.type === 'deadline' ? (
                <>
                  <span className="mono">
                    {fmtDateTime(r.currentDeadline)} ← {r.newDeadline && fmtDateTime(r.newDeadline)}
                  </span>
                  {r.newDeadline && r.currentDeadline && <span className="badge t-blue request-shift">{shiftOf(r.currentDeadline, r.newDeadline)}</span>}
                </>
              ) : (
                <>
                  {r.currentOwnerName} ← {r.newOwnerName}
                </>
              )}
            </div>
            <div className="small">{r.reason}</div>
            {d.error && <div className="tiny text-red">{d.error}</div>}
          </div>
          {d.verdict ? (
            <Decided verdict={d.verdict} />
          ) : (
            <div className="row gap-6">
              <button className="btn btn-sm btn-primary" onClick={() => void d.decide('approved', () => api.post(`/api/requests/${r.id}/decide`, { approve: true }), 'הבקשה אושרה')}>
                אשר
              </button>
              <button className="btn btn-sm" onClick={() => setRejecting(true)}>
                דחה
              </button>
            </div>
          )}
        </div>
      </div>
      {rejecting && (
        <NoteDialog
          title="דחיית בקשה"
          label="הסבר (לא חובה)"
          submitLabel="דחה"
          m={{ busy: false, error: null }}
          onClose={() => setRejecting(false)}
          onSubmit={(note) => {
            setRejecting(false);
            void d.decide('rejected', () => api.post(`/api/requests/${r.id}/decide`, { approve: false, note: note || undefined }), 'הבקשה נדחתה');
          }}
        />
      )}
    </div>
  );
}
