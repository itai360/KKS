// What is finished, out of the way: a list shows what is still open, and under it one line - a check,
// what they are, how many - that opens to them. One finished while the list is on screen folds into it
// (lib/leaving.ts) and the count hops. Open or closed is remembered for each list, on this device; in
// print it is always open.

import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Icon } from './Icon';

const KEY = 'kks-done-open';
function openOnes(): Record<string, true> {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '{}') as Record<string, true>;
  } catch {
    return {};
  }
}
function remember(id: string, open: boolean) {
  try {
    const all = openOnes();
    if (open) all[id] = true;
    else delete all[id];
    localStorage.setItem(KEY, JSON.stringify(all));
  } catch {
    /* this visit only */
  }
}

/** a count elsewhere on the page that leads to a drawer: it opens and comes into view */
export function revealDrawer(id: string): void {
  window.dispatchEvent(new CustomEvent('kks-reveal-drawer', { detail: id }));
}

/** row: as a row of the card it is in (the agenda's day), not a box of its own under a list */
export function DoneDrawer({ id, count, label, row, children }: { id: string; count: number; label: string; row?: boolean; children: ReactNode }) {
  const [open, setOpen] = useState(() => !!openOnes()[id]);
  const body = useId();
  const ref = useRef<HTMLDivElement>(null);
  // more of them while on screen: the count hops (not on the way in)
  const was = useRef(count);
  const [hop, setHop] = useState(0);
  useEffect(() => {
    if (count > was.current) setHop((h) => h + 1);
    was.current = count;
  }, [count]);
  useEffect(() => {
    const onReveal = (e: Event) => {
      if ((e as CustomEvent<string>).detail !== id) return;
      setOpen(true);
      remember(id, true);
      requestAnimationFrame(() => ref.current?.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' }));
    };
    window.addEventListener('kks-reveal-drawer', onReveal);
    return () => window.removeEventListener('kks-reveal-drawer', onReveal);
  }, [id]);
  if (!count) return null;
  const toggle = () => {
    setOpen(!open);
    remember(id, !open);
  };
  return (
    <div ref={ref} id={id} className={`done-drawer${open ? ' is-open' : ''}${row ? ' is-row' : ''}`}>
      <button type="button" className="done-drawer-head" aria-expanded={open} aria-controls={body} onClick={toggle}>
        <span className="done-drawer-check" aria-hidden="true">
          <Icon name="check" size={13} />
        </span>
        <span>{label}</span>
        <span key={hop} className={`done-drawer-n${hop ? ' is-hop' : ''}`}>{count}</span>
        <span className="grow" />
        <Icon name="chevronDown" size={16} className="done-drawer-chev" />
      </button>
      <div className="done-drawer-body" id={body} inert={!open || undefined}>
        <div className="done-drawer-inner">{children}</div>
      </div>
    </div>
  );
}
