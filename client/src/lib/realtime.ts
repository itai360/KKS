// Section 51 - changes made by anyone appear immediately for everyone.

import type { Notification } from '@shared/types';

type ChangeListener = (topics: string[]) => void;
type NotificationListener = (n: Notification) => void;
type StatusListener = (online: boolean) => void;

const changeListeners = new Set<ChangeListener>();
const notificationListeners = new Set<NotificationListener>();
const statusListeners = new Set<StatusListener>();
let source: EventSource | null = null;
let online = false;

function setOnline(v: boolean) {
  if (online === v) return;
  online = v;
  statusListeners.forEach((l) => l(v));
}

let wanted = false;
let pollTimer: ReturnType<typeof setInterval> | null = null;
let lastVersion: number | null = null;
let lastNotification: number | null = null;

function startStream(): void {
  source = new EventSource('/api/stream');
  source.onopen = () => {
    // after a reconnect, refresh everything that may have changed meanwhile
    if (!online) changeListeners.forEach((l) => l(['*']));
    setOnline(true);
  };
  source.onerror = () => setOnline(false);
  source.onmessage = (e) => {
    try {
      const msg = JSON.parse(e.data);
      if (msg.type === 'change') changeListeners.forEach((l) => l(msg.topics));
      else if (msg.type === 'notification') notificationListeners.forEach((l) => l(msg.notification));
    } catch {
      /* ignore malformed */
    }
  };
}

// The serverless deployment keeps no connection open: ask every few seconds
// whether anything changed, and for new notifications.
async function poll(): Promise<void> {
  if (document.hidden || !wanted) return;
  try {
    const res = await fetch(`/api/sync${lastNotification === null ? '' : `?n=${lastNotification}`}`, { credentials: 'same-origin' });
    if (!res.ok) throw new Error(String(res.status));
    const d: { v: number; n: number; notifications: Notification[] } = await res.json();
    if (lastVersion !== null && (d.v !== lastVersion || !online)) changeListeners.forEach((l) => l(['*']));
    lastVersion = d.v;
    lastNotification = d.n;
    for (const n of d.notifications) notificationListeners.forEach((l) => l(n));
    setOnline(true);
  } catch {
    setOnline(false);
  }
}
const onVisible = () => void poll();

function startPolling(): void {
  void poll();
  pollTimer = setInterval(() => void poll(), 8000);
  document.addEventListener('visibilitychange', onVisible);
}

export function connectRealtime(): void {
  if (wanted) return;
  wanted = true;
  fetch('/api/public/info')
    .then((r) => r.json())
    .then((info: { realtime?: string }) => {
      if (!wanted) return;
      if (info.realtime === 'poll') startPolling();
      else startStream();
    })
    .catch(() => wanted && startStream());
}

export function disconnectRealtime(): void {
  wanted = false;
  source?.close();
  source = null;
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = null;
  document.removeEventListener('visibilitychange', onVisible);
  lastVersion = null;
  lastNotification = null;
  setOnline(false);
}

export function onChange(fn: ChangeListener): () => void {
  changeListeners.add(fn);
  return () => changeListeners.delete(fn);
}

export function onNotification(fn: NotificationListener): () => void {
  notificationListeners.add(fn);
  return () => notificationListeners.delete(fn);
}

export function onStatus(fn: StatusListener): () => void {
  statusListeners.add(fn);
  fn(online);
  return () => statusListeners.delete(fn);
}

/** Lets a mutation trigger an immediate local refresh without waiting for the server echo. */
export function emitLocalChange(...topics: string[]): void {
  changeListeners.forEach((l) => l(topics.length ? topics : ['*']));
}
