// The phone's bar at the bottom (Layout): its screens, and when it is on the screen. The menu leaves
// these out of its own tiles - they are always one tap away below.

/** right to left: home, cadets, (the "+"), weeks, tasks - the same for everyone */
export const BOTTOM_BAR_SCREENS: readonly string[] = ['/', '/cadets', '/weeks', '/tasks'];

/** the bar shows up to this width (styles.css) */
export const BOTTOM_BAR_MEDIA = '(max-width: 860px)';
