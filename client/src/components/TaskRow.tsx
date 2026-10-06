import { useRef, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router';
import { domainLabel, isOpenStatus, PRIORITIES, PRIORITY_LABELS, type TaskStatus } from '@shared/constants';
import type { Task } from '@shared/types';
import { api } from '../lib/api';
import { emitLocalChange } from '../lib/realtime';
import { useSession } from '../lib/session';
import { DeadlineText, PriorityBadge, StatusBadge } from './Badges';
import { BulkCheck, bulkClick, BulkScope, useBulk } from './Bulk';
import { Icon } from './Icon';
import { useToast } from './Toasts';
import { useIncremental } from '../lib/incremental';
import { Empty, openable } from './ui';

export function canQuickUpdate(t: Task, userId: number, commander: boolean): boolean {
  return commander || t.ownerId === userId || t.participantIds.includes(userId) || t.createdBy === userId;
}

export function TaskRow({ task, showOwner = true, extra, readOnly }: { task: Task; showOwner?: boolean; extra?: ReactNode; readOnly?: boolean }) {
  const navigate = useNavigate();
  const { user, isCommander, viewing } = useSession();
  const toast = useToast();
  const bulk = useBulk();
  const [busy, setBusy] = useState(false);
  const saving = useRef(false);
  // Optimistic feedback belongs to this snapshot only. A refresh or a reopened task wins.
  const [optimistic, setOptimistic] = useState<{ source: Task; status: TaskStatus } | null>(null);
  const status = optimistic?.source === task ? optimistic.status : task.status;
  const open = isOpenStatus(status);
  const canCheck = !readOnly && !viewing && canQuickUpdate(task, user.id, isCommander) && open && status !== 'pending_approval';
  const done = status === 'done';
  const canApprove = isCommander || (task.createdBy === user.id && task.creatorRole !== 'commander' && task.ownerId !== user.id);
  const needsApproval = task.requiresApproval && !canApprove;

  const complete = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!canCheck || saving.current) return;
    saving.current = true;
    setBusy(true);
    if (!needsApproval) setOptimistic({ source: task, status: 'done' });
    try {
      const d = await api.post<{ task: Task }>(`/api/tasks/${task.id}/transition`, { action: 'complete' });
      setOptimistic({ source: task, status: d.task.status });
      toast({
        title: d.task.status === 'pending_approval' ? 'נשלח לאישור' : 'המשימה הושלמה',
        body: task.title,
        tone: 'green',
      });
      emitLocalChange('tasks');
    } catch (err) {
      setOptimistic(null);
      toast({ title: (err as Error).message, tone: 'red' });
    } finally {
      saving.current = false;
      setBusy(false);
    }
  };

  return (
    <div
      className={`task-row t-${done ? 'green' : task.tone}${done ? ' done' : ''}${bulk?.selected.has(task.id) ? ' selected' : ''}`}
      {...openable(bulkClick(bulk, task.id, () => navigate(`/tasks/${task.id}`)))}
    >
      {bulk?.active ? (
        <BulkCheck id={task.id} />
      ) : (
      <button
        type="button"
        className={`task-check${done ? ' checked' : ''}`}
        onClick={complete}
        disabled={!canCheck || busy}
        aria-label={`${done ? 'הושלמה' : needsApproval ? 'שליחה לאישור' : 'סימון כהושלמה'}: ${task.title}`}
        title={canCheck ? (needsApproval ? 'סימון כהושלמה (יישלח לאישור)' : 'סימון כהושלמה') : undefined}
      >
        <Icon name="check" />
      </button>
      )}
      <div className="task-main">
        <div className="task-title">{task.title}</div>
        <div className="task-meta">
          {showOwner && (
            <span>
              {task.ownerName}
              {task.participantIds.length > 0 && ` +${task.participantIds.length}`}
            </span>
          )}
          <span className={showOwner ? 'sep' : ''}>
            <DeadlineText task={task} />
          </span>
          {task.domain && <span className="sep">{domainLabel(task.domain, task.domainNote)}</span>}
          {task.weekName && <span className="sep">{task.weekName}</span>}
          {task.trackName && task.trackName !== task.domain && <span className="sep">ציר {task.trackName}</span>}
          {task.subtaskTotal > 0 && (
            <span className="sep mono">
              {task.subtaskDone}/{task.subtaskTotal} משנה
            </span>
          )}
          {task.status === 'waiting' && task.blockReason && <span className="sep">חסם: {task.blockReason}</span>}
          {task.stale && open && <span className="sep text-orange">לא עודכן</span>}
          {task.openDependencies > 0 && open && <span className="sep">תלויה ב-{task.openDependencies}</span>}
        </div>
      </div>
      <div className="task-side">
        {extra}
        <PriorityBadge priority={task.priority} />
        <StatusBadge status={status} overdue={!done && task.overdue} />
      </div>
    </div>
  );
}

/** The copies of an all-staff task as one row: its progress, not anyone's copy to tick. */
export function GroupTaskRow({ task, done, total }: { task: Task; done: number; total: number }) {
  const all = done === total;
  return (
    <TaskRow
      task={{ ...task, ownerName: 'כל הסגל', participantIds: [], status: all ? 'done' : 'todo', tone: all ? 'green' : task.tone, overdue: !all && task.overdue }}
      readOnly
      extra={<span className={`badge t-${all ? 'green' : 'blue'}`}>{done}/{total} השלימו</span>}
    />
  );
}

/** Selecting tasks on a page and changing them together (wrap the page, put <BulkToggle /> in its actions). */
export function TaskBulkScope({ tasks, children }: { tasks: Task[]; children: ReactNode }) {
  const { users, weeks, settings } = useSession();
  const active = users.filter((u) => u.active);
  return (
    <BulkScope
      entity="tasks"
      noun="משימות"
      topics={['tasks', 'weeks']}
      ids={tasks.map((t) => t.id)}
      actions={[
        { key: 'complete', label: 'הושלמו', icon: 'check' },
        { key: 'start', label: 'בטיפול', icon: 'play' },
        { key: 'priority', label: 'עדיפות', ask: { title: 'שינוי עדיפות', label: 'עדיפות', options: PRIORITIES.map((p) => ({ value: p, label: PRIORITY_LABELS[p] })), initial: 'high' } },
        { key: 'owner', label: 'אחראי', icon: 'users', ask: { title: 'העברה לאחראי אחר', label: 'אחראי', options: active.map((u) => ({ value: String(u.id), label: u.displayName })) } },
        { key: 'week', label: 'שבוע', icon: 'layers', ask: { title: 'שיוך לשבוע', label: 'שבוע', options: [{ value: '', label: 'ללא שבוע' }, ...weeks.map((w) => ({ value: String(w.id), label: w.name }))] } },
        { key: 'domain', label: 'תחום', ask: { title: 'שינוי תחום', label: 'תחום', options: [{ value: '', label: 'ללא תחום' }, ...settings.domains.map((d) => ({ value: d, label: d }))] } },
        { key: 'shift', label: 'הזזת דד-ליין', icon: 'clock', ask: { title: 'הזזת הדד-ליין', label: 'בכמה ימים להזיז (שלילי - להקדים)', type: 'number', initial: '1' } },
        { key: 'cancel', label: 'ביטול', ask: { title: 'ביטול משימות', label: 'סיבת הביטול', type: 'text', placeholder: 'לדוגמה: הפעילות בוטלה' } },
        { key: 'delete', label: 'מחיקה', icon: 'trash', danger: true, confirm: 'למחוק {n} משימות? אי אפשר לבטל.' },
      ]}
    >
      {children}
    </BulkScope>
  );
}

export function TaskList({ tasks, empty, showOwner = true }: { tasks: Task[]; empty?: ReactNode; showOwner?: boolean }) {
  const { shown, more } = useIncremental(tasks);
  if (!tasks.length) return <>{empty ?? <Empty title="אין משימות" />}</>;
  return (
    <>
      <div className="list">
        {shown.map((t) => (
          <TaskRow key={t.id} task={t} showOwner={showOwner} />
        ))}
      </div>
      {more}
    </>
  );
}

export function GroupTitle({ title, count, tone, id }: { title: string; count?: number; tone?: string; id?: string }) {
  return (
    <div className="group-title" id={id}>
      {tone && <span className={`dot t-${tone}`} />}
      <span>{title}</span>
      {count !== undefined && <span className="n">{count}</span>}
      <span className="line" />
    </div>
  );
}
