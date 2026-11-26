// Back. On a computer: at the top of the screen, above its title - where the eye is when a screen opens -
// named for where it goes (as an iPhone's back button is), step by step to the screens before, until the
// calendar. A screen opened from a link, with no screen before it in the app, goes up instead (a task -> the
// tasks -> the calendar). A phone has no arrow: one swipes back - and in the iPhone's app on the home screen,
// which has no swipe of its own, a swipe in from a side edge does it (useEdgeBack).

import { createContext, useContext, useEffect, useRef } from 'react';
import { haptic } from '../lib/haptics';
import { Icon } from './Icon';

/** the screen above: "/weeks/3/order" -> "/weeks/3", "/tasks/12" -> "/tasks", "/tasks" -> home */
export function parentPath(path: string): string {
  const parts = path.split('/').filter(Boolean);
  if (parts.length <= 1) return '/';
  const up = parts.slice(0, -1);
  // a list that is not a screen of its own ("/evaluations/committee/5")
  if (up.length > 1 && up[up.length - 1] === 'committee') up.pop();
  return `/${up.join('/')}`;
}

/** where back goes from the screen on show (none on the calendar): its name, when known, and going there */
export interface Back {
  label: string | null;
  go: () => void;
}
export const BackContext = createContext<Back | null>(null);

/** the computer's back, at the top of a screen (PageHead puts it above the title) */
export function PageBack() {
  const back = useContext(BackContext);
  if (!back) return null;
  return (
    <button type="button" className="page-back no-print" onClick={back.go} aria-label={back.label ? `חזרה אל ${back.label}` : 'חזרה למסך הקודם'} title="חזרה">
      <Icon name="chevronRight" size={20} />
      <span>{back.label ?? 'חזרה'}</span>
    </button>
  );
}

/** a finger this close to a side edge starts the swipe back; this far in, letting go goes back */
const EDGE = 24;
const GO = 72;

/**
 * The iPhone's app on the home screen has no swipe back of its own (Safari and Android do, so it is theirs
 * there): a swipe in from either side edge goes back. A round arrow comes in with the finger and grows once
 * letting go would go back.
 */
export function useEdgeBack(on: boolean, go: () => void): void {
  // the latest "back", without starting over on every render (a swipe under way would be lost)
  const goRef = useRef(go);
  goRef.current = go;
  useEffect(() => {
    if (!on || (navigator as Navigator & { standalone?: boolean }).standalone !== true) return;
    let start: { x: number; y: number; dir: 1 | -1 } | null = null;
    let swiping = false;
    let armed = false;
    let mark: HTMLDivElement | null = null;
    const drop = () => {
      start = null;
      swiping = false;
      armed = false;
      mark?.remove();
      mark = null;
    };
    const down = (e: TouchEvent) => {
      if (e.touches.length !== 1) return drop();
      const t = e.touches[0];
      const dir = t.clientX <= EDGE ? 1 : t.clientX >= innerWidth - EDGE ? -1 : 0;
      // a dialog, a sheet or the menu over the screen has its own ways to close
      if (!dir || document.querySelector('.modal-backdrop, .sheet-backdrop, .app.menu-open, .peek-sheet, .pop')) return;
      start = { x: t.clientX, y: t.clientY, dir };
    };
    const move = (e: TouchEvent) => {
      if (!start) return;
      const t = e.touches[0];
      const dx = (t.clientX - start.x) * start.dir;
      const dy = t.clientY - start.y;
      if (!swiping) {
        // a scroll, or a move back out: not a swipe back
        if ((Math.abs(dy) > 12 && Math.abs(dy) > Math.abs(dx)) || dx < -6) return drop();
        if (dx < 12) return;
        swiping = true;
        mark = document.createElement('div');
        mark.className = `edge-back${start.dir === 1 ? ' from-left' : ' from-right'}`;
        mark.style.top = `${Math.min(Math.max(start.y, 80), innerHeight - 80)}px`;
        mark.innerHTML = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="m9 6 6 6-6 6"/></svg>';
        document.body.appendChild(mark);
      }
      e.preventDefault();
      const pull = Math.min(dx, GO * 1.4);
      if (mark) mark.style.setProperty('--pull', `${pull}px`);
      const now = dx >= GO;
      if (now !== armed) {
        armed = now;
        mark?.classList.toggle('is-armed', armed);
        if (armed) haptic();
      }
    };
    const up = () => {
      const goNow = swiping && armed;
      drop();
      if (goNow) goRef.current();
    };
    addEventListener('touchstart', down, { passive: true });
    addEventListener('touchmove', move, { passive: false });
    addEventListener('touchend', up);
    addEventListener('touchcancel', drop);
    return () => {
      drop();
      removeEventListener('touchstart', down);
      removeEventListener('touchmove', move);
      removeEventListener('touchend', up);
      removeEventListener('touchcancel', drop);
    };
  }, [on]);
}
