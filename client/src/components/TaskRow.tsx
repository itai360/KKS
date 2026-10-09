import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router';
import { domainLabel, isOpenStatus, PRIORITIES, PRIORITY_LABELS } from '@shared/constants';
import type { Task } from '@shared/types';
import { api } from '../lib/api';
import { haptic } from '../lib/haptics';
import { finishedJustNow, forgetFinished, noteFinished, useLeaving, type LeavePhase } from '../lib/leaving';
import { namesOf } from '@shared/staffGroups';
import { collapseGroups, expandUnits, foldTasks, groupView, isGrouped, peopleOf } from '../lib/taskGroups';
import { emitLocalChange } from '../lib/realtime';
import { useSession } from '../lib/session';
import { prefetch } from '../lib/useApi';
import { DeadlineText, PriorityBadge, StatusBadge } from './Badges';
import { BulkCheck, bulkClick, BulkScope, SwipeRow, useBulk } from './Bulk';
import { DoneDrawer } from './DoneDrawer';
import { Icon } from './Icon';
import { useToast } from './Toasts';
import { useIncremental } from '../lib/incremental';
import { unlessHeld, useTaskMenu } from './TaskMenu';
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
  const complete = async (e?: React.MouseEvent | React.KeyboardEvent) => {
    e?.stopPropagation();
    if (!canCheck || busy) return;
    setBusy(true);
    if (!task.requiresApproval || isCommander) setTicked(true);
    // a short buzz on a phone that has one, on the same frame as the tick: it was taken
    haptic('success');
    try {
      const d = await api.post<{ task: Task }>(`/api/tasks/${task.id}/transition`, { action: 'complete' });
      const closed = d.task.status === 'done';
      // a list it now goes from lets it go done, folding (lib/leaving.ts)
      if (closed) noteFinished('tasks', [task.id]);
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
      forgetFinished('tasks', task.id);
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

/** who a task went to, beside its owner: its group's name ("סגל"), or the names of people who are not one group */
export function useGroupTag(task: Task, ownerShown: boolean): string {
  const { userName } = useSession();
  const people = peopleOf(task);
  if (people.length < 2) return '';
  if (task.groupName) return task.groupName;
  // one task they share, its owner already named: who shares it with them
  if (!isGrouped(task) && ownerShown) return `עם ${namesOf(task.participantIds.map(userName))}`;
  return namesOf(people.map(userName));
}

/** a copy for each person: how many have done theirs */
export function groupProgressOf(task: Task): { done: number; total: number } | null {
  if (!isGrouped(task)) return null;
  return { done: task.groupCopies.filter((c) => c.done).length, total: task.groupCopies.length };
}

export function GroupTag({ label, className = '' }: { label: string; className?: string }) {
  return (
    <span className={`group-tag ${className}`} title="קבוצה">
      <Icon name="users" size={12} />
      {label}
    </span>
  );
}

export function ProgressBadge({ task }: { task: Task }) {
  const p = groupProgressOf(task);
  if (!p) return null;
  const all = p.done === p.total;
  return (
    <span className={`badge mono t-${all ? 'green' : 'blue'}`} title={`${p.done} מתוך ${p.total} השלימו`} aria-label={`${p.done} מתוך ${p.total} השלימו`}>
      {p.done}/{p.total}
    </span>
  );
}

export function TaskRow({
  task,
  showOwner = true,
  extra,
  readOnly,
  folded,
  arrived,
  leaving,
}: {
  task: Task;
  showOwner?: boolean;
  extra?: ReactNode;
  readOnly?: boolean;
  folded?: boolean;
  /** just added while the list was open: it comes in */
  arrived?: boolean;
  /** done, and going from the list: a moment, then it folds away */
  leaving?: LeavePhase;
}) {
  const navigate = useNavigate();
  const bulk = useBulk();
  // a row for the whole group is no one's copy to tick
  const tick = useTaskTick(task, readOnly || folded);
  const ownerShown = showOwner && !folded;
  const tag = useGroupTag(task, ownerShown);
  const { done, open } = tick;
  const flash = useLiveFlash(`${task.status}|${task.deadline}|${task.ownerId}|${task.title}|${task.priority}|${task.overdue}`);
  // on a phone, swiped toward its leading side it is done (the round button stays for everyone else),
  // and toward its trailing side deleted - where the list deletes
  const canSwipeDone = tick.canCheck && !done && !tick.busy;
  // held (a phone) or right-clicked (a computer): what is done with it most, without opening it
  const menu = useTaskMenu(task, tick, bulk?.active);

  return (
    <SwipeRow itemId={task.id} label={task.title} leaving={leaving} done={canSwipeDone && !leaving ? { label: task.requiresApproval ? 'לאישור' : 'בוצע', run: () => void tick.complete() } : null}>
    <div
      className={`task-row t-${done ? 'green' : task.tone}${done ? ' done' : ''}${bulk?.selected.has(task.id) ? ' selected' : ''}${flash ? ' flash' : ''}${menu.lifted ? ' is-lifted' : ''}${arrived ? ' is-arrived' : ''}`}
      {...openable(bulkClick(bulk, task.id, unlessHeld(menu, () => navigate(`/tasks/${task.id}`))))}
      {...menu.bind}
      onPointerEnter={() => prefetchTask(task.id)}
      onFocus={() => prefetchTask(task.id)}
    >
      {bulk?.active ? <BulkCheck id={task.id} /> : <TaskCheck task={task} tick={tick} />}
      <div className="task-main">
        <div className="task-title">{task.title}</div>
        <div className="task-meta">
          {ownerShown && <span>{task.ownerName}</span>}
          {tag && <GroupTag label={tag} className={ownerShown ? 'sep' : ''} />}
          <span className={ownerShown || tag ? 'sep' : ''}>
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
        <ProgressBadge task={task} />
        <PriorityBadge priority={task.priority} />
        <StatusBadge status={task.status} overdue={task.overdue} />
      </div>
    </div>
    {menu.menu}
    </SwipeRow>
  );
}

/** A task given to a group as one row: under its group's name, with how many have done theirs - not anyone's copy to tick. */
export function GroupTaskRow({ task }: { task: Task }) {
  const { user } = useSession();
  return <TaskRow task={groupView({ task, copies: [task] }, user.id)} folded />;
}

/** Selecting tasks on a page and changing them together (wrap the page, put <BulkToggle /> in its actions). */
export function TaskBulkScope({ tasks, collapse = true, children }: { tasks: Task[]; /** one row for each task given to a group, as the lists show it */ collapse?: boolean; children: ReactNode }) {
  const { users, weeks, settings, user, isCommander } = useSession();
  const active = users.filter((u) => u.active);
  // a row for a whole group stands for all of its copies
  const { rows, expand } = useMemo(() => {
    const units = collapse ? collapseGroups(tasks, user.id) : tasks.map((t) => ({ task: t, copies: [t] }));
    return { rows: units.map((u) => u.task), expand: collapse ? expandUnits(units, user.id) : undefined };
  }, [tasks, collapse, user.id]);
  return (
    <BulkScope
      entity="tasks"
      noun="משימות"
      topics={['tasks', 'weeks']}
      ids={rows.map((t) => t.id)}
      expand={expand}
      // deleted in place only where the server would delete it: by its creator, or by the commander
      deletable={rows.filter((t) => isCommander || t.createdBy === user.id).map((t) => t.id)}
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

/** a list's rows, with the ones ticked done here and gone from it: they stay a moment, done, and fold away */
function useLeavingTasks(tasks: Task[], collapse: boolean) {
  const { user } = useSession();
  const folded = useMemo(() => foldTasks(tasks, user.id, collapse), [tasks, collapse, user.id]);
  return useLeaving(folded, (r) => r.task.id, (id, last) => finishedJustNow('tasks', id) && { ...last, task: doneNow(last.task) });
}

function Rows({ leaving, showOwner }: { leaving: ReturnType<typeof useLeavingTasks>; showOwner: boolean }) {
  const { shown, more } = useIncremental(leaving.rows);
  return (
    <>
      <div className="list">
        {shown.map((r) => (
          <TaskRow key={r.task.id} task={r.task} showOwner={showOwner} folded={r.folded} leaving={leaving.phaseOf(r.task.id)} />
        ))}
      </div>
      {more}
    </>
  );
}

export function TaskList({ tasks, empty, showOwner = true, collapse = true }: { tasks: Task[]; empty?: ReactNode; showOwner?: boolean; /** false: one person's tasks - each copy is theirs */ collapse?: boolean }) {
  const leaving = useLeavingTasks(tasks, collapse);
  if (!leaving.rows.length) return <>{empty ?? <Empty title="אין משימות" />}</>;
  return <Rows leaving={leaving} showOwner={showOwner} />;
}

/** a titled part of a list ("היום", "באיחור"): there while it has tasks - and while its last one, done, goes */
export function TaskSection({ title, id, tone, tasks, showOwner = true, collapse = true }: { title: string; id?: string; tone?: string; tasks: Task[]; showOwner?: boolean; collapse?: boolean }) {
  const leaving = useLeavingTasks(tasks, collapse);
  if (!leaving.rows.length) return null;
  return (
    <>
      <GroupTitle id={id} title={title} count={tasks.length} tone={tone} />
      <Rows leaving={leaving} showOwner={showOwner} />
    </>
  );
}

/** the open tasks of something (a task's parts, a debrief's follow-ups) - and the done ones in a drawer under them */
export function OpenTaskList({ tasks, drawerId, empty, showOwner = true }: { tasks: Task[]; drawerId: string; empty?: ReactNode; showOwner?: boolean }) {
  const open = useMemo(() => tasks.filter((t) => isOpenStatus(t.status)), [tasks]);
  const done = useMemo(() => tasks.filter((t) => !isOpenStatus(t.status)), [tasks]);
  return (
    <>
      <TaskList
        tasks={open}
        showOwner={showOwner}
        empty={
          tasks.length ? (
            <p className="small all-done-line">
              <Icon name="check" size={15} /> כולן הושלמו.
            </p>
          ) : (
            empty
          )
        }
      />
      <DoneDrawer id={drawerId} count={done.length} label="הושלמו">
        <TaskList tasks={done} showOwner={showOwner} />
      </DoneDrawer>
    </>
  );
}

/** an open task's heading when grouped by status */
const openStatusGroup = (t: Task) => (t.overdue ? 'באיחור' : t.status === 'waiting' ? 'ממתינות' : 'פתוחות');

/**
 * Tasks under headings (by area, owner, week or status): the open ones - what is done is in one drawer
 * under them. A heading whose last task is ticked done stays until that task has folded away.
 */
export function GroupedTaskList({ tasks, by, drawerId, empty }: { tasks: Task[]; by: (t: Task) => string; drawerId: string; empty?: ReactNode }) {
  const open = useMemo(() => tasks.filter((t) => isOpenStatus(t.status)), [tasks]);
  const done = useMemo(() => tasks.filter((t) => !isOpenStatus(t.status)), [tasks]);
  const groups = useMemo(() => {
    const map = new Map<string, Task[]>();
    for (const t of open) map.set(by(t), [...(map.get(by(t)) ?? []), t]);
    return [...map.entries()];
  }, [open, by]);
  // a heading gone with its last task stays, empty, while that task folds away
  const shownGroups = useLeaving(groups, ([k]) => k, (k) => [k, []] as [string, Task[]]);
  if (!tasks.length) return <>{empty ?? <Empty title="אין משימות" />}</>;
  return (
    <>
      {shownGroups.rows.map(([k, list]) => (
        <div key={k} className="task-group" data-group={k}>
          <TaskSection title={k} tasks={list} tone={list.some((t) => t.overdue) ? 'red' : undefined} />
        </div>
      ))}
      {!open.length && <p className="small muted">כל המשימות כאן הושלמו.</p>}
      <DoneDrawer id={drawerId} count={done.length} label="הושלמו">
        <TaskList tasks={done} />
      </DoneDrawer>
    </>
  );
}

/** grouping by status, for GroupedTaskList */
export const byOpenStatus = openStatusGroup;

/** a task as it is once done, for the moment it is seen going */
export const doneNow = (t: Task): Task => ({ ...t, status: 'done', overdue: false });

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
