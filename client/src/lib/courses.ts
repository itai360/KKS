import { api } from './api';
import { SNAPSHOT } from './launch';

/** the app loaded again at that address - also when it is the page on show (a link to its own part only
 * scrolls there, and the screens would stay the other course's) */
export function reloadAt(to: string): void {
  const url = new URL(to, window.location.href);
  if (url.pathname === window.location.pathname && url.search === window.location.search) {
    history.replaceState(history.state, '', url);
    window.location.reload();
  } else window.location.assign(url);
}

/** opens a previous course for reading (null: back to the current one) - every screen loads again */
export async function switchCourse(id: number | null): Promise<void> {
  await api.post('/api/courses/view', { id });
  reloadAt(id === null ? '/courses' : '/');
}

/** moves into a course opened beside the current one (null: the current course) - every screen loads again,
 * that course's */
export async function enterCourse(id: number | null, to: string = SNAPSHOT): Promise<void> {
  await api.post('/api/courses/switch', { id });
  reloadAt(to);
}

// the course this screen is in, among those beside each other (session.tsx says): a notification about
// another one opens in its own course
let here: number | null = null;
let beside = false;

export function setCourseHere(slot: number | null, anyBeside: boolean): void {
  here = slot;
  beside = anyBeside;
}

/** where a notification's link goes: into its own course first, when that is another course than this one */
export function notificationHref(n: { link: string | null; courseSlot?: number | null }): string | null {
  if (!n.link) return null;
  const there = n.courseSlot ?? null;
  if (!beside || there === here) return n.link;
  return `/api/courses/open?c=${there === null ? 'main' : `s${there}`}&to=${encodeURIComponent(n.link)}`;
}

/** follows a link: a screen of the app in place; one that moves between courses loads the app again */
export function follow(href: string, navigate: (to: string) => void): void {
  if (href.startsWith('/api/')) window.location.assign(href);
  else navigate(href);
}
