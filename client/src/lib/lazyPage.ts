import { lazy, type ComponentType } from 'react';

const RELOADED = 'kks.reloadedForCode';
const loaders: (() => Promise<unknown>)[] = [];

/**
 * A screen whose code loads when it is first opened. After an update the
 * server no longer has the previous version's files, so a tab still running
 * it cannot load a screen it has not opened yet: the page then loads afresh,
 * once, and gets the new version.
 */
export function lazyPage<M extends Record<string, unknown>, K extends keyof M & string>(load: () => Promise<M>, name: K) {
  let pending: Promise<M> | null = null;
  // one download, shared by the background fetch and opening the screen; a failed one is tried again
  const get = () =>
    (pending ??= load().catch((e: unknown) => {
      pending = null;
      throw e;
    }));
  loaders.push(get);
  return lazy(async () => {
    try {
      const module = await get();
      try {
        sessionStorage.removeItem(RELOADED);
      } catch {
        /* storage blocked */
      }
      return { default: module[name] as ComponentType };
    } catch (e) {
      let reloaded = false;
      try {
        reloaded = sessionStorage.getItem(RELOADED) === '1';
        if (!reloaded) sessionStorage.setItem(RELOADED, '1');
      } catch {
        reloaded = true; // without storage we cannot tell: do not risk reloading in a loop
      }
      if (!reloaded) window.location.reload();
      throw e;
    }
  });
}

interface Connection {
  saveData?: boolean;
  effectiveType?: string;
}

/**
 * Once the first screen is up and the browser is idle, fetches the other
 * screens' code one by one, so opening them is instant - and a tab left open
 * across an update can still open them. Skipped when the phone asked to save
 * data or the connection is very slow.
 */
export function prefetchPages(): void {
  const connection = (navigator as Navigator & { connection?: Connection }).connection;
  if (connection?.saveData || /(^|-)2g$/.test(connection?.effectiveType ?? '')) return;
  const idle = (run: () => void) => (window.requestIdleCallback ? window.requestIdleCallback(run, { timeout: 5000 }) : window.setTimeout(run, 300));
  let i = 0;
  const next = () => {
    if (i >= loaders.length) return;
    // a failure stops here; that screen tries again when it is opened
    loaders[i++]()
      .then(() => idle(next))
      .catch(() => undefined);
  };
  window.setTimeout(() => idle(next), 2500);
}
