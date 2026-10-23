// Section 51 - changes made by anyone appear immediately for everyone.

import type { Notification } from '@shared/types';
import { noteVersion, seenDataVersion, sessionLost, versionHeaders } from './api';
import { todayKey } from './format';

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
// one for each connection: an answer to a sync asked under an earlier one (signed out meanwhile) is dropped
let generation = 0;
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
let polling = false;
async function poll(): Promise<void> {
  // one sync at a time: a tab coming back and the timer at once ask once
  if (document.hidden || !wanted || polling) return;
  polling = true;
  const mine = generation;
  try {
    const q = lastNotification === null ? '' : `?n=${lastNotification}${lastAsked ? `&t=${encodeURIComponent(lastAsked)}` : ''}`;
    const res = await fetch(`/api/sync${q}`, { credentials: 'same-origin', cache: 'no-store', headers: versionHeaders() });
    if (mine !== generation) return;
    // the session ended (expired, or signed out elsewhere): not a network problem
    if (res.status === 401) return void sessionLost();
    if (!res.ok) throw new Error(String(res.status));
    const d: { v: number; n: number; t?: string; unread?: number; notifications: Notification[] } = await res.json();
    if (mine !== generation) return;
    // the first answer is compared with what the screens' data came with (something may have been saved
    // in between); later ones with the one before - and after a lost connection, everything is fetched again
    const behind = lastVersion === null ? seenDataVersion() > 0 && d.v > seenDataVersion() : d.v !== lastVersion;
    noteVersion(d.v);
    if (behind || (lastVersion !== null && !online)) changeListeners.forEach((l) => l(['*']));
    lastVersion = d.v;
    lastNotification = d.n;
    if (d.t) lastAsked = d.t;
    for (const n of d.notifications) notificationListeners.forEach((l) => l(n));
    if (typeof d.unread === 'number') stateListeners.forEach((l) => l({ unread: d.unread! }));
    setOnline(true);
  } catch {
    if (mine === generation) setOnline(false);
  } finally {
    polling = false;
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

// ---------------- what goes stale with time ----------------
// Lists by the day and the hour (overdue, today, this week) change with the clock, not only with saves:
// the screen open is fetched again every few minutes while it is in sight, on coming back to the tab
// after a while, and when the day turns.
const CLOCK_MS = 5 * 60_000;
const AWAY_MS = 2 * 60_000;
let clockTimer: ReturnType<typeof setInterval> | null = null;
let hiddenSince = 0;
let day = '';
const refreshAll = () => changeListeners.forEach((l) => l(['*']));
function onClockVisibility(): void {
  if (document.hidden) {
    hiddenSince = Date.now();
    return;
  }
  const away = hiddenSince ? Date.now() - hiddenSince : 0;
  hiddenSince = 0;
  if (away >= AWAY_MS || todayKey() !== day) {
    day = todayKey();
    refreshAll();
  }
}
function startClock(): void {
  day = todayKey();
  clockTimer = setInterval(() => {
    if (document.hidden || !wanted) return;
    day = todayKey();
    refreshAll();
  }, CLOCK_MS);
  document.addEventListener('visibilitychange', onClockVisibility);
}
function stopClock(): void {
  if (clockTimer) clearInterval(clockTimer);
  clockTimer = null;
  hiddenSince = 0;
  document.removeEventListener('visibilitychange', onClockVisibility);
}

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
  startClock();
}

export function disconnectRealtime(): void {
  wanted = false;
  generation++;
  stopClock();
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
