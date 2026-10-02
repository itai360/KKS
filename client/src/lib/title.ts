// The browser tab says where you are ("צוערים · קק"ס"), with the unread count
// in front - so a row of open tabs, or the history list, can be told apart.

import { useEffect } from 'react';

const DEFAULT = 'ניהול קורס קק"ס';
let suffix = DEFAULT;
let page: string | null = null;
let count = 0;

function apply() {
  const base = page ? `${page} · ${suffix}` : suffix;
  document.title = count > 0 ? `(${count > 99 ? '99+' : count}) ${base}` : base;
}

export function setTitleSuffix(s: string | null | undefined) {
  suffix = s?.trim() || DEFAULT;
  apply();
}

export function setTitleCount(n: number) {
  count = n;
  apply();
}

export function usePageTitle(t: string | null | undefined) {
  useEffect(() => {
    if (!t) return;
    page = t;
    apply();
    return () => {
      if (page === t) {
        page = null;
        apply();
      }
    };
  }, [t]);
}
