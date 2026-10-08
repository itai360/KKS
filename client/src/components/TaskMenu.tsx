// Holding a task on a phone, or right-clicking it on a computer, brings up what is done with it most -
// done, started, a day or a week later, open, copy its link - without opening it, as Apple's context
// menus do: the row lifts under the finger with a short buzz, and the actions come up beside it. Only
// what this person may do is offered; a deadline moved can be put back from the message that says so.

import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router';
import { addDays } from '@shared/dates';
import type { Task } from '@shared/types';
import { api } from '../lib/api';
import { dateKeyOf, fmtDeadline, fmtTime, isoAt } from '../lib/format';
import { haptic } from '../lib/haptics';
import { emitLocalChange } from '../lib/realtime';
import { useSession } from '../lib/session';
import { Icon } from './Icon';
import { Sheet, usePhonePicker } from './pickers';
import { useToast } from './Toasts';
import type { useTaskTick } from './TaskRow';

const HOLD_MS = 450;

interface Item {
  key: string;
  label: string;
  icon: string;
  run: () => void;
}

/**
 * The quick actions of one task row: `bind` goes on the row, `menu` is rendered beside it, `lifted`
 * marks the row while its menu is up, and `swallow()` tells a click that a hold just opened the menu.
 */
export function useTaskMenu(task: Task, tick: ReturnType<typeof useTaskTick>, disabled?: boolean) {
  const { user, isCommander, viewing } = useSession();
  const navigate = useNavigate();
  const toast = useToast();
  const phone = usePhonePicker();
  const [at, setAt] = useState<{ x: number; y: number } | null>(null);
  const hold = useRef<{ timer: ReturnType<typeof setTimeout>; x: number; y: number } | null>(null);
  const swallowNext = useRef(false);
  const row = useRef<HTMLElement | null>(null);
  const open = at !== null;
  const close = () => setAt(null);

  const shift = async (days: number) => {
    const before = task.deadline;
    const next = isoAt(addDays(dateKeyOf(before), days), fmtTime(before));
    try {
      await api.patch(`/api/tasks/${task.id}`, { deadline: next });
      emitLocalChange('tasks');
      toast({
        title: `הדד-ליין זז ל${fmtDeadline(next)}`,
        body: task.title,
        tone: 'green',
        action: {
          label: 'ביטול',
          run: () =>
            void api
              .patch(`/api/tasks/${task.id}`, { deadline: before })
              .then(() => emitLocalChange('tasks'))
              .catch((e: Error) => toast({ title: e.message, tone: 'red' })),
        },
      });
    } catch (e) {
      toast({ title: (e as Error).message, tone: 'red' });
    }
  };
  const start = async () => {
    try {
      await api.post(`/api/tasks/${task.id}/transition`, { action: 'start' });
      emitLocalChange('tasks');
      toast({ title: 'סומן "בטיפול"', body: task.title, tone: 'green' });
    } catch (e) {
      toast({ title: (e as Error).message, tone: 'red' });
    }
  };
  const copy = async () => {
    const url = `${location.origin}/tasks/${task.id}`;
    try {
      await navigator.clipboard.writeText(url);
      toast({ title: 'הקישור למשימה הועתק', tone: 'green' });
    } catch {
      toast({ title: url, tone: 'gray' });
    }
  };

  const moves = !viewing && (isCommander || task.createdBy === user.id) && tick.open && !!task.deadline;
  const items: Item[] = [
    ...(tick.canCheck && !tick.done ? [{ key: 'done', label: task.requiresApproval && !isCommander ? 'בוצע - לאישור' : 'בוצע', icon: 'check', run: () => void tick.complete() }] : []),
    ...(tick.canCheck && task.status === 'todo' ? [{ key: 'start', label: 'התחלתי לטפל', icon: 'play', run: () => void start() }] : []),
    ...(moves ? [{ key: 'day', label: 'דחייה ביום', icon: 'clock', run: () => void shift(1) }] : []),
    ...(moves ? [{ key: 'week', label: 'דחייה בשבוע', icon: 'calendar', run: () => void shift(7) }] : []),
    { key: 'open', label: 'פתיחת המשימה', icon: 'chevronLeft', run: () => navigate(`/tasks/${task.id}`) },
    { key: 'copy', label: 'העתקת קישור', icon: 'link', run: () => void copy() },
  ];

  const cancelHold = () => {
    if (hold.current) clearTimeout(hold.current.timer);
    hold.current = null;
  };
  useEffect(() => {
    return cancelHold;
  }, []);

  // the menu is portalled, but React still bubbles its events up to the row: only the row's own count
  const onRow = (e: { currentTarget: HTMLElement; target: EventTarget }) => e.currentTarget.contains(e.target as Node);
  const bind = {
    onPointerDown: (e: ReactPointerEvent<HTMLElement>) => {
      if (!onRow(e)) return;
      row.current = e.currentTarget;
      swallowNext.current = false;
      if (disabled || e.pointerType !== 'touch' || (e.target as HTMLElement).closest('button, a, input, label')) return;
      const { clientX: x, clientY: y } = e;
      cancelHold();
      hold.current = {
        x,
        y,
        timer: setTimeout(() => {
          hold.current = null;
          swallowNext.current = true;
          // the finger still down: when it lifts, no click follows it - onto the sheet now under it
          row.current?.addEventListener('touchend', (ev) => ev.cancelable && ev.preventDefault(), { once: true, passive: false });
          haptic('tick');
          setAt({ x, y });
        }, HOLD_MS),
      };
    },
    onPointerMove: (e: ReactPointerEvent) => {
      if (hold.current && Math.hypot(e.clientX - hold.current.x, e.clientY - hold.current.y) > 8) cancelHold();
    },
    onPointerUp: cancelHold,
    onPointerCancel: cancelHold,
    onContextMenu: (e: ReactMouseEvent<HTMLElement>) => {
      if (disabled || !onRow(e) || (e.target as HTMLElement).closest('a, input, textarea')) return;
      e.preventDefault();
      row.current = e.currentTarget;
      cancelHold();
      if (!open) setAt({ x: e.clientX, y: e.clientY });
    },
  };

  const menu = open ? (
    phone ? (
      <Sheet open title={task.title} onClose={close} back={row} className="task-menu-sheet">
        <div className="pick-sheet-body page-more-list" role="menu" aria-label={`פעולות: ${task.title}`}>
          {items.map((it) => (
            <button
              key={it.key}
              type="button"
              role="menuitem"
              className={`btn${it.key === 'done' ? ' task-menu-done' : ''}`}
              onClick={() => {
                close();
                it.run();
              }}
            >
              <Icon name={it.icon} /> {it.label}
            </button>
          ))}
        </div>
      </Sheet>
    ) : (
      <ContextMenu x={at.x} y={at.y} label={`פעולות: ${task.title}`} items={items} onClose={close} back={row} />
    )
  ) : null;

  return {
    bind,
    menu,
    lifted: open,
    /** a hold just opened the menu: the click that follows it does not also open the task */
    swallow: () => {
      const s = swallowNext.current;
      swallowNext.current = false;
      return s || open;
    },
  };
}

/** A computer's menu at the pointer: the arrows move through it, Enter picks, Escape or a click away closes it. */
function ContextMenu({ x, y, label, items, onClose, back }: { x: number; y: number; label: string; items: Item[]; onClose: () => void; back: { current: HTMLElement | null } }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x, top: y });
  // inside the window, whatever corner it was opened in
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setPos({ left: Math.max(8, Math.min(x - r.width, innerWidth - r.width - 8)), top: Math.max(8, Math.min(y, innerHeight - r.height - 8)) });
    el.querySelector<HTMLElement>('[role=menuitem]')?.focus();
  }, [x, y]);
  useEffect(() => {
    const away = (e: Event) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    // the page moving on closes it - but not the tail of a scroll already coasting when it opened
    const opened = performance.now();
    const gone = () => performance.now() - opened > 150 && onClose();
    document.addEventListener('pointerdown', away, true);
    window.addEventListener('scroll', gone, true);
    window.addEventListener('resize', gone);
    return () => {
      document.removeEventListener('pointerdown', away, true);
      window.removeEventListener('scroll', gone, true);
      window.removeEventListener('resize', gone);
    };
  }, [onClose]);
  const done = (focusBack: boolean) => {
    onClose();
    if (focusBack) back.current?.focus();
  };
  const onKey = (e: ReactKeyboardEvent) => {
    const list = [...(ref.current?.querySelectorAll<HTMLElement>('[role=menuitem]') ?? [])];
    const i = list.indexOf(document.activeElement as HTMLElement);
    if (e.key === 'Escape' || e.key === 'Tab') {
      e.preventDefault();
      e.stopPropagation();
      done(true);
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      list[(i + (e.key === 'ArrowDown' ? 1 : -1) + list.length) % list.length]?.focus();
    }
  };
  return createPortal(
    <div ref={ref} className="ctx-menu" role="menu" aria-label={label} style={{ left: pos.left, top: pos.top }} onKeyDown={onKey}>
      {items.map((it) => (
        <button
          key={it.key}
          type="button"
          role="menuitem"
          className={`ctx-item${it.key === 'done' ? ' is-done' : ''}`}
          // one highlight at a time: the pointer takes the keyboard's place as it moves
          onPointerMove={(e) => e.currentTarget.focus()}
          onClick={() => {
            done(false);
            it.run();
          }}
        >
          <Icon name={it.icon} size={16} />
          {it.label}
        </button>
      ))}
    </div>,
    document.body,
  );
}

/** the row's own click, kept from opening the task when a hold has just opened its menu */
export function unlessHeld(menu: { swallow: () => boolean }, click: () => void): () => void {
  return () => {
    if (!menu.swallow()) click();
  };
}

export type TaskMenu = ReturnType<typeof useTaskMenu>;
