// Section 9 (task page), 20 (activity log), 41-46 (receiving, updating, blocking,
// completing), 59-60 (dependencies, subtasks), 64 (all-staff progress).

import { useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { domainLabel, OVERDUE_RESPONSE_LABELS, PRIORITY_LABELS, REQUEST_TYPE_LABELS, STATUS_LABELS, VISIBILITY_LABELS } from '@shared/constants';
import type { Task, TaskDetail } from '@shared/types';
import { DeadlineText, PriorityBadge, StatusBadge } from '../components/Badges';
import { Icon } from '../components/Icon';
import { useNewTask } from '../components/NewTask';
import { TaskActions, useTaskMutation } from '../components/TaskActions';
import { TaskList } from '../components/TaskRow';
import { Bar, ErrorBox, PageError, Loading, Modal } from '../components/ui';
import { api } from '../lib/api';
import { fileSize, fmtAgo, fmtDateTime, fmtTimeLeft } from '../lib/format';
import { useSession } from '../lib/session';
import { usePageTitle } from '../lib/title';
import { useDraft } from '../lib/draft';
import { useApi, useTick } from '../lib/useApi';
import { safeUrl } from '../lib/safeUrl';

export function TaskPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { data, error, loading, setData, status } = useApi<TaskDetail>(`/api/tasks/${id}`, ['tasks']);
  useTick(30_000);

  if (loading && !data)
    return (
      <div className="page narrow">
        <Loading rows={4} />
      </div>
    );
  if (error && !data)
    return (
      <div className="page narrow">
        <PageError error={error} status={status} what="המשימה" feminine back="/tasks" backLabel="לכל המשימות" />
      </div>
    );
  if (!data) return null;
  return <TaskView detail={data} onChange={setData} onDeleted={() => navigate('/tasks', { replace: true })} />;
}

function TaskView({ detail, onChange, onDeleted }: { detail: TaskDetail; onChange: (d: TaskDetail) => void; onDeleted: () => void }) {
  const { task: t } = detail;
  const pendingRequests = detail.requests.filter((r) => r.status === 'pending');
  usePageTitle(t.title);

  return (
    <div className="page">
      <div className="row mb-12">
        {detail.parent && (
          <Link to={`/tasks/${detail.parent.id}`} className="small muted">
            משימת משנה של: <b>{detail.parent.title}</b>
          </Link>
        )}
      </div>

      <div className={`card card-pad t-${t.tone}`} style={{ borderRight: '6px solid var(--tone)', marginBottom: 16 }}>
        <div className="row row-top wrap">
          <div className="grow">
            <div className="row gap-6 wrap mb-12">
              <StatusBadge status={t.status} overdue={t.overdue} />
              <PriorityBadge priority={t.priority} hideNormal={false} />
              {t.domain && <span className="badge">{domainLabel(t.domain, t.domainNote)}</span>}
              {t.requiresApproval && <span className="badge t-blue">נדרש אישור מפקד</span>}
              {t.visibility !== 'normal' && <span className="badge">{t.visibility === 'team' ? 'כללית לכל הסגל' : 'מוגבלת'}</span>}
              {t.recurringRuleId && <span className="badge">משימה חוזרת</span>}
            </div>
            <h1 style={{ fontSize: 28, lineHeight: 1.25 }}>{t.title}</h1>
            <div className="row wrap mt-8 small" style={{ gap: '4px 18px' }}>
              <span>
                <span className="muted">אחראי: </span>
                <b>{t.ownerName}</b>
              </span>
              <span className="task-meta" style={{ margin: 0, fontSize: 14 }}>
                <span className="muted">דד-ליין:&nbsp;</span>
                <DeadlineText task={t} />
              </span>
              {t.status !== 'done' && t.status !== 'cancelled' && <span className={t.overdue ? 'text-red strong' : 'muted'}>{fmtTimeLeft(t.deadline)}</span>}
              {t.weekName && (
                <Link to={`/weeks/${t.weekId}`} className="muted">
                  {t.weekName}
                </Link>
              )}
            </div>
          </div>
        </div>
        {t.status === 'waiting' && (
          <div className="update mt-16" style={{ background: 'var(--purple-bg)', borderColor: 'rgba(116,72,184,.3)' }}>
            <div className="strong" style={{ color: 'var(--purple)' }}>
              חסם: {t.blockReason} {t.needsCommander && <span className="badge t-red">נדרשת התערבות מפקד</span>}
            </div>
            <div className="small mt-8">
              <b>ממתין ל:</b> {t.blockWaitingFor}
            </div>
            <div className="small">
              <b>הצעד הבא:</b> {t.blockNextStep}
            </div>
          </div>
        )}
        {t.needsCommander && t.status !== 'waiting' && (
          <div className="update mt-16" style={{ background: 'var(--red-bg)', borderColor: 'rgba(201,50,27,.3)' }}>
            <b className="text-red">הועבר להחלטת מפקד הקורס</b>
            {t.overdueResponse && <span className="small"> · {OVERDUE_RESPONSE_LABELS[t.overdueResponse]}</span>}
          </div>
        )}
        {t.status === 'cancelled' && t.cancelReason && (
          <div className="info-box mt-16">
            <b>בוטלה:</b> {t.cancelReason}
          </div>
        )}
        {pendingRequests.map((r) => (
          <div key={r.id} className="update mt-16" style={{ background: 'var(--blue-bg)', borderColor: 'rgba(42,95,158,.3)' }}>
            <div className="row wrap">
              <div className="grow small">
                <b>{REQUEST_TYPE_LABELS[r.type]}</b> של {r.requestedByName} ממתינה להחלטה
                {r.newDeadline && <> · דד-ליין מבוקש: <span className="mono">{fmtDateTime(r.newDeadline)}</span></>}
                {r.newOwnerName && <> · אל: {r.newOwnerName}</>}
                <div className="muted">{r.reason}</div>
              </div>
              {detail.permissions.canApprove && <RequestDecision requestId={r.id} />}
            </div>
          </div>
        ))}
        <div className="mt-16">
          <TaskActions detail={detail} onChange={onChange} onDeleted={onDeleted} />
        </div>
      </div>

      {detail.group && <GroupCard group={detail.group} />}

      <div className="split">
        <div className="col gap-16">
          <div className="card">
            <div className="card-head">
              <h3>פירוט</h3>
            </div>
            <div className="card-body" style={{ whiteSpace: 'pre-wrap' }}>
              {t.description || <span className="muted small">לא נוסף פירוט.</span>}
            </div>
          </div>
          <Subtasks detail={detail} />
          <Dependencies detail={detail} onChange={onChange} />
          <Updates detail={detail} onChange={onChange} />
          <Attachments detail={detail} onChange={onChange} />
        </div>
        <div className="col gap-16 sticky-side">
          <Details task={t} />
          <ActivityLog detail={detail} />
        </div>
      </div>
    </div>
  );
}

function RequestDecision({ requestId }: { requestId: number }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const decide = async (approve: boolean) => {
    setBusy(true);
    try {
      await api.post(`/api/requests/${requestId}/decide`, { approve });
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="row gap-6">
      <button className="btn btn-sm btn-primary" disabled={busy} onClick={() => void decide(true)}>
        אשר
      </button>
      <button className="btn btn-sm" disabled={busy} onClick={() => void decide(false)}>
        דחה
      </button>
      {err && <span className="tiny text-red">{err}</span>}
    </div>
  );
}

function GroupCard({ group }: { group: NonNullable<TaskDetail['group']> }) {
  const pct = group.total ? Math.round((group.done / group.total) * 100) : 0;
  return (
    <div className="card card-pad mb-12" style={{ marginBottom: 16 }}>
      <div className="row wrap">
        <div className="grow">
          <div className="label-caps">משימה לכל הסגל</div>
          <div className="strong" style={{ fontSize: 20 }}>
            {group.done} מתוך {group.total} השלימו
          </div>
        </div>
        <div style={{ width: 200 }}>
          <Bar value={pct} label="השלימו את המשימה" />
        </div>
      </div>
      <div className="chips mt-12">
        {group.members.map((m) => (
          <Link key={m.taskId} to={`/tasks/${m.taskId}`} className={`chip t-${m.status === 'done' ? 'green' : m.overdue ? 'red' : 'gray'}`}>
            <span className="dot" />
            {m.ownerName} · {m.status === 'done' ? 'הושלם' : m.overdue ? 'באיחור' : STATUS_LABELS[m.status]}
          </Link>
        ))}
      </div>
    </div>
  );
}

function Details({ task: t }: { task: Task }) {
  const { userName } = useSession();
  return (
    <div className="card">
      <div className="card-head">
        <h3>פרטים</h3>
      </div>
      <div className="card-body">
        <dl className="kv">
          <dt>אחראי ראשי</dt>
          <dd>
            <Link to={`/team/${t.ownerId}`}>{t.ownerName}</Link>
          </dd>
          {t.participantIds.length > 0 && (
            <>
              <dt>משתתפים</dt>
              <dd>{t.participantIds.map((p) => userName(p)).join(', ')}</dd>
            </>
          )}
          <dt>נוצר על ידי</dt>
          <dd>
            {t.createdByName} <span className="muted tiny">· {fmtAgo(t.createdAt)}</span>
          </dd>
          <dt>דד-ליין</dt>
          <dd className="mono">{fmtDateTime(t.deadline)}</dd>
          <dt>עדיפות</dt>
          <dd>{PRIORITY_LABELS[t.priority]}</dd>
          <dt>סטטוס</dt>
          <dd>{STATUS_LABELS[t.status]}</dd>
          <dt>תחום</dt>
          <dd>{domainLabel(t.domain, t.domainNote) || '-'}</dd>
          <dt>שבוע</dt>
          <dd>{t.weekId ? <Link to={`/weeks/${t.weekId}`}>{t.weekName}</Link> : '-'}</dd>
          <dt>ציר</dt>
          <dd>{t.trackId ? <Link to={`/tracks/${t.trackId}`}>{t.trackName}</Link> : '-'}</dd>
          {t.cadetId && (
            <>
              <dt>צוער</dt>
              <dd>
                <Link to={`/cadets/${t.cadetId}`}>{t.cadetName}</Link>
              </dd>
            </>
          )}
          {t.debriefId && (
            <>
              <dt>תחקיר</dt>
              <dd>
                <Link to={`/debriefs/${t.debriefId}`}>{t.debriefTitle}</Link>
              </dd>
            </>
          )}
          {t.experienceId && (
            <>
              <dt>התנסות</dt>
              <dd>
                <Link to="/experiences">משוב התנסות</Link>
              </dd>
            </>
          )}
          {t.eventId && (
            <>
              <dt>פעילות בלו"ז</dt>
              <dd>
                <Link to={`/schedule?event=${t.eventId}`}>{t.eventTitle}</Link>
              </dd>
            </>
          )}
          <dt>נראות</dt>
          <dd className="small">{VISIBILITY_LABELS[t.visibility].split(' - ')[0]}</dd>
          {t.carriedCount > 0 && (
            <>
              <dt>הועברה</dt>
              <dd>{t.carriedCount} פעמים לשבוע הבא</dd>
            </>
          )}
          {t.completedAt && (
            <>
              <dt>הושלמה</dt>
              <dd className="mono">{fmtDateTime(t.completedAt)}</dd>
            </>
          )}
          <dt>עדכון אחרון</dt>
          <dd className={t.stale ? 'text-orange strong' : ''}>{fmtAgo(t.lastActivityAt)}</dd>
        </dl>
      </div>
    </div>
  );
}

function Subtasks({ detail }: { detail: TaskDetail }) {
  const newTask = useNewTask();
  const t = detail.task;
  const canAdd = detail.permissions.canEdit || detail.permissions.canUpdateStatus;
  if (!detail.subtasks.length && !canAdd) return null;
  return (
    <div className="card">
      <div className="card-head">
        <h3 className="grow">משימות משנה</h3>
        {t.subtaskTotal > 0 && (
          <span className="mono small muted">
            {t.subtaskDone}/{t.subtaskTotal}
          </span>
        )}
        {canAdd && (
          <button
            className="btn btn-sm"
            onClick={() => newTask({ parentId: t.id, weekId: t.weekId, trackId: t.trackId, ownerIds: [t.ownerId], domain: t.domain, deadline: t.deadline, heading: `משימת משנה: ${t.title}` })}
          >
            <Icon name="plus" /> הוספה
          </button>
        )}
      </div>
      <div className="card-body">
        {t.subtaskTotal > 0 && (
          <div className="mb-12">
            <Bar value={Math.round((t.subtaskDone / t.subtaskTotal) * 100)} label="משימות משנה שהושלמו" />
          </div>
        )}
        {detail.subtasks.length ? <TaskList tasks={detail.subtasks} /> : <p className="small muted">אפשר לפרק משימה מורכבת למשימות משנה - והמשימה הראשית תקבל אחוז התקדמות.</p>}
      </div>
    </div>
  );
}

function Dependencies({ detail, onChange }: { detail: TaskDetail; onChange: (d: TaskDetail) => void }) {
  const [adding, setAdding] = useState(false);
  const m = useTaskMutation(detail.task.id, onChange);
  const canEdit = detail.permissions.canEdit || detail.permissions.canUpdateStatus;
  if (!detail.dependsOn.length && !detail.blocks.length && !canEdit) return null;
  return (
    <div className="card">
      <div className="card-head">
        <Icon name="dependency" />
        <h3 className="grow">תלויות</h3>
        {canEdit && (
          <button className="btn btn-sm" onClick={() => setAdding(true)}>
            <Icon name="plus" /> תלות
          </button>
        )}
      </div>
      <div className="card-body col gap-6">
        {!detail.dependsOn.length && !detail.blocks.length && <p className="small muted">לדוגמה: "בניית לו"ז" חייבת להסתיים לפני "הפצת לו"ז לסגל".</p>}
        {detail.dependsOn.length > 0 && <div className="label-caps">חייבת להסתיים קודם</div>}
        {detail.dependsOn.map((d) => (
          <div key={d.id} className="row small">
            <span className={`dot t-${d.status === 'done' ? 'green' : 'orange'}`} />
            <Link to={`/tasks/${d.id}`} className="grow strong">
              {d.title}
            </Link>
            <span className="muted">{d.ownerName}</span>
            <span className="badge">{STATUS_LABELS[d.status]}</span>
            {canEdit && (
              <button className="icon-btn" aria-label="הסר תלות" onClick={() => void m.run(() => api.del<TaskDetail>(`/api/tasks/${detail.task.id}/dependencies/${d.id}`))}>
                <Icon name="x" size={16} />
              </button>
            )}
          </div>
        ))}
        {detail.blocks.length > 0 && <div className="label-caps mt-8">ממתינות למשימה זו</div>}
        {detail.blocks.map((d) => (
          <div key={d.id} className="row small">
            <span className="dot t-gray" />
            <Link to={`/tasks/${d.id}`} className="grow">
              {d.title}
            </Link>
            <span className="muted">{d.ownerName}</span>
          </div>
        ))}
        <ErrorBox error={m.error} />
      </div>
      {adding && <AddDependency detail={detail} onClose={() => setAdding(false)} onChange={onChange} />}
    </div>
  );
}

function AddDependency({ detail, onClose, onChange }: { detail: TaskDetail; onClose: () => void; onChange: (d: TaskDetail) => void }) {
  const [q, setQ] = useState('');
  const { data } = useApi<Task[]>(`/api/tasks?scope=open&recurring=0${q ? `&q=${encodeURIComponent(q)}` : ''}`);
  const m = useTaskMutation(detail.task.id, onChange);
  const exclude = new Set([detail.task.id, ...detail.dependsOn.map((d) => d.id)]);
  return (
    <Modal title="המשימה תלויה ב..." onClose={onClose}>
      <input className="input" placeholder="חיפוש משימה..." value={q} onChange={(e) => setQ(e.target.value)} data-autofocus data-transient />
      <div className="col gap-6 mt-12" style={{ maxHeight: 360, overflowY: 'auto' }}>
        {(data ?? [])
          .filter((t) => !exclude.has(t.id))
          .slice(0, 40)
          .map((t) => (
            <button
              key={t.id}
              className="btn"
              style={{ justifyContent: 'flex-start', height: 'auto', padding: '8px 12px', textAlign: 'start' }}
              onClick={() => void m.run(() => api.post<TaskDetail>(`/api/tasks/${detail.task.id}/dependencies`, { dependsOnId: t.id }), 'התלות נוספה').then((ok) => ok && onClose())}
            >
              <span className="grow">
                {t.title}
                <span className="tiny muted"> · {t.ownerName}</span>
              </span>
            </button>
          ))}
      </div>
      <div className="mt-12">
        <ErrorBox error={m.error} />
      </div>
    </Modal>
  );
}

function Updates({ detail, onChange }: { detail: TaskDetail; onChange: (d: TaskDetail) => void }) {
  const { isCommander } = useSession();
  const [body, setBody] = useDraft(`update:${detail.task.id}`);
  const [kind, setKind] = useState<'comment' | 'instruction'>('comment');
  const m = useTaskMutation(detail.task.id, onChange);
  const canInstruct = isCommander || detail.permissions.canEdit;
  const send = () => {
    if (!body.trim()) return;
    void m.run(() => api.post<TaskDetail>(`/api/tasks/${detail.task.id}/updates`, { body: body.trim(), kind })).then((ok) => ok && setBody(''));
  };
  return (
    <div className="card">
      <div className="card-head">
        <Icon name="message" />
        <h3 className="grow">עדכונים</h3>
        <span className="mono tiny muted">{detail.updates.length}</span>
      </div>
      <div className="card-body col">
        {detail.updates.length === 0 && <p className="small muted">אין צורך לשלוח הודעת וואטסאפ - כתבו כאן עדכון וכולם יראו אותו מיד.</p>}
        {detail.updates.map((u) => (
          <div key={u.id} className={`update ${u.kind}`}>
            <div className="update-head">
              <b>{u.userName}</b>
              {u.kind === 'instruction' && <span className="badge t-blue">הנחיה</span>}
              {u.kind === 'return' && <span className="badge t-orange">הוחזר להשלמה</span>}
              <span className="tl-time">{fmtDateTime(u.createdAt)}</span>
            </div>
            <div className="update-body">{u.body}</div>
          </div>
        ))}
        <div className="col gap-6 mt-8">
          <textarea
            className="textarea"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder={kind === 'instruction' ? 'הנחיה לאחראי...' : 'לדוגמה: בוצעה פנייה למדור. ממתין לאישור.'}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) send();
            }}
            style={{ minHeight: 70 }}
          />
          <div className="row wrap">
            <button className="btn btn-primary btn-sm" disabled={!body.trim() || m.busy} onClick={send}>
              הוסף {kind === 'instruction' ? 'הנחיה' : 'עדכון'}
            </button>
            {canInstruct && (
              <label className="check small">
                <input type="checkbox" checked={kind === 'instruction'} onChange={(e) => setKind(e.target.checked ? 'instruction' : 'comment')} />
                סמן כהנחיה
              </label>
            )}
          </div>
          <ErrorBox error={m.error} />
        </div>
      </div>
    </div>
  );
}

function Attachments({ detail, onChange }: { detail: TaskDetail; onChange: (d: TaskDetail) => void }) {
  const [url, setUrl] = useState('');
  const [title, setTitle] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const m = useTaskMutation(detail.task.id, onChange);
  const { user, isCommander } = useSession();
  return (
    <div className="card">
      <div className="card-head">
        <Icon name="clip" />
        <h3 className="grow">קבצים וקישורים</h3>
        <button className="btn btn-sm" onClick={() => fileRef.current?.click()} disabled={m.busy}>
          <Icon name="upload" /> העלאת קובץ
        </button>
        <input
          ref={fileRef}
          type="file"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void m.run(() => api.upload<TaskDetail>(`/api/tasks/${detail.task.id}/files`, f), 'הקובץ צורף');
            e.target.value = '';
          }}
        />
      </div>
      <div className="card-body col gap-6">
        {detail.attachments.map((a) => (
          <div key={a.id} className="row small">
            <Icon name={a.kind === 'file' ? 'file' : 'link'} size={18} className="muted" />
            <a href={safeUrl(a.url)} target="_blank" rel="noreferrer noopener" className="grow strong" style={{ wordBreak: 'break-all' }}>
              {a.title}
            </a>
            <span className="tiny muted">
              {a.userName} · {fileSize(a.size)}
            </span>
            {(isCommander || a.userId === user.id || detail.permissions.canEdit) && (
              <button className="icon-btn" aria-label="הסרה" onClick={() => void m.run(async () => { await api.del(`/api/attachments/${a.id}`); return api.get<TaskDetail>(`/api/tasks/${detail.task.id}`); })}>
                <Icon name="trash" size={16} />
              </button>
            )}
          </div>
        ))}
        <form
          className="row wrap mt-8"
          onSubmit={(e) => {
            e.preventDefault();
            if (!url.trim()) return;
            void m.run(() => api.post<TaskDetail>(`/api/tasks/${detail.task.id}/links`, { url: url.trim(), title: title.trim() || undefined }), 'הקישור נוסף').then((ok) => {
              if (ok) {
                setUrl('');
                setTitle('');
              }
            });
          }}
        >
          <input className="input grow" dir="ltr" type="url" placeholder="https://drive.google.com/..." value={url} onChange={(e) => setUrl(e.target.value)} style={{ minWidth: 200 }} />
          <input className="input" placeholder="שם (לא חובה)" value={title} onChange={(e) => setTitle(e.target.value)} style={{ width: 160 }} />
          <button className="btn" disabled={!url.trim() || m.busy}>
            <Icon name="link" /> הוסף קישור
          </button>
        </form>
        <ErrorBox error={m.error} />
      </div>
    </div>
  );
}

function ActivityLog({ detail }: { detail: TaskDetail }) {
  const [all, setAll] = useState(false);
  const items = all ? detail.activity : detail.activity.slice(-8);
  return (
    <div className="card">
      <div className="card-head">
        <Icon name="history" />
        <h3 className="grow">יומן פעילות</h3>
        {detail.activity.length > 8 && (
          <button className="btn btn-ghost btn-sm" onClick={() => setAll(!all)}>
            {all ? 'פחות' : `הכל (${detail.activity.length})`}
          </button>
        )}
      </div>
      <div className="card-body">
        <div className="timeline">
          {items.map((a) => (
            <div key={a.id} className="tl-item">
              <div className="tl-time">{fmtDateTime(a.createdAt)}</div>
              <div>{a.text}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
