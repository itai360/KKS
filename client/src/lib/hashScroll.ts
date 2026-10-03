// A page opened at "#section" (from a notification or a reminder): scroll to it, and keep it in
// place while the cards above it finish loading and push it down - until the page settles or the
// person scrolls on their own.

import { useEffect } from 'react';
import { useLocation } from 'react-router';

const HANDS_ON = ['wheel', 'touchstart', 'keydown', 'pointerdown'] as const;

export function useHashScroll(id: string): void {
  const { hash } = useLocation();
  useEffect(() => {
    if (hash !== `#${id}`) return;
    const el = document.getElementById(id);
    if (!el) return;
    const go = () => el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    const ro = new ResizeObserver(go);
    if (el.parentElement) ro.observe(el.parentElement);
    go();
    const stop = () => {
      ro.disconnect();
      clearTimeout(timer);
      for (const e of HANDS_ON) window.removeEventListener(e, stop);
    };
    for (const e of HANDS_ON) window.addEventListener(e, stop, { passive: true });
    const timer = setTimeout(stop, 3000);
    return stop;
  }, [id, hash]);
}
