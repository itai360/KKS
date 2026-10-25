// The calendar's colours are Google Calendar's: the stylesheet draws each in the same hue the shared
// definitions name, so what is chosen is what is drawn.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { CAL_COLOR_HEX, CAL_COLORS, GOOGLE_COLORS } from '@shared/calendarLayers';

const css = readFileSync(fileURLToPath(new URL('../src/gcal.css', import.meta.url)), 'utf8');
const hueOf = (cls: string) => new RegExp(`\\.${cls} \\{ --c: (#[0-9a-f]{6});`).exec(css)?.[1];

describe("the calendar's colours in the stylesheet", () => {
  it("draws each event colour in Google's hue", () => {
    for (const c of CAL_COLORS) expect(hueOf(`c-${c}`), c).toBe(CAL_COLOR_HEX[c]);
  });

  it("draws each of Google's calendar colours in its hue", () => {
    for (const c of GOOGLE_COLORS) expect(hueOf(`c-g-${c.id}`), c.id).toBe(c.hex);
  });
});
