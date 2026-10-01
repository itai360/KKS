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

export function connectRealtime(): void {
  if (source) return;
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

export function disconnectRealtime(): void {
  source?.close();
  source = null;
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
