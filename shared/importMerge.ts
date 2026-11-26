/** Compare imported wording without changing what a person already wrote. */
export const importTextKey = (text: string): string => text
  .replace(/[״“”„]/g, '"').replace(/[׳‘’`]/g, "'").replace(/[–—־]/g, '-')
  .replace(/\s+/g, ' ').trim().toLowerCase();

/** Existing content stays first and unchanged; repeated imports add no duplicate lines. */
export function appendImportedText(current: string, incoming: string): string {
  const read = incoming.trim();
  if (!read || importTextKey(current).includes(importTextKey(read))) return current;
  if (!current.trim()) return read;
  const have = new Set(current.split(/\r?\n/).map(importTextKey).filter(Boolean));
  const fresh = read.split(/\r?\n/).filter((line) => {
    const key = importTextKey(line);
    if (!key) return true;
    if (have.has(key)) return false;
    have.add(key);
    return true;
  }).join('\n').trim();
  return fresh ? `${current}\n\n${fresh}` : current;
}

export function appendImportedRows<T>(current: T[], incoming: T[], same: (a: T, b: T) => boolean): T[] {
  const out = [...current];
  for (const row of incoming) if (!out.some((had) => same(had, row))) out.push(row);
  return out;
}
