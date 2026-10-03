// "Back" at the start of the top bar (which stays at the top of the screen) on every screen
// but the home screen: step by step to the screens before, until home - where it is gone until
// another screen is opened. A screen opened from a link, with no screen before it in the app,
// goes up instead (a task -> the tasks -> home). The only back arrow on a screen.

import { useLocation, useNavigate } from 'react-router';
import { Icon } from './Icon';

/** the screen above: "/weeks/3/order" -> "/weeks/3", "/tasks/12" -> "/tasks", "/tasks" -> home */
export function parentPath(path: string): string {
  const parts = path.split('/').filter(Boolean);
  if (parts.length <= 1) return '/';
  const up = parts.slice(0, -1);
  // a list that is not a screen of its own ("/evaluations/committee/5")
  if (up.length > 1 && up[up.length - 1] === 'committee') up.pop();
  return `/${up.join('/')}`;
}

export function BackButton() {
  const location = useLocation();
  const navigate = useNavigate();
  // going back ends at the home screen
  if (location.pathname === '/') return null;
  // where this screen is in the app's own history (react-router keeps it)
  const idx = (window.history.state as { idx?: number } | null)?.idx ?? 0;
  // going up takes this screen's place, so the next "back" goes on up rather than down to it again
  const back = () => (idx > 0 ? navigate(-1) : navigate(parentPath(location.pathname), { replace: true }));
  return (
    <button type="button" className="back-top no-print" aria-label="חזרה למסך הקודם" title="חזרה" onClick={back}>
      <Icon name="arrowRight" size={19} />
    </button>
  );
}
