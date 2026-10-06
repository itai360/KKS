import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router';
import { domainLabel, isOpenStatus, PRIORITIES, PRIORITY_LABELS } from '@shared/constants';
import type { Task } from '@shared/types';
import { api } from '../lib/api';
import { emitLocalChange } from '../lib/realtime';
import { useSession } from '../lib/session';
import { prefetch } from '../lib/useApi';
import { DeadlineText, PriorityBadge, StatusBadge } from './Badges';
import { BulkCheck, bulkClick, BulkScope, useBulk } from './Bulk';
import { Icon } from './Icon';
import { useToast } from './Toasts';
import { useIncremental } from '../lib/incremental';
import { Empty, openable } from './ui';

export function canQuickUpdate(t: Task, userId: number, commander: boolean): boolean {
  return commander || t.ownerId === userId || t.participantIds.includes(userId) || t.createdBy === userId;
}

// several ticks in a row: the list refreshes once, a moment after the last, so rows do not move under the pointer
let refreshTimer: ReturnType<typeof setTimeout> | null = null;
function refreshSoon() {
  if (refreshTimer) clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => {
    refreshTimer = null;
    emitLocalChange('tasks');
  }, 1200);
}

/** Marking a task done from a list: shown done at once, then the list moves it to the completed. */
export function useTaskTick(task: Task, readOnly?: boolean) {
  const { user, isCommander } = useSession();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  // ticked: shown done at once, until the list comes back without it (or with it as done)
  const [ticked, setTicked] = useState(false);
  const open = isOpenStatus(task.status);
  const canCheck = !readOnly && canQuickUpdate(task, user.id, isCommander) && open && task.status !== 'pending_approval';
  const done = task.status === 'done' || ticked;
  const complete = async (e: React.MouseEvent | React.KeyboardEvent) => {
    e.stopPropagation();
    if (!canCheck || busy) return;
    setBusy(true);
    if (!task.requiresApproval || isCommander) setTicked(true);
    // a short buzz on a phone that has one: it was taken
    try {
      navigator.vibrate?.(12);
    } catch {
      /* not allowed here */
    }
    try {
      const d = await api.post<{ task: Task }>(`/api/tasks/${task.id}/transition`, { action: 'complete' });
      const closed = d.task.status === 'done';
      toast({
        title: closed ? 'המשימה הושלמה' : 'נשלח לאישור מפקד',
        body: task.title,
        tone: 'green',
        // ticked by mistake: one press puts it back
        action: closed ? { label: 'ביטול', run: () => void undo() } : undefined,
      });
      refreshSoon();
    } catch (err) {
      setTicked(false);
      toast({ title: (err as Error).message, tone: 'red' });
    } finally {
      setBusy(false);
    }
  };
  const undo = async () => {
    try {
      await api.post(`/api/tasks/${task.id}/transition`, { action: 'undo_complete' });
      setTicked(false);
      emitLocalChange('tasks');
      toast({ title: 'הסימון בוטל', body: task.title, tone: 'gray' });
    } catch (err) {
      toast({ title: (err as Error).message, tone: 'red' });
    }
  };
  return { done, canCheck, busy, complete, open, ticked };
}

/** The round "done" button of a task in a list, a table or on the board. */
export function TaskCheck({ task, tick, small }: { task: Task; tick: ReturnType<typeof useTaskTick>; small?: boolean }) {
  const { done, canCheck, busy, complete } = tick;
  return (
    <button
      type="button"
      className={`task-check${done ? ' checked' : ''}${tick.ticked ? ' just-checked' : ''}${small ? ' small' : ''}`}
      onClick={complete}
      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && e.stopPropagation()}
      disabled={!canCheck || busy}
      aria-label={done ? `הושלמה: ${task.title}` : `סימון כהושלמה: ${task.title}`}
      title={canCheck ? (task.requiresApproval ? 'סימון כהושלמה (יישלח לאישור)' : 'סימון כהושלמה') : undefined}
    >
      <Icon name="check" />
    </button>
  );
}

/** a row whose task just changed while it was on the screen - by anyone - lights up for a moment */
export function useLiveFlash(signature: string): boolean {
  const last = useRef(signature);
  const [flash, setFlash] = useState(false);
  useEffect(() => {
    if (last.current === signature) return;
    last.current = signature;
    setFlash(true);
    const timer = setTimeout(() => setFlash(false), 1400);
    return () => clearTimeout(timer);
  }, [signature]);
  return flash;
}

/** the task's page, fetched while the pointer rests on its row - so it opens at once */
export const prefetchTask = (id: number) => prefetch(`/api/tasks/${id}`);

export function TaskRow({ task, showOwner = true, extra, readOnly }: { task: Task; showOwner?: boolean; extra?: ReactNode; readOnly?: boolean }) {
  const navigate = useNavigate();
  const bulk = useBulk();
  const tick = useTaskTick(task, readOnly);
  const { done, open } = tick;
  const flash = useLiveFlash(`${task.status}|${task.deadline}|${task.ownerId}|${task.title}|${task.priority}|${task.overdue}`);

  return (
    <div
      className={`task-row t-${done ? 'green' : task.tone}${done ? ' done' : ''}${bulk?.selected.has(task.id) ? ' selected' : ''}${flash ? ' flash' : ''}`}
      {...openable(bulkClick(bulk, task.id, () => navigate(`/tasks/${task.id}`)))}
      onPointerEnter={() => prefetchTask(task.id)}
      onFocus={() => prefetchTask(task.id)}
    >
      {bulk?.active ? <BulkCheck id={task.id} /> : <TaskCheck task={task} tick={tick} />}
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
        <StatusBadge status={task.status} overdue={task.overdue} />
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
