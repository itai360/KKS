import { lazy, type ComponentType } from 'react';

const RELOADED = 'kks.reloadedForCode';

/**
 * A screen whose code loads when it is first opened. After an update the
 * server no longer has the previous version's files, so a tab still running
 * it cannot load a screen it has not opened yet: the page then loads afresh,
 * once, and gets the new version.
 */
export function lazyPage<M extends Record<string, unknown>, K extends keyof M & string>(load: () => Promise<M>, name: K) {
  return lazy(async () => {
    try {
      const module = await load();
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
