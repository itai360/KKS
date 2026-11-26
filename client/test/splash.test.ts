import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import { holdFor, isComingBack, SPLASH_MS } from '../src/lib/splash';
import { APP_IDLE_MS, LAST_ACTIVE_KEY } from '../src/lib/appSession';
import { AWAY_MS } from '../src/lib/launch';

// Execute the actual pre-paint script: a bundle-only test would miss a logo flash on reload.
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const script = html.match(/<script id="boot-policy">([\s\S]*?)<\/script>/)![1];
const NOW = 2_000_000_000_000;
function boot(last?: string, opts: { now?: number; navigation?: string; blocked?: boolean; writeBlocked?: boolean; referrer?: string } = {}) {
  const values = new Map(last === undefined ? [] : [[LAST_ACTIVE_KEY, last]]);
  const dataset: Record<string, string> = {};
  runInNewContext(script, {
    Date: { now: () => opts.now ?? NOW },
    URL,
    location: { origin: 'https://kks.example' },
    document: { documentElement: { dataset }, referrer: opts.referrer ?? '' },
    performance: { getEntriesByType: () => [{ type: opts.navigation ?? 'navigate' }] },
    sessionStorage: {
      getItem: (key: string) => { if (opts.blocked) throw Error('blocked'); return values.get(key) ?? null; },
      setItem: (key: string, value: string) => { if (opts.blocked || opts.writeBlocked) throw Error('blocked'); values.set(key, value); },
    },
  });
  return { mode: dataset.boot, last: values.get(LAST_ACTIVE_KEY) };
}

describe('the opening screen', () => {
  it('shows for a new window/session but skips reloads and same-session course switches before paint', () => {
    const first = boot();
    expect(first).toEqual({ mode: 'show', last: String(NOW) });
    expect(boot(first.last, { now: NOW + 5000, navigation: 'reload' }).mode).toBe('skip');
    expect(boot(first.last, { now: NOW + 5000, navigation: 'navigate' }).mode).toBe('skip');
    expect(boot().mode).toBe('show'); // closing the window ends its session storage
  });

  it('shows again only after more than 24 hours, measured from the latest use', () => {
    expect(APP_IDLE_MS).toBe(24 * 60 * 60 * 1000);
    expect(AWAY_MS).toBe(APP_IDLE_MS);
    expect(boot(String(NOW - APP_IDLE_MS)).mode).toBe('skip');
    expect(boot(String(NOW - APP_IDLE_MS - 1)).mode).toBe('show');
    expect(isComingBack(5000)).toBe(false);
    expect(isComingBack(30 * 60_000)).toBe(false);
    expect(isComingBack(APP_IDLE_MS)).toBe(false);
    expect(isComingBack(APP_IDLE_MS + 1)).toBe(true);
    expect(boot(String(NOW + 1000)).mode).toBe('skip'); // clock correction
  });

  it('stays usable with blocked storage, quota errors or a damaged timestamp', () => {
    expect(boot(undefined, { blocked: true }).mode).toBe('show');
    expect(boot(undefined, { blocked: true, navigation: 'reload' }).mode).toBe('skip');
    expect(boot(undefined, { writeBlocked: true, navigation: 'reload' }).mode).toBe('skip');
    expect(boot(undefined, { blocked: true, navigation: 'back_forward' }).mode).toBe('skip');
    expect(boot(undefined, { blocked: true, referrer: 'https://kks.example/settings' }).mode).toBe('skip');
    expect(boot('invalid').mode).toBe('show');
  });

  it('keeps the first launch animation, but never adds a delay after a slow load', () => {
    expect(holdFor(true, 0, 500)).toBe(SPLASH_MS - 280 - 500);
    expect(holdFor(true, 0, 4200)).toBe(0);
    expect(holdFor(true, 60_000, 60_100)).toBe(SPLASH_MS - 280 - 100);
    expect(holdFor(false, 0, 100)).toBe(0);
  });
});
