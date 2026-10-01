import { PRIORITY_LABELS, STATUS_LABELS, type Priority, type TaskStatus, type Tone } from '@shared/constants';
import type { Task } from '@shared/types';
import { fmtDeadline } from '../lib/format';

const STATUS_TONE: Record<TaskStatus, Tone> = {
  todo: 'gray',
  in_progress: 'yellow',
  waiting: 'purple',
  pending_approval: 'blue',
  done: 'green',
  cancelled: 'gray',
};

export function StatusBadge({ status, overdue }: { status: TaskStatus; overdue?: boolean }) {
  return (
    <>
      <span className={`badge t-${STATUS_TONE[status]}`}>{STATUS_LABELS[status]}</span>
      {overdue && <span className="badge t-red">באיחור</span>}
    </>
  );
}

export function PriorityBadge({ priority, hideNormal = true }: { priority: Priority; hideNormal?: boolean }) {
  if (hideNormal && (priority === 'normal' || priority === 'low')) return null;
  const tone: Tone = priority === 'critical' ? 'red' : priority === 'high' ? 'orange' : 'gray';
  return <span className={`badge badge-outline t-${tone}`}>{priority === 'critical' ? '⚑ ' : ''}{PRIORITY_LABELS[priority]}</span>;
}

export function DeadlineText({ task }: { task: Pick<Task, 'deadline' | 'overdue' | 'dueSoon'> }) {
  return <span className={`deadline${task.overdue ? ' late' : task.dueSoon ? ' soon' : ''}`}>{fmtDeadline(task.deadline)}</span>;
}

export { STATUS_TONE };
