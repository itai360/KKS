import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { NavLink, useLocation, useNavigate, useNavigationType } from 'react-router';
import type { EntryRequest, Task, TaskRequest } from '@shared/types';
import { pendingRequests, reportIssue } from '../lib/api';
import { onNotification, onStatus } from '../lib/realtime';
import { useSession } from '../lib/session';
import { checkForUpdate, onUpdate, updateReady } from '../lib/update';
import { onStale, onWaiting, refreshAll, useApi } from '../lib/useApi';
import { usePresence } from '../lib/presence';
import { slideTabIndicators } from '../lib/tabIndicator';
import { Count } from './Count';
import { Icon } from './Icon';
import { useNewTask } from './NewTask';
import { addToWeekDebrief } from './WeekDebriefAdd';
import { addToWeekly } from './WeeklyAdd';
import { addEntry } from './EntryAdd';
import { ScreenBoundary } from './ScreenBoundary';
import { BackButton } from './BackButton';
import { CommandPalette } from './CommandPalette';
import { TopSearch } from './TopSearch';
import { ShortcutsHelp } from './Shortcuts';
import { initials } from './ui';
import { SETTINGS_ITEM } from './NavMenu';
import { NotificationsPanel } from './Notifications';
import { noteScreen, screenOf } from '../lib/frequent';
import { BOTTOM_BAR_MEDIA, bottomBarScreens } from '../lib/bottomBar';
import { useDrawerSwipe } from '../lib/drawerSwipe';
import { trapFocus } from '../lib/focusTrap';
import { lockScroll } from '../lib/scrollLock';
import { switchCourse } from '../lib/courses';
import { isTypingField } from '../lib/keyboard';
import { onThemeChange, setThemePref, shownTheme } from '../lib/theme';
import { useMedia } from '../lib/media';
import { usePullToRefresh } from '../lib/pullRefresh';

interface NavItem {
  to: string;
  label: string;
  icon: string;
  count?: number;
  end?: boolean;
  /** other words people look for it by, in the menu's search and Ctrl+K */
  keywords?: string;
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

/** the bell: how many are new, a short ring as one arrives, and a tap opens them over the screen (Notifications.tsx) */
function Bell({ unread }: { unread: number }) {
  const [open, setOpen] = useState(false);
  const [ring, setRing] = useState(0);
  const ref = useRef<HTMLButtonElement>(null);
  const location = useLocation();
  // the news of something done is heard, not kept: the bell rings for what stays in it
  useEffect(() => onNotification((n) => void (!n.finished && setRing((r) => r + 1))), []);
  useEffect(() => {
    if (!ring) return;
    const t = setTimeout(() => setRing(0), 1100);
    return () => clearTimeout(t);
  }, [ring]);
  // another screen opened: the panel is done
  useEffect(() => {
    setOpen(false);
  }, [location.pathname]);
  return (
    <>
      <button
        ref={ref}
        type="button"
        className={`icon-btn bell${ring ? ' is-ringing' : ''}${open ? ' is-open' : ''}`}
        aria-label={`התראות${unread ? ` (${unread} חדשות)` : ''}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        {/* a fresh ring each time one arrives, even mid-ring */}
        <span className="bell-icon" key={ring} aria-hidden="true">
          <Icon name="bell" />
        </span>
        <Count n={unread} />
      </button>
      <NotificationsPanel open={open} onClose={() => setOpen(false)} anchor={ref} />
    </>
  );
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
  const { isCommander, can } = useSession();
  const requests = useApi<TaskRequest[]>(isCommander ? '/api/requests' : null, ['requests', 'tasks']);
  const approvals = useApi<Task[]>(isCommander ? '/api/tasks?status=pending_approval' : null, ['tasks']);
  const pending = (requests.data?.length ?? 0) + (approvals.data?.length ?? 0);
  // visitors' entry still to send on to the base
  const entries = useApi<EntryRequest[]>(isCommander ? '/api/entries' : null, ['entries']).data?.filter((e) => e.status === 'pending').length ?? 0;
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
          { to: '/team', label: 'הסגל', icon: 'users', keywords: 'כוח אדם כ"א זמינות היעדרויות עומס' },
        ],
      },
      {
        title: 'תכנון הקורס',
        items: [
          { to: '/weeks', label: 'שבועות הקורס', icon: 'layers' },
          { to: '/weekly', label: 'שבועי', icon: 'weekly' },
          { to: '/tracks', label: 'צירים בקורס', icon: 'route' },
          { to: '/plans', label: 'אישור תוכניות', icon: 'stamp' },
          { to: '/three-week', label: 'אישור תוכניות תלת שבועי', icon: 'threeWeeks', keywords: 'תלת שבועי תלת-שבועי שלושה שבועות ארבעה שבועות תוכנית' },
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
          { to: '/takpatz', label: 'תקפ״צ', icon: 'board', keywords: 'תקפצ תקפ"צ יעדים אישיים תכנון התנסויות שלישים' },
        ],
      },
      {
        title: 'בקרה',
        items: [
          { to: '/requests', label: 'אישורים ובקשות', icon: 'inbox', count: pending },
          { to: '/entries', label: 'אישורי כניסה', icon: 'stamp', count: entries, keywords: 'מבקר כניסה לבסיס ש"ג' },
          { to: '/announcements', label: 'הודעות לסגל', icon: 'flag' },
          { to: '/alignment', label: 'יישור קו', icon: 'message', count: alignment },
          { to: '/briefing', label: 'תדריך בוקר', icon: 'sun' },
          { to: '/reports/weekly', label: 'תמונת מצב שבועית', icon: 'chart' },
        ],
      },
      {
        title: 'כלים',
        items: [
          { to: '/debriefs', label: 'תחקירים', icon: 'lightbulb' },
          { to: '/documents', label: 'מסמכים', icon: 'file' },
          { to: '/templates', label: 'תבניות', icon: 'template' },
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
        // what the commander opened to the staff (settings - permissions)
        ...(can('plans')
          ? [
              { to: '/plans', label: 'אישור תוכניות', icon: 'stamp' },
              { to: '/three-week', label: 'אישור תוכניות תלת שבועי', icon: 'threeWeeks', keywords: 'תלת שבועי תלת-שבועי שלושה שבועות ארבעה שבועות תוכנית' },
            ]
          : []),
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
        { to: '/takpatz', label: 'תקפ״צ', icon: 'board', keywords: 'תקפצ תקפ"צ יעדים אישיים תכנון התנסויות שלישים' },
      ],
    },
    {
      title: 'בקרה',
      items: [
        { to: '/requests', label: 'הבקשות שלי', icon: 'inbox' },
        { to: '/entries', label: 'אישורי כניסה', icon: 'stamp', keywords: 'מבקר כניסה לבסיס ש"ג' },
        { to: '/announcements', label: 'הודעות לסגל', icon: 'flag' },
        { to: '/alignment', label: 'יישור קו', icon: 'message', count: alignment },
        { to: '/briefing', label: 'תדריך בוקר', icon: 'sun' },
      ],
    },
    {
      title: 'כלים',
      items: [
        { to: '/debriefs', label: 'תחקירים', icon: 'lightbulb' },
        { to: '/documents', label: 'מסמכים', icon: 'file' },
        { to: '/templates', label: 'תבניות', icon: 'template' },
      ],
    },
  ];
}

/** the course's cycle, as its name says it ("מחזור כ׳") - the top of the menu names it; a name without one is shown whole */
export const courseCycle = (name: string) => /מחזור\s*[^\s,()·-]+/.exec(name)?.[0] ?? name;

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
  const { user, settings, unread, logout, isCommander, can, viewing, weeks } = useSession();
  // the commander and the week leads add to the schedule from anywhere, as they add a task
  const canEvent = !viewing && (can('schedule') || weeks.some((w) => w.leadId === user.id));
  const sections = useNavSections();
  const palettePages = useMemo(() => sections.flatMap((s) => s.items), [sections]);
  const newTask = useNewTask();
  const navigate = useNavigate();
  const location = useLocation();
  // the screen's big title - a page's heading, a task's own title, a document's - once it has gone under the
  // top bar: its name shows in the bar (data-bar-title names it where the heading alone says too little)
  const [barTitle, setBarTitle] = useState<string | null>(null);
  useEffect(() => {
    setBarTitle(null);
    let io: IntersectionObserver | null = null;
    let seen: HTMLElement | null = null;
    let under = false;
    // read again on every change: a title edited in place shows at once
    const show = () => setBarTitle(under ? (seen?.dataset.barTitle ?? seen?.textContent ?? '').trim() || null : null);
    const watch = () => {
      const h1 = document.querySelector<HTMLElement>('#main [data-bar-title], #main h1');
      if (h1 === seen) return show();
      io?.disconnect();
      seen = h1;
      under = false;
      show();
      if (!h1) return;
      const bar = document.querySelector('.topbar')?.getBoundingClientRect().height ?? 56;
      io = new IntersectionObserver(
        ([e]) => {
          under = !e.isIntersecting;
          show();
        },
        { rootMargin: `-${Math.round(bar)}px 0px 0px 0px` },
      );
      io.observe(h1);
    };
    watch();
    const main = document.getElementById('main');
    const mo = new MutationObserver(watch);
    if (main) mo.observe(main, { childList: true, subtree: true, characterData: true, attributeFilter: ['data-bar-title'] });
    return () => {
      io?.disconnect();
      mo.disconnect();
    };
  }, [location.pathname]);
  // a phone: pulling the screen down from its top brings it up to date
  const mainRef = useRef<HTMLElement>(null);
  const ptrRef = useRef<HTMLDivElement>(null);
  usePullToRefresh(mainRef, ptrRef, useMedia('(pointer: coarse)'));
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
  // a screen showing an earlier answer (its refresh failed, and is tried again on its own): said, with a refresh
  const [staleCount, setStaleCount] = useState(0);
  useEffect(() => onStale(setStaleCount), []);
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
  // the app's shortcuts on the phone's home screen (a long press on its icon - manifest.webmanifest) open
  // with ?new=task or ?new=weeknote: the form comes up over the screen, and the address is left clean
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const kind = params.get('new');
    const open = kind === 'task' ? () => newTask() : kind === 'weeknote' ? addToWeekDebrief : null;
    if (!open) return;
    params.delete('new');
    const search = params.toString();
    navigate({ pathname: location.pathname, search: search ? `?${search}` : '', hash: location.hash }, { replace: true });
    if (!viewing) open();
  }, [location.search, location.pathname, location.hash, navigate, newTask, viewing]);
  // each screen entered counts toward the menu's "בשימוש גבוה" (frequent.ts) - not the home page, which the logo is
  const lastScreen = useRef<string | null>(null);
  useEffect(() => {
    const to = screenOf(location.pathname, [...sections.flatMap((s) => s.items), SETTINGS_ITEM]);
    if (to === lastScreen.current) return;
    lastScreen.current = to;
    if (to && to !== '/') noteScreen(user.id, to);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname, user.id]);
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
  // a phone: the same menu slides in from the side whole - never folded to icons
  const phone = useMedia(BOTTOM_BAR_MEDIA);
  const folded = !phone && (railPref ? railPref === 'collapsed' : mediumScreen);
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

  // the phone's bar grows small while reading down - a short capsule of its symbols, every tab still one press
  // away - and is whole again on scrolling up, at the end of the page, or on moving to another screen
  const [barSmall, setBarSmall] = useState(false);
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
        if (atEnd || y < 60) setBarSmall(false);
        else if (Math.abs(y - last) > 6) setBarSmall(y > last);
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
    setBarSmall(false);
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
    const typed = isTypingField;
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
  // where the "+" menu opened from: the phone bar's, or the top bar's on a computer
  const [plusAt, setPlusAt] = useState<'bar' | 'top'>('bar');
  const plus = usePresence(plusOpen, 200);
  useEffect(() => {
    setPlusOpen(false);
  }, [location.pathname]);
  useEffect(() => {
    if (barSmall) setPlusOpen(false);
  }, [barSmall]);
  const path = location.pathname;
  // the phone's bar, right to left: tasks, cadets, "+", weeks, schedule; on any other screen no tab is marked
  // (everything else is in the menu under the course mark at the top)
  const tasksHome = bottomBarScreens(isCommander)[0];
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
  // on a phone the course's name at the top opens the side menu - the computer's own, with the same groups
  // and screens - sliding in from the side over the page; a screen chosen, a tap beside it, a swipe back to
  // the edge or Escape close it
  const [menuOpen, setMenuOpen] = useState(false);
  const drawer = phone && menuOpen;
  const railRef = useRef<HTMLElement>(null);
  const scrimRef = useRef<HTMLDivElement>(null);
  const menuButton = useRef<HTMLButtonElement>(null);
  const closeMenu = useCallback(() => setMenuOpen(false), []);
  useEffect(() => {
    setMenuOpen(false);
  }, [location.pathname]);
  useEffect(() => {
    if (!phone) setMenuOpen(false);
  }, [phone]);
  useDrawerSwipe(railRef, scrimRef, drawer, closeMenu);
  useEffect(() => {
    const rail = railRef.current;
    if (!drawer || !rail) return;
    // the page behind stays still, and the keyboard stays in the menu (a dialog opened over it has its own)
    const unlock = lockScroll();
    const untrap = trapFocus(rail, () => !document.querySelector('.modal-backdrop:not(.is-leaving)'));
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || document.querySelector('.modal')) return;
      e.preventDefault();
      setMenuOpen(false);
    };
    document.addEventListener('keydown', onKey);
    // the screen on show is where the menu opens: in sight, and the keyboard's place in it
    const at = rail.querySelector<HTMLElement>('.rail-link.active');
    (at ?? rail).focus({ preventScroll: true });
    if (at) {
      const r = at.getBoundingClientRect();
      const box = rail.getBoundingClientRect();
      if (r.bottom > box.bottom - 96) rail.scrollTop += r.bottom - box.bottom + 96;
    }
    return () => {
      document.removeEventListener('keydown', onKey);
      untrap();
      unlock();
      // back to the button that opened it
      const now = document.activeElement;
      if (!now || now === document.body || rail.contains(now)) menuButton.current?.focus({ preventScroll: true });
    };
  }, [drawer]);

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
    <div className={`app${folded ? ' rail-collapsed' : ''}${drawer ? ' menu-open' : ''}${viewing ? ' viewing-past' : ''}`}>
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
      {/* a phone: the page behind the open menu, dimmed - a tap on it closes the menu */}
      {phone && <div ref={scrimRef} className="rail-scrim" aria-hidden="true" onClick={closeMenu} />}
      <aside
        ref={railRef}
        id="main-menu"
        className={`rail${noPeek ? ' no-peek' : ''}`}
        aria-label="ניווט ראשי"
        tabIndex={phone ? -1 : undefined}
        inert={(phone && !menuOpen) || undefined}
        onMouseLeave={() => setNoPeek(false)}
        onFocus={(e) => noPeek && !(e.target as HTMLElement).classList.contains('rail-toggle') && setNoPeek(false)}
        // a phone: a screen chosen closes the menu, also the one already on show
        onClick={(e) => phone && (e.target as Element).closest('a[href]') && setMenuOpen(false)}
      >
        <div className="brand">
          <div className="brand-mark">{symbol.slice(0, 4)}</div>
          <div className="brand-text">
            <div className="brand-name">{courseCycle(settings.courseName)}</div>
            <div className="brand-sub">מערכת ניהול קורס</div>
          </div>
        </div>
        {sections.map((s, i) => {
          const links = s.items.map((it) => (
            <NavLink key={it.to} to={it.to} end={it.end} title={it.label} className={({ isActive }) => `rail-link${isActive ? ' active' : ''}`}>
              <Icon name={it.icon} />
              <span className="rail-label">{it.label}</span>
              <Count n={it.count ?? 0} />
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
                {!open && <Count n={total} />}
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
          {/* on a phone the same button sends the menu back to its edge */}
          <button
            className="icon-btn rail-toggle"
            onClick={phone ? closeMenu : toggleRail}
            aria-pressed={phone ? undefined : folded}
            aria-label={phone ? 'סגירת התפריט' : folded ? 'הרחבת התפריט' : 'כיווץ התפריט'}
            title={phone ? 'סגירת התפריט' : folded ? 'הרחבת התפריט' : 'כיווץ התפריט לסמלים'}
          >
            <Icon name={folded ? 'chevronLeft' : 'chevronRight'} />
          </button>
        </div>
      </aside>

      <div className="main" inert={drawer || undefined}>
        {/* titled: the screen's title shows beside the mark, and on a phone the search folds to its icon */}
        <header className={`topbar${barTitle ? ' is-titled' : ''}`}>
          <BackButton />
          <div className={`top-brand${menuOpen ? ' is-open' : ''}`}>
            {/* the course's mark opens the side menu, from this side of the screen */}
            <button
              ref={menuButton}
              type="button"
              className="top-brand-home"
              onClick={() => setMenuOpen((o) => !o)}
              aria-controls="main-menu"
              aria-expanded={menuOpen}
              aria-label="תפריט"
              title="תפריט"
            >
              <span className="brand-mark">{symbol.slice(0, 4)}</span>
            </button>
            {/* scrolled past the screen's big title: its name comes in beside the mark, as an iPhone's large titles do */}
            <span className={`top-brand-title${barTitle ? ' is-on' : ''}`} aria-hidden="true">
              {barTitle}
            </span>
          </div>
          <TopSearch pages={palettePages} />
          <div className="top-actions">
            <span className={`live hide-mobile${live ? ' on' : ''}`} title={live ? 'מחובר - עדכונים בזמן אמת' : 'מתחבר...'}>
              {live ? 'מעודכן' : 'מתחבר'}
            </span>
            <Bell unread={unread} />
            <ThemeButton />
            {/* on a computer, the same "+" as the phone bar's: what one adds, in a menu under it */}
            {!viewing && (
              <button
                id="top-plus-button"
                type="button"
                className={`top-plus hide-mobile${plusOpen && plusAt === 'top' ? ' plus-open' : ''}`}
                onClick={() => {
                  if (plusOpen && plusAt === 'top') return setPlusOpen(false);
                  setPlusAt('top');
                  setPlusOpen(true);
                }}
                aria-label={canEvent ? 'הוספה: משימה, אירוע בלו"ז, שבועי או תחקיר השבוע' : 'הוספה: משימה, שבועי או תחקיר השבוע'}
                title="הוספה (N - משימה חדשה)"
                aria-haspopup="menu"
                aria-expanded={plusOpen && plusAt === 'top'}
                aria-controls={plusOpen && plusAt === 'top' ? 'plus-menu' : undefined}
              >
                <Icon name="plus" />
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
        {!lost && staleCount > 0 && (
          <div className="update-bar stale no-print" role="status">
            <Icon name="history" size={16} />
            <span className="grow">חלק ממה שמוצג כאן לא התעדכן בטעינה האחרונה - מנסה שוב.</span>
            <button className="btn btn-sm" onClick={refreshAll}>
              רענון
            </button>
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
        <div className="ptr no-print" ref={ptrRef} aria-hidden="true">
          <Icon name="arrowUp" size={18} />
        </div>
        <main id="main" tabIndex={-1} ref={mainRef}>
          <ScreenBoundary key={location.pathname}>{children}</ScreenBoundary>
          <ShortcutsHelp />
          <CommandPalette pages={palettePages} />
        </main>
      </div>

      <nav
        className={`bottom-nav${typingField ? ' away' : barSmall ? ' compact' : ''}${barIdx < 0 ? ' no-tab' : ''}`}
        aria-label="ניווט"
        style={{ ['--idx' as string]: Math.max(0, barIdx) }}
        inert={drawer || undefined}
      >
        {/* slides to the current tab */}
        <span className="nav-ind" aria-hidden />
        <NavLink to={tasksHome} end={tasksHome === '/'} className={() => (barIdx === 0 ? 'active' : '')} aria-current={barIdx === 0 ? 'page' : undefined}>
          <Icon name="tasks" />
          <span className="nav-label">משימות</span>
        </NavLink>
        <NavLink to="/cadets" className={() => (barIdx === 1 ? 'active' : '')} aria-current={barIdx === 1 ? 'page' : undefined}>
          <Icon name="cap" />
          <span className="nav-label">צוערים</span>
        </NavLink>
        <button
          id="plus-button"
          className={plusOpen ? 'plus-open' : ''}
          onClick={() => {
            if (viewing) return;
            setPlusAt('bar');
            setPlusOpen((o) => !o);
            // its menu opens over the whole bar
            setBarSmall(false);
          }}
          aria-label={viewing ? 'קורס קודם - לקריאה בלבד' : canEvent ? 'הוספה: משימה, אירוע בלו"ז או שבועי' : 'הוספה: משימה או שבועי'}
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
          <span className="nav-label">שבועות</span>
        </NavLink>
        <NavLink to="/schedule" className={() => (barIdx === 4 ? 'active' : '')} aria-current={barIdx === 4 ? 'page' : undefined}>
          <Icon name="calendar" />
          <span className="nav-label">לו"ז</span>
        </NavLink>
      </nav>
      {plus.mounted && (
        <PlusMenu
          at={plusAt}
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
          onDebrief={() => {
            setPlusOpen(false);
            addToWeekDebrief();
          }}
          onEntry={() => {
            setPlusOpen(false);
            addEntry();
          }}
          onEvent={
            canEvent
              ? () => {
                  setPlusOpen(false);
                  navigate('/schedule?new=1');
                }
              : undefined
          }
        />
      )}
    </div>
  );
}

/**
 * The "+": the things one adds. From the phone bar it rises above the bar; from the top bar on a
 * computer it drops under the button, as a menu.
 */
function PlusMenu({
  at,
  onClose,
  onTask,
  onWeekly,
  onDebrief,
  onEntry,
  onEvent,
  leaving,
}: {
  at: 'bar' | 'top';
  onClose: () => void;
  onTask: () => void;
  onWeekly: () => void;
  onDebrief: () => void;
  onEntry: () => void;
  onEvent?: () => void;
  leaving: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const anchorId = at === 'top' ? 'top-plus-button' : 'plus-button';
  // under the top bar's button, its edge in line with the button's
  const [spot, setSpot] = useState<{ top: number; left: number } | null>(null);
  useLayoutEffect(() => {
    if (at !== 'top') return;
    const place = () => {
      const r = document.getElementById(anchorId)?.getBoundingClientRect();
      if (r) setSpot({ top: r.bottom + 10, left: Math.max(12, Math.min(r.left, window.innerWidth - 312)) });
    };
    place();
    window.addEventListener('resize', place);
    return () => window.removeEventListener('resize', place);
  }, [at, anchorId]);
  useEffect(() => {
    ref.current?.querySelector<HTMLElement>('[role=menuitem]')?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
        document.getElementById(anchorId)?.focus();
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
      if (!ref.current?.contains(t) && !t.closest(`#${anchorId}`)) onClose();
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onDown);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onDown);
    };
  }, [onClose, anchorId]);
  return (
    <>
      {at === 'bar' && <div className={`plus-scrim${leaving ? ' is-leaving' : ''}`} aria-hidden="true" />}
      {/* closed, it goes back into the "+" it came from */}
      <div
        className={`plus-menu${at === 'top' ? ' at-top' : ''}${leaving ? ' is-leaving' : ''}`}
        id="plus-menu"
        role="menu"
        aria-label="הוספה"
        ref={ref}
        inert={leaving || undefined}
        style={at === 'top' ? (spot ? { top: spot.top, left: spot.left } : { visibility: 'hidden' }) : undefined}
      >
        <button type="button" role="menuitem" onClick={onTask}>
          <span className="plus-menu-icon">
            <Icon name="tasks" />
          </span>
          <span className="grow">
            <span className="plus-menu-title">משימה</span>
            <span className="plus-menu-sub">משימה חדשה עם אחראי ודד-ליין</span>
          </span>
        </button>
        {onEvent && (
          <button type="button" role="menuitem" onClick={onEvent}>
            <span className="plus-menu-icon">
              <Icon name="calendar" />
            </span>
            <span className="grow">
              <span className="plus-menu-title">אירוע בלו"ז</span>
              <span className="plus-menu-sub">פעילות חדשה עם שעות, מיקום ואחראי</span>
            </span>
          </button>
        )}
        <button type="button" role="menuitem" onClick={onWeekly}>
          <span className="plus-menu-icon">
            <Icon name="weekly" />
          </span>
          <span className="grow">
            <span className="plus-menu-title">שבועי</span>
            <span className="plus-menu-sub">נושא, סגירה מקצועית או הערה לשבועי הקרוב</span>
          </span>
        </button>
        <button type="button" role="menuitem" onClick={onDebrief}>
          <span className="plus-menu-icon">
            <Icon name="lightbulb" />
          </span>
          <span className="grow">
            <span className="plus-menu-title">לתחקיר השבוע</span>
            <span className="plus-menu-sub">לשימור, לשיפור או לקח - לתחקיר השבועי של השבוע הזה</span>
          </span>
        </button>
        <button type="button" role="menuitem" onClick={onEntry}>
          <span className="plus-menu-icon">
            <Icon name="stamp" />
          </span>
          <span className="grow">
            <span className="plus-menu-title">אישור כניסה</span>
            <span className="plus-menu-sub">מבקר שמגיע לבסיס - הבקשה מגיעה למפקד הקורס</span>
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
