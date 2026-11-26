// Holding a row on a phone, or right-clicking it on a computer, brings up what is done with it most,
// without opening it, as Apple's context menus do: the row lifts under the finger with a short buzz, and
// the actions come up beside it - a sheet from below on a phone, a menu at the pointer on a computer.
// Tasks (TaskMenu.tsx) and cadets use it; each says which actions this person may take.

import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { createPortal } from 'react-dom';
import { haptic } from '../lib/haptics';
import { Icon } from './Icon';
import { Sheet, usePhonePicker } from './pickers';

const HOLD_MS = 450;

export interface RowMenuItem {
  key: string;
  label: string;
  icon: string;
  run: () => void;
  /** the one most likely wanted, set apart */
  primary?: boolean;
}

/**
 * One row's quick actions: `bind` goes on the row, `menu` is rendered beside it, `lifted` marks the row
 * while its menu is up, and `swallow()` tells a click that a hold just opened the menu.
 */
export function useRowMenu({
  title,
  items,
  disabled,
  links,
}: {
  title: string;
  items: RowMenuItem[];
  disabled?: boolean;
  /** the row is a link itself (a document's card): held or right-clicked there too, its menu instead of the browser's */
  links?: boolean;
}) {
  const phone = usePhonePicker();
  const [at, setAt] = useState<{ x: number; y: number } | null>(null);
  const hold = useRef<{ timer: ReturnType<typeof setTimeout>; x: number; y: number } | null>(null);
  const swallowNext = useRef(false);
  const row = useRef<HTMLElement | null>(null);
  const open = at !== null;
  const close = () => setAt(null);

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
      if (disabled || e.pointerType !== 'touch' || (e.target as HTMLElement).closest(links ? 'button, input, label' : 'button, a, input, label')) return;
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
      if (disabled || !onRow(e) || (e.target as HTMLElement).closest(links ? 'input, textarea' : 'a, input, textarea')) return;
      e.preventDefault();
      row.current = e.currentTarget;
      cancelHold();
      if (!open) setAt({ x: e.clientX, y: e.clientY });
    },
  };

  const menu = open ? (
    phone ? (
      <Sheet open title={title} onClose={close} back={row} className="row-menu-sheet">
        <div className="pick-sheet-body page-more-list" role="menu" aria-label={`פעולות: ${title}`}>
          {items.map((it) => (
            <button
              key={it.key}
              type="button"
              role="menuitem"
              className={`btn${it.primary ? ' row-menu-primary' : ''}`}
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
      <ContextMenu x={at.x} y={at.y} label={`פעולות: ${title}`} items={items} onClose={close} back={row} />
    )
  ) : null;

  return {
    bind,
    menu,
    lifted: open,
    /** a hold just opened the menu: the click that follows it does not also open the row */
    swallow: () => {
      const s = swallowNext.current;
      swallowNext.current = false;
      return s || open;
    },
  };
}

/** A computer's menu at the pointer: the arrows move through it, Enter picks, Escape or a click away closes it. */
function ContextMenu({ x, y, label, items, onClose, back }: { x: number; y: number; label: string; items: RowMenuItem[]; onClose: () => void; back: { current: HTMLElement | null } }) {
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
          className={`ctx-item${it.primary ? ' is-primary' : ''}`}
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

/** the row's own click, kept from opening the row when a hold has just opened its menu */
export function unlessHeld(menu: { swallow: () => boolean }, click: () => void): () => void {
  return () => {
    if (!menu.swallow()) click();
  };
}
