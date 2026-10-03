export type Cell = string | number | null | undefined;

/**
 * One cell. A text that starts like a formula (= + - @, or a tab) would run as one when the file is
 * opened in Excel ("CSV injection"), so it is kept as text with a leading apostrophe; a plain number
 * or phone number stays as it is.
 */
export function csvCell(v: Cell): string {
  let s = String(v ?? '');
  if (typeof v === 'string' && /^[=+\-@\t\r]/.test(s) && !/^[+-]?[\d\s().-]+$/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}
