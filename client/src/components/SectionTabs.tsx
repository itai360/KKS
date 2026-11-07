// A topic's screens, as tabs at the top of the page (the menu holds the topics alone). The screen on show sits
// on a raised thumb that slides to the one pressed, as a segmented control does; on a narrow screen the tabs
// scroll sideways, the one on show kept in sight, the edges fading where more is hidden. The arrow keys move
// between them (Home and End to the first and the last), Enter opens.

import { useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Link } from 'react-router';
import { screenAt } from '../lib/topics';
import { Count } from './Count';
import { Icon } from './Icon';

export interface SectionTab {
  to: string;
  label: string;
  icon: string;
  count?: number;
  end?: boolean;
}

const still = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

export function SectionTabs({ title, items, path }: { title: string; items: SectionTab[]; path: string }) {
  const current = screenAt(path, items);
  const track = useRef<HTMLDivElement>(null);
  const thumb = useRef<HTMLSpanElement>(null);
  // where the thumb was a moment ago (as a tab is pressed): it slides from there
  const from = useRef<DOMRect | null>(null);
  const [fade, setFade] = useState({ start: false, end: false });

  const measureFade = () => {
    const el = track.current;
    if (!el) return;
    const over = el.scrollWidth - el.clientWidth;
    // in a right-to-left page the start is at the right: scrollLeft runs from 0 down to minus the overflow
    const at = Math.abs(el.scrollLeft);
    const next = { start: over > 1 && at > 2, end: over > 1 && at < over - 2 };
    setFade((f) => (f.start === next.start && f.end === next.end ? f : next));
  };

  useLayoutEffect(() => {
    const el = track.current;
    const on = el?.querySelector<HTMLElement>('.section-tab.on');
    measureFade();
    if (!el || !on) return;
    // the screen on show in sight, without moving the page up or down
    const box = el.getBoundingClientRect();
    const r = on.getBoundingClientRect();
    if (r.left < box.left + 8) el.scrollBy({ left: r.left - box.left - 24, behavior: still() ? 'auto' : 'smooth' });
    else if (r.right > box.right - 8) el.scrollBy({ left: r.right - box.right + 24, behavior: still() ? 'auto' : 'smooth' });
    // the thumb slides from the tab left to the one now on show
    const was = from.current;
    from.current = null;
    const t = thumb.current;
    if (!was || !t || still()) return;
    const now = t.getBoundingClientRect();
    if (!now.width) return;
    const dx = was.left - now.left;
    const sx = was.width / now.width;
    if (Math.abs(dx) < 1 && Math.abs(sx - 1) < 0.01) return;
    t.animate([{ transform: `translateX(${dx}px) scaleX(${sx})` }, { transform: 'none' }], { duration: 340, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- on the screen on show changing
  }, [current?.to]);

  useLayoutEffect(() => {
    const el = track.current;
    if (!el) return;
    const ro = new ResizeObserver(measureFade);
    ro.observe(el);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once
  }, []);

  // the arrows go along the tabs as they are seen: in a right-to-left page, left is the next one
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const links = [...(track.current?.querySelectorAll<HTMLAnchorElement>('.section-tab') ?? [])];
    const i = links.indexOf(document.activeElement as HTMLAnchorElement);
    if (i < 0) return;
    const rtl = getComputedStyle(track.current!).direction === 'rtl';
    const step = e.key === 'ArrowLeft' ? (rtl ? 1 : -1) : e.key === 'ArrowRight' ? (rtl ? -1 : 1) : 0;
    const to = e.key === 'Home' ? 0 : e.key === 'End' ? links.length - 1 : step ? (i + step + links.length) % links.length : -1;
    if (to < 0) return;
    e.preventDefault();
    links[to].focus();
  };

  return (
    <nav className="section-tabs no-print" aria-label={`המסכים של ${title}`}>
      <div
        ref={track}
        className={`section-tabs-track${fade.start ? ' fade-start' : ''}${fade.end ? ' fade-end' : ''}`}
        onScroll={measureFade}
        onKeyDown={onKey}
      >
        {items.map((it) => {
          const on = it === current;
          return (
            <Link
              key={it.to}
              to={it.to}
              className={`section-tab${on ? ' on' : ''}`}
              aria-current={on ? (path === it.to ? 'page' : 'true') : undefined}
              onClick={() => {
                if (!on && thumb.current) from.current = thumb.current.getBoundingClientRect();
              }}
            >
              {on && <span ref={thumb} className="section-tab-thumb" aria-hidden="true" />}
              <Icon name={it.icon} size={16} />
              <span className="section-tab-label">{it.label}</span>
              <Count n={it.count ?? 0} />
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
