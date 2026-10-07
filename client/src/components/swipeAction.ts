// A row swiped sideways on a phone, as in Mail on iPhone: it follows the finger 1:1 toward its leading
// side (left, in a right-to-left page), and the action behind it grows as it goes - armed, with a tick,
// once letting go would do it. Let go, the direction and speed of the swipe decide (where it is heading,
// not where it stopped); either way the row springs home with the finger's speed. The other way it only
// gives a little. Up and down is the page's scroll, untouched.

import { useEffect, useRef, type RefObject } from 'react';
import { haptic } from '../lib/haptics';
import { animateSpring, project, rubberband, velocityOf, type SpringRun } from '../lib/spring';

export function useSwipeAction(row: RefObject<HTMLElement | null>, { enabled, onCommit }: { enabled: boolean; onCommit: () => void }): void {
  const commit = useRef(onCommit);
  commit.current = onCommit;
  useEffect(() => {
    const el = row.current;
    const wrap = el?.parentElement;
    if (!el || !wrap || !enabled) return;
    let x = 0;
    let run: SpringRun | null = null;
    let swallowUntil = 0;
    let g: null | { x0: number; y0: number; from: number; mode: 'wait' | 'drag' | 'off'; points: { y: number; t: number }[]; armed: boolean } = null;
    const reach = () => (el.offsetWidth || 300) * 0.38;

    const paint = (v: number) => {
      x = v;
      el.style.transform = v ? `translate3d(${v}px, 0, 0)` : '';
      el.style.transition = v ? 'none' : '';
      const progress = Math.min(1, Math.max(0, -v) / reach());
      wrap.style.setProperty('--swipe', progress.toFixed(3));
      wrap.classList.toggle('is-swiping', v !== 0);
      wrap.classList.toggle('is-armed', progress >= 1);
    };
    const home = (velocity: number) => {
      run = animateSpring(x, 0, {
        damping: 1,
        response: 0.3,
        velocity,
        onUpdate: paint,
        onDone: () => {
          run = null;
          paint(0);
        },
      });
    };

    const start = (e: TouchEvent) => {
      if (e.touches.length !== 1) return;
      const t = e.touches[0];
      const caught = !!run;
      if (run) x = run.stop().value;
      run = null;
      // its entrance (rows come into a list softly) stops where it is
      for (const a of el.getAnimations()) a.cancel();
      g = { x0: t.clientX, y0: t.clientY, from: x, mode: caught ? 'drag' : 'wait', points: [{ y: t.clientX, t: e.timeStamp }], armed: false };
    };
    const move = (e: TouchEvent) => {
      if (!g || g.mode === 'off') return;
      const t = e.touches[0];
      const dx = t.clientX - g.x0;
      const dy = t.clientY - g.y0;
      if (g.mode === 'wait') {
        if (Math.abs(dx) < 10 && Math.abs(dy) < 10) return;
        if (Math.abs(dy) >= Math.abs(dx)) {
          g.mode = 'off';
          return;
        }
        g.mode = 'drag';
        g.x0 = t.clientX;
      }
      if (e.cancelable) e.preventDefault();
      const raw = g.from + (t.clientX - g.x0);
      const w = el.offsetWidth || 300;
      // toward the action it follows freely, softening past the point where it is armed; the other way it barely gives
      paint(raw > 0 ? rubberband(raw, w, 0.2) : raw < -reach() ? -reach() + rubberband(raw + reach(), w) : raw);
      g.points.push({ y: t.clientX, t: e.timeStamp });
      if (g.points.length > 12) g.points.shift();
      const armed = raw <= -reach();
      if (armed !== g.armed) {
        g.armed = armed;
        if (armed) haptic('tick');
      }
    };
    const end = () => {
      if (!g) return;
      const was = g;
      g = null;
      if (was.mode !== 'drag') {
        if (x && !run) home(0);
        return;
      }
      // the click that a lifted finger may still send is not a tap on the row
      swallowUntil = performance.now() + 400;
      const v = velocityOf(was.points);
      const heading = x + project(v, 0.99);
      if (heading <= -reach() && v < 200) commit.current();
      home(v);
    };
    const click = (e: MouseEvent) => {
      if (performance.now() < swallowUntil) {
        e.stopPropagation();
        e.preventDefault();
      }
    };

    el.addEventListener('touchstart', start, { passive: true });
    el.addEventListener('touchmove', move, { passive: false });
    el.addEventListener('touchend', end);
    el.addEventListener('touchcancel', end);
    el.addEventListener('click', click, true);
    return () => {
      run?.stop();
      paint(0);
      el.removeEventListener('touchstart', start);
      el.removeEventListener('touchmove', move);
      el.removeEventListener('touchend', end);
      el.removeEventListener('touchcancel', end);
      el.removeEventListener('click', click, true);
    };
  }, [row, enabled]);
}
