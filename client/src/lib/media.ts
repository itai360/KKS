// Whether a media query matches now - and a re-render when that changes (a phone turned, a window resized).

import { useSyncExternalStore } from 'react';

export function useMedia(query: string): boolean {
  return useSyncExternalStore(
    (changed) => {
      const m = typeof matchMedia === 'function' ? matchMedia(query) : null;
      m?.addEventListener('change', changed);
      return () => m?.removeEventListener('change', changed);
    },
    () => typeof matchMedia === 'function' && matchMedia(query).matches,
    () => false,
  );
}
