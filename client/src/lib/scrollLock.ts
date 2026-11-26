// The page under an open dialog or sheet does not scroll. Each one that opens takes a hold, and the
// page scrolls again once the last hold is let go - counted, not guessed from what is on the page (a
// closing dialog's fading copy still stands there for a moment, and must not keep the page locked).

let holds = 0;

export function lockScroll(): () => void {
  holds++;
  document.body.style.overflow = 'hidden';
  let released = false;
  return () => {
    if (released) return;
    released = true;
    holds = Math.max(0, holds - 1);
    if (holds === 0) document.body.style.overflow = '';
  };
}
