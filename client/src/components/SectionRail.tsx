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
const still = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

/** many parts on a narrow screen: the lit one in the middle of the strip - the strip alone scrolls (scrollIntoView
 * moves the page too, and on an iPhone stops the page's own scroll to the part tapped) */
function centerLit(r: HTMLElement | null) {
  const on = r?.querySelector<HTMLElement>('.is-current');
  if (!r || !on || r.scrollWidth <= r.clientWidth) return;
  const a = on.getBoundingClientRect();
  const b = r.getBoundingClientRect();
  const by = a.left + a.width / 2 - (b.left + b.width / 2);
  if (Math.abs(by) > 2) r.scrollBy({ left: by, behavior: still() ? 'auto' : 'smooth' });
}

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

export function SectionRail({
  items,
  label,
  wide,
  onGo,
}: {
  items: RailItem[];
  label: string;
  /** with every part's name, where the screen is wide enough */
  wide?: boolean;
  /** a part tapped, before going there (a part closed to its heading opens) */
  onGo?: (id: string) => void;
}) {
  // the dock is sticky under the bar: once it sits there (the parts above it scrolled away), the strip shows
  const dock = useRef<HTMLDivElement>(null);
  const rail = useRef<HTMLElement>(null);
  const [shown, setShown] = useState(false);
  const [cur, setCur] = useState<string | null>(null);
  // a tap leads until the page has come to rest there - the smooth scroll passing other parts does not take the
  // light from it, nor a part too short to reach the top at the page's end - and the person scrolls on
  const steer = useRef<{ id: string; settled: number | null; timer: number } | null>(null);
  // a finger's press on a number: the tap is taken as the finger lifts
  const press = useRef<{ id: string; x: number; y: number } | null>(null);
  const tappedAt = useRef(0);
  const ids = items.map((i) => i.id).join(' ');
  // at rest: the strip brings the lit number to its middle only now, the page no longer moving
  const settle = (st: { settled: number | null }) => {
    st.settled = scrollY;
    centerLit(rail.current);
  };

  useEffect(() => {
    const list = ids.split(' ').filter(Boolean);
    let frame = 0;
    const update = () => {
      frame = 0;
      const s = dock.current;
      // stuck where its own style docks it (under the bar, or under a page's own sticky line)
      const stuckAt = s ? parseFloat(getComputedStyle(s).top) : NaN;
      setShown(!!s && s.getBoundingClientRect().top <= (Number.isFinite(stuckAt) ? stuckAt : topLine()) + 1);
      setCur(steer.current ? steer.current.id : currentOf(list));
    };
    const onScroll = () => {
      const st = steer.current;
      if (st) {
        if (st.settled !== null && Math.abs(scrollY - st.settled) > 4) steer.current = null;
        else if (st.settled === null) {
          clearTimeout(st.timer);
          st.timer = window.setTimeout(() => settle(st), 220);
        }
      }
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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- settle reads refs alone
  }, [ids]);

  // the lit number in sight within the strip as the person scrolls - not while a tap's scroll is on its way
  useEffect(() => {
    if (!steer.current || steer.current.settled !== null) centerLit(rail.current);
  }, [cur]);

  useEffect(() => {
    return () => clearTimeout(steer.current?.timer);
  }, []);

  const jump = (id: string, byKeyboard: boolean) => {
    onGo?.(id);
    const el = document.getElementById(id);
    if (!el) return;
    clearTimeout(steer.current?.timer);
    const st = { id, settled: null as number | null, timer: 0 };
    // no scroll at all (there already): at rest at once
    st.timer = window.setTimeout(() => settle(st), 260);
    steer.current = st;
    setCur(id);
    // the part's top just under the bar and this strip - not hidden behind them
    const under = Math.max(topLine(), rail.current?.getBoundingClientRect().bottom ?? 0) + 12;
    window.scrollTo({ top: Math.max(0, el.getBoundingClientRect().top + scrollY - under), behavior: still() ? 'auto' : 'smooth' });
    // from the keyboard, the keyboard goes there too (and a screen reader reads on from it)
    if (byKeyboard) {
      if (!el.hasAttribute('tabindex')) el.setAttribute('tabindex', '-1');
      el.focus({ preventScroll: true });
    }
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
              // a finger: taken as it lifts - on an iPhone a tap that stops the page still gliding brings no
              // click - unless it moved (the strip swiped sideways); a mouse or the keyboard: the click
              onPointerDown={(e) => {
                press.current = e.pointerType === 'mouse' ? null : { id: it.id, x: e.clientX, y: e.clientY };
              }}
              onPointerCancel={() => (press.current = null)}
              onPointerUp={(e) => {
                const p = press.current;
                press.current = null;
                if (!p || p.id !== it.id || Math.hypot(e.clientX - p.x, e.clientY - p.y) > 10) return;
                tappedAt.current = performance.now();
                jump(it.id, false);
              }}
              onClick={(e) => {
                // the click that follows a finger's tap, already taken
                if (performance.now() - tappedAt.current < 700) return;
                jump(it.id, e.detail === 0);
              }}
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
