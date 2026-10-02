// Text typed into a form on a page and not yet saved survives leaving the page
// and coming back, or a reload. It is kept in this tab only (session storage),
// per user, and removed once saved, emptied, or on sign-out - notes about
// cadets should not stay behind in a shared browser.

import { useCallback, useEffect, useRef, useState } from 'react';
import { useSession } from './session';

const PREFIX = 'kks.draft.';

function read(key: string): string | null {
  try {
    return sessionStorage.getItem(PREFIX + key);
  } catch {
    return null;
  }
}

function write(key: string, value: string): void {
  try {
    if (value.trim()) sessionStorage.setItem(PREFIX + key, value);
    else sessionStorage.removeItem(PREFIX + key);
  } catch {
    /* not kept */
  }
}

/** Like useState for a text field, but the unsaved text is kept until it is saved (set to ''). */
export function useDraft(key: string): [string, (value: string) => void] {
  const { user } = useSession();
  const full = `${user.id}:${key}`;
  const [value, setValue] = useState(() => read(full) ?? '');
  const keyRef = useRef(full);
  // another record on the same screen: its own draft
  useEffect(() => {
    if (keyRef.current === full) return;
    keyRef.current = full;
    setValue(read(full) ?? '');
  }, [full]);
  const set = useCallback((v: string) => {
    setValue(v);
    write(keyRef.current, v);
  }, []);
  return [value, set];
}

export function clearDrafts(): void {
  try {
    for (const k of Object.keys(sessionStorage)) if (k.startsWith(PREFIX)) sessionStorage.removeItem(k);
  } catch {
    /* nothing kept */
  }
}
