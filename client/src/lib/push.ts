import { useSyncExternalStore } from 'react';
import { api } from './api';
import { IS_DEMO } from './demo';

export function pushSupported(): boolean {
  return typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

/** iOS only delivers web push to an app added to the home screen. */
export function needsHomeScreen(): boolean {
  const ios = /iPad|iPhone|iPod/.test(navigator.userAgent);
  const standalone = window.matchMedia?.('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone;
  return ios && !standalone;
}

/**
 * The service worker is only needed for phone notifications. A browser that has
 * not turned them on keeps no service worker, so it never stands between the app
 * and the server; it is registered again when notifications are turned on.
 */
export async function dropUnusedServiceWorker(): Promise<void> {
  if (!('serviceWorker' in navigator)) return;
  try {
    const regs = await navigator.serviceWorker.getRegistrations();
    for (const reg of regs) {
      const sub = await reg.pushManager?.getSubscription().catch(() => null);
      if (!sub) await reg.unregister();
    }
  } catch {
    /* nothing to clean up */
  }
}

export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | undefined> {
  if (!('serviceWorker' in navigator)) return undefined;
  try {
    return await navigator.serviceWorker.register('/sw.js');
  } catch {
    return undefined;
  }
}

function keyToBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const pad = '='.repeat((4 - (base64url.length % 4)) % 4);
  const raw = atob((base64url + pad).replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export async function currentSubscription(): Promise<PushSubscription | null> {
  if (!pushSupported()) return null;
  const reg = await navigator.serviceWorker.getRegistration();
  return (await reg?.pushManager.getSubscription()) ?? null;
}

export async function enablePush(): Promise<void> {
  if (!pushSupported()) throw new Error('הדפדפן הזה לא תומך בהתראות');
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw new Error('ההרשאה להתראות נדחתה. ניתן לאפשר אותה בהגדרות האתר בדפדפן.');
  await registerServiceWorker();
  const reg = await navigator.serviceWorker.ready;
  const { publicKey } = await api.get<{ publicKey: string }>('/api/push/key');
  const existing = await reg.pushManager.getSubscription();
  const sub = existing ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyToBytes(publicKey) }));
  await api.post('/api/push/subscribe', sub.toJSON());
}

export async function disablePush(): Promise<void> {
  const sub = await currentSubscription();
  if (!sub) return;
  await api.post('/api/push/unsubscribe', { endpoint: sub.endpoint }).catch(() => undefined);
  await sub.unsubscribe();
}

/**
 * This device's phone notifications, the same for every place that offers them (the settings, the
 * home screen, the bell): turned on in one, the others know at once.
 * - install: an iPhone in its browser - they come only to the app on the home screen
 * - unsupported / denied: nothing to offer here (blocked in the browser's settings)
 */
export type PushState = 'loading' | 'unsupported' | 'install' | 'denied' | 'off' | 'on';

let state: PushState = 'loading';
let checked = false;
const listeners = new Set<() => void>();
const setState = (next: PushState) => {
  state = next;
  for (const l of listeners) l();
};

async function check(): Promise<void> {
  if (IS_DEMO) return setState('unsupported');
  // an iPhone's browser has no push at all - the answer there is the app, not "not supported"
  if (needsHomeScreen()) return setState('install');
  if (!pushSupported()) return setState('unsupported');
  if (Notification.permission === 'denied') return setState('denied');
  const sub = await currentSubscription().catch(() => null);
  setState(sub ? 'on' : 'off');
}

export function usePushState(): PushState {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      if (!checked) {
        checked = true;
        void check();
      }
      return () => listeners.delete(listener);
    },
    () => state,
    () => state,
  );
}

/** turns them on here - asking the browser's permission - and sends one to show they arrive */
export async function turnPushOn({ test = false } = {}): Promise<void> {
  try {
    await enablePush();
  } catch (e) {
    if (pushSupported() && Notification.permission === 'denied') setState('denied');
    throw e;
  }
  setState('on');
  if (test) await api.post('/api/push/test').catch(() => undefined);
}

export async function turnPushOff(): Promise<void> {
  await disablePush();
  setState('off');
}
