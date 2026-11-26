// This person's notifications, live, in one place for the bell's panel, the page and the count on the
// bell. A new one comes in at the top as it arrives; one read, put off or deleted on another device
// changes here too (the server says how many are unread after every change - realtime.ts); what is done
// here shows at once, and the server's answer settles the count. Only what is still open is kept: once
// what one is about is finished (its task done, the request decided...) it shows done for a moment and
// folds away - the server decides what is finished (journal.ts FINISHED), and a change to what they can
// be about (a task, a request, an announcement...) is when to ask it again.

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
  /** what they were about is finished: shown done ("done"), then folding away ("fold"), then out of the list -
   * "news": the news of something done, just come, read before it goes */
  leaving: ReadonlyMap<number, LeavePhase>;
}

export type LeavePhase = 'done' | 'fold' | 'news' | 'news-fold';

let state: NotificationsState = { list: null, error: null, unread: 0, fresh: new Set(), leaving: new Map() };
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

/** the most the server sends: a list this long may not be all of them */
const PAGE = 200;
const newestFirst = (a: Notification, b: Notification) => b.createdAt.localeCompare(a.createdAt) || b.id - a.id;
const open = (list: Notification[]) => list.filter((n) => !state.leaving.has(n.id));

let seq = 0;
async function load(): Promise<void> {
  const mine = ++seq;
  // the ones on screen now: those of them finished since come back marked, to be seen going
  const known = open(state.list ?? [])
    .map((n) => n.id)
    .slice(0, PAGE);
  try {
    const rows = await api.get<Notification[]>(`/api/notifications${known.length ? `?known=${known.join(',')}` : ''}`);
    if (mine !== seq) return;
    const still = rows.filter((n) => !n.finished);
    const done = rows.filter((n) => n.finished);
    // open again while it was going (a task reopened): it stays
    if (still.some((n) => state.leaving.has(n.id))) set({ leaving: new Map([...state.leaving].filter(([id]) => !still.some((n) => n.id === id))) });
    const going = (state.list ?? []).filter((n) => state.leaving.has(n.id) && !rows.some((r) => r.id === n.id));
    set({ list: [...still, ...done, ...going].sort(newestFirst), error: null });
    finish(done.map((n) => n.id));
    // all of them are here: the count is theirs (more than a page - the server counts)
    if (still.length < PAGE) setUnread(unreadIn(still));
    else void api.get<{ unread: number }>('/api/notifications/unread').then((r) => setUnread(r.unread)).catch(() => undefined);
  } catch (e) {
    if (mine === seq) set({ error: (e as Error).message });
  }
}

/** finished: done for a moment (news just come for longer, to be read), then folded away and out of the list */
function finish(ids: number[], news = false) {
  const going = ids.filter((id) => !state.leaving.has(id));
  if (!going.length) return;
  set({ leaving: new Map([...state.leaving, ...going.map((id) => [id, news ? 'news' : 'done'] as const)]) });
  setTimeout(
    () => {
      set({ leaving: new Map([...state.leaving].map(([id, p]) => [id, going.includes(id) ? (news ? 'news-fold' : 'fold') : p] as const)) });
      setTimeout(() => {
        const gone = going.filter((id) => state.leaving.get(id)?.endsWith('fold'));
        set({
          leaving: new Map([...state.leaving].filter(([id]) => !gone.includes(id))),
          list: state.list && state.list.filter((n) => !gone.includes(n.id)),
        });
      }, FOLD_MS);
    },
    news ? 2600 : 900,
  );
}
const FOLD_MS = 380;

let timer: ReturnType<typeof setTimeout> | null = null;
function reloadSoon(ms = 200) {
  if (state.list === null) return;
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    void load();
  }, ms);
}

/** what notifications can be about (realtime topics): a change there may have finished some of them */
export const NOTIFICATION_SUBJECTS = ['tasks', 'requests', 'announcements', 'weekly', 'cadets', 'debriefs', 'weeks', 'events'];

let settleTimer: ReturnType<typeof setTimeout> | null = null;
/** something they can be about changed: the list asked again (the finished ones go), or - not shown yet - just the count */
function settleSoon(ms = 350) {
  if (settleTimer) clearTimeout(settleTimer);
  settleTimer = setTimeout(() => {
    settleTimer = null;
    if (state.list) void load();
    else void api.get<{ unread: number }>('/api/notifications/unread').then((r) => setUnread(r.unread)).catch(() => undefined);
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
  state = { list: null, error: null, unread, fresh: new Set(), leaving: new Map() };
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
/** the list is on screen (the panel, or the notifications page): what comes in is seen there */
export const listInSight = () => panelOpen || window.location.pathname === '/notifications';

if (typeof window !== 'undefined') {
  onNotification((n) => {
    if (n.finished) {
      // the news of something done: heard as it comes (a message on top, the phone) and not kept - where the list
      // is on screen it comes in, done, and goes
      if (state.list && listInSight() && !state.list.some((x) => x.id === n.id)) {
        set({ list: [n, ...state.list] });
        markFresh(n.id);
        finish([n.id], true);
      }
      return;
    }
    const before = state.list?.find((x) => x.id === n.id);
    const counts = !n.read && (!before || before.read);
    if (state.list) set({ list: [n, ...state.list.filter((x) => x.id !== n.id)] });
    if (counts) set({ unread: state.unread + 1 });
    markFresh(n.id);
  });
  onNotificationState(({ unread }) => {
    setUnread(unread);
    // changed somewhere else (read on the phone, deleted on the computer, finished): the list follows
    if (state.list && unreadIn(open(state.list)) !== unread) reloadSoon();
  });
  onChange((topics) => {
    if (topics.includes('*') || topics.includes('notifications')) {
      reloadSoon(60);
      // back after the connection was lost: the count as it is now
      if (topics.includes('*')) void api.get<{ unread: number }>('/api/notifications/unread').then((r) => setUnread(r.unread)).catch(() => undefined);
    } else if (topics.some((t) => NOTIFICATION_SUBJECTS.includes(t))) settleSoon();
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
