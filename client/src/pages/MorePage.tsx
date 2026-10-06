// Mobile "עוד" menu (section 28).

import { useRef, useState } from 'react';
import { Link } from 'react-router';
import { matchesSearch } from '@shared/search';
import { Icon } from '../components/Icon';
import { useNavSections } from '../components/Layout';
import { Empty, initials, PageHead } from '../components/ui';
import { useSession } from '../lib/session';

export function MorePage() {
  const navigation = useNavSections();
  const { user, logout, isCommander } = useSession();
  const [query, setQuery] = useState('');
  const search = useRef<HTMLInputElement>(null);
  const sections = [
    ...navigation,
    {
      title: 'חשבון והעדפות',
      items: [
        { to: '/search', label: 'חיפוש במערכת', icon: 'search' },
        { to: '/notifications', label: 'התראות', icon: 'bell' },
        { to: '/settings', label: 'הגדרות', icon: 'settings' },
      ],
    },
  ]
    .map((s) => ({ ...s, items: s.items.filter((it) => matchesSearch(query, it.label, s.title || 'ניהול שוטף')) }))
    .filter((s) => s.items.length);
  const count = sections.reduce((sum, s) => sum + s.items.length, 0);
  const clear = () => {
    setQuery('');
    search.current?.focus();
  };
  return (
    <div className="page narrow more-page">
      <PageHead title="כל המסכים" docTitle="עוד" sub="כל הכלים של הקורס, במקום אחד." />
      <div className="more-search" role="search" aria-label="חיפוש בניווט">
        <Icon name="search" size={20} />
        <input
          ref={search}
          className="input"
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') clear();
          }}
          placeholder="חיפוש מסך או כלי..."
          aria-label="חיפוש מסך או כלי"
          aria-controls="navigation-results"
        />
        {query && (
          <button className="icon-btn" onClick={clear} aria-label="ניקוי החיפוש">
            <Icon name="x" />
          </button>
        )}
      </div>
      <p className="small muted more-search-status" role="status">
        {query.trim() ? `${count} מסכים נמצאו` : 'אפשר לחפש לפי שם המסך או התחום'}
      </p>
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
      <div id="navigation-results" className="more-sections">
        {sections.length === 0 && (
          <Empty
            icon="search"
            title="לא נמצא מסך מתאים"
            text={
              <button className="btn btn-ghost" onClick={clear}>
                ניקוי החיפוש והצגת כל המסכים
              </button>
            }
          />
        )}
        {sections.map((s, i) => (
          <div key={i} className="mb-12">
            <h2 className="label-caps more-section-title">{s.title || 'ניהול שוטף'}</h2>
            <nav className="card" aria-label={s.title || 'ניהול שוטף'}>
              {s.items.map((it) => (
                <Link key={it.to} to={it.to} className="health">
                  <Icon name={it.icon} size={20} />
                  <span className="grow strong">{it.label}</span>
                  {!!it.count && <span className="badge t-red">{it.count > 99 ? '99+' : it.count}</span>}
                  <Icon name="chevronLeft" size={16} className="faint" />
                </Link>
              ))}
            </nav>
          </div>
        ))}
      </div>
    </div>
  );
}
