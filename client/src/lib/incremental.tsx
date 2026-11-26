// Long lists draw in batches: the first rows appear at once, and more are added
// as the reader scrolls near the end (or presses the button). A course with
// thousands of tasks stays quick on a phone. Printing draws everything.

import { useEffect, useRef, useState, type ReactNode } from 'react';

export function useIncremental<T>(items: T[], step = 150): { shown: T[]; more: ReactNode } {
  const [limit, setLimit] = useState(step);
  const ref = useRef<HTMLDivElement>(null);
  const left = items.length - limit;

  useEffect(() => {
    const el = ref.current;
    if (!el || left <= 0 || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) setLimit((n) => n + step);
    }, { rootMargin: '800px 0px' });
    io.observe(el);
    return () => io.disconnect();
  }, [left, step]);

  useEffect(() => {
    if (left <= 0) return;
    const all = () => setLimit(Number.MAX_SAFE_INTEGER);
    window.addEventListener('beforeprint', all);
    return () => window.removeEventListener('beforeprint', all);
  }, [left]);

  if (left <= 0) return { shown: items, more: null };
  return {
    shown: items.slice(0, limit),
    more: (
      <div ref={ref} className="load-more">
        <button type="button" className="btn btn-sm" onClick={() => setLimit((n) => n + step * 4)}>
          הצגת עוד · נותרו {left}
        </button>
      </div>
    ),
  };
}
