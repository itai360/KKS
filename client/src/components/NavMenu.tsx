// Every screen in one place, as tiles: the sheet that rises from the course mark at the top of a phone
// (Layout), and the "כל המסכים" page. The person on top, a search, then the menu's groups - the screen
// on show marked, counts on what waits.

import { useRef, useState } from 'react';
import { Link, useLocation } from 'react-router';
import { matchesSearch } from '@shared/search';
import { useSession } from '../lib/session';
import { setThemePref, shownTheme } from '../lib/theme';
import { Icon } from './Icon';
import { Empty, initials } from './ui';

export interface MenuSection {
  title?: string;
  items: { to: string; label: string; icon: string; count?: number; end?: boolean }[];
}

/** each group's own mark beside its title */
const SECTION_ICONS: Record<string, string> = { 'תכנון הקורס': 'plan', צוערים: 'cap', בקרה: 'pulse', כלים: 'wrench', 'חשבון והעדפות': 'settings' };

export function NavMenu({ sections: nav, onNavigate }: { sections: MenuSection[]; onNavigate?: () => void }) {
  const { user, logout, isCommander, unread } = useSession();
  const location = useLocation();
  const [query, setQuery] = useState('');
  const [theme, setTheme] = useState(shownTheme);
  const search = useRef<HTMLInputElement>(null);
  const sections = [
    ...nav,
    {
      title: 'חשבון והעדפות',
      items: [
        { to: '/notifications', label: 'התראות', icon: 'bell', count: unread },
        { to: '/search', label: 'חיפוש במערכת', icon: 'search' },
        { to: '/settings', label: 'הגדרות', icon: 'settings' },
      ],
    },
  ]
    .map((s) => ({ ...s, items: s.items.filter((it) => matchesSearch(query, it.label, s.title || 'ראשי')) }))
    .filter((s) => s.items.length);
  const count = sections.reduce((sum, s) => sum + s.items.length, 0);
  const here = (to: string, end?: boolean) => (end ? location.pathname === to : location.pathname === to || location.pathname.startsWith(`${to}/`));
  const clear = () => {
    setQuery('');
    search.current?.focus();
  };
  let n = 0;

  return (
    // in the sheet, the menu itself takes the focus - not the search, which would bring up the phone's keyboard
    <div className="nav-menu" tabIndex={onNavigate ? -1 : undefined} data-autofocus={onNavigate ? true : undefined}>
      <div className="nav-menu-me">
        <div className="avatar">{initials(user.displayName)}</div>
        <div className="grow">
          <div className="strong">{user.displayName}</div>
          <div className="tiny muted">{isCommander ? 'מפקד הקורס' : user.title || 'איש סגל'}</div>
        </div>
        <button
          type="button"
          className="icon-btn"
          onClick={() => {
            const next = theme === 'dark' ? 'light' : 'dark';
            setThemePref(next);
            setTheme(next);
          }}
          aria-label={theme === 'dark' ? 'מעבר למצב בהיר' : 'מעבר למצב כהה'}
          title={theme === 'dark' ? 'מעבר למצב בהיר' : 'מעבר למצב כהה'}
        >
          <Icon name={theme === 'dark' ? 'sun' : 'moon'} />
        </button>
        <button type="button" className="btn btn-sm" onClick={() => void logout()}>
          <Icon name="logout" /> יציאה
        </button>
      </div>
      <div className="more-search" role="search" aria-label="חיפוש בניווט">
        <Icon name="search" size={20} />
        <input
          ref={search}
          className="input"
          type="search"
          value={query}
          data-transient
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape' && query) {
              e.stopPropagation();
              clear();
            }
          }}
          placeholder="חיפוש מסך או כלי..."
          aria-label="חיפוש מסך או כלי"
          aria-controls="navigation-results"
        />
        {query && (
          <button type="button" className="icon-btn" onClick={clear} aria-label="ניקוי החיפוש">
            <Icon name="x" />
          </button>
        )}
      </div>
      {query.trim() && (
        <p className="small muted more-search-status" role="status">
          {count === 1 ? 'מסך אחד נמצא' : `${count} מסכים נמצאו`}
        </p>
      )}
      <div id="navigation-results" className="nav-menu-sections">
        {sections.length === 0 && (
          <Empty
            icon="search"
            title="לא נמצא מסך מתאים"
            text={
              <button type="button" className="btn btn-ghost" onClick={clear}>
                ניקוי החיפוש והצגת כל המסכים
              </button>
            }
          />
        )}
        {sections.map((s, i) => (
          <section key={s.title ?? i} className="nav-menu-section" aria-label={s.title || 'ראשי'}>
            {s.title && (
              <h2 className="label-caps nav-menu-title">
                <Icon name={SECTION_ICONS[s.title] ?? 'layers'} size={14} />
                {s.title}
              </h2>
            )}
            <div className="menu-tiles">
              {s.items.map((it) => {
                const on = here(it.to, it.end);
                return (
                  <Link
                    key={it.to}
                    to={it.to}
                    className={`menu-tile${on ? ' is-here' : ''}`}
                    aria-current={on ? 'page' : undefined}
                    style={{ ['--i' as string]: Math.min(n++, 24) }}
                    onClick={() => onNavigate?.()}
                  >
                    <span className="menu-tile-icon">
                      <Icon name={it.icon} size={21} />
                    </span>
                    <span className="menu-tile-label">{it.label}</span>
                    {!!it.count && (
                      <span className="menu-tile-count" aria-label={`${it.count} ממתינים`}>
                        {it.count > 99 ? '99+' : it.count}
                      </span>
                    )}
                  </Link>
                );
              })}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
