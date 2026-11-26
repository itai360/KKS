// A short touch of the phone's vibration on moments that matter - a task done, a sheet let go past
// the line - at the same moment as what is seen. Only where the phone allows it (Android); never more.

let last = 0;

export function haptic(kind: 'tick' | 'success' = 'tick'): void {
  const now = Date.now();
  if (now - last < 80) return;
  last = now;
  try {
    if (typeof navigator.vibrate === 'function' && matchMedia('(pointer: coarse)').matches) navigator.vibrate(kind === 'success' ? 12 : 6);
  } catch {
    /* not on this device */
  }
}
