// While a dialog is the topmost layer, the keyboard stays in it: Tab goes round its own controls, and
// focus that lands on the page behind it comes back to where it was in the dialog. A layer opened over it
// (a list, a sheet, a message) comes after it in the page, and is left to itself.

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type=hidden]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"]), [contenteditable="true"]';

/** what Tab reaches in it, in order (shown ones only) */
function focusables(box: HTMLElement): HTMLElement[] {
  return [...box.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.getClientRects().length > 0 && !el.closest('[inert]'));
}

/** opened over the layer: later in the page, outside it */
const above = (layer: HTMLElement, node: Node) => !layer.contains(node) && !!(layer.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING);

export function trapFocus(layer: HTMLElement, isTop: () => boolean): () => void {
  let last: HTMLElement | null = null;
  const onFocusIn = (e: FocusEvent) => {
    if (!isTop()) return;
    const t = e.target as Node;
    if (layer.contains(t)) {
      last = t as HTMLElement;
      return;
    }
    if (above(layer, t)) return;
    // it went to the page behind the dialog: back in
    const back = last?.isConnected && layer.contains(last) ? last : (focusables(layer)[0] ?? layer);
    back.focus({ preventScroll: true });
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key !== 'Tab' || !isTop()) return;
    const active = document.activeElement;
    // in a layer opened over it: that one's own keys
    if (active && above(layer, active)) return;
    const list = focusables(layer);
    if (!list.length) {
      e.preventDefault();
      return;
    }
    const first = list[0];
    const end = list[list.length - 1];
    const inside = !!active && layer.contains(active);
    if (e.shiftKey && (!inside || active === first)) {
      e.preventDefault();
      end.focus();
    } else if (!e.shiftKey && (!inside || active === end)) {
      e.preventDefault();
      first.focus();
    }
  };
  document.addEventListener('focusin', onFocusIn);
  document.addEventListener('keydown', onKey);
  return () => {
    document.removeEventListener('focusin', onFocusIn);
    document.removeEventListener('keydown', onKey);
  };
}
