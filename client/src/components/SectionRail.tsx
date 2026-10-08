// A long page in parts - the weekly's four steps, a debrief form's sections - keeps a small floating strip
// under the top bar once its own list of parts has scrolled away: a number for each part, the part on the
// screen now lit with its name, each part's state (done, still missing) on its number, and a tap to go
// there. Like the page dots of an iPhone that widen for the page shown.

import { useEffect, useRef, useState } from 'react';
import { Icon } from './Icon';

export interface RailItem {
  /** the element's id on the page */
  id: string;
  n: number;
  label: string;
  state?: 'ok' | 'need' | null;
  /** read out with the label: "2 פתוחים" */
  count?: string;
}

const topLine = () => document.querySelector('.topbar')?.getBoundingClientRect().bottom ?? 56;

/** which of the parts is on the screen now: the last one whose top has gone under the bar (and the strip) */
function currentOf(ids: string[]): string | null {
  if (!ids.length) return null;
  if (innerHeight + scrollY >= document.documentElement.scrollHeight - 4) return ids[ids.length - 1];
  const line = topLine() + 72;
  let cur = ids[0];
  for (const id of ids) {
    const el = document.getElementById(id);
    if (el && el.getBoundingClientRect().top <= line) cur = id;
  }
  return cur;
}

export function SectionRail({ items, label, wide }: { items: RailItem[]; label: string; /** with every part's name, where the screen is wide enough */ wide?: boolean }) {
  // the dock is sticky under the bar: once it sits there (the parts above it scrolled away), the strip shows
  const dock = useRef<HTMLDivElement>(null);
  const rail = useRef<HTMLElement>(null);
  const [shown, setShown] = useState(false);
  const [cur, setCur] = useState<string | null>(null);
  // a tap leads for a moment: the smooth scroll passing other parts does not take the light from it
  const steer = useRef<{ id: string; until: number } | null>(null);
  const ids = items.map((i) => i.id).join(' ');

  useEffect(() => {
    const list = ids.split(' ').filter(Boolean);
    let frame = 0;
    const update = () => {
      frame = 0;
      const s = dock.current;
      // stuck where its own style docks it (under the bar, or under a page's own sticky line)
      const stuckAt = s ? parseFloat(getComputedStyle(s).top) : NaN;
      setShown(!!s && s.getBoundingClientRect().top <= (Number.isFinite(stuckAt) ? stuckAt : topLine()) + 1);
      const st = steer.current;
      setCur(st && performance.now() < st.until ? st.id : currentOf(list));
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    update();
    addEventListener('scroll', onScroll, { passive: true });
    addEventListener('resize', onScroll);
    return () => {
      cancelAnimationFrame(frame);
      removeEventListener('scroll', onScroll);
      removeEventListener('resize', onScroll);
    };
  }, [ids]);

  // many parts on a narrow screen: the lit one stays in sight within the strip
  useEffect(() => {
    const r = rail.current;
    if (!r || !cur || r.scrollWidth <= r.clientWidth) return;
    r.querySelector<HTMLElement>('.is-current')?.scrollIntoView({ block: 'nearest', inline: 'center' });
  }, [cur]);

  const jump = (id: string) => {
    steer.current = { id, until: performance.now() + 900 };
    setCur(id);
    document.getElementById(id)?.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
  };

  return (
    <>
      <div ref={dock} className="section-rail-dock no-print">
        <nav ref={rail} className={`section-rail${shown ? ' is-shown' : ''}${wide ? ' is-wide' : ''}`} aria-label={label} inert={!shown}>
          {items.map((it) => (
            <button
              key={it.id}
              type="button"
              className={`srail-step${it.id === cur ? ' is-current' : ''}${it.state ? ` is-${it.state}` : ''}`}
              aria-current={it.id === cur ? 'step' : undefined}
              aria-label={`${it.n}. ${it.label}${it.count ? ` - ${it.count}` : ''}${it.state === 'ok' ? ' - הושלם' : it.state === 'need' ? ' - חסר' : ''}`}
              onClick={() => jump(it.id)}
            >
              <span className="srail-n" aria-hidden="true">
                {it.state === 'ok' ? <Icon name="check" size={12} /> : it.n}
              </span>
              <span className="srail-label" aria-hidden="true">
                {it.label}
              </span>
            </button>
          ))}
        </nav>
      </div>
    </>
  );
}

/** the part on the screen now, for a list of parts that is always in sight (a debrief's side list) */
export function useCurrentSection(ids: string[]): string | null {
  const [cur, setCur] = useState<string | null>(null);
  const key = ids.join(' ');
  useEffect(() => {
    const list = key.split(' ').filter(Boolean);
    let frame = 0;
    const update = () => {
      frame = 0;
      setCur(currentOf(list));
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    update();
    addEventListener('scroll', onScroll, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      removeEventListener('scroll', onScroll);
    };
  }, [key]);
  return cur;
}
