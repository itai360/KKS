// After a new version is deployed, a tab that stays open keeps running the old
// code until the page is loaded again, so new features "don't show up". The page
// checks (when it comes back into view, on moving between screens, and every
// few minutes) whether index.html now names a different script than the one it
// started with. When it does, the next move to another screen loads the page
// afresh - nothing is lost, since moving leaves the current screen anyway - and a
// banner offers to reload right away.

const ENTRY = /\/assets\/index-[\w-]+\.js/;
const MIN_GAP = 60_000;

let ready = false;
let lastCheck = 0;
const listeners = new Set<(ready: boolean) => void>();

/** the script this page started with; null in the one-file demo build, which has nothing to compare */
function startedWith(): string | null {
  for (const s of document.querySelectorAll<HTMLScriptElement>('script[type="module"][src]')) {
    const m = ENTRY.exec(s.src);
    if (m) return m[0];
  }
  return null;
}

export async function checkForUpdate(force = false): Promise<boolean> {
  if (ready) return true;
  const mine = startedWith();
  if (!mine || (!force && Date.now() - lastCheck < MIN_GAP)) return false;
  lastCheck = Date.now();
  try {
    const res = await fetch('/', { cache: 'no-store', headers: { accept: 'text/html' } });
    const latest = res.ok ? ENTRY.exec(await res.text())?.[0] : undefined;
    if (latest && latest !== mine) {
      ready = true;
      for (const fn of listeners) fn(true);
    }
  } catch {
    /* offline: the next check will tell */
  }
  return ready;
}

export function updateReady(): boolean {
  return ready;
}

export function onUpdate(fn: (ready: boolean) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function watchForUpdates(): void {
  if (!startedWith()) return;
  setInterval(() => void checkForUpdate(), 5 * 60_000);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void checkForUpdate();
  });
}
