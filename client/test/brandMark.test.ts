import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { isKksSymbol, KKS_WORD } from '../src/components/BrandMark';

const html = readFileSync(fileURLToPath(new URL('../index.html', import.meta.url)), 'utf8');

describe("the course's mark", () => {
  it('is drawn with the same shapes as the opening screen (which moves קק״ in its pieces)', () => {
    const logo = /<svg class="kks-logo"[\s\S]*?<\/svg>/.exec(html)?.[0] ?? '';
    expect(/viewBox="([^"]+)"/.exec(logo)?.[1]).toBe(KKS_WORD.viewBox);
    const pieces = [...logo.matchAll(/<path class="([^"]+)" d="([^"]+)"/g)];
    const shapes = (d: string) => d.split('M').filter(Boolean).sort();
    expect(shapes(pieces.filter((m) => m[1].includes('kks-q') || m[1].includes('kks-g')).map((m) => m[2]).join(''))).toEqual(shapes(KKS_WORD.k));
    expect(pieces.find((m) => m[1].includes('kks-s'))?.[2]).toBe(KKS_WORD.s);
  });

  it('knows קק"ס however it was typed, and leaves another course its letters', () => {
    for (const s of ['קק"ס', 'קק״ס', 'קקס', ' קק״ס ']) expect(isKksSymbol(s)).toBe(true);
    for (const s of ['קמ"ן', 'קצ"ש', 'קק', '']) expect(isKksSymbol(s)).toBe(false);
  });
});
