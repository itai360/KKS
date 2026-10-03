// A floating "back" on every screen: to the screen before, or - opened from a link, with no
// screen before it in the app - to the screen above it (a task -> the tasks).

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
  // where this screen is in the app's own history (react-router keeps it)
  const idx = (window.history.state as { idx?: number } | null)?.idx ?? 0;
  if (location.pathname === '/' && idx === 0) return null;
  return (
    <button type="button" className="back-fab no-print" aria-label="חזרה למסך הקודם" title="חזרה" onClick={() => (idx > 0 ? navigate(-1) : navigate(parentPath(location.pathname)))}>
      <Icon name="arrowRight" size={20} />
    </button>
  );
}
