/** Per-window session: survives refresh/course switches, normally ends when the app window closes. */
export const APP_IDLE_MS = 24 * 60 * 60 * 1000;
export const LAST_ACTIVE_KEY = 'kks.splash.last-active';
export const idleExpired = (last: number, now: number): boolean => last > 0 && now - last > APP_IDLE_MS;
