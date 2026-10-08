import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError } from './api';
import { onChange } from './realtime';

export interface ApiState<T> {
  data: T | undefined;
  error: string | null;
  /** the failed request's HTTP status (404: it does not exist, or no longer), 0 without a connection */
  status: number | null;
  loading: boolean;
  reload: () => Promise<void>;
  setData: (d: T) => void;
}

// ---------------- what was last fetched, per address ----------------
// A screen opened again (Back, the menu, a row opened a moment ago) shows what it showed last at once
// and refreshes it in the background, the way a screen already open refreshes when something changes.
// Kept in memory only, for the signed-in person: signing out (or in as someone else) empties it.

interface Entry {
  data: unknown;
  at: number;
}
const cache = new Map<string, Entry>();
const MAX_ENTRIES = 50;
/** older than this, an entry is not shown (it is still fetched again, as always) */
const MAX_AGE_MS = 30 * 60_000;
let owner = '';

/**
 * `asOf`: when the request that brought it was sent. An answer to a request sent before what is kept
 * was (a save's own answer, a later fetch) is older than it and does not replace it - on a slow
 * connection, a fetch already on its way when a deadline was changed must not bring the old one back.
 */
function remember(url: string, data: unknown, asOf = Date.now()): void {
  const e = cache.get(url);
  if (e && e.at > asOf) return;
  cache.delete(url);
  cache.set(url, { data, at: asOf });
  // the oldest go first
  while (cache.size > MAX_ENTRIES) cache.delete(cache.keys().next().value!);
}

function cached<T>(url: string | null): T | undefined {
  if (!url) return undefined;
  const e = cache.get(url);
  if (!e) return undefined;
  if (Date.now() - e.at > MAX_AGE_MS) {
    cache.delete(url);
    return undefined;
  }
  return e.data as T;
}

/** for the person now signed in (and the course open): another one starts with nothing kept */
export function setApiCacheOwner(key: string): void {
  if (owner !== key) cache.clear();
  owner = key;
}

export function clearApiCache(): void {
  cache.clear();
  owner = '';
}

/**
 * Fetches an address ahead of opening it - a row the pointer rests on, a card touched - so the screen
 * opens with it. Nothing is fetched when a recent answer is kept.
 */
const prefetching = new Set<string>();
export function prefetch(url: string): void {
  const e = cache.get(url);
  if ((e && Date.now() - e.at < 15_000) || prefetching.has(url)) return;
  prefetching.add(url);
  const asOf = Date.now();
  api
    .get(url)
    .then((d) => remember(url, d, asOf))
    .catch(() => undefined)
    .finally(() => prefetching.delete(url));
}

// ---------------- screens waiting for what they show ----------------
// A screen fetching something it has nothing to show for yet (opened for the first time, or a filter
// changed) counts as waiting; the thin bar at the top of the page shows while anything waits.

let waiting = 0;
const waitListeners = new Set<(n: number) => void>();
function setWaiting(delta: number): void {
  waiting = Math.max(0, waiting + delta);
  waitListeners.forEach((l) => l(waiting));
}
export function onWaiting(fn: (n: number) => void): () => void {
  waitListeners.add(fn);
  fn(waiting);
  return () => waitListeners.delete(fn);
}

/**
 * Fetches `url` and refetches whenever the server announces a change to one of
 * `topics` (or any topic when '*'). Pass null to skip.
 */
export function useApi<T>(url: string | null, topics: string[] = ['tasks']): ApiState<T> {
  const [data, setDataState] = useState<T | undefined>(() => cached<T>(url));
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<number | null>(null);
  const [loading, setLoading] = useState<boolean>(!!url && cached<T>(url) === undefined);
  const urlRef = useRef(url);
  urlRef.current = url;
  // the address what is on the screen came from
  const shown = useRef<string | null>(cached<T>(url) === undefined ? null : url);
  const seq = useRef(0);
  // when the screen last took a save's own answer (setData): a fetch sent before that is older news
  const savedAt = useRef(0);

  const load = useCallback(async () => {
    const u = urlRef.current;
    if (!u) return;
    const mine = ++seq.current;
    // nothing for this address on the screen yet: the screen waits for it
    const blocking = shown.current !== u;
    if (blocking) setWaiting(1);
    const asOf = Date.now();
    try {
      const d = await api.get<T>(u);
      remember(u, d, asOf);
      if (mine === seq.current && urlRef.current === u && asOf >= savedAt.current) {
        shown.current = u;
        setDataState(d);
        setError(null);
        setStatus(null);
      }
    } catch (e) {
      if (mine === seq.current) {
        setError((e as Error).message);
        setStatus(e instanceof ApiError ? e.status : null);
        // it no longer exists (deleted while the screen was open): do not keep showing it
        if (e instanceof ApiError && e.status === 404) {
          cache.delete(u);
          setDataState(undefined);
        }
      }
    } finally {
      if (blocking) setWaiting(-1);
      if (mine === seq.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!url) {
      setLoading(false);
      return;
    }
    // opened before: what it showed last is up at once, and is refreshed below; otherwise what is on
    // the screen stays until the answer comes (a filter changed: the list does not blink empty)
    const kept = cached<T>(url);
    if (kept !== undefined && shown.current !== url) {
      shown.current = url;
      setDataState(kept);
      setError(null);
      setStatus(null);
    }
    setLoading(kept === undefined);
    void load();
  }, [url, load]);

  const topicKey = topics.join(',');
  useEffect(() => {
    if (!url) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const off = onChange((changed) => {
      if (changed.includes('*') || topics.includes('*') || changed.some((t) => topics.includes(t))) {
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => void load(), 60);
      }
    });
    return () => {
      off();
      if (timer) clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, topicKey, load]);

  // a screen that changes what it shows (after saving) keeps the change for the next time it opens
  const setData = useCallback((d: T) => {
    const u = urlRef.current;
    savedAt.current = Date.now();
    if (u) {
      remember(u, d, savedAt.current);
      shown.current = u;
    }
    setDataState(d);
  }, []);

  return { data, error, status, loading, reload: load, setData };
}

/** Re-renders every `ms` so relative times ("לפני 3 דקות", overdue) stay fresh. */
export function useTick(ms = 60_000): number {
  const [n, setN] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setN((x) => x + 1), ms);
    return () => clearInterval(t);
  }, [ms]);
  return n;
}
