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
}

export function setThemePref(pref: ThemePref): void {
  try {
    if (pref === 'auto') localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, pref);
  } catch {
    /* applies to this visit only */
  }
  applyTheme(pref);
}
