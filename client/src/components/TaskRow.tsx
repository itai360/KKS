import { useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router';
import { isOpenStatus, PRIORITIES, PRIORITY_LABELS } from '@shared/constants';
import type { Task } from '@shared/types';
import { api } from '../lib/api';
import { emitLocalChange } from '../lib/realtime';
import { useSession } from '../lib/session';
import { DeadlineText, PriorityBadge, StatusBadge } from './Badges';
import { BulkCheck, bulkClick, BulkScope, useBulk } from './Bulk';
import { Icon } from './Icon';
import { useToast } from './Toasts';
import { useIncremental } from '../lib/incremental';
import { Empty } from './ui';

export function canQuickUpdate(t: Task, userId: number, commander: boolean): boolean {
  return commander || t.ownerId === userId || t.participantIds.includes(userId) || t.createdBy === userId;
}

export function TaskRow({ task, showOwner = true, extra, readOnly }: { task: Task; showOwner?: boolean; extra?: ReactNode; readOnly?: boolean }) {
  const navigate = useNavigate();
  const { user, isCommander } = useSession();
  const toast = useToast();
  const bulk = useBulk();
  const [busy, setBusy] = useState(false);
  const open = isOpenStatus(task.status);
  const canCheck = !readOnly && canQuickUpdate(task, user.id, isCommander) && open && task.status !== 'pending_approval';

  const complete = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!canCheck || busy) return;
    setBusy(true);
    try {
      const d = await api.post<{ task: Task }>(`/api/tasks/${task.id}/transition`, { action: 'complete' });
      toast({
        title: d.task.status === 'pending_approval' ? 'נשלח לאישור מפקד' : 'המשימה הושלמה',
        body: task.title,
        tone: 'green',
      });
      emitLocalChange('tasks');
    } catch (err) {
      toast({ title: (err as Error).message, tone: 'red' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className={`task-row t-${task.tone}${task.status === 'done' ? ' done' : ''}${bulk?.selected.has(task.id) ? ' selected' : ''}`}
      onClick={bulkClick(bulk, task.id, () => navigate(`/tasks/${task.id}`))}
      role="link"
      tabIndex={0}
      onKeyDown={(e) => e.key === 'Enter' && bulkClick(bulk, task.id, () => navigate(`/tasks/${task.id}`))()}
    >
      {bulk?.active ? (
        <BulkCheck id={task.id} />
      ) : (
      <button
        type="button"
        className={`task-check${task.status === 'done' ? ' checked' : ''}`}
        onClick={complete}
        disabled={!canCheck || busy}
        aria-label={task.status === 'done' ? 'הושלמה' : 'סימון כהושלמה'}
        title={canCheck ? (task.requiresApproval ? 'סימון כהושלמה (יישלח לאישור)' : 'סימון כהושלמה') : undefined}
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
          {task.domain && <span className="sep">{task.domain}</span>}
          {task.weekName && <span className="sep">{task.weekName}</span>}
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
        <StatusBadge status={task.status} overdue={task.overdue} />
      </div>
    </div>
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
