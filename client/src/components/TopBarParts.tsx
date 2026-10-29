// The top bar's parts on a computer, as Google Calendar lays its own out: on the calendar "היום", the
// arrows, the title of the days shown, a day to go to and the view; everywhere the help, the settings,
// every screen in one place and the person's menu.

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { DESK_VIEWS, VIEW_KEYS, VIEW_LABELS, type CalendarBar } from '../lib/calendarBar';
import { useSession } from '../lib/session';
import { onThemeChange, setThemePref, shownTheme } from '../lib/theme';
import { Icon } from './Icon';
import { NotificationsPanel } from './Notifications';
import { Sheet } from './pickers';
import { OPEN_SHORTCUTS } from './Shortcuts';
import { initials } from './ui';

/** A button and what drops from it: closed by a click outside it, Escape or a choice made. */
function Dropdown({
  className,
  panelClass,
  label,
  title,
  button,
  children,
}: {
  className: string;
  panelClass: string;
  label: string;
  title?: string;
  button: ReactNode;
  children: (close: () => void) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const btn = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const panel = box.current?.querySelector<HTMLElement>('.dd-panel');
    panel?.querySelector<HTMLElement>('[role=menuitem], [role=menuitemradio], input, a, button')?.focus();
    const onDown = (e: PointerEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setOpen(false);
        btn.current?.focus();
        return;
      }
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
      const items = [...(panel?.querySelectorAll<HTMLElement>('[role=menuitem], [role=menuitemradio]') ?? [])];
      if (!items.length) return;
      e.preventDefault();
      const at = items.indexOf(document.activeElement as HTMLElement);
      items[(at + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus();
    };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [open]);
  return (
    <div className={`dd ${className}`} ref={box}>
      <button ref={btn} type="button" className="dd-btn" aria-label={label} title={title ?? label} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        {button}
      </button>
      {open && (
        <div className={`dd-panel ${panelClass}`} role="menu" aria-label={label}>
          {children(() => {
            setOpen(false);
            btn.current?.focus();
          })}
        </div>
      )}
    </div>
  );
}

/** "היום", the arrows, the title and a day to go to - the calendar's own, at the start of the top bar */
export function CalendarControls({ bar }: { bar: CalendarBar }) {
  return (
    <div className="top-cal">
      <button type="button" className="btn top-today" onClick={bar.today} disabled={bar.todayShown} title="היום (T)">
        היום
      </button>
      <div className="top-cal-steps">
        <button type="button" className="icon-btn" aria-label={`${bar.stepLabel} קודם`} title={`${bar.stepLabel} קודם (K)`} onClick={() => bar.step(-1)}>
          <Icon name="chevronRight" />
        </button>
        <button type="button" className="icon-btn" aria-label={`${bar.stepLabel} הבא`} title={`${bar.stepLabel} הבא (J)`} onClick={() => bar.step(1)}>
          <Icon name="chevronLeft" />
        </button>
      </div>
      <h1 className="top-cal-title" aria-live="polite">
        {bar.title}
      </h1>
      <button type="button" className="icon-btn top-goto" aria-label="מעבר לתאריך" title="מעבר לתאריך (G)" onClick={bar.askDate}>
        <Icon name="goto" />
      </button>
    </div>
  );
}

/** the view, as Google Calendar's "שבוע ▾": the views with their keys */
export function ViewSwitcher({ bar }: { bar: CalendarBar }) {
  return (
    <Dropdown
      className="top-view"
      panelClass="dd-menu"
      label={`תצוגה: ${VIEW_LABELS[bar.view]}`}
      button={
        <>
          <span>{VIEW_LABELS[bar.view]}</span>
          <Icon name="chevronDown" size={16} />
        </>
      }
    >
      {(close) => (
        <>
          {DESK_VIEWS.map((v) => (
            <button
              key={v}
              type="button"
              role="menuitemradio"
              aria-checked={bar.view === v}
              className={`dd-item${bar.view === v ? ' on' : ''}`}
              onClick={() => {
                bar.setView(v);
                close();
              }}
            >
              <span className="grow">{VIEW_LABELS[v]}</span>
              {VIEW_KEYS[v] && <span className="kbd">{VIEW_KEYS[v]![0]}</span>}
            </button>
          ))}
          {bar.extras.length > 0 && <div className="dd-sep" role="separator" />}
          {bar.extras.map((x) => (
            <button
              key={x.label}
              type="button"
              role="menuitem"
              className="dd-item"
              onClick={() => {
                close();
                x.run();
              }}
            >
              <Icon name={x.icon} size={18} />
              <span className="grow">{x.label}</span>
            </button>
          ))}
        </>
      )}
    </Dropdown>
  );
}

export function HelpButton() {
  return (
    <button type="button" className="icon-btn hide-mobile" aria-label="קיצורי מקלדת ועזרה" title="קיצורי מקלדת (?)" onClick={() => window.dispatchEvent(new Event(OPEN_SHORTCUTS))}>
      <Icon name="help" />
    </button>
  );
}

/** the person: who they are, their settings, leaving */
export function UserMenu() {
  const { user, isCommander, logout } = useSession();
  const role = isCommander ? 'מפקד הקורס' : user.title || 'איש סגל';
  return (
    <Dropdown className="top-user hide-mobile" panelClass="dd-menu dd-user" label={`${user.displayName} - ${role}`} button={<span className="avatar">{initials(user.displayName)}</span>}>
      {(close) => (
        <>
          <div className="dd-who">
            <span className="avatar">{initials(user.displayName)}</span>
            <span className="col">
              <b>{user.displayName}</b>
              <span className="small muted">{role}</span>
            </span>
          </div>
          <Link to="/settings" role="menuitem" className="dd-item" onClick={close}>
            <Icon name="settings" size={18} />
            <span className="grow">{isCommander ? 'הגדרות והקמת קורס' : 'הגדרות'}</span>
          </Link>
          <button
            type="button"
            role="menuitem"
            className="dd-item"
            onClick={() => {
              close();
              void logout();
            }}
          >
            <Icon name="logout" size={18} />
            <span className="grow">יציאה</span>
          </button>
        </>
      )}
    </Dropdown>
  );
}

/** the colours of a letter avatar, as Google gives one to whoever has no picture - the same for the same name */
const AVATAR_COLORS = ['#eb417b', '#1a73e8', '#188038', '#e8710a', '#9334e6', '#d93025', '#12a4af', '#5f6368'];
const avatarColor = (name: string) => AVATAR_COLORS[[...name].reduce((n, ch) => (n * 31 + ch.charCodeAt(0)) >>> 0, 7) % AVATAR_COLORS.length];

/**
 * The person, at the edge of a phone's calendar bar - as Google Calendar's app has the account there: a
 * letter in a coloured circle with a ring, and how many notifications are new. A tap opens a sheet of the
 * person's things: the notifications, light or dark, the settings and leaving.
 */
export function AppAccount() {
  const { user, isCommander, unread, logout } = useSession();
  const role = isCommander ? 'מפקד הקורס' : user.title || 'איש סגל';
  const [open, setOpen] = useState(false);
  const [bell, setBell] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const [shown, setShown] = useState(shownTheme);
  useEffect(() => onThemeChange(() => setShown(shownTheme())), []);
  const close = () => setOpen(false);
  const color = avatarColor(user.displayName);
  return (
    <>
      <button
        ref={button}
        type="button"
        className="gph-avatar"
        style={{ '--av': color } as React.CSSProperties}
        aria-label={`${user.displayName} - ${role}${unread ? ` · ${unread} התראות חדשות` : ''}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(true)}
      >
        <span className="gph-avatar-face">{initials(user.displayName).slice(0, 1)}</span>
        {unread > 0 && <span className="gph-avatar-count">{unread > 99 ? '99+' : unread}</span>}
      </button>
      <Sheet open={open} title="חשבון" onClose={close} back={button} className="gph-sheet">
        <div className="gph-who">
          <span className="gph-avatar-face is-big" style={{ '--av': color } as React.CSSProperties}>
            {initials(user.displayName).slice(0, 1)}
          </span>
          <span className="col">
            <b>{user.displayName}</b>
            <span className="small muted">{role}</span>
          </span>
        </div>
        <div className="gph-list" role="menu">
          <button
            type="button"
            role="menuitem"
            className="gph-item"
            onClick={() => {
              close();
              setBell(true);
            }}
          >
            <Icon name="bell" size={22} />
            <span className="grow">התראות</span>
            {unread > 0 && <span className="count">{unread}</span>}
          </button>
          <button
            type="button"
            role="menuitem"
            className="gph-item"
            onClick={() => {
              close();
              setThemePref(shown === 'dark' ? 'light' : 'dark');
            }}
          >
            <Icon name={shown === 'dark' ? 'sun' : 'moon'} size={22} />
            <span className="grow">{shown === 'dark' ? 'מצב בהיר' : 'מצב כהה'}</span>
          </button>
          <Link to="/settings" role="menuitem" className="gph-item" onClick={close}>
            <Icon name="settings" size={22} />
            <span className="grow">{isCommander ? 'הגדרות והקמת קורס' : 'הגדרות'}</span>
          </Link>
          <button
            type="button"
            role="menuitem"
            className="gph-item"
            onClick={() => {
              close();
              void logout();
            }}
          >
            <Icon name="logout" size={22} />
            <span className="grow">יציאה</span>
          </button>
        </div>
      </Sheet>
      <NotificationsPanel open={bell} onClose={() => setBell(false)} anchor={button} />
    </>
  );
}
