import { describe, expect, it } from 'vitest';
import { GLANCE_MS, holdFor, isComingBack, SPLASH_MS } from '../src/lib/splash';

describe('the opening screen', () => {
  it('stays three seconds in the installed app - its fade the last of them - and no longer than it must in a tab', () => {
    // the app ready half a second after the opening screen began: it waits until the fade's turn
    expect(holdFor(true, 0, 500)).toBe(SPLASH_MS - 280 - 500);
    expect(SPLASH_MS).toBe(3000);
    // the app slower than three seconds: it goes as soon as the app is there
    expect(holdFor(true, 0, 4200)).toBe(0);
    // come back to: counted from when it showed again
    expect(holdFor(true, 60_000, 60_100)).toBe(SPLASH_MS - 280 - 100);
    // a browser's tab: at once
    expect(holdFor(false, 0, 100)).toBe(0);
  });

  it('shows again when the app is come back to - not after a glance away', () => {
    expect(isComingBack(1200)).toBe(false);
    expect(isComingBack(GLANCE_MS)).toBe(true);
    expect(isComingBack(30 * 60_000)).toBe(true);
  });
});
