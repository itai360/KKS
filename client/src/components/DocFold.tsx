// The parts of a plan document open and close by their headings ("1. השורה התחתונה"): read on a screen, one
// keeps the parts one needs and closes the rest down to their line. Remembered on this device. Printed, and
// in the Word file, the document is whole.

import { useEffect, useState, type MouseEvent, type ReactNode } from 'react';
import { Icon } from './Icon';

const KEY = 'kks.docFolds';

function stored(): string[] {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

export interface Folds {
  isOpen: (id: string) => boolean;
  toggle: (id: string) => void;
  /** opened (a tap on its number in the strip of parts goes to it open) */
  open: (id: string) => void;
  /** the section's class: closed to its heading */
  cls: (id: string) => string | undefined;
}

/** the parts closed on this device, by the ids of their sections */
export function useFolds(): Folds {
  const [closed, setClosed] = useState<string[]>(stored);
  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(closed));
    } catch {
      // no storage (a private window): closed for this visit only
    }
  }, [closed]);
  return {
    isOpen: (id) => !closed.includes(id),
    toggle: (id) => setClosed((c) => (c.includes(id) ? c.filter((x) => x !== id) : [...c, id])),
    open: (id) => setClosed((c) => (c.includes(id) ? c.filter((x) => x !== id) : c)),
    cls: (id) => (closed.includes(id) ? 'is-folded' : undefined),
  };
}

/**
 * A part's heading. The heading is tapped as a whole - its text stays text, printed and in the Word file as
 * it is; the arrow beside it is the button, for a keyboard and a screen reader.
 */
export function FoldTitle({ folds, id, children }: { folds: Folds; id: string; children: ReactNode }) {
  const open = folds.isOpen(id);
  const tap = (ev: MouseEvent<HTMLHeadingElement>) => {
    // the button answers for itself; the end of selecting the heading's text is not a tap
    if ((ev.target as Element).closest('button') || getSelection()?.toString()) return;
    folds.toggle(id);
  };
  return (
    <h2 className="fold-h" onClick={tap}>
      <span id={`${id}-title`}>{children}</span>
      <button type="button" className="fold-btn no-print" aria-expanded={open} aria-labelledby={`${id}-title`} title={open ? 'סגירה' : 'פתיחה'} onClick={() => folds.toggle(id)}>
        <Icon name="chevronDown" size={18} />
      </button>
    </h2>
  );
}

/** the Word file is the whole document, as printed: the closed parts opened while it is read */
export const wholeForWord = {
  before: async (): Promise<HTMLElement | null> => {
    const el = document.querySelector<HTMLElement>('article.doc');
    el?.classList.add('is-whole');
    return el;
  },
  after: (): void => {
    document.querySelector('article.doc')?.classList.remove('is-whole');
  },
};
