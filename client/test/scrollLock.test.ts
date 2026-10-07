import { beforeEach, describe, expect, it } from 'vitest';

// the page's body, as the lock sees it
const body = { style: { overflow: '' } };
(globalThis as { document?: unknown }).document = { body };
const { lockScroll } = await import('../src/lib/scrollLock');

describe('the page under dialogs and sheets', () => {
  beforeEach(() => {
    body.style.overflow = '';
  });

  it('scrolls again once the last one closes - whatever order they close in', () => {
    const dialog = lockScroll();
    const sheet = lockScroll();
    expect(body.style.overflow).toBe('hidden');
    dialog();
    expect(body.style.overflow).toBe('hidden');
    sheet();
    expect(body.style.overflow).toBe('');
  });

  it('a hold let go twice counts once', () => {
    const a = lockScroll();
    const b = lockScroll();
    a();
    a();
    expect(body.style.overflow).toBe('hidden');
    b();
    expect(body.style.overflow).toBe('');
  });
});
