// A phone's keyboard does not shrink the page (on an iPhone, and on Android unless asked to): it covers
// the bottom of it, and the browser slides the whole screen up to show the field. While one is up, the
// part of the screen still in sight is handed to the stylesheet - its height and where it starts - so a
// dialog sits in it, above the keyboard, and the field typed in is brought to the middle of the dialog.

/** a field the keyboard comes up for */
export function isTypingField(el: EventTarget | null): el is HTMLElement {
  return (
    el instanceof HTMLTextAreaElement ||
    (el instanceof HTMLElement && el.isContentEditable) ||
    (el instanceof HTMLInputElement &&
      el.inputMode !== 'none' &&
      !el.readOnly &&
      !['checkbox', 'radio', 'button', 'submit', 'reset', 'file', 'range', 'color', 'hidden'].includes(el.type))
  );
}

/**
 * A field that takes the keys typed in it, so keyboard shortcuts leave it alone. A checkbox, a radio or
 * a button does not: after ticking a calendar's box, its keys work at once.
 */
export function takesKeys(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  if (el.isContentEditable || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) return true;
  if (el instanceof HTMLInputElement) return !['checkbox', 'radio', 'button', 'submit', 'reset', 'file', 'range', 'color', 'hidden'].includes(el.type);
  const role = el.getAttribute('role');
  return role === 'combobox' || role === 'textbox' || role === 'searchbox' || role === 'listbox';
}

// the floating send button at the bottom of a sheet: the field stays clear of it
const DOCK = 84;

function bringIntoSight(el: HTMLElement) {
  const box = el.closest<HTMLElement>('.modal-body');
  // on a page the browser brings the field into sight itself
  if (!box) return;
  const r = el.getBoundingClientRect();
  const b = box.getBoundingClientRect();
  const room = b.height - DOCK;
  if (r.top >= b.top + 8 && r.bottom <= b.top + room) return;
  const top = box.scrollTop + (r.top - b.top) - Math.max(8, (room - r.height) / 2);
  box.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
}

export function watchKeyboard(): void {
  const vv = typeof window !== 'undefined' ? window.visualViewport : null;
  if (!vv) return;
  const root = document.documentElement;
  let up = false;
  let shownFor: Element | null = null;

  const update = () => {
    const field = document.activeElement;
    // pinching in shrinks what is in sight too - that is not a keyboard
    const now = isTypingField(field) && vv.scale < 1.05 && window.innerHeight - vv.height > 120;
    if (now) {
      root.style.setProperty('--vv-h', `${Math.round(vv.height)}px`);
      root.style.setProperty('--vv-top', `${Math.round(vv.offsetTop)}px`);
    }
    if (now !== up) {
      up = now;
      if (up) root.dataset.kb = '';
      else {
        delete root.dataset.kb;
        root.style.removeProperty('--vv-h');
        root.style.removeProperty('--vv-top');
        shownFor = null;
      }
    }
    // once for each field, after the dialog took its new height
    if (now && field !== shownFor) {
      shownFor = field;
      requestAnimationFrame(() => requestAnimationFrame(() => isTypingField(field) && bringIntoSight(field)));
    }
  };

  vv.addEventListener('resize', update);
  vv.addEventListener('scroll', update);
  window.addEventListener('resize', update);
  document.addEventListener('focusin', () => {
    update();
    // some browsers report the keyboard only once it finished rising
    setTimeout(update, 350);
  });
  // moving from one field to the next keeps the keyboard up: look again once the focus settled
  document.addEventListener('focusout', () => setTimeout(update, 60));
}
