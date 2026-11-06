// The app opens on its snapshot (תמונת המצב): from its icon, its address typed, a link from elsewhere - not when
// it is reloaded, moved around in, or linked to a screen of its own (a notification's). And the installed app,
// come back to after a while away, is opened again: it goes to the snapshot too - unless something in it is
// being written, or a notification tapped is taking it to what it is about.

import { useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router';

export const SNAPSHOT = '/overview';

/** away this long, coming back to the app is opening it again */
export const AWAY_MS = 10 * 60_000;

/** opened at its front door - not reloaded, nor come back to, nor moved to from a screen of its own */
export function isOpening(at: { pathname: string; search: string; hash: string }, navigation: string | undefined, referrer: string, origin: string): boolean {
  if (at.pathname !== '/' || at.search || at.hash) return false;
  if (navigation === 'reload' || navigation === 'back_forward') return false;
  if (!referrer) return true;
  try {
    return new URL(referrer).origin !== origin;
  } catch {
    return true;
  }
}

/** Before the first screen is drawn (main.tsx): an opening starts at the snapshot. */
export function openAtSnapshot(): void {
  const navigation = (performance.getEntriesByType?.('navigation')[0] as PerformanceNavigationTiming | undefined)?.type;
  if (isOpening(window.location, navigation, document.referrer, window.location.origin)) {
    history.replaceState(history.state, '', SNAPSHOT);
  }
}

/** the app installed on the phone (or the computer) - not a browser's tab, where moving between tabs is routine */
function installedApp(): boolean {
  return (
    window.matchMedia?.('(display-mode: standalone)').matches ||
    window.matchMedia?.('(display-mode: fullscreen)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

/** something is being written: a field in use, a window open over the page, or what a screen has not yet saved */
function busy(): boolean {
  const el = document.activeElement as HTMLElement | null;
  if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) return true;
  if (document.querySelector('[role="dialog"], dialog[open], [aria-modal="true"]')) return true;
  // the screens that keep unsaved work say so when the page is about to be left
  const leaving = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(leaving);
  return leaving.defaultPrevented;
}

/** The installed app, come back to after a while away, opens on its snapshot; a notification tapped while it was
 * open takes it to what the notification is about (its worker asks, where it cannot move the app itself). */
export function useOpenings(): void {
  const navigate = useNavigate();
  const location = useLocation();
  const here = useRef(`${location.pathname}${location.search}`);
  useEffect(() => {
    here.current = `${location.pathname}${location.search}`;
  }, [location]);

  useEffect(() => {
    let hiddenAt = document.hidden ? Date.now() : 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onVisibility = () => {
      if (document.hidden) {
        hiddenAt = Date.now();
        clearTimeout(timer);
        return;
      }
      const away = hiddenAt ? Date.now() - hiddenAt : 0;
      hiddenAt = 0;
      if (away < AWAY_MS || !installedApp()) return;
      const was = here.current;
      // a moment first: a notification tapped may be taking it somewhere
      timer = setTimeout(() => {
        if (here.current !== was || here.current.split('?')[0] === SNAPSHOT || busy()) return;
        navigate(SNAPSHOT);
      }, 400);
    };
    const onMessage = (e: MessageEvent) => {
      const data = e.data as { type?: string; link?: unknown } | null;
      if (data?.type !== 'open' || typeof data.link !== 'string') return;
      clearTimeout(timer);
      const to = new URL(data.link, window.location.origin);
      if (to.origin === window.location.origin) navigate(`${to.pathname}${to.search}${to.hash}`);
    };
    document.addEventListener('visibilitychange', onVisibility);
    navigator.serviceWorker?.addEventListener('message', onMessage);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisibility);
      navigator.serviceWorker?.removeEventListener('message', onMessage);
    };
  }, [navigate]);
}
