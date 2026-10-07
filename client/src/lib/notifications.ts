// This person's notifications, live, in one place for the bell's panel, the page and the count on the
// bell. A new one comes in at the top as it arrives; one read, put off or deleted on another device
// changes here too (the server says how many are unread after every change - realtime.ts); what is done
// here shows at once, and the server's answer settles the count.

import { useSyncExternalStore } from 'react';
import type { Notification } from '@shared/types';
import { api } from './api';
import { onChange, onNotification, onNotificationState } from './realtime';

export interface NotificationsState {
  /** the latest (not put off), newest first - null until a screen first asks for them */
  list: Notification[] | null;
  error: string | null;
  unread: number;
  /** just arrived: shown with a moment of light */
  fresh: ReadonlySet<number>;
}

let state: NotificationsState = { list: null, error: null, unread: 0, fresh: new Set() };
const listeners = new Set<() => void>();
function set(patch: Partial<NotificationsState>) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => void listeners.delete(l);
};

export function useNotifications(): NotificationsState {
  return useSyncExternalStore(subscribe, () => state, () => state);
}

export const useUnread = () => useSyncExternalStore(subscribe, () => state.unread, () => state.unread);

let seq = 0;
async function load(): Promise<void> {
  const mine = ++seq;
  try {
    const list = await api.get<Notification[]>('/api/notifications');
    if (mine === seq) set({ list, error: null });
  } catch (e) {
    if (mine === seq) set({ error: (e as Error).message });
  }
}

let timer: ReturnType<typeof setTimeout> | null = null;
function reloadSoon(ms = 200) {
  if (state.list === null) return;
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    void load();
  }, ms);
}

/** a screen shows them: load once, and keep them live from then on */
export function ensureNotifications(): void {
  if (state.list === null) void load();
}

const unreadIn = (list: Notification[]) => list.filter((n) => !n.read).length;

/** signed in: the count the server gave; signed out: nothing kept for the next person */
export function startNotifications(unread: number): void {
  seq++;
  state = { list: null, error: null, unread, fresh: new Set() };
  listeners.forEach((l) => l());
}

export function setUnread(unread: number): void {
  if (unread !== state.unread) set({ unread });
}

// ---- what comes in ----

const freshTimers = new Map<number, ReturnType<typeof setTimeout>>();
function markFresh(id: number) {
  set({ fresh: new Set([...state.fresh, id]) });
  clearTimeout(freshTimers.get(id));
  freshTimers.set(
    id,
    setTimeout(() => {
      freshTimers.delete(id);
      const next = new Set(state.fresh);
      next.delete(id);
      set({ fresh: next });
    }, 2600),
  );
}

let panelOpen = false;
/** the panel is open: a new notification comes into it, with no message on top */
export const setPanelOpen = (open: boolean) => void (panelOpen = open);
export const isPanelOpen = () => panelOpen;

if (typeof window !== 'undefined') {
  onNotification((n) => {
    const before = state.list?.find((x) => x.id === n.id);
    const counts = !n.read && (!before || before.read);
    if (state.list) set({ list: [n, ...state.list.filter((x) => x.id !== n.id)] });
    if (counts) set({ unread: state.unread + 1 });
    markFresh(n.id);
  });
  onNotificationState(({ unread }) => {
    setUnread(unread);
    // changed somewhere else (read on the phone, deleted on the computer): the list follows
    if (state.list && unreadIn(state.list) !== unread) reloadSoon();
  });
  onChange((topics) => {
    if (!topics.includes('*') && !topics.includes('notifications')) return;
    reloadSoon(60);
    // back after the connection was lost: the count as it is now
    if (topics.includes('*')) void api.get<{ unread: number }>('/api/notifications/unread').then((r) => setUnread(r.unread)).catch(() => undefined);
  });
}

// ---- what is done here: at once, then settled by the server ----

function patch(ids: number[], read: boolean) {
  if (!state.list) return;
  const on = new Set(ids);
  const list = state.list.map((n) => (on.has(n.id) && n.read !== read ? { ...n, read } : n));
  set({ list, unread: Math.max(0, state.unread + (read ? -1 : 1) * state.list.filter((n) => on.has(n.id) && n.read !== read).length) });
}

async function settle(p: Promise<{ unread: number }>): Promise<void> {
  try {
    setUnread((await p).unread);
  } catch (e) {
    void load();
    throw e;
  }
}

export function markRead(ids: number[]): Promise<void> {
  patch(ids, true);
  return settle(api.post<{ unread: number }>('/api/notifications/read', { ids }));
}

export function markUnread(ids: number[]): Promise<void> {
  patch(ids, false);
  return settle(api.post<{ unread: number }>('/api/notifications/unread', { ids }));
}

export function markAllRead(): Promise<void> {
  if (state.list) set({ list: state.list.map((n) => (n.read ? n : { ...n, read: true })) });
  set({ unread: 0 });
  return settle(api.post<{ unread: number }>('/api/notifications/read', { all: true }));
}

/** put off until a time (out of the list until then), or brought back now (null) */
export async function snooze(n: Notification, until: string | null): Promise<void> {
  if (until && state.list) set({ list: state.list.filter((x) => x.id !== n.id), unread: Math.max(0, state.unread - (n.read ? 0 : 1)) });
  await settle(api.post<{ unread: number }>(`/api/notifications/${n.id}/snooze`, { until }));
  if (!until) void load();
}
