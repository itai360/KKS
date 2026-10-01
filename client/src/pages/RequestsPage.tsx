// Sections 46, 62, 63 - completion approvals, deadline extensions and transfers in one inbox.

import { useState } from 'react';
import { Link } from 'react-router';
import { REQUEST_TYPE_LABELS } from '@shared/constants';
import type { Task, TaskRequest } from '@shared/types';
import { BulkCheck, BulkScope, BulkToggle } from '../components/Bulk';
import { Icon } from '../components/Icon';
import { NoteDialog } from '../components/TaskActions';
import { useToast } from '../components/Toasts';
import { Empty, ErrorBox, Loading, PageHead } from '../components/ui';
import { api } from '../lib/api';
import { fmtAgo, fmtDateTime, fmtDeadline } from '../lib/format';
import { emitLocalChange } from '../lib/realtime';
import { useSession } from '../lib/session';
import { useApi } from '../lib/useApi';

export function RequestsPage() {
  const { isCommander, user } = useSession();
  const pending = useApi<TaskRequest[]>('/api/requests', ['requests', 'tasks']);
  const history = useApi<TaskRequest[]>('/api/requests?status=all', ['requests', 'tasks']);
  const approvals = useApi<Task[]>('/api/tasks?status=pending_approval', ['tasks']);
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [returning, setReturning] = useState<Task | null>(null);
  const [rejecting, setRejecting] = useState<TaskRequest | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const toDecide = (pending.data ?? []).filter((r) => r.requestedBy !== user.id);
  const mine = (history.data ?? []).filter((r) => r.requestedBy === user.id);
  const myApprovals = (approvals.data ?? []).filter((t) => isCommander || (t.createdBy === user.id && t.ownerId !== user.id));

  const run = async (fn: () => Promise<unknown>, title: string) => {
    setBusy(true);
    setErr(null);
    try {
      await fn();
      toast({ title, tone: 'green' });
      emitLocalChange('tasks', 'requests');
      return true;
    } catch (e) {
      setErr((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page narrow">
      <PageHead title={isCommander ? 'אישורים ובקשות' : 'הבקשות שלי'} sub="בקשות סגירה, הארכת דד-ליין והעברת אחריות." />
      <ErrorBox error={err} />
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
                <Empty title="אין בקשות סגירה" />
              ) : (
                myApprovals.map((t) => (
                  <div key={t.id} className="attn-item t-blue" style={{ cursor: 'default' }}>
                    <span className="attn-bar" />
                    <BulkCheck id={t.id} />
                    <div>
                      <Link to={`/tasks/${t.id}`} className="attn-title">
                        {t.title}
                      </Link>
                      <div className="attn-sub">
                        {t.ownerName} ביקש לסגור · דד-ליין {fmtDeadline(t.deadline)}
                      </div>
                    </div>
                    <div className="row gap-6">
                      <button className="btn btn-sm btn-primary" disabled={busy} onClick={() => void run(() => api.post(`/api/tasks/${t.id}/transition`, { action: 'approve' }), 'המשימה אושרה ונסגרה')}>
                        אשר
                      </button>
                      <button className="btn btn-sm" disabled={busy} onClick={() => setReturning(t)}>
                        החזר להשלמה
                      </button>
                    </div>
                  </div>
                ))
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
                <Empty title="אין בקשות פתוחות" />
              ) : (
                toDecide.map((r) => (
                  <div key={r.id} className="attn-item t-blue" style={{ cursor: 'default' }}>
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
                          <span className="mono">
                            {fmtDateTime(r.currentDeadline)} ← {r.newDeadline && fmtDateTime(r.newDeadline)}
                          </span>
                        ) : (
                          <>
                            {r.currentOwnerName} ← {r.newOwnerName}
                          </>
                        )}
                      </div>
                      <div className="small">{r.reason}</div>
                    </div>
                    <div className="row gap-6">
                      <button className="btn btn-sm btn-primary" disabled={busy} onClick={() => void run(() => api.post(`/api/requests/${r.id}/decide`, { approve: true }), 'הבקשה אושרה')}>
                        אשר
                      </button>
                      <button className="btn btn-sm" disabled={busy} onClick={() => setRejecting(r)}>
                        דחה
                      </button>
                    </div>
                  </div>
                ))
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
      {returning && (
        <NoteDialog
          title="החזרה להשלמה"
          label="מה חסר?"
          required
          submitLabel="החזר"
          m={{ busy, error: err }}
          onClose={() => setReturning(null)}
          onSubmit={(note) => void run(() => api.post(`/api/tasks/${returning.id}/transition`, { action: 'return', note }), 'הוחזר להשלמה').then((ok) => ok && setReturning(null))}
        />
      )}
      {rejecting && (
        <NoteDialog
          title="דחיית בקשה"
          label="הסבר (לא חובה)"
          submitLabel="דחה"
          m={{ busy, error: err }}
          onClose={() => setRejecting(null)}
          onSubmit={(note) => void run(() => api.post(`/api/requests/${rejecting.id}/decide`, { approve: false, note: note || undefined }), 'הבקשה נדחתה').then((ok) => ok && setRejecting(null))}
        />
      )}
    </div>
  );
}
