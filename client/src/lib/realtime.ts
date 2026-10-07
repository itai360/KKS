// Section 51 - changes made by anyone appear immediately for everyone.

import type { Notification } from '@shared/types';
import { noteVersion, sessionLost, versionHeaders } from './api';

type ChangeListener = (topics: string[]) => void;
type NotificationListener = (n: Notification) => void;
type StatusListener = (online: boolean) => void;
/** how many of this person's notifications are unread now (read on another device, put off, back) */
type NotificationStateListener = (state: { unread: number }) => void;

const changeListeners = new Set<ChangeListener>();
const notificationListeners = new Set<NotificationListener>();
const stateListeners = new Set<NotificationStateListener>();
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
let lastAsked: string | null = null;

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
      else if (msg.type === 'notifications') stateListeners.forEach((l) => l({ unread: msg.unread }));
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
    const q = lastNotification === null ? '' : `?n=${lastNotification}${lastAsked ? `&t=${encodeURIComponent(lastAsked)}` : ''}`;
    const res = await fetch(`/api/sync${q}`, { credentials: 'same-origin', cache: 'no-store', headers: versionHeaders() });
    // the session ended (expired, or signed out elsewhere): not a network problem
    if (res.status === 401) return void sessionLost();
    if (!res.ok) throw new Error(String(res.status));
    const d: { v: number; n: number; t?: string; unread?: number; notifications: Notification[] } = await res.json();
    noteVersion(d.v);
    if (lastVersion !== null && (d.v !== lastVersion || !online)) changeListeners.forEach((l) => l(['*']));
    lastVersion = d.v;
    lastNotification = d.n;
    if (d.t) lastAsked = d.t;
    for (const n of d.notifications) notificationListeners.forEach((l) => l(n));
    if (typeof d.unread === 'number') stateListeners.forEach((l) => l({ unread: d.unread! }));
    setOnline(true);
  } catch {
    setOnline(false);
  }
}
const onVisible = () => void poll();
// the browser knows first when the network goes and comes back
const onNetworkLost = () => setOnline(false);
const onNetworkBack = () => void poll();

function startPolling(): void {
  void poll();
  pollTimer = setInterval(() => void poll(), 8000);
  document.addEventListener('visibilitychange', onVisible);
  window.addEventListener('offline', onNetworkLost);
  window.addEventListener('online', onNetworkBack);
}

let retryTimer: ReturnType<typeof setTimeout> | null = null;

function chooseMode(): void {
  fetch('/api/public/info', { cache: 'no-store' })
    .then((r) => {
      if (!r.ok) throw new Error(String(r.status));
      return r.json();
    })
    .then((info: { realtime?: string }) => {
      if (!wanted) return;
      if (info.realtime === 'poll') startPolling();
      else startStream();
    })
    // not known yet: ask again soon rather than guess (a stream on the serverless deployment would never answer)
    .catch(() => {
      if (wanted) retryTimer = setTimeout(chooseMode, 3000);
    });
}

export function connectRealtime(): void {
  if (wanted) return;
  wanted = true;
  chooseMode();
}

export function disconnectRealtime(): void {
  wanted = false;
  if (retryTimer) clearTimeout(retryTimer);
  retryTimer = null;
  source?.close();
  source = null;
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = null;
  document.removeEventListener('visibilitychange', onVisible);
  window.removeEventListener('offline', onNetworkLost);
  window.removeEventListener('online', onNetworkBack);
  lastVersion = null;
  lastNotification = null;
  lastAsked = null;
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

export function onNotificationState(fn: NotificationStateListener): () => void {
  stateListeners.add(fn);
  return () => stateListeners.delete(fn);
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
