// How many wait somewhere (beside a screen's name in the menu, on the bell): a new number pops in, and
// when the last of them is taken care of the count does not just vanish - it shrinks away
// (styles.css, "count-out"), the way a finished row folds out of its list (lib/leaving.ts).

import { useEffect, useState } from 'react';

const OUT_MS = 320;

export function Count({ n, className = 'count', label }: { n: number; className?: string; label?: string }) {
  // the number it had, kept while it goes
  const [last, setLast] = useState(n);
  useEffect(() => {
    if (n > 0) {
      setLast(n);
      return;
    }
    const t = setTimeout(() => setLast(0), OUT_MS);
    return () => clearTimeout(t);
  }, [n]);
  const shown = n > 0 ? n : last;
  if (!shown) return null;
  return (
    // a new key replays the pop; going, it is no longer a count to read
    <span key={n > 0 ? n : 'going'} className={`${className}${n > 0 ? '' : ' is-going'}`} aria-label={n > 0 ? label : undefined} aria-hidden={n > 0 ? undefined : true}>
      {shown > 99 ? '99+' : shown}
    </span>
  );
}
