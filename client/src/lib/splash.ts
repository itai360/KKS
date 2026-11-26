// Show the animated mark for a new app session or a return after a day away.
// index.html makes the warm-session decision before paint so even a reload has no logo flash.
import { installedApp } from './launch';
import { APP_IDLE_MS, idleExpired, LAST_ACTIVE_KEY } from './appSession';

export const SPLASH_MS = 3000;
const FADE_MS = 280;
const STORE_INTERVAL = 60_000;
let template: HTMLElement | null = null;
let shownAt = 0;
let ready = false;
let hideTimer: ReturnType<typeof setTimeout> | undefined;
let removeTimer: ReturnType<typeof setTimeout> | undefined;

export function holdFor(installed: boolean, since: number, now: number): number {
  return installed ? Math.max(0, since + SPLASH_MS - FADE_MS - now) : 0;
}
export const isComingBack = (awayMs: number): boolean => awayMs > APP_IDLE_MS;

function cancelTimers(): void {
  clearTimeout(hideTimer);
  clearTimeout(removeTimer);
}

/** SessionGate calls this only when login or the signed-in app is ready. */
export function hideSplash(): void {
  ready = true;
  const boot = document.getElementById('boot');
  if (!boot || boot.dataset.leaving) return;
  if (document.documentElement.dataset.boot === 'skip') {
    boot.remove();
    return;
  }
  boot.dataset.leaving = '1';
  hideTimer = setTimeout(() => {
    boot.classList.add('is-done');
    removeTimer = setTimeout(() => boot.remove(), FADE_MS + 40);
  }, holdFor(installedApp(), shownAt, performance.now()));
}

/** Observe activity without closing the session on pagehide: reload and course switches use it too. */
export function watchSplash(): () => void {
  const boot = document.getElementById('boot');
  if (boot) template = boot.cloneNode(true) as HTMLElement;
  if (document.documentElement.dataset.boot === 'skip') boot?.remove();
  let lastActive = Date.now();
  let lastStored = 0;
  let wasHidden = document.hidden;
  const touch = (force = false) => {
    lastActive = Date.now();
    if (!force && lastActive - lastStored < STORE_INTERVAL) return;
    lastStored = lastActive;
    try { sessionStorage.setItem(LAST_ACTIVE_KEY, String(lastActive)); } catch { /* private/blocked storage: keep in-memory activity */ }
  };
  touch(true);
  const resume = (forceStore = true) => {
    if (document.hidden) return;
    // Another page in this window may have been used while this one sat in the back/forward cache.
    try {
      const stored = Number(sessionStorage.getItem(LAST_ACTIVE_KEY));
      if (Number.isFinite(stored)) lastActive = Math.max(lastActive, stored);
    } catch { /* use this document's activity if storage is unavailable */ }
    const expired = idleExpired(lastActive, Date.now());
    touch(forceStore);
    if (!expired || !template) return;
    cancelTimers();
    document.getElementById('boot')?.remove();
    document.documentElement.dataset.boot = 'show';
    document.body.appendChild(template.cloneNode(true));
    shownAt = performance.now();
    if (ready) hideSplash();
  };
  const onVisibility = () => {
    const hidden = document.hidden;
    // Navigating an already-hidden page may emit another hidden event; it is not new use.
    if (hidden && !wasHidden) touch(true);
    wasHidden = hidden;
    if (!hidden) resume();
  };
  // A notification can navigate a still-hidden window before focusing it. That is not fresh activity.
  const onPageHide = () => { if (!document.hidden) touch(true); };
  const onPageShow = (event: PageTransitionEvent) => { if (event.persisted) resume(); };
  // Also handle a computer waking after a day without a visibility change.
  const onActivity = () => { if (!document.hidden) resume(false); };
  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('pagehide', onPageHide);
  window.addEventListener('pageshow', onPageShow);
  document.addEventListener('pointerdown', onActivity, { passive: true });
  document.addEventListener('keydown', onActivity);
  return () => {
    cancelTimers();
    document.removeEventListener('visibilitychange', onVisibility);
    window.removeEventListener('pagehide', onPageHide);
    window.removeEventListener('pageshow', onPageShow);
    document.removeEventListener('pointerdown', onActivity);
    document.removeEventListener('keydown', onActivity);
  };
}
