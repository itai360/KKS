import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { isKksSymbol, KKS_WORD } from '../src/components/BrandMark';

const html = readFileSync(fileURLToPath(new URL('../index.html', import.meta.url)), 'utf8');

describe("the course's mark", () => {
  it('is drawn with the same shapes as the opening screen', () => {
    const logo = /<svg class="kks-logo"[\s\S]*?<\/svg>/.exec(html)?.[0] ?? '';
    expect(/viewBox="([^"]+)"/.exec(logo)?.[1]).toBe(KKS_WORD.viewBox);
    expect(/class="kks-k" d="([^"]+)"/.exec(logo)?.[1]).toBe(KKS_WORD.k);
    expect(/class="kks-s" d="([^"]+)"/.exec(logo)?.[1]).toBe(KKS_WORD.s);
  });

  it('knows קק"ס however it was typed, and leaves another course its letters', () => {
    for (const s of ['קק"ס', 'קק״ס', 'קקס', ' קק״ס ']) expect(isKksSymbol(s)).toBe(true);
    for (const s of ['קמ"ן', 'קצ"ש', 'קק', '']) expect(isKksSymbol(s)).toBe(false);
  });
});
