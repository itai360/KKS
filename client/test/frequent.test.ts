import { beforeEach, describe, expect, it } from 'vitest';

// the browser's storage, as the ranking sees it
const store = new Map<string, string>();
(globalThis as { localStorage?: unknown }).localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
};
const { frequentScreens, noteScreen, screenOf } = await import('../src/lib/frequent');

const DAY = 86_400_000;
const screens = ['/my', '/tasks', '/schedule', '/debriefs', '/cadets', '/weekly'];

describe('the screens a person uses most', () => {
  beforeEach(() => store.clear());

  it('offers the main screens before there is a habit, then the ones used most', () => {
    expect(frequentScreens(7, screens, ['/my', '/tasks', '/schedule'])).toEqual(['/my', '/tasks', '/schedule']);
    const now = Date.now();
    for (const to of ['/debriefs', '/debriefs', '/debriefs', '/cadets', '/cadets', '/weekly']) noteScreen(7, to, now);
    expect(frequentScreens(7, screens, ['/my', '/tasks', '/schedule'], 3, now)).toEqual(['/debriefs', '/cadets', '/weekly']);
    // one screen used so far: the main ones fill the rest
    store.clear();
    noteScreen(7, '/weekly', now);
    expect(frequentScreens(7, screens, ['/my', '/tasks', '/schedule'], 3, now)).toEqual(['/weekly', '/my', '/tasks']);
  });

  it('lets what is used now outrank what was used a lot a month ago, and keeps people apart', () => {
    const then = Date.now() - 40 * DAY;
    for (let i = 0; i < 6; i++) noteScreen(7, '/cadets', then);
    const now = Date.now();
    noteScreen(7, '/debriefs', now);
    noteScreen(7, '/debriefs', now);
    expect(frequentScreens(7, screens, [], 3, now)[0]).toBe('/debriefs');
    expect(frequentScreens(8, screens, ['/tasks'], 3, now)).toEqual(['/tasks']);
  });

  it('finds the screen a page belongs to', () => {
    const menu = [{ to: '/', end: true }, { to: '/cadets' }, { to: '/reports/weekly' }];
    expect(screenOf('/cadets/12', menu)).toBe('/cadets');
    expect(screenOf('/', menu)).toBe('/');
    expect(screenOf('/reports/weekly', menu)).toBe('/reports/weekly');
    expect(screenOf('/nowhere', menu)).toBeNull();
  });
});
