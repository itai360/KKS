// A day, a week or a month turned by the finger on a phone, like a page: it follows 1:1 sideways, and
// let go, where the swipe is heading (not where it stopped) decides - the next one (the page goes
// right, the next comes in from the left, as a right-to-left page reads) or the one before, or back
// to where it was. The old one leaves on one side and the new one comes in from the other, with the
// finger's speed. Up and down stays the page's (and the hours') scroll.

import { useEffect, useRef, type RefObject } from 'react';
import { haptic } from '../lib/haptics';
import { animateSpring, project, rubberband, velocityOf, type SpringRun } from '../lib/spring';

export function usePeriodSwipe(
  area: RefObject<HTMLElement | null>,
  {
    enabled,
    onStep,
    can,
    skipScrollers,
  }: {
    enabled: boolean;
    onStep: (dir: 1 | -1) => void;
    /** whether there is anything that way: if not, the page resists and comes back (the first or the last one) */
    can?: (dir: 1 | -1) => boolean;
    /** a swipe that starts on something scrolling sideways (a wide table) scrolls it, not the page */
    skipScrollers?: boolean;
  },
): void {
  const step = useRef(onStep);
  step.current = onStep;
  const canRef = useRef(can);
  canRef.current = can;
  useEffect(() => {
    const el = area.current;
    if (!el || !enabled) return;
    let x = 0;
    let run: SpringRun | null = null;
    let g: null | { x0: number; y0: number; from: number; mode: 'wait' | 'drag' | 'off'; points: { y: number; t: number }[]; past: boolean } = null;
    const width = () => el.offsetWidth || 360;
    const line = () => width() * 0.28;

    const paint = (v: number) => {
      x = v;
      el.style.transform = v ? `translate3d(${v}px, 0, 0)` : '';
      // a page further from its place fades a little, as it goes
      el.style.opacity = v ? String(1 - Math.min(0.45, Math.abs(v) / (width() * 1.8))) : '';
      el.style.transition = v ? 'none' : '';
    };
    const springTo = (to: number, velocity: number, done?: () => void, response = 0.3) => {
      run = animateSpring(x, to, {
        response,
        velocity,
        onUpdate: paint,
        onDone: () => {
          run = null;
          paint(to);
          done?.();
        },
      });
    };

    const start = (e: TouchEvent) => {
      if (e.touches.length !== 1) return;
      const t = e.touches[0];
      if ((e.target as HTMLElement).closest('input, textarea, select, [contenteditable="true"]')) return;
      if (skipScrollers) {
        for (let n = e.target as HTMLElement | null; n && n !== el; n = n.parentElement) {
          const ox = getComputedStyle(n).overflowX;
          if ((ox === 'auto' || ox === 'scroll') && n.scrollWidth > n.clientWidth + 1) return;
        }
      }
      const caught = !!run;
      if (run) x = run.stop().value;
      run = null;
      g = { x0: t.clientX, y0: t.clientY, from: x, mode: caught ? 'drag' : 'wait', points: [{ y: t.clientX, t: e.timeStamp }], past: false };
    };
    const move = (e: TouchEvent) => {
      if (!g || g.mode === 'off') return;
      const t = e.touches[0];
      const dx = t.clientX - g.x0;
      const dy = t.clientY - g.y0;
      if (g.mode === 'wait') {
        if (Math.abs(dx) < 12 && Math.abs(dy) < 12) return;
        if (Math.abs(dy) >= Math.abs(dx)) {
          g.mode = 'off';
          return;
        }
        g.mode = 'drag';
        g.x0 = t.clientX;
      }
      if (e.cancelable) e.preventDefault();
      const raw = g.from + (t.clientX - g.x0);
      const w = width();
      // nothing that way: it gives a little and resists, the way a list's end does
      const blocked = raw !== 0 && canRef.current && !canRef.current(raw > 0 ? 1 : -1);
      // a whole page's width at most, softening past it
      paint(blocked ? Math.sign(raw) * rubberband(Math.abs(raw), w, 0.3) : Math.abs(raw) > w ? Math.sign(raw) * (w + rubberband(Math.abs(raw) - w, w)) : raw);
      g.points.push({ y: t.clientX, t: e.timeStamp });
      if (g.points.length > 12) g.points.shift();
      const past = !blocked && Math.abs(raw) > line();
      if (past !== g.past) {
        g.past = past;
        if (past) haptic('tick');
      }
    };
    const end = () => {
      if (!g) return;
      const was = g;
      g = null;
      if (was.mode !== 'drag') {
        if (x && !run) springTo(0, 0);
        return;
      }
      const v = velocityOf(was.points);
      const heading = x + project(v, 0.99);
      // a finger already heading back says no, wherever the page is
      const reversing = Math.abs(v) > 150 && Math.sign(v) !== Math.sign(x);
      const side = Math.sign(heading);
      const blocked = !!canRef.current && !canRef.current(side > 0 ? 1 : -1);
      if (Math.abs(heading) < line() || reversing || blocked) return springTo(0, v);
      // out on its side, then the next one in from the other
      springTo(side * width(), v, () => {
        step.current(side > 0 ? 1 : -1);
        requestAnimationFrame(() => {
          paint(-side * width() * 0.35);
          springTo(0, v * 0.5, undefined, 0.34);
        });
      }, 0.24);
    };

    el.addEventListener('touchstart', start, { passive: true });
    el.addEventListener('touchmove', move, { passive: false });
    el.addEventListener('touchend', end);
    el.addEventListener('touchcancel', end);
    return () => {
      run?.stop();
      paint(0);
      el.removeEventListener('touchstart', start);
      el.removeEventListener('touchmove', move);
      el.removeEventListener('touchend', end);
      el.removeEventListener('touchcancel', end);
    };
  }, [area, enabled, skipScrollers]);
}
