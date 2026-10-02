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
import { initials } from './ui';

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

  if (isCommander) {
    return [
      {
        items: [
          { to: '/', label: 'בית', icon: 'home', end: true },
          { to: '/my', label: 'המשימות שלי', icon: 'my' },
          { to: '/tasks', label: 'כל המשימות', icon: 'tasks' },
          { to: '/weeks', label: 'שבועות הקורס', icon: 'layers' },
          { to: '/schedule', label: 'לו"ז', icon: 'calendar' },
          { to: '/team', label: 'צוות', icon: 'users' },
        ],
      },
      {
        title: 'בקרה',
        items: [
          { to: '/requests', label: 'אישורים ובקשות', icon: 'inbox', count: pending },
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
      ],
    },
    {
      title: 'צוערים ולקחים',
      items: [
        { to: '/cadets', label: 'צוערים', icon: 'shield' },
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

export function Layout({ children }: { children: ReactNode }) {
  const { user, settings, unread, logout, isCommander } = useSession();
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
  const lastPath = useRef(location.pathname);
  useEffect(() => {
    if (lastPath.current === location.pathname) return;
    lastPath.current = location.pathname;
    if (updateReady()) window.location.reload();
    else void checkForUpdate();
  }, [location.pathname]);
  // a block body on purpose: newer browsers return a promise from scrollTo, and an effect that returns
  // anything but a cleanup function makes React crash on the next screen change
  useEffect(() => {
    window.scrollTo(0, 0);
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

  return (
    <div className="app">
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
      <aside className="rail" aria-label="ניווט ראשי">
        <div className="brand">
          <div className="brand-mark">{symbol.slice(0, 4)}</div>
          <div>
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
                {it.label}
                {!!it.count && <span className="count">{it.count}</span>}
              </NavLink>
            ))}
          </nav>
        ))}
        <NavLink to="/settings" className={({ isActive }) => `rail-link${isActive ? ' active' : ''}`} style={{ marginTop: 14 }}>
          <Icon name="settings" />
          {isCommander ? 'הגדרות והקמת קורס' : 'הגדרות'}
        </NavLink>
        <div className="rail-foot">
          <div className="avatar">{initials(user.displayName)}</div>
          <div className="grow">
            <div className="strong small">{user.displayName}</div>
            <div className="tiny" style={{ color: 'var(--rail-muted)' }}>
              {isCommander ? 'מפקד הקורס' : user.title || 'איש סגל'}
            </div>
          </div>
          <button className="icon-btn" style={{ color: 'var(--rail-muted)' }} onClick={() => void logout()} aria-label="יציאה" title="יציאה">
            <Icon name="logout" />
          </button>
        </div>
      </aside>

      <div className="main">
        <header className="topbar">
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
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="חיפוש משימה, איש סגל, שבוע, תחום..." aria-label="חיפוש" />
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
            <button className="btn btn-primary hide-mobile" onClick={() => newTask()} title="קיצור מקלדת: N">
              <Icon name="plus" /> משימה
            </button>
          </div>
        </header>
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
        </main>
      </div>

      <nav className="bottom-nav" aria-label="ניווט">
        <NavLink to="/" end className={({ isActive }) => (isActive ? 'active' : '')}>
          <Icon name="home" />
          בית
        </NavLink>
        <NavLink to="/tasks" className={({ isActive }) => (isActive ? 'active' : '')}>
          <Icon name="tasks" />
          משימות
        </NavLink>
        <button onClick={() => newTask()} aria-label="משימה חדשה">
          <span className="plus">
            <Icon name="plus" />
          </span>
        </button>
        <NavLink to="/weeks" className={({ isActive }) => (isActive ? 'active' : '')}>
          <Icon name="layers" />
          שבועות
        </NavLink>
        <NavLink to="/more" className={({ isActive }) => (isActive ? 'active' : '')}>
          <Icon name="more" />
          עוד
        </NavLink>
      </nav>
    </div>
  );
}
