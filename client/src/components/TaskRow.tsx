import { useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router';
import { isOpenStatus } from '@shared/constants';
import type { Task } from '@shared/types';
import { api } from '../lib/api';
import { emitLocalChange } from '../lib/realtime';
import { useSession } from '../lib/session';
import { DeadlineText, PriorityBadge, StatusBadge } from './Badges';
import { Icon } from './Icon';
import { useToast } from './Toasts';
import { Empty } from './ui';

export function canQuickUpdate(t: Task, userId: number, commander: boolean): boolean {
  return commander || t.ownerId === userId || t.participantIds.includes(userId) || t.createdBy === userId;
}

export function TaskRow({ task, showOwner = true, extra, readOnly }: { task: Task; showOwner?: boolean; extra?: ReactNode; readOnly?: boolean }) {
  const navigate = useNavigate();
  const { user, isCommander } = useSession();
  const toast = useToast();
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
      className={`task-row t-${task.tone}${task.status === 'done' ? ' done' : ''}`}
      onClick={() => navigate(`/tasks/${task.id}`)}
      role="link"
      tabIndex={0}
      onKeyDown={(e) => e.key === 'Enter' && navigate(`/tasks/${task.id}`)}
    >
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

export function TaskList({ tasks, empty, showOwner = true }: { tasks: Task[]; empty?: ReactNode; showOwner?: boolean }) {
  if (!tasks.length) return <>{empty ?? <Empty title="אין משימות" />}</>;
  return (
    <div className="list">
      {tasks.map((t) => (
        <TaskRow key={t.id} task={t} showOwner={showOwner} />
      ))}
    </div>
  );
}

export function GroupTitle({ title, count, tone }: { title: string; count?: number; tone?: string }) {
  return (
    <div className="group-title">
      {tone && <span className={`dot t-${tone}`} />}
      <span>{title}</span>
      {count !== undefined && <span className="n">{count}</span>}
      <span className="line" />
    </div>
  );
}
