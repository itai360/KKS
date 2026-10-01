import { api } from './api';

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
