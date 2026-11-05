// The side menu on a computer: open, or folded to its icons - and folded, whether it opens by itself while the
// mouse is over it (and folds back as the mouse leaves). Kept on this device; the menu's button and the choice
// in the settings change the same thing.

export type RailFold = 'collapsed' | 'expanded';
const KEY = 'kks.rail';
const HOVER_KEY = 'kks.railHover';
const CHANGED = 'kks-rail';

/** folded or open as the person left it; null: as the screen's width has it (folded on a medium screen) */
export function railPref(): RailFold | null {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'collapsed' || v === 'expanded' ? v : null;
  } catch {
    return null;
  }
}

/** folded, it opens while the mouse is over it */
export function railHover(): boolean {
  try {
    return localStorage.getItem(HOVER_KEY) === '1';
  } catch {
    return false;
  }
}

function store(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* this visit only */
  }
}

export function setRailPref(fold: RailFold): void {
  store(KEY, fold);
  window.dispatchEvent(new Event(CHANGED));
}

export function setRailHover(on: boolean): void {
  store(HOVER_KEY, on ? '1' : '0');
  window.dispatchEvent(new Event(CHANGED));
}

export function onRailChange(fn: () => void): () => void {
  window.addEventListener(CHANGED, fn);
  return () => window.removeEventListener(CHANGED, fn);
}

/** offered once on a device: folding the menu tells that it can open by itself */
export function hoverOffered(): boolean {
  try {
    if (localStorage.getItem('kks.railHoverOffered')) return true;
    localStorage.setItem('kks.railHoverOffered', '1');
    return false;
  } catch {
    return true;
  }
}
