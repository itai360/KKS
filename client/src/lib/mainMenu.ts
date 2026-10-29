// The side menu, opened from somewhere other than the top bar: the calendar's own bar on a phone has the
// menu's button (☰) where Google Calendar's app has it. Layout keeps the menu; it lends this its opener.

let host: ((from: HTMLElement | null) => void) | null = null;

/** Layout's: opens the menu, and focus goes back to `from` when it closes. Returns the undo. */
export function setMainMenuHost(fn: (from: HTMLElement | null) => void): () => void {
  host = fn;
  return () => {
    if (host === fn) host = null;
  };
}

/** Opens the side menu (a phone's drawer); `from` gets the focus back when it closes. */
export function openMainMenu(from: HTMLElement | null = null): void {
  host?.(from);
}
