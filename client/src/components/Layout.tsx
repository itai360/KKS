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
import { TabIcon } from './TabIcon';
import { useNewTask } from './NewTask';
import { addToWeekDebrief } from './WeekDebriefAdd';
import { addToWeekly } from './WeeklyAdd';
import { addProcedure } from './ProcedureReport';
import { openSmartEntry } from './SmartEntry';
import { ScreenBoundary } from './ScreenBoundary';
import { BackContext, parentPath, useEdgeBack, type Back } from './BackButton';
import { CommandPalette } from './CommandPalette';
import { TopSearch } from './TopSearch';
import { CalendarLayers } from './SideBar';
import { MiniMonth } from './MiniMonth';
import { CalendarControls, HelpButton, UserMenu, ViewSwitcher } from './TopBarParts';
import { PHONE_VIEWS, showCalendarNow, useCalendarBar, VIEW_ICONS, VIEW_LABELS } from '../lib/calendarBar';
import { setMainMenuHost } from '../lib/mainMenu';
import { todayKey } from '../lib/format';
import { ShortcutsHelp } from './Shortcuts';
import { initials } from './ui';
import { SETTINGS_ITEM } from './NavMenu';
import { NotificationsPanel } from './Notifications';
import { noteScreen, screenOf } from '../lib/frequent';
import { BOTTOM_BAR_MEDIA } from '../lib/bottomBar';
import { useDrawerSwipe } from '../lib/drawerSwipe';
import { trapFocus } from '../lib/focusTrap';
import { lockScroll } from '../lib/scrollLock';
import { switchCourse } from '../lib/courses';
import { isTypingField, takesKeys } from '../lib/keyboard';
import { onThemeChange, setThemePref, shownTheme, syncBrowserBar } from '../lib/theme';
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

/** the menu's last group: the course's calendar and, on it, which calendars it shows */
const CAL_GROUP = 'יומן';
/** each group of the menu, by its title - shown alone when the menu is folded to icons */
const GROUP_ICONS: Record<string, string> = { 'ניהול משימות': 'tasks', 'תכנון הקורס': 'plan', 'פיקוד ובקרה': 'pulse', צוערים: 'cap', 'תחקירים ולמידה': 'lightbulb', 'סגל וכלים': 'wrench', [CAL_GROUP]: 'calendar' };
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

/** the phone bar's tabs: each screen belongs to one, its tab marked while it is on show. "more" - the
 *  screens no tab has (control, the staff and the tools) */
export type NavTab = 'home' | 'cadets' | 'weeks' | 'tasks' | 'more';
export interface NavSection {
  title?: string;
  tab: NavTab;
  items: NavItem[];
}
/** the phone bar's place of each tab (the "+" is the middle one); "more" marks none */
const TAB_INDEX: Record<NavTab, number> = { home: 0, cadets: 1, weeks: 3, tasks: 4, more: -1 };

/** the tab a screen belongs to: the calendar (and an event's page) is home; a screen inside one (a cadet's
 *  page, a task's) belongs where its list does */
export function tabOf(path: string, sections: NavSection[]): NavTab {
  if (path === '/' || path.startsWith('/event/')) return 'home';
  const s = sections.find((x) => x.items.some((it) => !it.end && (path === it.to || path.startsWith(`${it.to}/`))));
  return s?.tab ?? 'more';
}

/** the screens of this tab's history, by their place in it - kept for the tab's life (a reload included) */
const TRAIL_KEY = 'kks-back-trail';
function readTrail(): string[] {
  try {
    const t = JSON.parse(sessionStorage.getItem(TRAIL_KEY) ?? '[]');
    return Array.isArray(t) ? t : [];
  } catch {
    return [];
  }
}
function saveTrail(t: string[]): void {
  try {
    sessionStorage.setItem(TRAIL_KEY, JSON.stringify(t));
  } catch {
    // private browsing: back still works, only without the name of where it goes
  }
}

export function useNavSections(): NavSection[] {
  const { isCommander, can } = useSession();
  const requests = useApi<TaskRequest[]>(isCommander ? '/api/requests' : null, ['requests', 'tasks']);
  const approvals = useApi<Task[]>(isCommander ? '/api/tasks?status=pending_approval' : null, ['tasks']);
  const pending = (requests.data?.length ?? 0) + (approvals.data?.length ?? 0);
  // visitors' entry still to send on to the base
  const entries = useApi<EntryRequest[]>(isCommander ? '/api/entries' : null, ['entries']).data?.filter((e) => e.status === 'pending').length ?? 0;
  // messages from the staff's WhatsApp group that came in since this person last looked
  const alignment = useApi<{ n: number }>('/api/alignment/unseen', ['alignment', 'alignment-seen']).data?.n ?? 0;

  // the same modules for everyone, around the calendar: the tasks, planning the course, command and control,
  // the cadets, debriefs and learning, the staff and the tools
  const procedures = { to: '/procedures', label: 'אי עמידה בנהלים', icon: 'shield', keywords: 'נהלים הפקרת נשק נשק מאחורה טלפון דיגום כומתה שרוך גומיות תג שם משמעת' };
  const cadets: NavSection = {
    title: 'צוערים',
    tab: 'cadets',
    items: [
      { to: '/cadets', label: 'צוערים', icon: 'cap', keywords: 'צוותים פטורים משמעת שיחות אישיות' },
      { to: '/evaluations', label: 'תיקי הערכה', icon: 'folder', keywords: 'ציונים מבחנים ועדה' },
      { to: '/sociometric', label: 'סוציומטרי', icon: 'socio' },
      { to: '/experiences', label: 'התנסויות', icon: 'target', keywords: 'משובים חונך' },
      { to: '/takpatz', label: 'תקפ״צ', icon: 'board', keywords: 'תקפצ תקפ"צ יעדים אישיים תכנון התנסויות שלישים' },
      procedures,
    ],
  };
  const learning: NavSection = { title: 'תחקירים ולמידה', tab: 'weeks', items: [{ to: '/debriefs', label: 'תחקירים ולקחים', icon: 'lightbulb', keywords: 'תחקיר שבועי פעילות עצימה תחק"ש פלוגתי לקחים בנק לקחים' }] };
  const threeWeek = { to: '/three-week', label: 'אישור תוכניות תלת שבועי', icon: 'threeWeeks', keywords: 'תלת שבועי תלת-שבועי שלושה שבועות ארבעה שבועות תוכנית' };
  const home: NavSection = { tab: 'home', items: [{ to: '/', label: 'יומן הקורס', icon: 'calendar', end: true, keywords: 'לו"ז לוז בית אירועים יומן' }] };
  if (isCommander) {
    return [
      home,
      {
        title: 'ניהול משימות',
        tab: 'tasks',
        items: [
          { to: '/my', label: 'המשימות שלי', icon: 'my' },
          { to: '/tasks', label: 'כל המשימות', icon: 'tasks', keywords: 'לוח משימות קבוצות' },
          { to: '/requests', label: 'אישורים ובקשות', icon: 'inbox', count: pending, keywords: 'הארכה העברה אישור מפקד' },
          { to: '/command', label: 'פקודות שלי', icon: 'zap' },
          { to: '/templates', label: 'תבניות', icon: 'template' },
          { to: '/recurring', label: 'משימות חוזרות', icon: 'repeat' },
        ],
      },
      {
        title: 'תכנון הקורס',
        tab: 'weeks',
        items: [
          { to: '/weeks', label: 'שבועות הקורס', icon: 'layers', keywords: 'מוכנות שבוע פקודת שבוע' },
          { to: '/weekly', label: 'שבועי', icon: 'weekly' },
          { to: '/tracks', label: 'צירים בקורס', icon: 'route' },
          { to: '/plans', label: 'אישור תוכניות', icon: 'stamp' },
          threeWeek,
        ],
      },
      {
        title: 'פיקוד ובקרה',
        tab: 'more',
        items: [
          { to: '/overview', label: 'תמונת מצב', icon: 'home', keywords: 'דף הבית לוח המפקד דורש טיפול' },
          { to: '/briefing', label: 'תדריך בוקר', icon: 'sun' },
          { to: '/reports/weekly', label: 'תמונת מצב שבועית', icon: 'chart' },
          { to: '/lookahead', label: 'מבט קדימה', icon: 'eye' },
          { to: '/day-end', label: 'סיכום היום', icon: 'moon' },
          { to: '/activity', label: 'יומן פעילות', icon: 'history' },
        ],
      },
      cadets,
      learning,
      {
        title: 'סגל וכלים',
        tab: 'more',
        items: [
          { to: '/team', label: 'הסגל', icon: 'users', keywords: 'כוח אדם כ"א זמינות היעדרויות עומס' },
          { to: '/announcements', label: 'הודעות לסגל', icon: 'flag' },
          { to: '/alignment', label: 'יישור קו', icon: 'message', count: alignment },
          { to: '/directory', label: 'אנשי קשר', icon: 'phone' },
          { to: '/entries', label: 'אישורי כניסה', icon: 'stamp', count: entries, keywords: 'מבקר כניסה לבסיס ש"ג' },
          { to: '/documents', label: 'מסמכים', icon: 'file' },
          { to: '/courses', label: 'קורסים קודמים', icon: 'history' },
        ],
      },
    ];
  }
  return [
    home,
    {
      title: 'ניהול משימות',
      tab: 'tasks',
      items: [
        { to: '/my', label: 'המשימות שלי', icon: 'my' },
        { to: '/tasks', label: 'משימות', icon: 'tasks', keywords: 'לוח משימות קבוצות' },
        { to: '/requests', label: 'הבקשות שלי', icon: 'inbox' },
        ...(can('tasks') ? [{ to: '/command', label: 'פקודות שלי', icon: 'zap' }] : []),
        { to: '/templates', label: 'תבניות', icon: 'template' },
        { to: '/recurring', label: 'משימות חוזרות', icon: 'repeat' },
      ],
    },
    {
      title: 'תכנון הקורס',
      tab: 'weeks',
      items: [
        { to: '/weeks', label: 'שבועות הקורס', icon: 'layers', keywords: 'מוכנות שבוע פקודת שבוע' },
        { to: '/weekly', label: 'שבועי', icon: 'weekly' },
        { to: '/tracks', label: 'צירים בקורס', icon: 'route' },
        // what the commander opened to the staff (settings - permissions)
        ...(can('plans') ? [{ to: '/plans', label: 'אישור תוכניות', icon: 'stamp' }, threeWeek] : []),
      ],
    },
    {
      title: 'פיקוד ובקרה',
      tab: 'more',
      items: [
        { to: '/briefing', label: 'תדריך בוקר', icon: 'sun' },
        { to: '/reports/weekly', label: 'תמונת מצב שבועית', icon: 'chart' },
        { to: '/lookahead', label: 'מבט קדימה', icon: 'eye' },
        { to: '/day-end', label: 'סיכום היום', icon: 'moon' },
        { to: '/activity', label: 'יומן פעילות', icon: 'history' },
      ],
    },
    cadets,
    learning,
    {
      title: 'סגל וכלים',
      tab: 'more',
      items: [
        { to: '/announcements', label: 'הודעות לסגל', icon: 'flag' },
        { to: '/alignment', label: 'יישור קו', icon: 'message', count: alignment },
        { to: '/directory', label: 'אנשי קשר', icon: 'phone' },
        { to: '/entries', label: 'אישורי כניסה', icon: 'stamp', keywords: 'מבקר כניסה לבסיס ש"ג' },
        { to: '/documents', label: 'מסמכים', icon: 'file' },
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
      if (takesKeys(el)) return;
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
  // back: the screen before this one in the app's own history (react-router numbers it), or - opened from a
  // link, with nothing before it - the screen above; named for that screen. The calendar is where it ends
  const historyIdx = (window.history.state as { idx?: number } | null)?.idx ?? 0;
  const trail = useRef<string[] | null>(null);
  if (!trail.current) trail.current = readTrail();
  useEffect(() => {
    const t = trail.current!;
    t[historyIdx] = location.pathname;
    t.length = historyIdx + 1;
    saveTrail(t);
  }, [location.key, location.pathname, historyIdx]);
  const back = useMemo<Back | null>(() => {
    if (location.pathname === '/') return null;
    const target = historyIdx > 0 ? (trail.current![historyIdx - 1] ?? null) : parentPath(location.pathname);
    const screens = [...sections.flatMap((s) => s.items), SETTINGS_ITEM];
    const to = target === null ? null : screenOf(target, screens);
    const label = to ? (screens.find((it) => it.to === to)?.label ?? null) : null;
    return {
      label,
      // going up takes this screen's place, so the next "back" goes on up rather than down to it again
      go: () => (historyIdx > 0 ? navigate(-1) : navigate(parentPath(location.pathname), { replace: true })),
    };
  }, [location.pathname, historyIdx, sections, navigate]);

  // each screen entered counts toward the menu's "בשימוש גבוה" (frequent.ts) - not the calendar, which the bar has
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
  // home, where the course's mark leads: the commander's overview; the staff have their own tasks
  const homeScreen = isCommander ? { to: '/overview', label: 'תמונת מצב' } : { to: '/my', label: 'המשימות שלי' };
  // the calendar - the home page - puts its own controls in the top bar on a computer, and its layers in the side bar
  const calBar = useCalendarBar();
  const onCalendar = location.pathname === '/';
  // an event's whole form is a page of its own, as Google Calendar's: no bars around it
  const focusPage = location.pathname.startsWith('/event/');
  const today = todayKey();

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
  // a phone's calendar is Google Calendar's app: its own bar on top (no site bar), the whole screen, and
  // the page itself never scrolls - only what is inside it (the hours, the list)
  const calShell = phone && onCalendar;
  // before the calendar's own effects (its hours open where they should only once the screen holds them)
  useLayoutEffect(() => {
    document.documentElement.classList.toggle('cal-shell', calShell);
    // the phone's bar with the clock in the page's colour - the calendar's own white, or the paper
    syncBrowserBar();
    return () => {
      document.documentElement.classList.remove('cal-shell');
      syncBrowserBar();
    };
  }, [calShell]);
  const deskBar = !phone && onCalendar ? calBar : null;
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
  // away - and is whole again on scrolling up, at the top or the end, or on moving to another screen. It
  // follows any scroll that reads down: the page's, and one inside it - the calendar's hours, a long list in
  // its own box - since a scroll does not bubble, it is heard on its way down (capture)
  const [barSmall, setBarSmall] = useState(false);
  useEffect(() => {
    const lastTop = new WeakMap<object, number>();
    let frame = 0;
    let target: EventTarget | null = null;
    const onScroll = (e: Event) => {
      target = e.target;
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        const page = !(target instanceof Element) || target === document.documentElement || target === document.scrollingElement;
        const el = page ? document.documentElement : (target as Element);
        // the bar itself, the side menu and an open window are not the page being read
        if (!page && el.closest('.bottom-nav, .rail, .modal, .sheet, .plus-menu, .popover')) return;
        const y = page ? window.scrollY : el.scrollTop;
        // the top bar shows its edge only while content passes under the page's top
        if (page) document.documentElement.toggleAttribute('data-scrolled', y > 2);
        const height = page ? window.innerHeight : el.clientHeight;
        const full = page ? document.documentElement.scrollHeight : el.scrollHeight;
        // sideways only (days swiped, a strip of chips): not reading down
        if (full <= height + 4) return;
        const last = lastTop.get(el);
        // the first move of a box only says where it was
        if (last === undefined || last === y) {
          lastTop.set(el, y);
          return;
        }
        if (y < 40 || y + height >= full - 8) {
          setBarSmall(false);
          lastTop.set(el, y);
        } else if (Math.abs(y - last) > 8) {
          setBarSmall(y > last);
          lastTop.set(el, y);
        }
      });
    };
    document.addEventListener('scroll', onScroll, { capture: true, passive: true });
    return () => {
      document.removeEventListener('scroll', onScroll, { capture: true });
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
  // the phone's bar, right to left: home, cadets, "+", weeks, tasks - each marked on every screen of its own
  // (a cadet's file, the sociometric, a task's page...); on the screens no tab has, none is marked
  const tab = tabOf(path, sections);
  const barIdx = TAB_INDEX[tab];
  // on a phone the menu button at the top opens the side menu - the computer's own, with the same groups
  // and screens - sliding in from the side over the page; a screen chosen, a tap beside it, a swipe back to
  // the edge or Escape close it
  const [menuOpen, setMenuOpen] = useState(false);
  const drawer = phone && menuOpen;
  const railRef = useRef<HTMLElement>(null);
  const scrimRef = useRef<HTMLDivElement>(null);
  const menuButton = useRef<HTMLButtonElement>(null);
  // the menu opened from elsewhere (the calendar's own bar on a phone): focus goes back there
  const opener = useRef<HTMLElement | null>(null);
  useEffect(
    () =>
      setMainMenuHost((from) => {
        opener.current = from;
        setMenuOpen(true);
      }),
    [],
  );
  const closeMenu = useCallback(() => setMenuOpen(false), []);
  useEffect(() => {
    setMenuOpen(false);
  }, [location.pathname]);
  useEffect(() => {
    if (!phone) setMenuOpen(false);
  }, [phone]);
  useDrawerSwipe(railRef, scrimRef, drawer, closeMenu);
  // a phone has no back arrow - one swipes back (the iPhone's app on the home screen: from a side edge)
  const goBack = useCallback(() => back?.go(), [back]);
  useEdgeBack(phone && !!back && !menuOpen, goBack);
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
      const back = opener.current?.isConnected ? opener.current : menuButton.current;
      opener.current = null;
      if (!now || now === document.body || rail.contains(now)) back?.focus({ preventScroll: true });
    };
  }, [drawer]);

  // the menu's groups (תכנון הקורס, צוערים, בקרה, כלים) open and close, and the group of the screen on show opens
  // by itself (the calendar's: its last group, "יומן"). A computer's side bar remembers how each was left; a
  // phone's menu opens every time with only the group of the screen on show open
  const [groups, setGroups] = useState<Record<string, boolean>>(() => (phone ? {} : readGroups()));
  const hereSection = sections.find((s) => s.items.some((it) => (it.end ? path === it.to : path === it.to || path.startsWith(`${it.to}/`))));
  const here = hereSection ? (hereSection.title ?? CAL_GROUP) : undefined;
  const keepGroups = (g: Record<string, boolean>) => (phone ? g : saveGroups(g));
  useEffect(() => {
    if (here) setGroups((g) => (g[here] ? g : keepGroups({ ...g, [here]: true })));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- on the screen's group changing
  }, [here]);
  useLayoutEffect(() => {
    if (drawer) setGroups(here ? { [here]: true } : {});
    // eslint-disable-next-line react-hooks/exhaustive-deps -- as it opens
  }, [drawer]);
  const groupOpen = (title: string) => groups[title] ?? false;
  const toggleGroup = (title: string) => setGroups((g) => keepGroups({ ...g, [title]: !g[title] }));
  // with the phone's bar below, home is its first tab - not in the menu too
  const railLinks = (items: NavItem[]) =>
    items
      .filter((it) => !(phone && it.to === '/'))
      .map((it) => (
        <NavLink key={it.to} to={it.to} end={it.end} title={it.label} className={({ isActive }) => `rail-link${isActive ? ' active' : ''}`}>
          <Icon name={it.icon} />
          <span className="rail-label">{it.label}</span>
          <Count n={it.count ?? 0} />
        </NavLink>
      ));
  const railGroup = (title: string, id: string, body: ReactNode, total = 0) => {
    const open = groupOpen(title);
    return (
      <nav key={id} aria-label={title} className={`rail-group${open ? ' open' : ''}${title === here ? ' here' : ''}`}>
        <button
          type="button"
          className="rail-group-head"
          aria-expanded={open}
          aria-controls={id}
          onClick={() => toggleGroup(title)}
          title={title === here && !open ? `${title} - המסך הפתוח נמצא כאן` : title}
        >
          <Icon name={GROUP_ICONS[title] ?? 'layers'} />
          <span className="rail-label">{title}</span>
          {/* closed, with the screen on show inside: marked, so it is clear where one is */}
          {!open && title === here && <span className="rail-group-here" aria-hidden="true" />}
          {!open && <Count n={total} />}
          <Icon name="chevronDown" size={15} className="rail-group-chev" />
        </button>
        <div className="rail-group-body" id={id} inert={!open}>
          <div className="rail-group-inner">{body}</div>
        </div>
      </nav>
    );
  };
  // the calendar's group: the course's calendar (on a computer - a phone has it as its bar's first tab), and on
  // the calendar, which calendars it shows ("היומנים שלי", "יומנים נוספים")
  const calLinks = railLinks(sections.filter((s) => !s.title).flatMap((s) => s.items));
  const calLayers = onCalendar && !folded;

  // every group of the menu, each opening and closing (a computer's menu; a phone's "כל המסכים")
  const allGroups = sections.map((s, i) => {
    const links = s.title ? railLinks(s.items) : [];
    if (!s.title || !links.length) return null;
    return railGroup(s.title, `rail-group-${i}`, links, s.items.reduce((n, it) => n + (it.count ?? 0), 0));
  });
  // a phone's menu: every screen, by its groups - and on the calendar first the calendar's own, as Google
  // Calendar's app has it: its views, what it can do and its calendars
  const calMenu = calBar && (
    <div className="gside-cal" role="group" aria-label="תצוגת היומן">
      {PHONE_VIEWS.map((v) => (
        <button
          key={v}
          type="button"
          className={`gside-view${calBar.view === v ? ' on' : ''}`}
          aria-pressed={calBar.view === v}
          onClick={() => {
            closeMenu();
            calBar.setView(v);
          }}
        >
          <Icon name={VIEW_ICONS[v]} />
          <span className="rail-label">{VIEW_LABELS[v]}</span>
        </button>
      ))}
      {!!calBar.drawer?.length && <span className="gside-sep" aria-hidden="true" />}
      {calBar.drawer?.map((m) => (
        <button
          key={m.label}
          type="button"
          className="gside-view"
          onClick={() => {
            closeMenu();
            m.run();
          }}
        >
          <Icon name={m.icon} />
          <span className="rail-label">{m.label}</span>
        </button>
      ))}
    </div>
  );
  const phoneMenu = (
    <div className="gside-panel">
      {tab === 'home' && (
        <>
          <div className="gside-head">
            <Icon name="calendar" />
            <h2>{CAL_GROUP}</h2>
          </div>
          {calMenu}
          {onCalendar && (
            <div className="gside-layers">
              <CalendarLayers />
            </div>
          )}
          <span className="gside-sep" aria-hidden="true" />
        </>
      )}
      {allGroups}
      <NavLink to="/settings" className={({ isActive }) => `rail-link rail-settings${isActive ? ' active' : ''}`}>
        <Icon name="settings" />
        <span className="rail-label">{isCommander ? 'הגדרות והקמת קורס' : 'הגדרות'}</span>
      </NavLink>
    </div>
  );

  return (
    <div className={`app${folded ? ' rail-collapsed' : ''}${drawer ? ' menu-open' : ''}${viewing ? ' viewing-past' : ''}${focusPage ? ' is-focus' : ''}`}>
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
        className={`rail gside${noPeek ? ' no-peek' : ''}`}
        aria-label="ניווט ראשי"
        tabIndex={phone ? -1 : undefined}
        inert={(phone && !menuOpen) || undefined}
        onMouseLeave={() => setNoPeek(false)}
        onFocus={(e) => noPeek && !(e.target as HTMLElement).classList.contains('gside-menu') && setNoPeek(false)}
        // a phone: a screen chosen closes the menu, also the one already on show
        onClick={(e) => phone && (e.target as Element).closest('a[href]') && setMenuOpen(false)}
      >
        {/* in line with the top bar, as one bar across: the menu's button and the course's mark (home: the calendar) */}
        <div className="gside-top">
          {/* says what it does: shows or hides the side bar (a phone: closes the menu) */}
          <button
            type="button"
            className="icon-btn gside-menu"
            onClick={phone ? closeMenu : toggleRail}
            aria-pressed={phone ? undefined : !folded}
            aria-label={phone ? 'סגירת התפריט' : folded ? 'הצגת סרגל הצד' : 'הסתרת סרגל הצד'}
            title={phone ? 'סגירת התפריט' : folded ? 'הצגת סרגל הצד: החודש, היומנים והתפריט' : 'הסתרת סרגל הצד'}
          >
            <Icon name={phone ? 'x' : 'sidebar'} />
          </button>
          <NavLink to={homeScreen.to} end className="gside-brand" title={homeScreen.label}>
            <span className="brand-mark">{symbol.slice(0, 4)}</span>
            <span className="brand-text">
              <span className="brand-name">{courseCycle(settings.courseName)}</span>
              <span className="brand-sub">{homeScreen.label}</span>
            </span>
          </NavLink>
        </div>
        <div className="gside-body">
          {phone ? (
            phoneMenu
          ) : (
            <>
              {!folded && (
                <MiniMonth
                  selected={calBar?.date ?? today}
                  shown={calBar?.shown ?? []}
                  today={today}
                  onPick={(d) => (calBar ? calBar.goTo(d) : navigate(d === today ? '/' : `/?date=${d}`))}
                />
              )}
              {allGroups}
              {/* last, under "סגל וכלים": the calendar, and on it which calendars it shows */}
              {(calLinks.length > 0 || calLayers) &&
                railGroup(
                  CAL_GROUP,
                  'rail-group-cal',
                  <>
                    {calLinks}
                    {calLayers && <CalendarLayers />}
                  </>,
                )}
              <NavLink to="/settings" className={({ isActive }) => `rail-link rail-settings${isActive ? ' active' : ''}`}>
                <Icon name="settings" />
                <span className="rail-label">{isCommander ? 'הגדרות והקמת קורס' : 'הגדרות'}</span>
              </NavLink>
            </>
          )}
        </div>
        {/* a phone: the person and leaving, at the foot of the menu (a computer has them in the top bar) */}
        {phone && (
          <div className="rail-foot">
            <div className="avatar">{initials(user.displayName)}</div>
            <div className="grow rail-user" title={`${user.displayName} - ${isCommander ? 'מפקד הקורס' : user.title || 'איש סגל'}`}>
              <div className="strong small">{user.displayName}</div>
              <div className="tiny" style={{ color: 'var(--rail-muted)' }}>
                {isCommander ? 'מפקד הקורס' : user.title || 'איש סגל'}
              </div>
            </div>
            <NavLink to="/settings" className={({ isActive }) => `icon-btn rail-foot-settings${isActive ? ' active' : ''}`} aria-label={isCommander ? 'הגדרות והקמת קורס' : 'הגדרות'} title={isCommander ? 'הגדרות והקמת קורס' : 'הגדרות'}>
              <Icon name="settings" />
            </NavLink>
            <button className="icon-btn rail-logout" style={{ color: 'var(--rail-muted)' }} onClick={() => void logout()} aria-label="יציאה" title="יציאה">
              <Icon name="logout" />
            </button>
          </div>
        )}
      </aside>

      <div className="main" inert={drawer || undefined}>
        {/* titled: the screen's title shows beside the mark, and on a phone the search folds to its icon */}
        <header className={`topbar${barTitle && !deskBar ? ' is-titled' : ''}${deskBar ? ' is-calendar' : ''}`}>
          <div className={`top-brand${menuOpen ? ' is-open' : ''}`}>
            {/* the side menu, from this side of the screen - where the calendar's own bar has it */}
            <button
              ref={menuButton}
              type="button"
              className="top-menu"
              onClick={() => setMenuOpen((o) => !o)}
              aria-controls="main-menu"
              aria-expanded={menuOpen}
              aria-label="תפריט"
              title="תפריט"
            >
              <Icon name="menu" size={22} />
            </button>
            {/* the course's mark: home - the commander's overview (תמונת מצב), the staff's own tasks */}
            <NavLink to={homeScreen.to} end className="top-brand-home" aria-label={homeScreen.label} title={homeScreen.label}>
              <span className="brand-mark">{symbol.slice(0, 4)}</span>
            </NavLink>
            {/* scrolled past the screen's big title: its name comes in beside the mark, as an iPhone's large titles do */}
            <span className={`top-brand-title${barTitle ? ' is-on' : ''}`} aria-hidden="true">
              {barTitle}
            </span>
          </div>
          {deskBar && <CalendarControls bar={deskBar} />}
          {/* a computer, any other screen: its title, once it has gone under the bar */}
          {!phone && !deskBar && (
            <span className={`top-title${barTitle ? ' is-on' : ''}`} aria-hidden="true">
              {barTitle}
            </span>
          )}
          <TopSearch pages={palettePages} />
          <div className="top-actions">
            {deskBar && <ViewSwitcher bar={deskBar} />}
            <span className={`live hide-mobile${live ? ' on' : ''}`} title={live ? 'מחובר - עדכונים בזמן אמת' : 'מתחבר...'}>
              {live ? 'מעודכן' : 'מתחבר'}
            </span>
            <HelpButton />
            <ThemeButton />
            <Bell unread={unread} />
            {/* a computer: the "+" with everything one adds - the screens are in the side menu (settings too) */}
            {!phone && !viewing && (
              <button
                id="top-plus-button"
                type="button"
                className={`top-plus${plusOpen && plusAt === 'top' ? ' plus-open' : ''}`}
                onClick={() => {
                  if (plusOpen && plusAt === 'top') return setPlusOpen(false);
                  setPlusAt('top');
                  setPlusOpen(true);
                }}
                aria-label={canEvent ? 'הוספה: משימה, אירוע בלו"ז, שבועי, תחקיר השבוע או אי עמידה בנהלים' : 'הוספה: משימה, שבועי, תחקיר השבוע או אי עמידה בנהלים'}
                title="הוספה"
                aria-haspopup="menu"
                aria-expanded={plusOpen && plusAt === 'top'}
                aria-controls={plusOpen && plusAt === 'top' ? 'plus-menu' : undefined}
              >
                <Icon name="plus" />
              </button>
            )}
            <UserMenu />
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
          <BackContext.Provider value={phone ? null : back}>
            <ScreenBoundary key={location.pathname}>{children}</ScreenBoundary>
          </BackContext.Provider>
          <ShortcutsHelp />
          <CommandPalette pages={palettePages} />
        </main>
      </div>

      {/* the phone's bar floats over the page: a capsule of glass, the symbols and their words, a mark that
          slides to the chosen tab and the "+" in the middle - small while reading down */}
      <nav
        className={`bottom-nav${typingField ? ' away' : barSmall ? ' compact' : ''}${barIdx < 0 ? ' no-tab' : ''}`}
        aria-label="ניווט"
        style={{ ['--idx' as string]: Math.max(0, barIdx) }}
        inert={drawer || undefined}
      >
        <span className="nav-ind" aria-hidden />
        {/* the calendar: always today's day, at this hour - not the day it was left on */}
        <NavLink
          to={{ pathname: '/', search: '?view=day' }}
          state={{ today: true }}
          end
          className={() => (barIdx === 0 ? 'active' : '')}
          aria-current={barIdx === 0 ? 'page' : undefined}
          onClick={() => requestAnimationFrame(showCalendarNow)}
        >
          <TabIcon name="calendar" filled={barIdx === 0} />
          <span className="nav-label">יומן</span>
        </NavLink>
        <NavLink to="/cadets" className={() => (barIdx === 1 ? 'active' : '')} aria-current={barIdx === 1 ? 'page' : undefined}>
          <TabIcon name="cadets" filled={barIdx === 1} />
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
          <TabIcon name="weeks" filled={barIdx === 3} />
          <span className="nav-label">שבועות</span>
        </NavLink>
        <NavLink to="/tasks" className={() => (barIdx === 4 ? 'active' : '')} aria-current={barIdx === 4 ? 'page' : undefined}>
          <TabIcon name="tasks" filled={barIdx === 4} />
          <span className="nav-label">משימות</span>
        </NavLink>
      </nav>
      {plus.mounted && (
        <PlusMenu
          at={plusAt}
          leaving={plus.leaving}
          onClose={() => setPlusOpen(false)}
          onSmart={() => {
            setPlusOpen(false);
            openSmartEntry();
          }}
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
          onProcedure={() => {
            setPlusOpen(false);
            addProcedure();
          }}
          onEvent={
            canEvent
              ? () => {
                  setPlusOpen(false);
                  navigate('/?new=1');
                }
              : undefined
          }
        />
      )}
    </div>
  );
}

/**
 * The "+": the things one adds. From the phone bar it rises above the bar; from the top bar's "+" on a
 * computer it drops under the button, as a menu.
 */
function PlusMenu({
  at,
  onClose,
  onSmart,
  onTask,
  onWeekly,
  onDebrief,
  onProcedure,
  onEvent,
  leaving,
}: {
  at: 'bar' | 'top';
  onClose: () => void;
  onSmart: () => void;
  onTask: () => void;
  onWeekly: () => void;
  onDebrief: () => void;
  onProcedure: () => void;
  onEvent?: () => void;
  leaving: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const anchorId = at === 'top' ? 'top-plus-button' : 'plus-button';
  // under the top bar's "+", toward the middle of the screen from it (it sits near the left edge)
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
        <button type="button" role="menuitem" className="plus-menu-smart" onClick={onSmart}>
          <span className="plus-menu-icon">
            <Icon name="sparkle" />
          </span>
          <span className="grow">
            <span className="plus-menu-title">הזנה חכמה</span>
            <span className="plus-menu-sub">כותבים במילים שלכם - עונש, אישור כניסה, פטור, משימה - והאפליקציה מזינה למקום הנכון</span>
          </span>
        </button>
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
        <button type="button" role="menuitem" onClick={onProcedure}>
          <span className="plus-menu-icon">
            <Icon name="shield" />
          </span>
          <span className="grow">
            <span className="plus-menu-title">אי עמידה בנהלים</span>
            <span className="plus-menu-sub">הפקרת נשק, נשק מאחורה, טלפון, דיגום - נרשם בתיק הצוער</span>
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
