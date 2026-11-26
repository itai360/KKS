// A recording's parts as the browser makes them (lib/recording.ts): cut at a pause, as 16 kHz WAV.

import { describe, expect, it } from 'vitest';
import { cutAt, RATE, wav } from '../src/lib/recording';

describe('a recording cut into parts', () => {
  it('cuts a long recording at its quietest moment before two minutes', () => {
    // three minutes of steady sound, with a pause of a quarter second at 1:50
    const s = new Float32Array(180 * RATE).map((_, i) => 0.5 * Math.sin(i / 7));
    s.fill(0, 110 * RATE, 110.25 * RATE);
    const end = cutAt(s, 0);
    expect(end / RATE).toBeGreaterThan(110);
    expect(end / RATE).toBeLessThan(110.25);
    // the rest is short enough to be the last part
    expect(cutAt(s, end)).toBe(s.length);
  });

  it('writes 16-bit mono WAV at 16 kHz', async () => {
    const blob = wav(new Float32Array([0, 1, -1, 0.5]));
    expect(blob.type).toBe('audio/wav');
    const v = new DataView(await blob.arrayBuffer());
    const text = (at: number, n: number) => String.fromCharCode(...Array.from({ length: n }, (_, i) => v.getUint8(at + i)));
    expect(text(0, 4)).toBe('RIFF');
    expect(text(8, 4)).toBe('WAVE');
    expect(v.getUint16(22, true)).toBe(1); // one channel
    expect(v.getUint32(24, true)).toBe(RATE);
    expect(v.getUint16(34, true)).toBe(16);
    expect(v.getUint32(40, true)).toBe(8); // four samples of two bytes
    expect([v.getInt16(44, true), v.getInt16(46, true), v.getInt16(48, true), v.getInt16(50, true)]).toEqual([0, 32767, -32768, 16383]);
    // two minutes stay under the host's 4.5 MB request limit
    expect(44 + 120 * RATE * 2).toBeLessThan(4_500_000);
  });
});
