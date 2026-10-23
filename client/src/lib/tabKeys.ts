// A row of tabs from the keyboard, as tabs work everywhere: Tab reaches only the chosen one, the arrows go
// to the next and the one before (right to left: the left arrow goes on), Home and End to the ends - and
// the tab reached is chosen at once.

import type { KeyboardEvent } from 'react';

export function onTabListKey(e: KeyboardEvent<HTMLElement>): void {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
  const tabs = [...e.currentTarget.querySelectorAll<HTMLElement>('[role="tab"]:not([disabled])')];
  const at = tabs.indexOf(document.activeElement as HTMLElement);
  if (at < 0 || tabs.length < 2) return;
  const rtl = getComputedStyle(e.currentTarget).direction === 'rtl';
  let to = at;
  if (e.key === 'Home') to = 0;
  else if (e.key === 'End') to = tabs.length - 1;
  else to = (at + ((e.key === 'ArrowLeft') === rtl ? 1 : -1) + tabs.length) % tabs.length;
  e.preventDefault();
  tabs[to].focus();
  tabs[to].click();
}

/** a tab's own marks: its role, whether it is the chosen one, and a place in the Tab order only then */
export const tabProps = (selected: boolean) => ({ role: 'tab' as const, 'aria-selected': selected, tabIndex: selected ? 0 : -1 });
