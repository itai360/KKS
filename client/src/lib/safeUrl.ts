/**
 * An address from the data, safe to put in a link: a web address or a path of this site - never
 * "javascript:" or "data:", which would run code on click. Anything else leads nowhere.
 */
export function safeUrl(url: string | null | undefined): string {
  const u = (url ?? '').trim();
  if (/^https?:\/\//i.test(u) || (u.startsWith('/') && !u.startsWith('//'))) return u;
  return '#';
}
