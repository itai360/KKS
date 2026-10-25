// A card that floats beside what was clicked, as Google Calendar's event card and its quick create do:
// on a computer beside its anchor where there is room (right to left: first to its left), on a phone a
// sheet from below. Escape, a click outside it or its close button close it; the keyboard goes into it,
// and back to where it was after.

import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { BOTTOM_BAR_MEDIA } from '../lib/bottomBar';
import { useMedia } from '../lib/media';
import { Modal } from './ui';

/** what a click inside does not count as "outside": the pickers' lists and calendars, dialogs, toasts */
const INSIDE = '.cal-pop, .pop, .sheet-backdrop, .modal-backdrop, .toasts';

export interface Anchor {
  top: number;
  left: number;
  right: number;
  bottom: number;
}

export const anchorOf = (el: Element): Anchor => {
  const r = el.getBoundingClientRect();
  return { top: r.top, left: r.left, right: r.right, bottom: r.bottom };
};

export function Popover({
  anchor,
  label,
  onClose,
  children,
  width = 400,
  className = '',
  sheetFooter,
  sheetTitle,
}: {
  anchor: Anchor;
  /** the card's name (a phone's sheet shows it as its title, unless sheetTitle) */
  label: string;
  /** the head of a phone's sheet when the card already shows its name */
  sheetTitle?: string;
  onClose: () => void;
  children: ReactNode;
  width?: number;
  className?: string;
  /** a phone's sheet: its buttons at the foot */
  sheetFooter?: ReactNode;
}) {
  const phone = useMedia(BOTTOM_BAR_MEDIA);
  const ref = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  const [pos, setPos] = useState<CSSProperties>({ visibility: 'hidden', top: 0, left: 0 });

  useLayoutEffect(() => {
    if (phone) return;
    const place = () => {
      const el = ref.current;
      if (!el) return;
      const w = Math.min(width, innerWidth - 24);
      const h = el.offsetHeight;
      const gap = 8;
      const leftRoom = anchor.left - 12;
      const rightRoom = innerWidth - anchor.right - 12;
      const left =
        leftRoom >= w + gap ? anchor.left - gap - w : rightRoom >= w + gap ? anchor.right + gap : Math.max(12, Math.min(innerWidth - w - 12, (anchor.left + anchor.right) / 2 - w / 2));
      // beside it, its top at the anchor's; below or above it when it is centred over it
      const beside = leftRoom >= w + gap || rightRoom >= w + gap;
      const wantTop = beside ? anchor.top : anchor.bottom + gap + h <= innerHeight - 12 ? anchor.bottom + gap : anchor.top - gap - h;
      const top = Math.max(12, Math.min(innerHeight - h - 12, wantTop));
      setPos({ top, left, width: w });
    };
    place();
    const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(place) : null;
    if (ref.current) ro?.observe(ref.current);
    window.addEventListener('resize', place);
    return () => {
      ro?.disconnect();
      window.removeEventListener('resize', place);
    };
  }, [anchor, width, phone]);

  // the focus moves in once the card is in place: while it is hidden to be measured it cannot take it,
  // and a quick create's title must take the keys typed right after the click
  const shown = pos.visibility !== 'hidden';
  useEffect(() => {
    if (phone || !shown) return;
    // the field marked for it first (a quick create's title), else the first thing to press - in that order, not the page's
    const root = ref.current;
    const first = root?.querySelector<HTMLElement>('[data-autofocus]') ?? root?.querySelector<HTMLElement>('input, textarea, button:not([disabled]), a[href]');
    (first ?? root)?.focus({ preventScroll: true });
  }, [phone, shown]);

  useEffect(() => {
    if (phone) return;
    const back = document.activeElement as HTMLElement | null;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Element;
      if (t.closest(INSIDE)) return;
      close.current();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      // a picker or a dialog opened from the card closes first
      if (document.querySelector('.pop:not(.is-leaving), .modal-backdrop:not(.is-leaving), .sheet-backdrop:not(.is-leaving)')) return;
      e.preventDefault();
      close.current();
    };
    // the click that opened it is over before this listens
    const t = setTimeout(() => document.addEventListener('pointerdown', onDown), 0);
    document.addEventListener('keydown', onKey);
    return () => {
      clearTimeout(t);
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
      if (back && document.contains(back) && (!document.activeElement || document.activeElement === document.body || ref.current?.contains(document.activeElement))) back.focus({ preventScroll: true });
    };
  }, [phone]);

  if (phone) {
    return (
      <Modal title={sheetTitle ?? label} onClose={onClose} footer={sheetFooter}>
        <div className={`cal-pop-sheet ${className}`}>{children}</div>
      </Modal>
    );
  }
  return createPortal(
    <div ref={ref} className={`cal-pop ${className}`} role="dialog" aria-label={label} tabIndex={-1} dir="rtl" style={pos}>
      {children}
    </div>,
    document.body,
  );
}
