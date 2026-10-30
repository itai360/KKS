// Light, dark, or as the device is set - chosen per device in settings. The
// stylesheet follows the device by itself; a choice here pins one of the two.

export type ThemePref = 'auto' | 'light' | 'dark';
const KEY = 'kks.theme';

export function themePref(): ThemePref {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'light' || v === 'dark' ? v : 'auto';
  } catch {
    return 'auto';
  }
}

export function applyTheme(pref: ThemePref = themePref()): void {
  const root = document.documentElement;
  if (pref === 'auto') delete root.dataset.theme;
  else root.dataset.theme = pref;
  syncBrowserBar();
}

/**
 * A phone's browser paints its address bar (and the status bar of the app on the home screen) in
 * the page's colour - light in light mode, dark in dark mode - so the top of the screen is one piece.
 */
export function syncBrowserBar(): void {
  if (typeof document === 'undefined') return;
  const metas = [...document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')];
  if (!metas.length) {
    const meta = document.createElement('meta');
    meta.name = 'theme-color';
    document.head.appendChild(meta);
    metas.push(meta);
  }
  // the page has one for a light device and one for a dark one (index.html): a theme chosen here, whatever
  // the device is set to, is the colour of both
  // the page's own colour as it is now - the calendar's on a phone is white, the other screens' the paper
  const body = document.body ? getComputedStyle(document.body).backgroundColor : '';
  const paper = body && body !== 'rgba(0, 0, 0, 0)' && body !== 'transparent' ? body : getComputedStyle(document.documentElement).getPropertyValue('--paper').trim();
  if (paper) for (const meta of metas) meta.content = paper;
}

const CHANGED = 'kks-theme';
const DARK = '(prefers-color-scheme: dark)';

export function setThemePref(pref: ThemePref): void {
  try {
    if (pref === 'auto') localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, pref);
  } catch {
    /* applies to this visit only */
  }
  applyTheme(pref);
  // the button in the top bar and the choice in the settings show the same thing
  window.dispatchEvent(new Event(CHANGED));
}

/** what is on the screen now: the choice, or the device's own setting */
export function shownTheme(pref: ThemePref = themePref()): 'light' | 'dark' {
  if (pref !== 'auto') return pref;
  return typeof matchMedia === 'function' && matchMedia(DARK).matches ? 'dark' : 'light';
}

/** calls back when the choice changes here, or the device switches while following it */
export function onThemeChange(fn: () => void): () => void {
  const media = typeof matchMedia === 'function' ? matchMedia(DARK) : null;
  window.addEventListener(CHANGED, fn);
  media?.addEventListener('change', fn);
  return () => {
    window.removeEventListener(CHANGED, fn);
    media?.removeEventListener('change', fn);
  };
}
