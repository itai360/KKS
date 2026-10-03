import { useEffect, useRef, useState, type ReactNode } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router';
import type { Task, TaskRequest } from '@shared/types';
import { pendingRequests, reportIssue } from '../lib/api';
import { onStatus } from '../lib/realtime';
import { useSession } from '../lib/session';
import { checkForUpdate, onUpdate, updateReady } from '../lib/update';
import { useApi } from '../lib/useApi';
import { Icon } from './Icon';
import { useNewTask } from './NewTask';
import { ScreenBoundary } from './ScreenBoundary';
import { BackButton } from './BackButton';
import { CommandPalette, OPEN_PALETTE } from './CommandPalette';
import { ShortcutsHelp } from './Shortcuts';
import { initials } from './ui';
import { switchCourse } from '../lib/courses';

interface NavItem {
  to: string;
  label: string;
  icon: string;
  count?: number;
  end?: boolean;
}

export function useNavSections(): { title?: string; items: NavItem[] }[] {
  const { isCommander } = useSession();
  const requests = useApi<TaskRequest[]>(isCommander ? '/api/requests' : null, ['requests', 'tasks']);
  const approvals = useApi<Task[]>(isCommander ? '/api/tasks?status=pending_approval' : null, ['tasks']);
  const pending = (requests.data?.length ?? 0) + (approvals.data?.length ?? 0);
  // messages from the staff's WhatsApp group that came in since this person last looked
  const alignment = useApi<{ n: number }>('/api/alignment/unseen', ['alignment', 'alignment-seen']).data?.n ?? 0;

  if (isCommander) {
    return [
      {
        items: [
          { to: '/', label: 'בית', icon: 'home', end: true },
          { to: '/my', label: 'המשימות שלי', icon: 'my' },
          { to: '/tasks', label: 'כל המשימות', icon: 'tasks' },
          { to: '/weeks', label: 'שבועות הקורס', icon: 'layers' },
          { to: '/plans', label: 'אישור תוכניות', icon: 'stamp' },
          { to: '/schedule', label: 'לו"ז', icon: 'calendar' },
          { to: '/team', label: 'צוות', icon: 'users' },
        ],
      },
      {
        title: 'בקרה',
        items: [
          { to: '/requests', label: 'אישורים ובקשות', icon: 'inbox', count: pending },
          { to: '/announcements', label: 'הודעות לסגל', icon: 'flag' },
          { to: '/alignment', label: 'יישור קו', icon: 'message', count: alignment },
          { to: '/directory', label: 'אנשי קשר', icon: 'phone' },
          { to: '/briefing', label: 'תדריך בוקר', icon: 'sun' },
          { to: '/reports/weekly', label: 'תמונת מצב שבועית', icon: 'chart' },
          { to: '/lookahead', label: 'מבט קדימה', icon: 'eye' },
          { to: '/activity', label: 'יומן פעילות', icon: 'history' },
        ],
      },
      {
        title: 'צוערים ולקחים',
        items: [
          { to: '/cadets', label: 'צוערים', icon: 'shield' },
          { to: '/attendance', label: 'מצבה', icon: 'check' },
          { to: '/evaluations', label: 'תיקי הערכה', icon: 'folder' },
          { to: '/experiences', label: 'התנסויות', icon: 'target' },
          { to: '/debriefs', label: 'תחקירים', icon: 'lightbulb' },
          { to: '/documents', label: 'מסמכים', icon: 'file' },
        ],
      },
      {
        title: 'כלים',
        items: [
          { to: '/command', label: 'פקודות שלי', icon: 'zap' },
          { to: '/meeting', label: 'ישיבת סגל', icon: 'message' },
          { to: '/templates', label: 'תבניות', icon: 'template' },
          { to: '/recurring', label: 'משימות חוזרות', icon: 'repeat' },
          { to: '/day-end', label: 'סיכום יום', icon: 'moon' },
          { to: '/courses', label: 'קורסים קודמים', icon: 'history' },
        ],
      },
    ];
  }
  return [
    {
      items: [
        { to: '/', label: 'המשימות שלי', icon: 'home', end: true },
        { to: '/tasks', label: 'משימות', icon: 'tasks' },
        { to: '/weeks', label: 'שבועות הקורס', icon: 'layers' },
        { to: '/schedule', label: 'לו"ז', icon: 'calendar' },
      ],
    },
    {
      title: 'סקירה',
      items: [
        { to: '/briefing', label: 'תדריך בוקר', icon: 'sun' },
        { to: '/lookahead', label: 'מבט קדימה', icon: 'eye' },
        { to: '/day-end', label: 'סיכום יום', icon: 'moon' },
        { to: `/requests`, label: 'הבקשות שלי', icon: 'inbox' },
        { to: '/announcements', label: 'הודעות לסגל', icon: 'flag' },
        { to: '/alignment', label: 'יישור קו', icon: 'message', count: alignment },
        { to: '/directory', label: 'אנשי קשר', icon: 'phone' },
      ],
    },
    {
      title: 'צוערים ולקחים',
      items: [
        { to: '/cadets', label: 'צוערים', icon: 'shield' },
        { to: '/attendance', label: 'מצבה', icon: 'check' },
        { to: '/evaluations', label: 'תיקי הערכה', icon: 'folder' },
        { to: '/experiences', label: 'התנסויות', icon: 'target' },
        { to: '/debriefs', label: 'תחקירים', icon: 'lightbulb' },
        { to: '/documents', label: 'מסמכים', icon: 'file' },
      ],
    },
    {
      title: 'כלים',
      items: [
        { to: '/templates', label: 'תבניות', icon: 'template' },
        { to: '/recurring', label: 'משימות חוזרות', icon: 'repeat' },
      ],
    },
  ];
}

const RAIL_KEY = 'kks.rail';
const MEDIUM = '(max-width: 1279px)';

function readRailPref(): 'collapsed' | 'expanded' | null {
  try {
    const v = localStorage.getItem(RAIL_KEY);
    return v === 'collapsed' || v === 'expanded' ? v : null;
  } catch {
    return null;
  }
}

export function Layout({ children }: { children: ReactNode }) {
  const { user, settings, unread, logout, isCommander, viewing } = useSession();
  const sections = useNavSections();
  const newTask = useNewTask();
  const navigate = useNavigate();
  const location = useLocation();
  const [q, setQ] = useState('');
  const [live, setLive] = useState(false);

  useEffect(() => onStatus(setLive), []);
  // no connection for a while: say so (on a phone the "מעודכן" mark is hidden)
  const [lost, setLost] = useState(false);
  useEffect(() => {
    if (live) {
      setLost(false);
      return;
    }
    const t = setTimeout(() => setLost(true), navigator.onLine === false ? 0 : 10_000);
    return () => clearTimeout(t);
  }, [live]);
  const [update, setUpdate] = useState(updateReady());
  useEffect(() => onUpdate(setUpdate), []);
  // a new version waiting is loaded on moving to another screen (the address has already changed)
  // "/" jumps to the search box, as on most sites
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey) return;
      const el = e.target as HTMLElement;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)) return;
      if (document.querySelector('.modal')) return;
      e.preventDefault();
      const input = document.querySelector<HTMLInputElement>('.topbar .search input');
      if (input && input.offsetParent !== null) input.focus();
      else navigate('/search');
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [navigate]);
  const lastPath = useRef(location.pathname);
  useEffect(() => {
    if (lastPath.current === location.pathname) return;
    lastPath.current = location.pathname;
    if (updateReady()) window.location.reload();
    else void checkForUpdate();
  }, [location.pathname]);
  // a block body on purpose: newer browsers return a promise from scrollTo, and an effect that returns
  // anything but a cleanup function makes React crash on the next screen change.
  // An address with "#section" is left to the screen, which scrolls to that section.
  useEffect(() => {
    if (!location.hash) window.scrollTo(0, 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only on a screen change
  }, [location.pathname]);

  // a screen still loading (or empty) a few seconds after moving to it is reported, with what the browser is waiting for
  useEffect(() => {
    const path = location.pathname;
    const t = setTimeout(() => {
      const main = document.getElementById('main');
      const busy = !!main?.querySelector('[aria-busy="true"]');
      const text = main?.innerText.trim() ?? '';
      if (document.visibilityState === 'visible' && (busy || !text)) {
        reportIssue('screen still loading after 6 s', { path, busy, empty: !text, title: main?.querySelector('h1')?.textContent ?? null, pending: pendingRequests() });
      }
    }, 6000);
    return () => clearTimeout(t);
  }, [location.pathname]);

  const symbol = settings.courseSymbol || 'קק"ס';

  // the side menu folds to icons on a medium screen (a tablet, a small laptop) unless
  // the person pinned it; hovering a folded menu opens it over the content
  const [railPref, setRailPref] = useState(readRailPref);
  const [mediumScreen, setMediumScreen] = useState(() => window.matchMedia(MEDIUM).matches);
  useEffect(() => {
    const mq = window.matchMedia(MEDIUM);
    const on = () => setMediumScreen(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  const folded = railPref ? railPref === 'collapsed' : mediumScreen;
  // just folded: it stays folded under the pointer (no opening on hover) until the pointer leaves it
  const [noPeek, setNoPeek] = useState(false);
  const toggleRail = () => {
    const next = folded ? 'expanded' : 'collapsed';
    setNoPeek(next === 'collapsed');
    setRailPref(next);
    try {
      localStorage.setItem(RAIL_KEY, next);
    } catch {
      /* this visit only */
    }
  };

  // the phone's bar steps aside while reading down, and returns on scrolling up,
  // at the end of the page, or on moving to another screen
  const [barAway, setBarAway] = useState(false);
  useEffect(() => {
    let last = window.scrollY;
    let frame = 0;
    const onScroll = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        const y = window.scrollY;
        const atEnd = y + window.innerHeight >= document.documentElement.scrollHeight - 8;
        if (atEnd || y < 60) setBarAway(false);
        else if (Math.abs(y - last) > 6) setBarAway(y > last);
        last = y;
      });
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      cancelAnimationFrame(frame);
    };
  }, []);
  useEffect(() => {
    setBarAway(false);
  }, [location.pathname]);
  const path = location.pathname;
  const barIdx = path === '/' ? 0 : path.startsWith('/tasks') ? 1 : path.startsWith('/weeks') ? 3 : 4;

  return (
    <div className={`app${folded ? ' rail-collapsed' : ''}${viewing ? ' viewing-past' : ''}`}>
      {/* keyboard and screen-reader users skip the menu */}
      <a
        className="skip-link"
        href="#main"
        onClick={(e) => {
          e.preventDefault();
          document.getElementById('main')?.focus();
        }}
      >
        דילוג לתוכן הראשי
      </a>
      <aside
        className={`rail${noPeek ? ' no-peek' : ''}`}
        aria-label="ניווט ראשי"
        onMouseLeave={() => setNoPeek(false)}
        onFocus={(e) => noPeek && !(e.target as HTMLElement).classList.contains('rail-toggle') && setNoPeek(false)}
      >
        <div className="brand">
          <div className="brand-mark">{symbol.slice(0, 4)}</div>
          <div className="brand-text">
            <div className="brand-name">{settings.courseName}</div>
            <div className="brand-sub">מערכת ניהול קורס</div>
          </div>
        </div>
        {sections.map((s, i) => (
          <nav key={i} aria-label={s.title}>
            {s.title && <div className="rail-section">{s.title}</div>}
            {s.items.map((it) => (
              <NavLink key={it.to} to={it.to} end={it.end} className={({ isActive }) => `rail-link${isActive ? ' active' : ''}`}>
                <Icon name={it.icon} />
                <span className="rail-label">{it.label}</span>
                {!!it.count && <span className="count">{it.count > 99 ? '99+' : it.count}</span>}
              </NavLink>
            ))}
          </nav>
        ))}
        <NavLink to="/settings" className={({ isActive }) => `rail-link${isActive ? ' active' : ''}`} style={{ marginTop: 14 }}>
          <Icon name="settings" />
          <span className="rail-label">{isCommander ? 'הגדרות והקמת קורס' : 'הגדרות'}</span>
        </NavLink>
        <div className="rail-foot">
          <div className="avatar">{initials(user.displayName)}</div>
          <div className="grow rail-user">
            <div className="strong small">{user.displayName}</div>
            <div className="tiny" style={{ color: 'var(--rail-muted)' }}>
              {isCommander ? 'מפקד הקורס' : user.title || 'איש סגל'}
            </div>
          </div>
          <button className="icon-btn rail-logout" style={{ color: 'var(--rail-muted)' }} onClick={() => void logout()} aria-label="יציאה" title="יציאה">
            <Icon name="logout" />
          </button>
          <button className="icon-btn rail-toggle" onClick={toggleRail} aria-pressed={folded} aria-label={folded ? 'הרחבת התפריט' : 'כיווץ התפריט'} title={folded ? 'הרחבת התפריט' : 'כיווץ התפריט לסמלים'}>
            <Icon name={folded ? 'chevronLeft' : 'chevronRight'} />
          </button>
        </div>
      </aside>

      <div className="main">
        <header className="topbar">
          <BackButton />
          <NavLink to="/" className="top-brand">
            <div className="brand-mark">{symbol.slice(0, 3)}</div>
            <span className="small">{settings.courseName}</span>
          </NavLink>
          <form
            className="search"
            role="search"
            onSubmit={(e) => {
              e.preventDefault();
              if (q.trim()) navigate(`/search?q=${encodeURIComponent(q.trim())}`);
            }}
          >
            <Icon name="search" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="חיפוש משימה, איש סגל, שבוע, תחום..." aria-label="חיפוש" aria-keyshortcuts="/" />
            <button type="button" className="search-palette" onClick={() => window.dispatchEvent(new Event(OPEN_PALETTE))} aria-label="פקודה מהירה" aria-keyshortcuts="Control+K" title="פקודה מהירה: מסך, פעולה או פריט">
              <span className="kbd">Ctrl K</span>
            </button>
          </form>
          <div className="top-actions">
            <span className={`live hide-mobile${live ? ' on' : ''}`} title={live ? 'מחובר - עדכונים בזמן אמת' : 'מתחבר...'}>
              {live ? 'מעודכן' : 'מתחבר'}
            </span>
            <NavLink to="/search" className="icon-btn only-mobile" aria-label="חיפוש">
              <Icon name="search" />
            </NavLink>
            <NavLink to="/notifications" className="icon-btn bell" aria-label={`התראות${unread ? ` (${unread} חדשות)` : ''}`}>
              <Icon name="bell" />
              {unread > 0 && <span className="count">{unread > 99 ? '99+' : unread}</span>}
            </NavLink>
            {!viewing && (
              <button className="btn btn-primary hide-mobile" onClick={() => newTask()} title="קיצור מקלדת: N">
                <Icon name="plus" /> משימה
              </button>
            )}
          </div>
        </header>
        {viewing && (
          <div className="update-bar course-bar no-print" role="status">
            <Icon name="history" size={16} />
            <span className="grow">
              פתוח לקריאה: <b>{viewing.name}</b> - קורס קודם. אפשר לעבור בכל המסכים; שינויים נעשים רק בקורס הנוכחי.
            </span>
            <button className="btn btn-sm" onClick={() => void switchCourse(null)}>
              חזרה לקורס הנוכחי
            </button>
          </div>
        )}
        {lost && (
          <div className="update-bar offline no-print" role="status">
            <Icon name="alert" size={16} />
            <span className="grow">אין חיבור לשרת - מנסה להתחבר מחדש. עד אז מה שמוצג אולי לא מעודכן, ושינויים לא יישמרו.</span>
          </div>
        )}
        {update && (
          <div className="update-bar no-print" role="status">
            <Icon name="zap" size={16} />
            <span className="grow">יש גרסה חדשה של המערכת. היא תיטען במעבר הבא בין מסכים, או עכשיו:</span>
            <button className="btn btn-sm" onClick={() => window.location.reload()}>
              רענון
            </button>
          </div>
        )}
        <main id="main" tabIndex={-1}>
          <ScreenBoundary key={location.pathname}>{children}</ScreenBoundary>
          <ShortcutsHelp />
          <CommandPalette pages={sections.flatMap((s) => s.items)} />
        </main>
      </div>

      <nav className={`bottom-nav${barAway ? ' away' : ''}`} aria-label="ניווט" style={{ ['--idx' as string]: barIdx }}>
        {/* slides to the current tab; on any other screen, "עוד" holds it */}
        <span className="nav-ind" aria-hidden />
        <NavLink to="/" end className={barIdx === 0 ? 'active' : ''}>
          <Icon name="home" />
          בית
        </NavLink>
        <NavLink to="/tasks" className={barIdx === 1 ? 'active' : ''}>
          <Icon name="tasks" />
          משימות
        </NavLink>
        <button onClick={() => !viewing && newTask()} aria-label={viewing ? 'קורס קודם - לקריאה בלבד' : 'משימה חדשה'} aria-disabled={viewing ? 'true' : undefined}>
          <span className="plus">
            <Icon name="plus" />
          </span>
        </button>
        <NavLink to="/weeks" className={barIdx === 3 ? 'active' : ''}>
          <Icon name="layers" />
          שבועות
        </NavLink>
        <NavLink to="/more" className={barIdx === 4 ? 'active' : ''}>
          <Icon name="more" />
          עוד
        </NavLink>
      </nav>
    </div>
  );
}
