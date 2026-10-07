import { useEffect, useRef, useState, type ReactNode } from 'react';
import { NavLink, useLocation, useNavigate, useNavigationType } from 'react-router';
import type { Task, TaskRequest } from '@shared/types';
import { pendingRequests, reportIssue } from '../lib/api';
import { onStatus } from '../lib/realtime';
import { useSession } from '../lib/session';
import { checkForUpdate, onUpdate, updateReady } from '../lib/update';
import { onWaiting, useApi } from '../lib/useApi';
import { usePresence } from '../lib/presence';
import { slideTabIndicators } from '../lib/tabIndicator';
import { Icon } from './Icon';
import { useNewTask } from './NewTask';
import { addToWeekly } from './WeeklyAdd';
import { ScreenBoundary } from './ScreenBoundary';
import { BackButton } from './BackButton';
import { CommandPalette, OPEN_PALETTE } from './CommandPalette';
import { ShortcutsHelp } from './Shortcuts';
import { initials, Modal } from './ui';
import { NavMenu } from './NavMenu';
import { switchCourse } from '../lib/courses';
import { onThemeChange, setThemePref, shownTheme } from '../lib/theme';

interface NavItem {
  to: string;
  label: string;
  icon: string;
  count?: number;
  end?: boolean;
}

/** each group of the menu, by its title - shown alone when the menu is folded to icons */
const GROUP_ICONS: Record<string, string> = { 'תכנון הקורס': 'plan', צוערים: 'cap', בקרה: 'pulse', כלים: 'wrench' };
const GROUPS_KEY = 'kks.navGroups';
function readGroups(): Record<string, boolean> {
  try {
    return JSON.parse(localStorage.getItem(GROUPS_KEY) ?? '{}') as Record<string, boolean>;
  } catch {
    return {};
  }
}
function saveGroups(g: Record<string, boolean>): Record<string, boolean> {
  try {
    localStorage.setItem(GROUPS_KEY, JSON.stringify(g));
  } catch {
    /* this visit only */
  }
  return g;
}

/** light or dark in one tap, beside the bell; "as the device" stays in the settings */
function ThemeButton() {
  const [shown, setShown] = useState(shownTheme);
  useEffect(() => onThemeChange(() => setShown(shownTheme())), []);
  const next = shown === 'dark' ? 'light' : 'dark';
  const label = next === 'dark' ? 'מעבר למצב כהה' : 'מעבר למצב בהיר';
  const flip = (e: React.MouseEvent<HTMLButtonElement>) => {
    const doc = document as Document & { startViewTransition?: (update: () => void) => { ready: Promise<void> } };
    if (!doc.startViewTransition || matchMedia('(prefers-reduced-motion: reduce)').matches) return setThemePref(next);
    // the new look spreads out from the button
    const r = e.currentTarget.getBoundingClientRect();
    const x = r.left + r.width / 2;
    const y = r.top + r.height / 2;
    const radius = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y));
    doc
      .startViewTransition(() => setThemePref(next))
      .ready.then(() =>
        document.documentElement.animate(
          { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${radius}px at ${x}px ${y}px)`] },
          { duration: 480, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)', pseudoElement: '::view-transition-new(root)' },
        ),
      )
      .catch(() => undefined);
  };
  return (
    <button type="button" className="icon-btn theme-btn" onClick={flip} aria-label={label} title={label}>
      <Icon name={shown === 'dark' ? 'sun' : 'moon'} />
    </button>
  );
}

export function useNavSections(): { title?: string; items: NavItem[] }[] {
  const { isCommander } = useSession();
  const requests = useApi<TaskRequest[]>(isCommander ? '/api/requests' : null, ['requests', 'tasks']);
  const approvals = useApi<Task[]>(isCommander ? '/api/tasks?status=pending_approval' : null, ['tasks']);
  const pending = (requests.data?.length ?? 0) + (approvals.data?.length ?? 0);
  // messages from the staff's WhatsApp group that came in since this person last looked
  const alignment = useApi<{ n: number }>('/api/alignment/unseen', ['alignment', 'alignment-seen']).data?.n ?? 0;

  // the same groups for everyone, in the order a day goes: plan the course, the cadets, keeping track, the tools
  if (isCommander) {
    return [
      {
        items: [
          { to: '/', label: 'בית', icon: 'home', end: true },
          { to: '/my', label: 'המשימות שלי', icon: 'my' },
          { to: '/tasks', label: 'כל המשימות', icon: 'tasks' },
          { to: '/schedule', label: 'לו"ז', icon: 'calendar' },
          { to: '/team', label: 'הסגל', icon: 'users' },
        ],
      },
      {
        title: 'תכנון הקורס',
        items: [
          { to: '/weeks', label: 'שבועות הקורס', icon: 'layers' },
          { to: '/weekly', label: 'שבועי', icon: 'weekly' },
          { to: '/tracks', label: 'צירים בקורס', icon: 'route' },
          { to: '/plans', label: 'אישור תוכניות', icon: 'stamp' },
        ],
      },
      {
        title: 'צוערים',
        items: [
          { to: '/cadets', label: 'צוערים', icon: 'cap' },
          { to: '/attendance', label: 'מצבה', icon: 'check' },
          { to: '/evaluations', label: 'תיקי הערכה', icon: 'folder' },
          { to: '/sociometric', label: 'סוציומטרי', icon: 'socio' },
          { to: '/experiences', label: 'התנסויות', icon: 'target' },
        ],
      },
      {
        title: 'בקרה',
        items: [
          { to: '/requests', label: 'אישורים ובקשות', icon: 'inbox', count: pending },
          { to: '/announcements', label: 'הודעות לסגל', icon: 'flag' },
          { to: '/alignment', label: 'יישור קו', icon: 'message', count: alignment },
          { to: '/briefing', label: 'תדריך בוקר', icon: 'sun' },
          { to: '/day-end', label: 'סיכום יום', icon: 'moon' },
          { to: '/lookahead', label: 'מבט קדימה', icon: 'eye' },
          { to: '/reports/weekly', label: 'תמונת מצב שבועית', icon: 'chart' },
          { to: '/activity', label: 'יומן פעילות', icon: 'history' },
          { to: '/directory', label: 'אנשי קשר', icon: 'phone' },
        ],
      },
      {
        title: 'כלים',
        items: [
          { to: '/command', label: 'פקודות שלי', icon: 'zap' },
          { to: '/meeting', label: 'ישיבת סגל', icon: 'message' },
          { to: '/debriefs', label: 'תחקירים', icon: 'lightbulb' },
          { to: '/documents', label: 'מסמכים', icon: 'file' },
          { to: '/templates', label: 'תבניות', icon: 'template' },
          { to: '/recurring', label: 'משימות חוזרות', icon: 'repeat' },
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
        { to: '/schedule', label: 'לו"ז', icon: 'calendar' },
      ],
    },
    {
      title: 'תכנון הקורס',
      items: [
        { to: '/weeks', label: 'שבועות הקורס', icon: 'layers' },
        { to: '/weekly', label: 'שבועי', icon: 'weekly' },
        { to: '/tracks', label: 'צירים בקורס', icon: 'route' },
      ],
    },
    {
      title: 'צוערים',
      items: [
        { to: '/cadets', label: 'צוערים', icon: 'cap' },
        { to: '/attendance', label: 'מצבה', icon: 'check' },
        { to: '/evaluations', label: 'תיקי הערכה', icon: 'folder' },
        { to: '/sociometric', label: 'סוציומטרי', icon: 'socio' },
        { to: '/experiences', label: 'התנסויות', icon: 'target' },
      ],
    },
    {
      title: 'בקרה',
      items: [
        { to: '/requests', label: 'הבקשות שלי', icon: 'inbox' },
        { to: '/announcements', label: 'הודעות לסגל', icon: 'flag' },
        { to: '/alignment', label: 'יישור קו', icon: 'message', count: alignment },
        { to: '/briefing', label: 'תדריך בוקר', icon: 'sun' },
        { to: '/day-end', label: 'סיכום יום', icon: 'moon' },
        { to: '/lookahead', label: 'מבט קדימה', icon: 'eye' },
        { to: '/directory', label: 'אנשי קשר', icon: 'phone' },
      ],
    },
    {
      title: 'כלים',
      items: [
        { to: '/debriefs', label: 'תחקירים', icon: 'lightbulb' },
        { to: '/documents', label: 'מסמכים', icon: 'file' },
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
  // Back (and Forward) return to where the screen was scrolled; a new screen starts at the top.
  // An address with "#section" is left to the screen, which scrolls to that section.
  const navType = useNavigationType();
  const scrolls = useRef(new Map<string, number>());
  const shownPath = useRef(location.pathname);
  useEffect(() => {
    try {
      history.scrollRestoration = 'manual';
    } catch {
      /* the browser keeps doing it */
    }
  }, []);
  useEffect(() => {
    const key = location.key;
    let frame = 0;
    const save = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        scrolls.current.set(key, window.scrollY);
      });
    };
    window.addEventListener('scroll', save, { passive: true });
    return () => {
      window.removeEventListener('scroll', save);
      cancelAnimationFrame(frame);
    };
  }, [location.key]);
  useEffect(() => {
    const moved = shownPath.current !== location.pathname;
    shownPath.current = location.pathname;
    const y = navType === 'POP' ? scrolls.current.get(location.key) : undefined;
    if (y === undefined) {
      if (moved && !location.hash) window.scrollTo(0, 0);
      return;
    }
    // the screen may still be filling in: try until it is tall enough, for up to a second - and stop
    // the moment the person scrolls by themselves
    let frame = 0;
    let tries = 0;
    const stop = () => cancelAnimationFrame(frame);
    const go = () => {
      const max = document.documentElement.scrollHeight - window.innerHeight;
      window.scrollTo(0, Math.min(y, Math.max(0, max)));
      if (max >= y || ++tries > 60) return;
      frame = requestAnimationFrame(go);
    };
    go();
    window.addEventListener('wheel', stop, { passive: true, once: true });
    window.addEventListener('touchstart', stop, { passive: true, once: true });
    return () => {
      stop();
      window.removeEventListener('wheel', stop);
      window.removeEventListener('touchstart', stop);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- on each move through the history
  }, [location.key]);

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
        // the top bar shows its edge only while content passes under it
        document.documentElement.toggleAttribute('data-scrolled', y > 2);
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
  // the line under a chosen tab slides to the next one, on every screen
  useEffect(() => {
    const main = document.getElementById('main');
    if (!main) return;
    return slideTabIndicators(main);
  }, []);
  // and while a field is typed in: the keyboard takes the bottom of the screen, and a bar riding on top
  // of it would cover the very field being typed
  const [typingField, setTypingField] = useState(false);
  useEffect(() => {
    const typed = (el: EventTarget | null) =>
      el instanceof HTMLTextAreaElement ||
      (el instanceof HTMLElement && el.isContentEditable) ||
      (el instanceof HTMLInputElement && el.inputMode !== 'none' && !['checkbox', 'radio', 'button', 'submit', 'reset', 'file', 'range', 'color'].includes(el.type));
    const onIn = (e: FocusEvent) => setTypingField(typed(e.target));
    const onOut = (e: FocusEvent) => setTypingField(typed(e.relatedTarget));
    document.addEventListener('focusin', onIn);
    document.addEventListener('focusout', onOut);
    return () => {
      document.removeEventListener('focusin', onIn);
      document.removeEventListener('focusout', onOut);
    };
  }, []);
  // the bar's "+": a new task or something for the weekly
  const [plusOpen, setPlusOpen] = useState(false);
  const plus = usePresence(plusOpen, 200);
  useEffect(() => {
    setPlusOpen(false);
  }, [location.pathname]);
  useEffect(() => {
    if (barAway) setPlusOpen(false);
  }, [barAway]);
  const path = location.pathname;
  // the phone's bar, right to left: tasks, cadets, "+", weeks, schedule; on any other screen no tab is marked
  // (everything else is in the menu under the course mark at the top)
  const tasksHome = isCommander ? '/tasks' : '/';
  const barIdx =
    path.startsWith('/tasks') || path === '/my' || (!isCommander && path === '/')
      ? 0
      : path.startsWith('/cadets')
        ? 1
        : path.startsWith('/weeks') || path.startsWith('/weekly')
          ? 3
          : path.startsWith('/schedule')
            ? 4
            : -1;
  // the course mark at the top of a phone opens every screen, as a sheet over the page
  const [menuOpen, setMenuOpen] = useState(false);
  useEffect(() => {
    setMenuOpen(false);
  }, [location.pathname]);

  // the menu's groups (תכנון הקורס, צוערים, בקרה, כלים) open and close; each remembers how it was left,
  // and the group of the screen on show opens by itself
  const [groups, setGroups] = useState<Record<string, boolean>>(readGroups);
  const here = sections.find((s) => s.title && s.items.some((it) => (it.end ? path === it.to : path === it.to || path.startsWith(`${it.to}/`))))?.title;
  useEffect(() => {
    if (here) setGroups((g) => (g[here] ? g : saveGroups({ ...g, [here]: true })));
  }, [here]);
  const groupOpen = (title: string) => groups[title] ?? false;
  const toggleGroup = (title: string) => setGroups((g) => saveGroups({ ...g, [title]: !g[title] }));

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
        {sections.map((s, i) => {
          const links = s.items.map((it) => (
            <NavLink key={it.to} to={it.to} end={it.end} title={it.label} className={({ isActive }) => `rail-link${isActive ? ' active' : ''}`}>
              <Icon name={it.icon} />
              <span className="rail-label">{it.label}</span>
              {!!it.count && (
                <span className="count" key={it.count}>
                  {it.count > 99 ? '99+' : it.count}
                </span>
              )}
            </NavLink>
          ));
          if (!s.title)
            return (
              <nav key={i} aria-label="ניהול שוטף">
                {links}
              </nav>
            );
          const open = groupOpen(s.title);
          const total = s.items.reduce((n, it) => n + (it.count ?? 0), 0);
          const id = `rail-group-${i}`;
          return (
            <nav key={i} aria-label={s.title} className={`rail-group${open ? ' open' : ''}${s.title === here ? ' here' : ''}`}>
              <button
                type="button"
                className="rail-group-head"
                aria-expanded={open}
                aria-controls={id}
                onClick={() => toggleGroup(s.title!)}
                title={s.title === here && !open ? `${s.title} - המסך הפתוח נמצא כאן` : s.title}
              >
                <Icon name={GROUP_ICONS[s.title] ?? 'layers'} />
                <span className="rail-label">{s.title}</span>
                {/* closed, with the screen on show inside: marked, so it is clear where one is */}
                {!open && s.title === here && <span className="rail-group-here" aria-hidden="true" />}
                {!open && total > 0 && (
                  <span className="count" key={total}>
                    {total > 99 ? '99+' : total}
                  </span>
                )}
                <Icon name="chevronDown" size={15} className="rail-group-chev" />
              </button>
              <div className="rail-group-body" id={id} inert={!open}>
                <div className="rail-group-inner">{links}</div>
              </div>
            </nav>
          );
        })}
        <NavLink to="/settings" className={({ isActive }) => `rail-link${isActive ? ' active' : ''}`} style={{ marginTop: 14 }}>
          <Icon name="settings" />
          <span className="rail-label">{isCommander ? 'הגדרות והקמת קורס' : 'הגדרות'}</span>
        </NavLink>
        <div className="rail-foot">
          <div className="avatar">{initials(user.displayName)}</div>
          <div className="grow rail-user" title={`${user.displayName} - ${isCommander ? 'מפקד הקורס' : user.title || 'איש סגל'}`}>
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
          <div className={`top-brand${menuOpen ? ' is-open' : ''}`}>
            {/* the mark goes home - from anywhere; already there, back to the top */}
            <NavLink
              to="/"
              end
              className="top-brand-home"
              aria-label="דף הבית"
              title="דף הבית"
              onClick={() => path === '/' && window.scrollTo({ top: 0, behavior: 'smooth' })}
            >
              <span className="brand-mark">{symbol.slice(0, 4)}</span>
            </NavLink>
            {/* the course's name opens every screen, as a sheet over the page */}
            <button type="button" className="top-brand-menu" onClick={() => setMenuOpen(true)} aria-haspopup="dialog" aria-expanded={menuOpen} aria-label={`${settings.courseName} - כל המסכים`} title="כל המסכים">
              <span className="small top-brand-name">{settings.courseName}</span>
              <Icon name="chevronDown" size={15} className="top-brand-chev" />
            </button>
          </div>
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
              {unread > 0 && (
                <span className="count" key={unread}>
                  {unread > 99 ? '99+' : unread}
                </span>
              )}
            </NavLink>
            <ThemeButton />
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
        <TopProgress />
        <main id="main" tabIndex={-1}>
          <ScreenBoundary key={location.pathname}>{children}</ScreenBoundary>
          <ShortcutsHelp />
          <CommandPalette pages={sections.flatMap((s) => s.items)} />
        </main>
      </div>

      <nav className={`bottom-nav${barAway || typingField ? ' away' : ''}${barIdx < 0 ? ' no-tab' : ''}`} aria-label="ניווט" style={{ ['--idx' as string]: Math.max(0, barIdx) }}>
        {/* slides to the current tab */}
        <span className="nav-ind" aria-hidden />
        <NavLink to={tasksHome} end={tasksHome === '/'} className={() => (barIdx === 0 ? 'active' : '')} aria-current={barIdx === 0 ? 'page' : undefined}>
          <Icon name="tasks" />
          משימות
        </NavLink>
        <NavLink to="/cadets" className={() => (barIdx === 1 ? 'active' : '')} aria-current={barIdx === 1 ? 'page' : undefined}>
          <Icon name="cap" />
          צוערים
        </NavLink>
        <button
          id="plus-button"
          className={plusOpen ? 'plus-open' : ''}
          onClick={() => !viewing && setPlusOpen((o) => !o)}
          aria-label={viewing ? 'קורס קודם - לקריאה בלבד' : 'הוספה: משימה או שבועי'}
          aria-disabled={viewing ? 'true' : undefined}
          aria-haspopup="menu"
          aria-expanded={plusOpen}
          aria-controls={plusOpen ? 'plus-menu' : undefined}
        >
          <span className="plus">
            <Icon name="plus" />
          </span>
        </button>
        <NavLink to="/weeks" className={() => (barIdx === 3 ? 'active' : '')} aria-current={barIdx === 3 ? 'page' : undefined}>
          <Icon name="layers" />
          שבועות
        </NavLink>
        <NavLink to="/schedule" className={() => (barIdx === 4 ? 'active' : '')} aria-current={barIdx === 4 ? 'page' : undefined}>
          <Icon name="calendar" />
          לו"ז
        </NavLink>
      </nav>
      {menuOpen && (
        <Modal title="כל המסכים" onClose={() => setMenuOpen(false)} className="menu-sheet">
          <NavMenu sections={sections} onNavigate={() => setMenuOpen(false)} />
        </Modal>
      )}
      {plus.mounted && (
        <PlusMenu
          leaving={plus.leaving}
          onClose={() => setPlusOpen(false)}
          onTask={() => {
            setPlusOpen(false);
            newTask();
          }}
          onWeekly={() => {
            setPlusOpen(false);
            addToWeekly();
          }}
        />
      )}
    </div>
  );
}

/** the phone bar's "+": the two things one adds on the move, rising above it */
function PlusMenu({ onClose, onTask, onWeekly, leaving }: { onClose: () => void; onTask: () => void; onWeekly: () => void; leaving: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.querySelector<HTMLElement>('[role=menuitem]')?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
        document.getElementById('plus-button')?.focus();
        return;
      }
      if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
      const items = [...(ref.current?.querySelectorAll<HTMLElement>('[role=menuitem]') ?? [])];
      const at = items.indexOf(document.activeElement as HTMLElement);
      e.preventDefault();
      items[(at + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus();
    };
    const onDown = (e: PointerEvent) => {
      const t = e.target as Element;
      if (!ref.current?.contains(t) && !t.closest('#plus-button')) onClose();
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onDown);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onDown);
    };
  }, [onClose]);
  return (
    <>
      <div className={`plus-scrim${leaving ? ' is-leaving' : ''}`} aria-hidden="true" />
      {/* closed, it sinks back into the "+" it rose from */}
      <div className={`plus-menu${leaving ? ' is-leaving' : ''}`} id="plus-menu" role="menu" aria-label="הוספה" ref={ref} inert={leaving || undefined}>
        <button type="button" role="menuitem" onClick={onTask}>
          <span className="plus-menu-icon">
            <Icon name="tasks" />
          </span>
          <span className="grow">
            <span className="plus-menu-title">משימות</span>
            <span className="plus-menu-sub">משימה חדשה עם אחראי ודד-ליין</span>
          </span>
        </button>
        <button type="button" role="menuitem" onClick={onWeekly}>
          <span className="plus-menu-icon">
            <Icon name="weekly" />
          </span>
          <span className="grow">
            <span className="plus-menu-title">שבועי</span>
            <span className="plus-menu-sub">נושא, סגירה מקצועית או הערה לשבועי הקרוב</span>
          </span>
        </button>
      </div>
    </>
  );
}

/**
 * A thin bar along the top while a screen waits for what it shows (opened for the first time, a filter
 * changed) - not for the refreshes in the background. Shown only past a moment, so a quick answer
 * does not flash it.
 */
function TopProgress() {
  const [state, setState] = useState<'' | 'on' | 'done'>('');
  useEffect(() => {
    let showTimer: ReturnType<typeof setTimeout> | null = null;
    let hideTimer: ReturnType<typeof setTimeout> | null = null;
    let on = false;
    const off = onWaiting((n) => {
      if (n > 0) {
        if (hideTimer) clearTimeout(hideTimer);
        hideTimer = null;
        if (!on && !showTimer)
          showTimer = setTimeout(() => {
            showTimer = null;
            on = true;
            setState('on');
          }, 160);
        return;
      }
      if (showTimer) clearTimeout(showTimer);
      showTimer = null;
      if (!on) return;
      on = false;
      setState('done');
      hideTimer = setTimeout(() => setState(''), 420);
    });
    return () => {
      off();
      if (showTimer) clearTimeout(showTimer);
      if (hideTimer) clearTimeout(hideTimer);
    };
  }, []);
  return <div className={`top-progress${state ? ` is-${state}` : ''}`} aria-hidden="true" />;
}
