// Mobile "עוד" menu (section 28).

import { Link } from 'react-router';
import { Icon } from '../components/Icon';
import { useNavSections } from '../components/Layout';
import { initials } from '../components/ui';
import { usePageTitle } from '../lib/title';
import { useSession } from '../lib/session';

export function MorePage() {
  // no heading on screen; the browser tab still names the screen
  usePageTitle('עוד');
  const sections = useNavSections();
  const { user, logout, isCommander } = useSession();
  return (
    <div className="page narrow">
      <div className="card card-pad row mb-12">
        <div className="avatar">{initials(user.displayName)}</div>
        <div className="grow">
          <div className="strong">{user.displayName}</div>
          <div className="tiny muted">{isCommander ? 'מפקד הקורס' : user.title || 'איש סגל'}</div>
        </div>
        <button className="btn btn-sm" onClick={() => void logout()}>
          <Icon name="logout" /> יציאה
        </button>
      </div>
      {sections.map((s, i) => (
        <div key={i} className="mb-12">
          {s.title && <div className="label-caps" style={{ margin: '14px 4px 6px' }}>{s.title}</div>}
          <div className="card">
            {s.items.map((it) => (
              <Link key={it.to} to={it.to} className="health">
                <Icon name={it.icon} size={20} />
                <span className="grow strong">{it.label}</span>
                {!!it.count && <span className="badge t-red">{it.count > 99 ? '99+' : it.count}</span>}
                <Icon name="chevronLeft" size={16} className="faint" />
              </Link>
            ))}
          </div>
        </div>
      ))}
      <div className="card">
        <Link to="/search" className="health">
          <Icon name="search" size={20} />
          <span className="grow strong">חיפוש</span>
        </Link>
        <Link to="/notifications" className="health">
          <Icon name="bell" size={20} />
          <span className="grow strong">התראות</span>
        </Link>
        <Link to="/settings" className="health">
          <Icon name="settings" size={20} />
          <span className="grow strong">הגדרות</span>
        </Link>
      </div>
    </div>
  );
}
