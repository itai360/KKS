// Moving through a run of documents - the week orders, the plan approvals, a cadet's talks, the
// evaluation files of a team - the way pages are turned: the one before and the one after by name,
// the arrow keys on a computer (in a right-to-left page the next one is to the left), and a swipe
// on a phone (components/periodSwipe.ts). The next one is fetched ahead, so it opens at once.
// And a document's link, shared from the phone's own share sheet (or copied, on a computer).

import { useEffect, useRef, type RefObject } from 'react';
import { useNavigate } from 'react-router';
import { prefetch } from '../lib/useApi';
import { Icon } from './Icon';
import { usePeriodSwipe } from './periodSwipe';
import { usePhonePicker } from './pickers';
import { useToast } from './Toasts';

export interface DocLink {
  /** the address it opens at */
  to: string;
  /** its name, said on the button: "שבוע 4 - הגנה" */
  label: string;
  /** what to fetch ahead, so it opens at once */
  api?: string;
}

/** arrows, swipe and the fetch ahead: wire them once for a document page */
export function useDocNav({ prev, next, swipe }: { prev: DocLink | null; next: DocLink | null; swipe?: RefObject<HTMLElement | null> }) {
  const navigate = useNavigate();
  const phone = usePhonePicker();
  const links = useRef({ prev, next });
  links.current = { prev, next };

  // the one after (and before) is fetched now, so turning to it shows it at once
  useEffect(() => {
    if (next?.api) prefetch(next.api);
    if (prev?.api) prefetch(prev.api);
  }, [next?.api, prev?.api]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      const el = e.target as HTMLElement | null;
      // the arrows of what is being typed in or chosen from stay theirs
      if (el?.closest?.('input, textarea, select, [contenteditable="true"], [role=radio], [role=tab], [role=slider], [role=menuitem], [role=option], .seg')) return;
      if (document.querySelector('.modal, .ctx-menu, .pick-sheet, .confirm-dialog')) return;
      const to = e.key === 'ArrowLeft' ? links.current.next : links.current.prev;
      if (!to) return;
      e.preventDefault();
      navigate(to.to);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [navigate]);

  const noArea = useRef<HTMLElement | null>(null);
  usePeriodSwipe(swipe ?? noArea, {
    enabled: phone && !!swipe && !!(prev || next),
    can: (dir) => !!(dir === 1 ? links.current.next : links.current.prev),
    onStep: (dir) => {
      const to = dir === 1 ? links.current.next : links.current.prev;
      if (to) navigate(to.to);
    },
    skipScrollers: true,
  });
}

/** the one before and the one after, by name, with where this one stands among them */
export function DocPager({ prev, next, position, noun }: { prev: DocLink | null; next: DocLink | null; position?: string; noun: string }) {
  const navigate = useNavigate();
  if (!prev && !next) return null;
  const go = (l: DocLink | null) => l && navigate(l.to);
  return (
    <nav className="doc-pager no-print" aria-label={`מעבר בין ${noun}`}>
      <button
        type="button"
        className="btn btn-sm doc-pager-btn"
        disabled={!prev}
        onClick={() => go(prev)}
        onPointerEnter={() => prev?.api && prefetch(prev.api)}
        aria-label={prev ? `הקודם: ${prev.label}` : 'אין קודם'}
        title={prev ? `${prev.label} (חץ ימינה)` : undefined}
      >
        <Icon name="chevronRight" size={16} />
        {prev && <span className="doc-pager-label">{prev.label}</span>}
      </button>
      {position && <span className="tiny muted doc-pager-at">{position}</span>}
      <button
        type="button"
        className="btn btn-sm doc-pager-btn"
        disabled={!next}
        onClick={() => go(next)}
        onPointerEnter={() => next?.api && prefetch(next.api)}
        aria-label={next ? `הבא: ${next.label}` : 'אין הבא'}
        title={next ? `${next.label} (חץ שמאלה)` : undefined}
      >
        {next && <span className="doc-pager-label">{next.label}</span>}
        <Icon name="chevronLeft" size={16} />
      </button>
    </nav>
  );
}

/** a document's link: the phone's share sheet where there is one (WhatsApp, mail...), copied otherwise */
export function ShareButton({ title }: { title: string }) {
  const toast = useToast();
  const share = async () => {
    const url = location.href;
    if (navigator.share && coarsePointer()) {
      try {
        await navigator.share({ title, url });
        return;
      } catch (e) {
        // closed without sharing: nothing to say
        if ((e as Error).name === 'AbortError') return;
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      toast({ title: 'הקישור למסמך הועתק', body: title, tone: 'green' });
    } catch {
      toast({ title: url, tone: 'gray' });
    }
  };
  return (
    <button type="button" className="btn doc-share" onClick={() => void share()} title="שיתוף הקישור למסמך">
      <Icon name="link" /> <span className="hide-mobile">קישור</span>
      <span className="only-mobile">שיתוף</span>
    </button>
  );
}

/** the share sheet is for a phone (a touch screen); a computer copies the link */
function coarsePointer(): boolean {
  return matchMedia('(pointer: coarse)').matches;
}
