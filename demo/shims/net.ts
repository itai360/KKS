// node:net for the browser demo: just telling addresses apart.
export function isIP(s: string): number {
  if (/^(\d{1,3}\.){3}\d{1,3}$/.test(s)) return 4;
  return s.includes(':') ? 6 : 0;
}
