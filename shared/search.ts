// One way to search, everywhere: Hebrew is typed in many forms, and a search
// should find "מפק״צ" whether it was typed מפק"צ, מפק״צ or מפקצ.

const FINALS: Record<string, string> = { ך: 'כ', ם: 'מ', ן: 'נ', ף: 'פ', ץ: 'צ' };

/** Text as a search compares it: no quote marks or niqqud, final letters folded, hyphens as spaces, any case. */
export function searchKey(s: string | null | undefined): string {
  if (!s) return '';
  return s
    .normalize('NFKD')
    .replace(/[֑-ׇ]/g, '') // niqqud and cantillation marks
    .replace(/["'`״׳“”„‘’]/g, '')
    .replace(/[ךםןףץ]/g, (c) => FINALS[c])
    .replace(/[-–—_/]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/**
 * Does the item match what was typed? Every word must appear, in any of the
 * fields - so "מפק"צ 2 מטווח" finds the range task that מפק"צ 2 owns.
 */
export function matchesSearch(query: string | null | undefined, ...fields: (string | null | undefined)[]): boolean {
  const words = searchKey(query).split(' ').filter(Boolean);
  if (!words.length) return true;
  const hay = fields.map(searchKey).join(' \u0000 ');
  return words.every((w) => hay.includes(w));
}
