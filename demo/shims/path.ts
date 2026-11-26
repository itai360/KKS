// node:path (posix) for the browser.

function normalize(p: string): string {
  const abs = p.startsWith('/');
  const out: string[] = [];
  for (const seg of p.split('/')) {
    if (!seg || seg === '.') continue;
    if (seg === '..') out.pop();
    else out.push(seg);
  }
  return (abs ? '/' : '') + out.join('/') || (abs ? '/' : '.');
}

export const join = (...parts: string[]) => normalize(parts.filter(Boolean).join('/'));
export const resolve = (...parts: string[]) => normalize(parts.reduce((acc, p) => (p.startsWith('/') ? p : `${acc}/${p}`), ''));
export const dirname = (p: string) => normalize(p).replace(/\/[^/]*$/, '') || '.';
export const basename = (p: string) => normalize(p).split('/').pop() ?? '';
export const extname = (p: string) => /\.[^./]*$/.exec(basename(p))?.[0] ?? '';
export const sep = '/';
export default { join, resolve, dirname, basename, extname, sep };
