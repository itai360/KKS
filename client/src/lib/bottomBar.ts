// The phone's bar at the bottom (Layout): its screens, and when it is on the screen. The menu leaves
// these out of its own tiles - they are always one tap away below.

/** right to left: tasks, cadets, (the "+"), weeks, schedule - tasks is the staff's home page */
export const bottomBarScreens = (isCommander: boolean): string[] => [isCommander ? '/tasks' : '/', '/cadets', '/weeks', '/schedule'];

/** the bar shows up to this width (styles.css) */
export const BOTTOM_BAR_MEDIA = '(max-width: 860px)';
