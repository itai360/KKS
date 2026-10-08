// Pulling a phone's screen down from its top brings everything on it up to date, as Mail and every
// list on an iPhone do: the page follows the finger, with more resistance the further it goes; past a
// point the arrow turns and a short buzz says that letting go will refresh; let go, the page springs
// back to a spinner while the screen fetches again, then home. A sideways move is a swipe (a row, a
// day), never a pull; a sheet, an open dialog or a list scrolled inside are left alone.

import { useEffect, type RefObject } from 'react';
import { haptic } from './haptics';
import { emitLocalChange } from './realtime';
import { animateSpring, type SpringRun } from './spring';

/** how far the page comes down before letting go refreshes */
export const PULL_AT = 72;

/** the page's travel for a finger's travel: 1:1 at first, softening (the page never runs away) */
export function pullDistance(finger: number): number {
  if (finger <= 0) return 0;
  return finger / (1 + finger / 260);
}

function scrolledInside(from: Element | null): boolean {
  for (let el = from; el && el !== document.body; el = el.parentElement) {
    const oy = getComputedStyle(el).overflowY;
    if ((oy === 'auto' || oy === 'scroll') && el.scrollTop > 0) return true;
  }
  return false;
}

export function usePullToRefresh(content: RefObject<HTMLElement | null>, indicator: RefObject<HTMLElement | null>, enabled: boolean): void {
  useEffect(() => {
    const page = content.current;
    const mark = indicator.current;
    if (!enabled || !page || !mark) return;
    let g: null | { x0: number; y0: number; mode: 'wait' | 'pull'; armed: boolean } = null;
    let at = 0;
    let run: SpringRun | null = null;
    let busy = false;

    const paint = (px: number) => {
      at = px;
      page.style.transform = px > 0.5 ? `translate3d(0, ${px}px, 0)` : '';
      const p = Math.min(1, px / PULL_AT);
      mark.style.opacity = px > 0.5 ? String(Math.min(1, p * 1.4)) : '';
      mark.style.transform = `translate3d(-50%, ${Math.max(-44, px - 52)}px, 0) rotate(${busy ? 0 : p * 180}deg)`;
      mark.classList.toggle('is-armed', p >= 1);
    };
    const springTo = (to: number, done?: () => void) => {
      run?.stop();
      run = animateSpring(at, to, { response: 0.34, onUpdate: paint, onDone: () => ((run = null), paint(to), done?.()) });
    };
    const refresh = () => {
      busy = true;
      mark.classList.add('is-loading');
      springTo(PULL_AT * 0.7);
      emitLocalChange('*');
      // long enough to be seen and for the screen's answers to come back
      setTimeout(() => {
        mark.classList.remove('is-loading');
        springTo(0, () => (busy = false));
      }, 750);
    };

    const start = (e: TouchEvent) => {
      if (busy || e.touches.length !== 1 || window.scrollY > 0) return;
      const t = e.target as Element;
      if (t.closest('input, textarea, select, [contenteditable="true"]') || document.querySelector('.modal-backdrop, .sheet-backdrop, .plus-menu') || scrolledInside(t)) return;
      g = { x0: e.touches[0].clientX, y0: e.touches[0].clientY, mode: 'wait', armed: false };
    };
    const move = (e: TouchEvent) => {
      if (!g) return;
      const dx = e.touches[0].clientX - g.x0;
      const dy = e.touches[0].clientY - g.y0;
      if (g.mode === 'wait') {
        if (Math.abs(dx) < 2 && Math.abs(dy) < 2) return;
        // decided on the first move: down and more down than sideways, or not at all
        if (dy <= 0 || Math.abs(dx) * 1.2 > dy || window.scrollY > 0) {
          g = null;
          return;
        }
        g.mode = 'pull';
      }
      // turned into a sideways swipe: the page goes back, the swipe is the row's
      if (Math.abs(dx) > dy * 1.5) {
        g = null;
        springTo(0);
        return;
      }
      if (e.cancelable) e.preventDefault();
      run?.stop();
      run = null;
      const px = pullDistance(dy);
      paint(px);
      const armed = px >= PULL_AT;
      if (armed !== g.armed) {
        g.armed = armed;
        if (armed) haptic('tick');
      }
    };
    const end = () => {
      if (!g) return;
      const was = g;
      g = null;
      if (was.mode !== 'pull') return;
      if (was.armed) refresh();
      else springTo(0);
    };

    document.addEventListener('touchstart', start, { passive: true });
    document.addEventListener('touchmove', move, { passive: false });
    document.addEventListener('touchend', end);
    document.addEventListener('touchcancel', end);
    return () => {
      run?.stop();
      page.style.transform = '';
      document.removeEventListener('touchstart', start);
      document.removeEventListener('touchmove', move);
      document.removeEventListener('touchend', end);
      document.removeEventListener('touchcancel', end);
    };
  }, [content, indicator, enabled]);
}
