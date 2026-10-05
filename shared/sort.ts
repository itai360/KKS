// One alphabetical order, everywhere: options are listed by the Hebrew alphabet (א-ב), with quote
// marks ignored and numbers in their natural order ("צוות 2" before "צוות 10").

const collator = new Intl.Collator('he', { numeric: true, sensitivity: 'base' });
// word by word, as a dictionary: only the quote marks of acronyms (מפק"צ, ס׳) are left out
const plain = (s: string) => s.replace(/["'`״׳“”]/g, '');

export const byHe = (a: string, b: string): number => collator.compare(plain(a), plain(b));

/** the catch-all choice: it comes after every other one */
const OTHER = 'אחר';

/** a copy of the list in alphabetical order, by the text `key` gives (the item itself for strings); "אחר" last */
export function sortHe<T>(list: readonly T[], key: (x: T) => string = (x) => String(x)): T[] {
  return [...list].sort((a, b) => Number(key(a) === OTHER) - Number(key(b) === OTHER) || byHe(key(a), key(b)));
}

/** cadets as lists show them: by team (those without one last), then by last and first name */
export function byTeamAndName(a: { team: string | null; last: string; first: string }, b: { team: string | null; last: string; first: string }): number {
  if (!a.team !== !b.team) return a.team ? -1 : 1;
  return byHe(a.team ?? '', b.team ?? '') || byHe(a.last, b.last) || byHe(a.first, b.first);
}
