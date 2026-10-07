// Every screen in one place, as tiles: the sheet that rises from the course's name at the top of a phone
// (Layout), and the "כל המסכים" page. The person on top, a search, the three screens they use most,
// then the menu's groups - each closed until its title is tapped (a search opens the ones it finds in),
// the screen on show marked, counts on what waits. Where the phone's bar is at the bottom, its screens
// are not offered again on top or among the main ones (a search still finds them).

import { useMemo, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router';
import { matchesSearch } from '@shared/search';
import { BOTTOM_BAR_MEDIA, bottomBarScreens } from '../lib/bottomBar';
import { frequentScreens } from '../lib/frequent';
import { useSession } from '../lib/session';
import { setThemePref, shownTheme } from '../lib/theme';
import { Icon } from './Icon';
import { Empty, initials } from './ui';

export interface MenuSection {
  title?: string;
  items: { to: string; label: string; icon: string; count?: number; end?: boolean }[];
}

/** each group's own mark beside its title */
const SECTION_ICONS: Record<string, string> = { ראשי: 'home', 'תכנון הקורס': 'plan', צוערים: 'cap', בקרה: 'pulse', כלים: 'wrench', 'חשבון והעדפות': 'settings' };

/** the menu's own last group, beside the course's screens */
export const accountItems = (unread: number): MenuSection['items'] => [
  { to: '/notifications', label: 'התראות', icon: 'bell', count: unread },
  { to: '/search', label: 'חיפוש במערכת', icon: 'search' },
  { to: '/settings', label: 'הגדרות', icon: 'settings' },
];

export function NavMenu({ sections: nav, onNavigate }: { sections: MenuSection[]; onNavigate?: () => void }) {
  const { user, logout, isCommander, unread } = useSession();
  const location = useLocation();
  const [query, setQuery] = useState('');
  const [opened, setOpened] = useState<Record<string, boolean>>({});
  const [theme, setTheme] = useState(shownTheme);
  const search = useRef<HTMLInputElement>(null);
  const searching = !!query.trim();
  // the phone's bar below has these already
  const onBar = useMemo(() => new Set(typeof matchMedia === 'function' && matchMedia(BOTTOM_BAR_MEDIA).matches ? bottomBarScreens(isCommander) : []), [isCommander]);
  // the main screens are a group like the others ("ראשי"); on top instead, the three this person uses most
  const all: MenuSection[] = [
    ...nav.map((s) => (s.title ? s : { title: 'ראשי', items: s.items.filter((it) => searching || !onBar.has(it.to)) })),
    { title: 'חשבון והעדפות', items: accountItems(unread) },
  ];
  const items = all.flatMap((s) => s.items);
  const offeredKey = items
    .filter((it) => !it.end && it.to !== '/' && !onBar.has(it.to))
    .map((it) => it.to)
    .join(',');
  // read once as the menu opens: tiles do not swap under the finger. Before there is a habit to go by:
  // the first screens of the menu - past the home page (the logo is home) and the bar's
  const top = useMemo(() => {
    const offered = offeredKey.split(',').filter(Boolean);
    return frequentScreens(user.id, offered, offered);
  }, [user.id, offeredKey]);
  const frequent = top.map((to) => items.find((it) => it.to === to)).filter((it): it is MenuSection['items'][number] => !!it);
  const sections = all.map((s) => ({ ...s, items: s.items.filter((it) => matchesSearch(query, it.label, s.title ?? '')) })).filter((s) => s.items.length);
  const count = sections.reduce((sum, s) => sum + s.items.length, 0);
  const here = (to: string, end?: boolean) => (end ? location.pathname === to : location.pathname === to || location.pathname.startsWith(`${to}/`));
  const clear = () => {
    setQuery('');
    search.current?.focus();
  };
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
        {!searching && frequent.length > 0 && (
          <section className="nav-menu-section nav-menu-frequent is-open" aria-labelledby="nav-menu-frequent-title">
            <h2 className="label-caps nav-menu-caption" id="nav-menu-frequent-title">
              בשימוש גבוה
            </h2>
            <div className="menu-tiles is-frequent">
              {frequent.map((it, k) => (
                <MenuTile key={it.to} item={it} on={here(it.to, it.end)} index={k} onNavigate={onNavigate} />
              ))}
            </div>
          </section>
        )}
        {sections.map((s, i) => {
          // a group opens by its title (a search opens them all)
          const open = searching || !!opened[s.title!];
          const total = s.items.reduce((sum, it) => sum + (it.count ?? 0), 0);
          const isHere = s.items.some((it) => here(it.to, it.end));
          const bodyId = `nav-menu-group-${i}`;
          const tiles = (
            <div className="menu-tiles">
              {s.items.map((it, k) => (
                <MenuTile key={it.to} item={it} on={here(it.to, it.end)} index={Math.min(k, 24)} onNavigate={onNavigate} />
              ))}
            </div>
          );
          const title = s.title!;
          return (
            <section key={title} className={`nav-menu-section nav-menu-group${open ? ' is-open' : ''}${isHere ? ' is-here' : ''}`} aria-label={title}>
              <h2 className="nav-menu-head">
                <button
                  type="button"
                  className="nav-menu-toggle"
                  aria-expanded={open}
                  aria-controls={bodyId}
                  disabled={searching}
                  onClick={(e) => {
                    const group = e.currentTarget.closest('section');
                    const opening = !opened[title];
                    setOpened((o) => ({ ...o, [title]: !o[title] }));
                    // opened low in the sheet: once it has slid open, the whole of it comes into sight
                    if (opening && group)
                      setTimeout(() => group.scrollIntoView({ block: 'nearest', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' }), 280);
                  }}
                >
                  <span className="nav-menu-toggle-icon">
                    <Icon name={SECTION_ICONS[title] ?? 'layers'} size={18} />
                  </span>
                  <span className="grow">{title}</span>
                  {/* closed: where the screen on show is, and how much waits inside */}
                  {!open && isHere && <span className="nav-menu-here" aria-label="המסך הפתוח נמצא כאן" />}
                  {!open && total > 0 && (
                    <span className="menu-tile-count is-inline" aria-label={`${total} ממתינים`}>
                      {total > 99 ? '99+' : total}
                    </span>
                  )}
                  <span className="tiny muted mono nav-menu-n" aria-hidden="true">
                    {s.items.length}
                  </span>
                  <Icon name="chevronDown" size={16} className="nav-menu-chev" />
                </button>
              </h2>
              <div className="nav-menu-body" id={bodyId} inert={!open}>
                <div className="nav-menu-inner">{tiles}</div>
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}

function MenuTile({ item: it, on, index, onNavigate }: { item: MenuSection['items'][number]; on: boolean; index: number; onNavigate?: () => void }) {
  return (
    <Link to={it.to} className={`menu-tile${on ? ' is-here' : ''}`} aria-current={on ? 'page' : undefined} style={{ ['--i' as string]: index }} onClick={() => onNavigate?.()}>
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
}
