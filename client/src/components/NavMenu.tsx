// Every screen in one place: the sheet that rises from the course's name at the top of a phone (Layout),
// and the "כל המסכים" page. Laid out the way a phone's own app library is: a search on top (Enter opens
// the first screen found), a row of the screens this person uses most, then every group of the menu at once -
// each a grid of icons in the group's own colour, one press away (no group to open first), the screen on
// show filled in, a count on what waits. Last, the person: the settings, light or dark, and leaving.
// The home page (the logo is home) and the schedule are not among the groups' tiles, and where the phone's
// bar is at the bottom, neither are its screens (a search still finds them all). Notifications and the
// search of the course are not here: the bell and the magnifier at the top open them.

import { useMemo, useRef, useState, type CSSProperties } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { matchesSearch } from '@shared/search';
import { BOTTOM_BAR_MEDIA, bottomBarScreens } from '../lib/bottomBar';
import { frequentScreens } from '../lib/frequent';
import { useSession } from '../lib/session';
import { setThemePref, shownTheme } from '../lib/theme';
import { Count } from './Count';
import { Highlight } from './Highlight';
import { Icon } from './Icon';
import { Empty, initials } from './ui';

export interface MenuSection {
  title?: string;
  items: MenuItem[];
}

type MenuItem = { to: string; label: string; icon: string; count?: number; end?: boolean };

/** each group's own mark and colour */
const SECTION_ICONS: Record<string, string> = { ראשי: 'home', 'תכנון הקורס': 'plan', צוערים: 'cap', בקרה: 'pulse', כלים: 'wrench', חשבון: 'settings' };
const SECTION_TONES: Record<string, string> = { ראשי: 'gray', 'תכנון הקורס': 'blue', צוערים: 'green', בקרה: 'orange', כלים: 'purple', חשבון: 'gray' };

/** the person's own place, beside the course's screens */
export const SETTINGS_ITEM: MenuItem = { to: '/settings', label: 'הגדרות', icon: 'settings' };

/** where the grids have five icons in a row, not four (as in the styles) */
const WIDE_GRID_MEDIA = '(min-width: 560px)';

export function NavMenu({ sections: nav, onNavigate }: { sections: MenuSection[]; onNavigate?: () => void }) {
  const { user, logout, isCommander } = useSession();
  const location = useLocation();
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [theme, setTheme] = useState(shownTheme);
  const search = useRef<HTMLInputElement>(null);
  const searching = !!query.trim();
  // the phone's bar below has these already
  const onBar = useMemo(() => new Set(typeof matchMedia === 'function' && matchMedia(BOTTOM_BAR_MEDIA).matches ? bottomBarScreens(isCommander) : []), [isCommander]);
  // the groups' tiles leave out the home page (the logo is home), the schedule (it has its own place: the
  // bar below on a phone, the side menu on a computer) and whatever else the bar below has
  const kept = (it: MenuItem) => !it.end && it.to !== '/' && it.to !== '/schedule' && !onBar.has(it.to);
  const all: MenuSection[] = nav.map((s) => (s.title ? s : { title: 'ראשי', items: s.items.filter((it) => searching || kept(it)) }));
  const everything = [...nav.flatMap((s) => s.items), SETTINGS_ITEM];
  // which group a screen is in: its colour, wherever it shows (the most used on top too)
  const toneOf = (to: string) => SECTION_TONES[all.find((s) => s.items.some((it) => it.to === to))?.title ?? 'חשבון'] ?? 'gray';
  const offeredKey = everything
    .filter(kept)
    .map((it) => it.to)
    .join(',');
  // read once as the menu opens: tiles do not swap under the finger. As many as fill one row of the grid.
  // Before there is a habit to go by: the first screens of the menu that it offers
  const top = useMemo(() => {
    const offered = offeredKey.split(',').filter(Boolean);
    const perRow = typeof matchMedia === 'function' && matchMedia(WIDE_GRID_MEDIA).matches ? 5 : 4;
    return frequentScreens(user.id, offered, offered, perRow);
  }, [user.id, offeredKey]);
  const frequent = top.map((to) => everything.find((it) => it.to === to)).filter((it): it is MenuItem => !!it);
  // searching, the person's own place is one of the groups too
  const groups = [...all, ...(searching ? [{ title: 'חשבון', items: [SETTINGS_ITEM] }] : [])];
  const sections = groups.map((s) => ({ ...s, items: s.items.filter((it) => matchesSearch(query, it.label, s.title ?? '')) })).filter((s) => s.items.length);
  const found = sections.flatMap((s) => s.items);
  const here = (to: string, end?: boolean) => (end ? location.pathname === to : location.pathname === to || location.pathname.startsWith(`${to}/`));
  const clear = () => {
    setQuery('');
    search.current?.focus();
  };
  let n = 0;
  const tile = (it: MenuItem, tone: string) => <MenuTile key={it.to} item={it} tone={tone} q={query} on={here(it.to, it.end)} index={Math.min(n++, 30)} onNavigate={onNavigate} />;
  return (
    // in the sheet, the menu itself takes the focus - not the search, which would bring up the phone's keyboard
    <div className="nav-menu" tabIndex={onNavigate ? -1 : undefined} data-autofocus={onNavigate ? true : undefined}>
      <div className="nav-search" role="search" aria-label="חיפוש בניווט">
        <Icon name="search" size={18} />
        <input
          ref={search}
          className="input"
          type="search"
          value={query}
          data-transient
          enterKeyHint="go"
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape' && query) {
              e.stopPropagation();
              clear();
            } else if (e.key === 'Enter' && searching && found[0]) {
              // the first screen found opens
              e.preventDefault();
              navigate(found[0].to);
              onNavigate?.();
            }
          }}
          placeholder="לאן נכנסים?"
          aria-label="חיפוש מסך או כלי"
          aria-controls="navigation-results"
        />
        {query && (
          <button type="button" className="icon-btn" onClick={clear} aria-label="ניקוי החיפוש">
            <Icon name="x" size={16} />
          </button>
        )}
      </div>
      {searching && (
        <p className="tiny muted nav-search-status" role="status">
          {found.length === 0 ? 'לא נמצא מסך' : found.length === 1 ? 'מסך אחד נמצא · Enter פותח אותו' : `${found.length} מסכים נמצאו · Enter פותח את הראשון`}
        </p>
      )}
      <div id="navigation-results" className="nav-sections">
        {searching && found.length === 0 && (
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
          <section className="nav-section nav-quick" aria-labelledby="nav-quick-title">
            <h2 className="nav-caption" id="nav-quick-title">
              <Icon name="zap" size={13} /> הכי בשימוש שלך
            </h2>
            <div className="nav-grid">{frequent.map((it) => tile(it, toneOf(it.to)))}</div>
          </section>
        )}
        {sections.map((s, i) => {
          const title = s.title!;
          const tone = SECTION_TONES[title] ?? 'gray';
          const waiting = s.items.reduce((sum, it) => sum + (it.count ?? 0), 0);
          return (
            <section key={title} className={`nav-section t-${tone}`} aria-labelledby={`nav-section-${i}`}>
              <h2 className="nav-caption" id={`nav-section-${i}`}>
                <span className="nav-caption-mark" aria-hidden="true">
                  <Icon name={SECTION_ICONS[title] ?? 'layers'} size={12} />
                </span>
                {title}
                {waiting > 0 && <span className="nav-caption-wait">{waiting === 1 ? 'אחד ממתין' : `${waiting} ממתינים`}</span>}
              </h2>
              <div className="nav-grid">{s.items.map((it) => tile(it, tone))}</div>
            </section>
          );
        })}
      </div>
      {!searching && (
        <div className="nav-account">
          <div className="avatar">{initials(user.displayName)}</div>
          <div className="grow nav-account-who">
            <div className="strong">{user.displayName}</div>
            <div className="tiny muted">{isCommander ? 'מפקד הקורס' : user.title || 'איש סגל'}</div>
          </div>
          <Link to={SETTINGS_ITEM.to} className={`icon-btn nav-account-btn${here(SETTINGS_ITEM.to) ? ' is-here' : ''}`} aria-label="הגדרות" title="הגדרות" aria-current={here(SETTINGS_ITEM.to) ? 'page' : undefined} onClick={() => onNavigate?.()}>
            <Icon name="settings" />
          </Link>
          <button
            type="button"
            className="icon-btn nav-account-btn"
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
          <button type="button" className="btn btn-sm nav-account-out" onClick={() => void logout()}>
            <Icon name="logout" size={16} /> יציאה
          </button>
        </div>
      )}
    </div>
  );
}

/** a screen: its icon in its group's colour (filled when it is the screen on show), its name under it */
function MenuTile({ item: it, tone, q, on, index, onNavigate }: { item: MenuItem; tone: string; q: string; on: boolean; index: number; onNavigate?: () => void }) {
  return (
    <Link to={it.to} className={`nav-tile${on ? ' is-here' : ''}`} aria-current={on ? 'page' : undefined} style={{ '--i': index } as CSSProperties} onClick={() => onNavigate?.()}>
      <span className={`nav-tile-icon t-${tone}`}>
        <Icon name={it.icon} size={22} />
        <Count n={it.count ?? 0} className="menu-tile-count" label={`${it.count} ממתינים`} />
      </span>
      <span className="nav-tile-label">
        <Highlight text={it.label} q={q} />
      </span>
    </Link>
  );
}
