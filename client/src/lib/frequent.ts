// The screens a person opens most, so the menu offers them first. Each screen entered counts, and a count
// fades by half every ten days - what is used now outranks what was used a lot a month ago. Kept on this
// device, for this person; it is a convenience, so storage that is missing or blocked just means no
// ranking yet.

const HALF_LIFE = 10 * 86_400_000;

type Scores = Record<string, { s: number; t: number }>;

const keyOf = (userId: number) => `kks.screens.${userId}`;

function read(userId: number): Scores {
  try {
    const v = JSON.parse(localStorage.getItem(keyOf(userId)) ?? '{}') as unknown;
    return v && typeof v === 'object' ? (v as Scores) : {};
  } catch {
    return {};
  }
}

const faded = (e: { s: number; t: number }, now: number) => e.s * 0.5 ** (Math.max(0, now - e.t) / HALF_LIFE);

/** a screen entered (its menu address) */
export function noteScreen(userId: number, to: string, now = Date.now()): void {
  const all = read(userId);
  const e = all[to];
  all[to] = { s: (e ? faded(e, now) : 0) + 1, t: now };
  // the few that matter: the rest fall away
  const kept = Object.entries(all)
    .sort((a, b) => faded(b[1], now) - faded(a[1], now))
    .slice(0, 30);
  try {
    localStorage.setItem(keyOf(userId), JSON.stringify(Object.fromEntries(kept)));
  } catch {
    /* not kept */
  }
}

/** the screens used most, of these, most first - then the fallbacks, until there are n */
export function frequentScreens(userId: number, candidates: string[], fallback: string[], n = 3, now = Date.now()): string[] {
  const all = read(userId);
  const ranked = candidates
    .filter((to) => all[to] && faded(all[to], now) > 0.05)
    .sort((a, b) => faded(all[b], now) - faded(all[a], now));
  const out = [...new Set([...ranked, ...fallback.filter((to) => candidates.includes(to))])];
  return out.slice(0, n);
}

/** the menu address a page belongs to: the longest one it is under */
export function screenOf(path: string, screens: { to: string; end?: boolean }[]): string | null {
  let best: string | null = null;
  for (const s of screens) {
    const under = s.end ? path === s.to : path === s.to || path.startsWith(`${s.to}/`);
    if (under && (!best || s.to.length > best.length)) best = s.to;
  }
  return best;
}
