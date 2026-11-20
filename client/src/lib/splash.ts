// The opening screen (index.html): קק״ס coming together, its ס jumping. In the installed app it stays three
// seconds at every opening - the app launched, or come back to from the phone's other apps (away more than a
// glance) - and for as long as the app is still loading after that. In a browser's tab it gives way as soon as
// there is something to show.

import { installedApp } from './launch';

/** how long it shows in the installed app, its fade included */
export const SPLASH_MS = 3000;
/** its fade (index.html, #boot's transition) */
const FADE_MS = 280;
/** away less than this - a glance at a message, a swipe - is not opening the app again */
export const GLANCE_MS = 5000;

/** the opening screen as the page first had it, to show again */
let template: HTMLElement | null = null;
/** when the one showing began (the page's own start, for the first) */
let shownAt = 0;

/** how long to wait before it starts fading: in the installed app, until its three seconds are nearly up */
export function holdFor(installed: boolean, since: number, now: number): number {
  return installed ? Math.max(0, since + SPLASH_MS - FADE_MS - now) : 0;
}

/** away long enough that coming back is opening the app */
export const isComingBack = (awayMs: number): boolean => awayMs >= GLANCE_MS;

/** The app has something to show: the opening screen fades - in the installed app not before its time. */
export function hideSplash(): void {
  const boot = document.getElementById('boot');
  if (!boot || boot.dataset.leaving) return;
  boot.dataset.leaving = '1';
  window.setTimeout(
    () => {
      boot.classList.add('is-done');
      window.setTimeout(() => boot.remove(), FADE_MS + 40);
    },
    holdFor(installedApp(), shownAt, performance.now()),
  );
}

/** Before the app is drawn (main.tsx): keeps the opening screen to show again each time the installed app is come
 *  back to - from the start, as it opens. */
export function watchSplash(): void {
  const boot = document.getElementById('boot');
  if (boot) template = boot.cloneNode(true) as HTMLElement;
  let hiddenAt = 0;
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      hiddenAt = Date.now();
      return;
    }
    const away = hiddenAt ? Date.now() - hiddenAt : 0;
    hiddenAt = 0;
    if (!template || !installedApp() || !isComingBack(away) || document.getElementById('boot')) return;
    const again = template.cloneNode(true) as HTMLElement;
    document.body.appendChild(again);
    shownAt = performance.now();
    hideSplash();
  });
}
