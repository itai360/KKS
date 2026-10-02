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

/**
 * Fetches `url` and refetches whenever the server announces a change to one of
 * `topics` (or any topic when '*'). Pass null to skip.
 */
export function useApi<T>(url: string | null, topics: string[] = ['tasks']): ApiState<T> {
  const [data, setData] = useState<T | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<number | null>(null);
  const [loading, setLoading] = useState<boolean>(!!url);
  const urlRef = useRef(url);
  urlRef.current = url;
  const seq = useRef(0);

  const load = useCallback(async () => {
    const u = urlRef.current;
    if (!u) return;
    const mine = ++seq.current;
    try {
      const d = await api.get<T>(u);
      if (mine === seq.current && urlRef.current === u) {
        setData(d);
        setError(null);
        setStatus(null);
      }
    } catch (e) {
      if (mine === seq.current) {
        setError((e as Error).message);
        setStatus(e instanceof ApiError ? e.status : null);
        // it no longer exists (deleted while the screen was open): do not keep showing it
        if (e instanceof ApiError && e.status === 404) setData(undefined);
      }
    } finally {
      if (mine === seq.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!url) {
      setLoading(false);
      return;
    }
    setLoading(true);
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
