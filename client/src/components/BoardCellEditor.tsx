import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router';
import { BLOCK_REASONS, isOpenStatus, PRIORITIES, PRIORITY_LABELS, STATUS_LABELS, type Priority, type TaskStatus } from '@shared/constants';
import type { TaskDetail } from '@shared/types';
import { api } from '../lib/api';
import { dateKeyOf, fmtTime, isoAt } from '../lib/format';
import { forgetFinished, noteFinished } from '../lib/leaving';
import { emitLocalChange } from '../lib/realtime';
import { useSession } from '../lib/session';
import { useApi } from '../lib/useApi';
import { Icon } from './Icon';
import { useToast } from './Toasts';
import { ErrorBox, Field } from './ui';

export type BoardField = 'title' | 'owner' | 'status' | 'deadline' | 'priority';

interface BoardCellEditorProps {
  taskId: number;
  field: BoardField;
  anchor: HTMLElement;
  onClose: () => void;
}

const FIELD_LABELS: Record<BoardField, string> = { title: 'שם המשימה', owner: 'אחראי', status: 'סטטוס', deadline: 'דד־ליין', priority: 'עדיפות' };
const FOCUSABLE = 'button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]';
type TransitionAction = 'start' | 'complete' | 'unblock' | 'block' | 'approve' | 'return' | 'reopen';

/** Re-keying also discards the previous cell's draft when another cell is opened. */
export function BoardCellEditor(props: BoardCellEditorProps) {
  return <CellEditor key={`${props.taskId}:${props.field}`} {...props} />;
}

function CellEditor({ taskId, field, anchor, onClose }: BoardCellEditorProps) {
  const { users, user, weeks, isCommander, viewing, settings } = useSession();
  const toast = useToast();
  const id = useId();
  // Each opening verifies current permissions before offering edits. The server ignores this
  // query key; it gives useApi a fresh cache entry rather than showing a previously opened task.
  const detail = useApi<TaskDetail>(`/api/tasks/${taskId}?board_edit=${encodeURIComponent(id)}`, ['tasks']);
  const box = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const busyRef = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [title, setTitle] = useState('');
  const [ownerId, setOwnerId] = useState('');
  const [priority, setPriority] = useState<Priority>('normal');
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [mode, setMode] = useState<'block' | 'return' | null>(null);
  const [reason, setReason] = useState('');
  const [waitingFor, setWaitingFor] = useState('');
  const [nextStep, setNextStep] = useState('');
  const [needsCommander, setNeedsCommander] = useState(false);
  const [note, setNote] = useState('');
  const [position, setPosition] = useState<CSSProperties>({ position: 'fixed', visibility: 'hidden' });
  const task = detail.data?.task;
  const permissions = detail.data?.permissions;

  useEffect(() => {
    if (!task || ready) return;
    setTitle(task.title);
    setOwnerId(String(task.ownerId));
    setPriority(task.priority);
    setDate(dateKeyOf(task.deadline));
    setTime(fmtTime(task.deadline));
    setReason(task.blockReason ?? '');
    setWaitingFor(task.blockWaitingFor ?? '');
    setNextStep(task.blockNextStep ?? '');
    setNeedsCommander(task.needsCommander);
    setReady(true);
  }, [task, ready]);

  useLayoutEffect(() => {
    const panel = box.current;
    if (!panel) return;
    const place = () => {
      const viewport = window.visualViewport;
      const leftEdge = (viewport?.offsetLeft ?? 0) + 8;
      const topEdge = (viewport?.offsetTop ?? 0) + 8;
      const viewWidth = viewport?.width ?? window.innerWidth;
      const viewHeight = viewport?.height ?? window.innerHeight;
      const width = Math.max(0, Math.min(360, viewWidth - 16));
      const maxHeight = Math.max(0, viewHeight - 16);
      const rect = anchor.getBoundingClientRect();
      const height = Math.min(panel.getBoundingClientRect().height, maxHeight);
      const below = rect.bottom + 6;
      const above = rect.top - height - 6;
      const top = below + height <= topEdge + maxHeight ? below : above >= topEdge ? above : topEdge;
      setPosition({
        position: 'fixed',
        zIndex: 160,
        width,
        maxHeight,
        overflowY: 'auto',
        left: Math.max(leftEdge, Math.min(rect.right - width, leftEdge + viewWidth - 16 - width)),
        top: Math.max(topEdge, Math.min(top, topEdge + maxHeight - height)),
      });
    };
    place();
    const observer = new ResizeObserver(place);
    observer.observe(panel);
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    window.visualViewport?.addEventListener('resize', place);
    window.visualViewport?.addEventListener('scroll', place);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
      window.visualViewport?.removeEventListener('resize', place);
      window.visualViewport?.removeEventListener('scroll', place);
    };
  }, [anchor]);

  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    box.current?.focus({ preventScroll: true });
    const outside = (event: PointerEvent) => {
      if (!busyRef.current && event.target instanceof Node && !box.current?.contains(event.target)) closeRef.current();
    };
    document.addEventListener('pointerdown', outside, true);
    return () => {
      document.removeEventListener('pointerdown', outside, true);
      const target = anchor.isConnected ? anchor : previous?.isConnected ? previous : null;
      target?.focus({ preventScroll: true });
    };
  }, [anchor]);

  useEffect(() => {
    if (!ready) return;
    const target = box.current?.querySelector<HTMLElement>('[data-board-autofocus]');
    target?.focus({ preventScroll: true });
    if (target instanceof HTMLInputElement && target.type === 'text') target.select();
  }, [ready, mode]);

  const keyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    // The portal remains part of the board's React tree; its keys must not activate a row.
    event.stopPropagation();
    if (event.key === 'Escape') {
      event.preventDefault();
      if (!busyRef.current) closeRef.current();
    }
    if (event.key !== 'Tab') return;
    const focusable = [...(box.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])].filter((el) => el.getClientRects().length > 0);
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (!first) {
      event.preventDefault();
      box.current?.focus();
    } else if (event.shiftKey && (document.activeElement === first || document.activeElement === box.current)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (document.activeElement === last || document.activeElement === box.current)) {
      event.preventDefault();
      first.focus();
    }
  };

  const allowed = (action: TransitionAction) => {
    if (!task || !permissions || viewing) return false;
    if (action === 'reopen') return !isOpenStatus(task.status) && (permissions.canEdit || permissions.canApprove);
    if (action === 'approve' || action === 'return') return task.status === 'pending_approval' && permissions.canApprove;
    if (action === 'unblock') return task.status === 'waiting' && (permissions.canUpdateStatus || isCommander);
    if (!permissions.canUpdateStatus) return false;
    if (action === 'start') return task.status === 'todo';
    return task.status === 'todo' || task.status === 'in_progress' || task.status === 'waiting';
  };
  const canEdit = !!permissions && !viewing && (field === 'owner' ? permissions.canChangeOwner : field === 'deadline' ? permissions.canChangeDeadline : permissions.canEdit);
  const actions: { action: TransitionAction; label: string; status: TaskStatus; icon: string }[] = [
    { action: 'start', label: 'בטיפול', status: 'in_progress', icon: 'play' },
    { action: 'complete', label: task?.requiresApproval && !permissions?.canApprove ? 'שליחה לאישור סגירה' : 'הושלם', status: task?.requiresApproval && !permissions?.canApprove ? 'pending_approval' : 'done', icon: 'check' },
    { action: 'unblock', label: 'החסם טופל · חזרה לטיפול', status: 'in_progress', icon: 'play' },
    { action: 'block', label: task?.status === 'waiting' ? 'עדכון החסם' : 'ממתין / חסום', status: 'waiting', icon: 'pause' },
    { action: 'approve', label: 'אישור סגירה', status: 'done', icon: 'check' },
    { action: 'return', label: 'החזרה להשלמה', status: 'in_progress', icon: 'repeat' },
    { action: 'reopen', label: 'פתיחה מחדש', status: 'in_progress', icon: 'repeat' },
  ].filter((item) => allowed(item.action as TransitionAction)) as typeof actions;
  const readOnly = field === 'status' ? !actions.length : !canEdit;

  const undoCompletion = async () => {
    try {
      await api.post<TaskDetail>(`/api/tasks/${taskId}/transition`, { action: 'undo_complete' });
      forgetFinished('tasks', taskId);
      emitLocalChange('tasks');
      toast({ title: 'סימון ההשלמה בוטל', tone: 'green' });
    } catch (cause) {
      toast({ title: cause instanceof Error ? cause.message : 'לא ניתן לבטל את הסימון', tone: 'red' });
    }
  };

  const save = async (body: Record<string, unknown>, action?: TransitionAction) => {
    if (busyRef.current) return;
    if ((action && !allowed(action)) || (!action && !canEdit)) return setError('אין לך הרשאה לשנות את השדה הזה. אפשר לפתוח את המשימה לפרטים נוספים.');
    busyRef.current = true;
    setBusy(true);
    setError(null);
    try {
      const result = action
        ? await api.post<TaskDetail>(`/api/tasks/${taskId}/transition`, { action, ...body })
        : await api.patch<TaskDetail>(`/api/tasks/${taskId}`, body);
      detail.setData(result);
      if (result.task.status === 'done') noteFinished('tasks', [taskId]);
      else if (isOpenStatus(result.task.status)) forgetFinished('tasks', taskId);
      emitLocalChange('tasks');
      toast({
        title: action ? `הסטטוס עודכן: ${STATUS_LABELS[result.task.status]}` : 'השינוי נשמר',
        tone: 'green',
        action: action === 'complete' && result.task.status === 'done' ? { label: 'ביטול הסימון', run: () => void undoCompletion() } : undefined,
      });
      closeRef.current();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'השינוי לא נשמר. אפשר לנסות שוב.');
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  const saveField = () => {
    if (!task) return;
    try {
      const body: Record<string, unknown> = field === 'title' ? { title: title.trim() } : field === 'owner' ? { ownerId: Number(ownerId) } : field === 'deadline' ? { deadline: isoAt(date, time) } : { priority };
      const key = Object.keys(body)[0] as keyof typeof task;
      if (body[key] === task[key]) return closeRef.current();
      void save(body);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'יש לבדוק את פרטי השינוי');
    }
  };

  const canAssignCommander = isCommander || weeks.some((week) => week.id === task?.weekId && week.leadId === user.id);
  const owners = users.filter((person) => person.id === task?.ownerId || (person.active && (canAssignCommander || person.role === 'staff')));
  const formValid = field === 'title' ? title.trim().length > 0 : field === 'owner' ? !!ownerId : field === 'deadline' ? !!date && !!time : true;
  const blockValid = BLOCK_REASONS.some((item) => item === reason) && waitingFor.trim().length >= 2 && nextStep.trim().length >= 2;
  const readonlyMessage = viewing ? 'קורס קודם פתוח לקריאה בלבד.' : field === 'owner' && permissions?.canRequestTransfer ? 'העברת האחריות דורשת אישור. אפשר להגיש בקשה מתוך המשימה.' : field === 'deadline' && permissions?.canRequestDeadline ? 'שינוי הדד־ליין דורש אישור. אפשר להגיש בקשה מתוך המשימה.' : 'אין כרגע פעולה זמינה עבורך בשדה הזה. פרטי המשימה זמינים לצפייה.';

  return createPortal(
    <div ref={box} className="board-editor" role="dialog" aria-labelledby={`${id}-title`} aria-describedby={ready && task ? `${id}-task` : undefined} aria-busy={busy || !ready && !detail.error} style={position} tabIndex={-1} dir="rtl" onKeyDown={keyDown} onClick={(event) => event.stopPropagation()} onPointerDown={(event) => event.stopPropagation()}>
      <div className="board-editor-head">
        <h2 id={`${id}-title`}>{mode === 'block' ? 'פרטי החסם' : mode === 'return' ? 'החזרה להשלמה' : FIELD_LABELS[field]}</h2>
        <button type="button" className="icon-btn" aria-label="סגירת העריכה" onClick={onClose} disabled={busy}><Icon name="x" size={18} /></button>
      </div>
      <div className="board-editor-body">
        {ready && task && <p className="board-editor-hint" id={`${id}-task`}>{task.title}</p>}
        {!ready && !detail.error && <p className="board-editor-hint" role="status">טוען פרטי משימה…</p>}
        <ErrorBox error={detail.error ?? error} />
        {detail.error && !ready && <button type="button" className="btn btn-sm" onClick={() => void detail.reload()}>ניסיון נוסף</button>}
        {ready && task && (readOnly ? <p className="board-editor-hint">{readonlyMessage}</p> : field === 'status' ? (
          mode ? (
            <form className="board-editor-form" onSubmit={(event) => {
              event.preventDefault();
              if (mode === 'block' && blockValid) void save({ reason, waitingFor: waitingFor.trim(), nextStep: nextStep.trim(), needsCommander }, 'block');
              if (mode === 'return' && note.trim().length >= 2) void save({ note: note.trim() }, 'return');
            }}>
              {mode === 'block' ? <>
                <Field label="סיבת החסם" required><select className="select" data-board-autofocus value={reason} onChange={(event) => setReason(event.target.value)} disabled={busy} required><option value="">בחירת סיבה</option>{BLOCK_REASONS.map((item) => <option key={item}>{item}</option>)}</select></Field>
                <Field label="למי ממתינים?" required><input className="input" value={waitingFor} onChange={(event) => setWaitingFor(event.target.value)} minLength={2} maxLength={200} disabled={busy} required /></Field>
                <Field label="מה הצעד הבא?" required><input className="input" value={nextStep} onChange={(event) => setNextStep(event.target.value)} minLength={2} maxLength={300} disabled={busy} required /></Field>
                <label className="check"><input type="checkbox" checked={needsCommander} onChange={(event) => setNeedsCommander(event.target.checked)} disabled={busy} />נדרשת התערבות מפקד</label>
              </> : <Field label="מה חסר להשלמת המשימה?" required><textarea className="textarea" data-board-autofocus value={note} onChange={(event) => setNote(event.target.value)} minLength={2} maxLength={2000} rows={3} disabled={busy} required /></Field>}
              <div className="board-editor-actions"><button type="submit" className="btn btn-primary btn-sm" disabled={busy || (mode === 'block' ? !blockValid : note.trim().length < 2)}>{busy ? 'שומר…' : mode === 'block' ? 'שמירת החסם' : 'החזרה להשלמה'}</button><button type="button" className="btn btn-ghost btn-sm" onClick={() => { setMode(null); setError(null); }} disabled={busy}>חזרה</button></div>
            </form>
          ) : <>
            <p className="board-editor-hint">כרגע: {STATUS_LABELS[task.status]}</p>
            {task.openDependencies > 0 && <p className="board-editor-hint">המשימה תלויה ב־{task.openDependencies} משימות שעדיין פתוחות.</p>}
            <div className="board-editor-statuses">{actions.map((item, index) => <button key={item.action} type="button" className="board-editor-status" data-status={item.status} data-board-autofocus={index === 0 || undefined} disabled={busy} onClick={() => { setError(null); if (item.action === 'block' || item.action === 'return') setMode(item.action); else void save({}, item.action); }}><Icon name={item.icon} size={16} /><span>{item.label}</span></button>)}</div>
            {busy && <p className="board-editor-hint" role="status">מעדכן סטטוס…</p>}
          </>
        ) : (
          <form className="board-editor-form" onSubmit={(event) => { event.preventDefault(); if (formValid) saveField(); }}>
            {field === 'title' && <Field label="שם המשימה" required><input className="input" type="text" data-board-autofocus value={title} onChange={(event) => setTitle(event.target.value)} maxLength={200} disabled={busy} required /></Field>}
            {field === 'owner' && <Field label="אחראי" required><select className="select" data-board-autofocus value={ownerId} onChange={(event) => setOwnerId(event.target.value)} disabled={busy} required>{!owners.some((person) => person.id === task.ownerId) && <option value={task.ownerId}>{task.ownerName}</option>}{owners.map((person) => <option key={person.id} value={person.id}>{person.displayName}{person.active ? '' : ' (לא פעיל)'}</option>)}</select></Field>}
            {field === 'priority' && <Field label="עדיפות"><select className="select" data-board-autofocus value={priority} onChange={(event) => setPriority(event.target.value as Priority)} disabled={busy}>{PRIORITIES.map((item) => <option key={item} value={item}>{PRIORITY_LABELS[item]}</option>)}</select></Field>}
            {field === 'deadline' && <><div className="board-editor-dates"><Field label="תאריך" required><input className="input" type="date" dir="ltr" data-board-autofocus value={date} onChange={(event) => setDate(event.target.value)} disabled={busy} required /></Field><Field label="שעה" required><input className="input" type="time" dir="ltr" value={time} onChange={(event) => setTime(event.target.value)} disabled={busy} required /></Field></div><p className="board-editor-hint">לפי אזור הזמן של הקורס: {settings.timezone}</p></>}
            <div className="board-editor-actions"><button type="submit" className="btn btn-primary btn-sm" disabled={busy || !formValid}>{busy ? 'שומר…' : 'שמירה'}</button><button type="button" className="btn btn-ghost btn-sm" onClick={onClose} disabled={busy}>ביטול</button></div>
          </form>
        ))}
        <Link className="board-editor-link" to={`/tasks/${taskId}`} onClick={onClose}>פתיחת המשימה<Icon name="chevronLeft" size={14} /></Link>
      </div>
    </div>,
    document.body,
  );
}
