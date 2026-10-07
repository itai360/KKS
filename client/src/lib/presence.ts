// Something that leaves the way it came: closed, it stays on the page a moment longer, marked as
// leaving, so its way out can play (along the path it came in by) before it is gone.

import { useEffect, useState } from 'react';

export function usePresence(open: boolean, ms = 160): { mounted: boolean; leaving: boolean } {
  const [mounted, setMounted] = useState(open);
  useEffect(() => {
    if (open) {
      setMounted(true);
      return;
    }
    const quick = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    const timer = setTimeout(() => setMounted(false), quick ? 0 : ms);
    return () => clearTimeout(timer);
  }, [open, ms]);
  return { mounted: open || mounted, leaving: !open && mounted };
}
