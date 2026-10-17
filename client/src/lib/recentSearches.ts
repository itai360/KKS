// What this person looked for lately, on this device - the search page and the top bar's search share it.

const RECENT_MAX = 8;
const recentKey = (userId: number) => `kks.search.recent.${userId}`;

export function readRecent(userId: number): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(recentKey(userId)) ?? '[]');
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').slice(0, RECENT_MAX) : [];
  } catch {
    return [];
  }
}

export function writeRecent(userId: number, list: string[]): void {
  try {
    localStorage.setItem(recentKey(userId), JSON.stringify(list.slice(0, RECENT_MAX)));
  } catch {
    /* this visit only */
  }
}

/** a search that found something goes first */
export function rememberSearch(userId: number, q: string): string[] {
  const t = q.trim();
  const next = [t, ...readRecent(userId).filter((x) => x !== t)].slice(0, RECENT_MAX);
  writeRecent(userId, next);
  return next;
}
