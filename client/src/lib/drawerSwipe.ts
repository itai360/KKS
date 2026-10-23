// The phone's side menu goes back to the edge it came from under the finger: a sideways drag on it moves it
// with the finger, and letting go closes it when it was dragged - or thrown - far enough toward that edge;
// otherwise it springs back. An up-and-down move is left to the menu's own scrolling.

import { useEffect, type RefObject } from 'react';

/** where a throw at this speed (px/s) comes to rest, as a scroll slows down */
const project = (v: number, rate = 0.998) => ((v / 1000) * rate) / (1 - rate);
/** dragged the other way, into the page: it follows less and less */
const rubber = (over: number, size: number, c = 0.55) => (over * size * c) / (size + c * over);

export function useDrawerSwipe(drawer: RefObject<HTMLElement | null>, scrim: RefObject<HTMLElement | null>, open: boolean, onClose: () => void): void {
  useEffect(() => {
    const el = drawer.current;
    if (!el || !open) return;
    // the edge it closes toward: the right one on a right-to-left page
    const sign = getComputedStyle(el).direction === 'rtl' ? 1 : -1;
    let start: { x: number; y: number; id: number } | null = null;
    let dragging = false;
    let width = 0;
    let trail: { x: number; t: number }[] = [];
    const still = () => {
      el.classList.remove('is-dragging');
      el.style.transform = '';
      const s = scrim.current;
      if (s) {
        s.classList.remove('is-dragging');
        s.style.opacity = '';
      }
    };
    const down = (e: PointerEvent) => {
      if (e.pointerType === 'mouse' || !e.isPrimary) return;
      start = { x: e.clientX, y: e.clientY, id: e.pointerId };
      dragging = false;
      trail = [{ x: e.clientX, t: e.timeStamp }];
    };
    const move = (e: PointerEvent) => {
      if (!start || e.pointerId !== start.id) return;
      const dx = (e.clientX - start.x) * sign;
      const dy = e.clientY - start.y;
      if (!dragging) {
        // a scroll, or a move into the page: not a drag of the menu
        if ((Math.abs(dy) > 10 && Math.abs(dy) >= Math.abs(dx)) || dx < -10) {
          start = null;
          return;
        }
        if (dx < 10 || dx < Math.abs(dy) * 1.2) return;
        dragging = true;
        // measured before anything moves: reading it later would settle the style mid-drag
        width = el.offsetWidth;
        el.setPointerCapture(e.pointerId);
        el.classList.add('is-dragging');
        scrim.current?.classList.add('is-dragging');
      }
      const offset = dx >= 0 ? dx : -rubber(-dx, width);
      el.style.transform = `translateX(${offset * sign}px)`;
      if (scrim.current) scrim.current.style.opacity = String(Math.max(0, 1 - Math.max(0, offset) / width));
      trail.push({ x: e.clientX, t: e.timeStamp });
      trail = trail.filter((p) => e.timeStamp - p.t < 100);
    };
    const up = (e: PointerEvent) => {
      if (!start || e.pointerId !== start.id) return;
      const was = dragging;
      const dx = (e.clientX - start.x) * sign;
      start = null;
      dragging = false;
      if (!was) return;
      const first = trail[0];
      const dt = first ? e.timeStamp - first.t : 0;
      const v = first && dt > 0 ? (((e.clientX - first.x) * sign) / dt) * 1000 : 0;
      // from where the finger left it: closing slides on to the edge, staying springs back
      still();
      if (dx + project(v) > width / 2) onClose();
      // the drag does not end as a tap on the link under the finger
      const swallow = (c: Event) => {
        c.preventDefault();
        c.stopPropagation();
      };
      window.addEventListener('click', swallow, { capture: true, once: true });
      setTimeout(() => window.removeEventListener('click', swallow, { capture: true }), 350);
    };
    const cancel = (e: PointerEvent) => {
      if (!start || e.pointerId !== start.id) return;
      start = null;
      if (dragging) still();
      dragging = false;
    };
    el.addEventListener('pointerdown', down);
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', cancel);
    return () => {
      el.removeEventListener('pointerdown', down);
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', cancel);
      still();
    };
  }, [drawer, scrim, open, onClose]);
}
