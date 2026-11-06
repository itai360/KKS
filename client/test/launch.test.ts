import { describe, expect, it } from 'vitest';
import { isOpening } from '../src/lib/launch';

const ORIGIN = 'https://kks.example';
const at = (url: string) => {
  const u = new URL(url, ORIGIN);
  return { pathname: u.pathname, search: u.search, hash: u.hash };
};

describe('the app opens on its snapshot', () => {
  it('opened at its front door - from its icon, its address typed, a link from elsewhere', () => {
    expect(isOpening(at('/'), 'navigate', '', ORIGIN)).toBe(true);
    expect(isOpening(at('/'), undefined, '', ORIGIN)).toBe(true);
    expect(isOpening(at('/'), 'navigate', 'https://mail.example/inbox', ORIGIN)).toBe(true);
  });

  it('not when reloaded, come back to, or moved to from a screen of its own', () => {
    expect(isOpening(at('/'), 'reload', '', ORIGIN)).toBe(false);
    expect(isOpening(at('/'), 'back_forward', '', ORIGIN)).toBe(false);
    expect(isOpening(at('/'), 'navigate', `${ORIGIN}/courses`, ORIGIN)).toBe(false);
  });

  it('not when it is asked for a screen - a notification, a shortcut, the calendar on a day', () => {
    expect(isOpening(at('/tasks/12'), 'navigate', '', ORIGIN)).toBe(false);
    expect(isOpening(at('/my?new=task'), 'navigate', '', ORIGIN)).toBe(false);
    expect(isOpening(at('/?date=2026-11-06&event=4'), 'navigate', '', ORIGIN)).toBe(false);
    expect(isOpening(at('/#today'), 'navigate', '', ORIGIN)).toBe(false);
  });
});
