// A sheet from the bottom of a phone, moved by the finger the way iOS moves one: it follows 1:1 from
// where it was grabbed (its handle and title, or its content when that is scrolled to the top); pulled
// up it resists more and more; let go, it carries the finger's speed - to where the flick is heading
// (closed, past half its height) or back home - and it can be caught again in the middle of either.
// The dimming behind it follows it. Touch only: a mouse closes it by its X, Escape or a click outside.

import { useEffect, useRef, type RefObject } from 'react';
import { haptic } from '../lib/haptics';
import { animateSpring, project, rubberband, velocityOf, type SpringRun } from '../lib/spring';

interface SheetGesture {
  /** off on a computer's centred dialog, or a dialog that only its own buttons close */
  enabled: boolean;
  /** let go past the line: may it go now? (a dialog with typed text asks first - it comes back, then asks) */
  canLeave: () => boolean;
  /** it has slid away: close it */
  leave: () => void;
  /** it may not go yet: it came back, and this asks */
  refused?: () => void;
  /** the dimming behind it, which lightens as it is pulled down */
  backdrop?: RefObject<HTMLElement | null>;
  /** the part that is grabbed even mid-scroll (handle, title) and the part that scrolls */
  handle: string;
  scroller: string;
}

const PHONE = '(max-width: 860px)';

export function useSheetGesture(sheet: RefObject<HTMLElement | null>, opts: SheetGesture): void {
  const o = useRef(opts);
  o.current = opts;
  useEffect(() => {
    const el = sheet.current;
    if (!el || !opts.enabled) return;
    let y = 0; // where the sheet is now, below its place
    let run: SpringRun | null = null;
    let g: null | { x0: number; y0: number; from: number; zone: 'handle' | 'body'; scroller: HTMLElement | null; mode: 'wait' | 'drag' | 'off'; points: { y: number; t: number }[]; past: boolean } = null;

    const paint = (v: number) => {
      y = v;
      const h = el.offsetHeight || 1;
      el.style.transform = v ? `translate3d(0, ${v}px, 0)` : '';
      el.style.transition = 'none';
      o.current.backdrop?.current?.style.setProperty('--scrim', String(Math.max(0, Math.min(1, 1 - v / h))));
    };
    const settle = () => {
      el.style.transform = '';
      el.style.transition = '';
      o.current.backdrop?.current?.style.removeProperty('--scrim');
    };
    const springTo = (to: number, velocity: number, done?: () => void) => {
      let finished = false;
      let r: SpringRun | null = null;
      const finish = () => {
        if (finished) return;
        finished = true;
        run = null;
        if (to === 0) settle();
        done?.();
      };
      r = animateSpring(y, to, {
        damping: 1,
        response: to === 0 ? 0.32 : 0.28,
        velocity,
        onUpdate: (v) => {
          paint(to === 0 ? Math.max(v, -24) : v);
          // on its way out, it is gone the moment it is off the screen - not after the last invisible pixel
          if (to !== 0 && v >= (el.offsetHeight || 1)) {
            r?.stop();
            finish();
          }
        },
        onDone: finish,
      });
      run = finished ? null : r;
    };

    const start = (e: TouchEvent) => {
      if (e.touches.length !== 1 || !matchMedia(PHONE).matches) return;
      const t = e.target as HTMLElement;
      const zone = t.closest(o.current.handle) ? 'handle' : 'body';
      if (zone === 'body' && t.closest('input, textarea, select, [contenteditable="true"]')) return;
      // caught in the middle of a motion: it stops where it is, and the finger takes it from there
      const caught = !!run;
      if (run) y = run.stop().value;
      run = null;
      // its entrance (or a step back) still running: it stops on the frame it is at, read off the screen
      const running = el.getAnimations();
      if (running.length) {
        const now = getComputedStyle(el).transform;
        for (const a of running) a.cancel();
        paint(now && now !== 'none' ? new DOMMatrixReadOnly(now).m42 : 0);
      }
      const touch = e.touches[0];
      g = { x0: touch.clientX, y0: touch.clientY, from: y, zone, scroller: t.closest<HTMLElement>(o.current.scroller), mode: caught ? 'drag' : 'wait', points: [{ y: touch.clientY, t: e.timeStamp }], past: false };
    };

    const move = (e: TouchEvent) => {
      if (!g || g.mode === 'off') return;
      const touch = e.touches[0];
      const dx = touch.clientX - g.x0;
      const dy = touch.clientY - g.y0;
      if (g.mode === 'wait') {
        // a few pixels before deciding, then the direction says what it is: across or up in the content
        // is scrolling; down (or anything on the handle) moves the sheet
        if (Math.abs(dx) < 10 && Math.abs(dy) < 10) return;
        const atTop = !g.scroller || g.scroller.scrollTop <= 0;
        if (Math.abs(dx) > Math.abs(dy) || (g.zone === 'body' && (dy < 0 || !atTop))) {
          g.mode = 'off';
          return;
        }
        g.mode = 'drag';
        g.y0 = touch.clientY;
      }
      e.preventDefault();
      const raw = g.from + (touch.clientY - g.y0);
      const h = el.offsetHeight || 1;
      paint(raw < 0 ? rubberband(raw, h) : raw);
      g.points.push({ y: touch.clientY, t: e.timeStamp });
      if (g.points.length > 12) g.points.shift();
      // a light tick as it passes the point where letting go closes it
      const past = raw > h * 0.5;
      if (past !== g.past) {
        g.past = past;
        if (past) haptic('tick');
      }
    };

    const end = () => {
      if (!g) return;
      const was = g;
      g = null;
      // a tap or a scroll that stopped it on its way: it carries on home
      if (was.mode !== 'drag') {
        if (y && !run) springTo(0, 0);
        return;
      }
      const v = velocityOf(was.points);
      const h = el.offsetHeight || 1;
      // where the motion is heading, not where the finger stopped
      const close = y + project(v) > h * 0.5 && v > -150;
      if (close && o.current.canLeave()) {
        haptic('tick');
        springTo(h + 24, Math.max(v, 400), () => o.current.leave());
      } else {
        springTo(0, v, close ? () => o.current.refused?.() : undefined);
      }
    };

    el.addEventListener('touchstart', start, { passive: true });
    el.addEventListener('touchmove', move, { passive: false });
    el.addEventListener('touchend', end);
    el.addEventListener('touchcancel', end);
    return () => {
      run?.stop();
      el.removeEventListener('touchstart', start);
      el.removeEventListener('touchmove', move);
      el.removeEventListener('touchend', end);
      el.removeEventListener('touchcancel', end);
    };
  }, [sheet, opts.enabled]);
}
