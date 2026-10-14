// The site as an app on the phone's home screen (manifest.webmanifest): its own icon, opening full screen
// without the browser's bars - and on an iPhone, phone notifications only reach it from there. Chrome
// (Android, and a computer) offers the install through an event that comes once, early: it is kept here
// for a button of ours. An iPhone has no such event - its Share menu adds the app - so the app says how.
// Running from the home screen already, there is nothing to offer.

import { useSyncExternalStore } from 'react';

/** Chrome's offer to install, kept for when the person chooses to */
interface InstallPrompt extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

let offer: InstallPrompt | null = null;
let installed = false;
const listeners = new Set<() => void>();
const changed = () => listeners.forEach((l) => l());

/** from the start, before any screen is up: Chrome offers the install once, early */
export function watchInstall(): void {
  if (typeof window === 'undefined') return;
  window.addEventListener('beforeinstallprompt', (e) => {
    // our own button offers it, where it belongs - not the browser's banner over the screen
    e.preventDefault();
    offer = e as InstallPrompt;
    changed();
  });
  window.addEventListener('appinstalled', () => {
    offer = null;
    installed = true;
    changed();
  });
}

/**
 * How this device installs the app:
 * - installed: it runs from the home screen (or was just installed)
 * - prompt: Chrome offered it - one button installs
 * - ios-safari: Safari's Share button, then "הוספה למסך הבית"
 * - ios-other: another browser on an iPhone - its Share button in the address bar, or Safari
 * - android-menu: Android, no offer (yet, or a browser that makes none): the browser's menu installs it
 * - none: a computer that cannot install it - it is for the phone
 */
export type InstallWay = 'installed' | 'prompt' | 'ios-safari' | 'ios-other' | 'android-menu' | 'none';

export function installWayOf(ua: string, { standalone, canPrompt, touch }: { standalone: boolean; canPrompt: boolean; touch: boolean }): InstallWay {
  if (standalone) return 'installed';
  if (canPrompt) return 'prompt';
  // an iPad says it is a Mac - one with a touch screen
  const ios = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && touch);
  if (ios) return /CriOS|FxiOS|EdgiOS|OPiOS|GSA\//.test(ua) ? 'ios-other' : 'ios-safari';
  if (/Android/.test(ua)) return 'android-menu';
  return 'none';
}

function standalone(): boolean {
  if (typeof window === 'undefined') return false;
  return installed || matchMedia('(display-mode: standalone)').matches || matchMedia('(display-mode: fullscreen)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

function currentWay(): InstallWay {
  if (typeof navigator === 'undefined') return 'none';
  return installWayOf(navigator.userAgent, { standalone: standalone(), canPrompt: !!offer, touch: navigator.maxTouchPoints > 1 });
}

/** how this device installs the app - and a re-render when that changes (offered, installed) */
export function useInstallWay(): InstallWay {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    currentWay,
    () => 'none' as InstallWay,
  );
}

/** Chrome's own install window; true once the person installed */
export async function installApp(): Promise<boolean> {
  if (!offer) return false;
  const shown = offer;
  await shown.prompt();
  const { outcome } = await shown.userChoice;
  // an offer is good once: Chrome makes a new one if it is turned down
  offer = null;
  if (outcome === 'accepted') installed = true;
  changed();
  return outcome === 'accepted';
}
