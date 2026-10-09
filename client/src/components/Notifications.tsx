// Notifications as a live list: the panel the bell opens (a popover on a computer, a sheet on a phone)
// and the page share it. Grouped by day; a new one slides in at the top as it arrives; each can be
// opened (it is read), marked read or new again, put off until later, or deleted with a moment to bring
// it back - on a phone by swiping it (toward its leading side read / new, toward its trailing side
// deleted), on a computer from the buttons that show on the row under the pointer. Once what one is
// about is finished (lib/notifications.ts) it is ticked "הסתיים" and folds away: only what is open stays.

import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { Link, useNavigate } from 'react-router';
import { NOTIFICATION_CATEGORY_LABELS, type NotificationCategory } from '@shared/constants';
import { addDays, shortDate, startOfWeek, weekdayName } from '@shared/dates';
import type { Notification } from '@shared/types';
import { ensureNotifications, markAllRead, markRead, markUnread, setPanelOpen, snooze, useNotifications, type LeavePhase } from '../lib/notifications';
import { dateKeyOf, fmtAgo, fmtDateTime, fmtTime, isoAt, todayKey } from '../lib/format';
import { lockScroll } from '../lib/scrollLock';
import { usePresence } from '../lib/presence';
import { quickDelete } from '../lib/quickDelete';
import { useTick } from '../lib/useApi';
import { BulkCheck, bulkClick, BulkScope, SwipeRow, useBulk } from './Bulk';
import { CheckMark } from './CheckMark';
import { Icon } from './Icon';
import { Sheet, usePhonePicker } from './pickers';
import { useToast } from './Toasts';
import { Empty, openable, Seg } from './ui';

export const NOTIFICATION_TONE: Record<NotificationCategory, string> = { action: 'blue', info: 'green', exception: 'red' };
export const NOTIFICATION_ICON: Record<NotificationCategory, string> = { action: 'hand', info: 'bell', exception: 'alert' };

/** when a notification put off comes back */
export function laterOptions(): { label: string; at: string }[] {
  const now = new Date();
  const today = todayKey();
  const hour = Number(fmtTime(now.toISOString()).slice(0, 2));
  const sunday = addDays(startOfWeek(today), 7);
  return [
    { label: 'בעוד שעה', at: new Date(now.getTime() + 3600_000).toISOString() },
    { label: 'בעוד 3 שעות', at: new Date(now.getTime() + 3 * 3600_000).toISOString() },
    ...(hour < 17 ? [{ label: 'הערב 18:00', at: isoAt(today, '18:00') }] : []),
    { label: 'מחר 08:00', at: isoAt(addDays(today, 1), '08:00') },
    ...(addDays(today, 1) !== sunday ? [{ label: 'ראשון 08:00', at: isoAt(sunday, '08:00') }] : []),
  ];
}

/** the day a notification came, as a heading: היום, אתמול, the weekday this week, or the date */
export function dayLabel(iso: string, today = todayKey()): string {
  const key = dateKeyOf(iso);
  if (key === today) return 'היום';
  if (key === addDays(today, -1)) return 'אתמול';
  if (key > addDays(today, -7)) return `יום ${weekdayName(key)}`;
  return shortDate(key);
}

/** one notification: open it, read / new, later, delete - and, its subject finished, ticked and folded away */
export function NotificationItem({ n, fresh, leaving, onOpen, snoozedView }: { n: Notification; fresh?: boolean; leaving?: LeavePhase; onOpen: (n: Notification) => void; snoozedView?: boolean }) {
  const toast = useToast();
  const bulk = useBulk();
  const [later, setLater] = useState(false);
  const fail = (e: unknown) => toast({ title: (e as Error).message, tone: 'red' });
  const toggle = () => void (n.read ? markUnread([n.id]) : markRead([n.id])).catch(fail);
  const remove = () => quickDelete({ entity: 'notifications', id: n.id, label: n.title, topics: ['notifications'], toast });
  const putOff = (at: string | null, label?: string) => {
    setLater(false);
    snooze(n, at)
      .then(() => toast({ title: at ? `תחזור ${label}` : 'ההתראה חזרה', tone: 'green' }))
      .catch(fail);
  };
  const stop = (fn: () => void) => (e: React.MouseEvent) => {
    e.stopPropagation();
    fn();
  };
  return (
    <SwipeRow
      itemId={n.id}
      label={n.title}
      trash={false}
      done={snoozedView || leaving ? null : { label: n.read ? 'חדשה' : 'נקראה', run: toggle }}
      className={`notif-wrap${fresh ? ' is-fresh' : ''}${leaving ? ' is-finished' : ''}${leaving?.startsWith('news') ? ' is-news' : ''}${leaving?.endsWith('fold') ? ' is-folding' : ''}`}
    >
      <div
        className={`notif-item t-${NOTIFICATION_TONE[n.category]}${n.read ? '' : ' is-unread'}${bulk?.selected.has(n.id) ? ' selected' : ''}`}
        {...openable(bulkClick(bulk, n.id, () => onOpen(n)))}
        aria-label={`${leaving ? 'הסתיים: ' : n.read ? '' : 'חדשה: '}${n.title}`}
      >
        {bulk?.active ? <BulkCheck id={n.id} /> : <span className="notif-icon" aria-hidden="true">{<Icon name={NOTIFICATION_ICON[n.category]} size={16} />}</span>}
        <div className="notif-main">
          <div className="notif-title">{n.title}</div>
          {n.body && <div className="notif-body">{n.body}</div>}
          <div className="notif-meta">
            <span>{NOTIFICATION_CATEGORY_LABELS[n.category]}</span>
            <span className="sep">
              {n.snoozedUntil ? (
                `חוזרת ${fmtDateTime(n.snoozedUntil)}`
              ) : (
                <time dateTime={n.createdAt} title={fmtDateTime(n.createdAt)}>
                  {fmtAgo(n.createdAt)}
                </time>
              )}
            </span>
          </div>
        </div>
        <div className="notif-side">
          {leaving && (
            <span className="notif-done" aria-hidden="true">
              <CheckMark size={16} /> הסתיים
            </span>
          )}
          {!n.read && !leaving && <span className="notif-dot" aria-hidden="true" />}
          {!bulk?.active && !leaving && (
            <span className="notif-acts">
              {snoozedView ? (
                <button type="button" className="btn btn-ghost btn-sm" onClick={stop(() => putOff(null))}>
                  החזר עכשיו
                </button>
              ) : (
                <>
                  <button type="button" className="icon-btn notif-act" onClick={stop(toggle)} aria-label={n.read ? 'סימון כחדשה' : 'סימון כנקראה'} title={n.read ? 'סימון כחדשה' : 'סימון כנקראה'}>
                    <Icon name={n.read ? 'mail' : 'check'} size={15} />
                  </button>
                  <button type="button" className="icon-btn notif-act" onClick={stop(() => setLater(!later))} aria-label="להזכיר אחר כך" aria-expanded={later} title="להזכיר אחר כך">
                    <Icon name="clock" size={15} />
                  </button>
                </>
              )}
              <button type="button" className="icon-btn notif-act notif-del" onClick={stop(remove)} aria-label={`מחיקה: ${n.title}`} title="מחיקה (Delete)">
                <Icon name="trash" size={15} />
              </button>
            </span>
          )}
        </div>
        {later && !leaving && (
          <div className="notif-later-menu" role="group" aria-label="מתי להזכיר" onClick={(e) => e.stopPropagation()}>
            {laterOptions().map((o) => (
              <button key={o.label} type="button" className="chip chip-sm" onClick={() => putOff(o.at, o.label)}>
                {o.label}
              </button>
            ))}
          </div>
        )}
      </div>
    </SwipeRow>
  );
}

/** a list of notifications under day headings, newest first */
export function NotificationList({
  list,
  fresh,
  leaving,
  onOpen,
  snoozedView,
}: {
  list: Notification[];
  fresh?: ReadonlySet<number>;
  leaving?: ReadonlyMap<number, LeavePhase>;
  onOpen: (n: Notification) => void;
  snoozedView?: boolean;
}) {
  useTick(30_000);
  const today = todayKey();
  const groups: { label: string; items: Notification[] }[] = [];
  for (const n of list) {
    const label = snoozedView ? 'נדחו' : dayLabel(n.createdAt, today);
    const g = groups[groups.length - 1];
    if (g?.label === label) g.items.push(n);
    else groups.push({ label, items: [n] });
  }
  return (
    <div className="notif-list">
      {groups.map((g) => (
        <section key={g.label} className="notif-group" aria-label={g.label}>
          <h3 className="notif-day">{g.label}</h3>
          {g.items.map((n) => (
            <NotificationItem key={n.id} n={n} fresh={fresh?.has(n.id)} leaving={leaving?.get(n.id)} onOpen={onOpen} snoozedView={snoozedView} />
          ))}
        </section>
      ))}
    </div>
  );
}

/** in a list one can delete from in place (swipe, the Delete key) - and select from, on the page */
export function NotificationsScope({ list, children, actions = [] }: { list: Notification[]; children: ReactNode; actions?: Parameters<typeof BulkScope>[0]['actions'] }) {
  return (
    <BulkScope
      entity="notifications"
      noun="התראות"
      topics={['notifications']}
      ids={list.map((n) => n.id)}
      actions={[...actions, { key: 'delete', label: 'מחיקה', icon: 'trash', danger: true, confirm: 'למחוק {n} התראות?' }]}
    >
      {children}
    </BulkScope>
  );
}

/** opening a notification: it is read, and its screen opens */
export function useOpenNotification(after?: () => void) {
  const navigate = useNavigate();
  const toast = useToast();
  return (n: Notification) => {
    after?.();
    if (!n.read) markRead([n.id]).catch((e: Error) => toast({ title: e.message, tone: 'red' }));
    if (n.link) navigate(n.link);
  };
}

// ---------------- the panel ----------------

type Only = 'all' | 'unread';

/** which ones, and read them all */
function PanelTools({ only, setOnly }: { only: Only; setOnly: (v: Only) => void }) {
  const { unread } = useNotifications();
  const toast = useToast();
  return (
    <div className="notif-tools">
      <Seg
        value={only}
        onChange={setOnly}
        options={[
          { value: 'all', label: 'הכל' },
          { value: 'unread', label: `חדשות${unread ? ` (${unread > 99 ? '99+' : unread})` : ''}` },
        ]}
      />
      <span className="grow" />
      <button type="button" className="btn btn-ghost btn-sm" disabled={!unread} onClick={() => void markAllRead().catch((e: Error) => toast({ title: e.message, tone: 'red' }))}>
        <Icon name="check" size={15} /> סמן הכל כנקרא
      </button>
    </div>
  );
}

function PanelBody({ onClose, only, tools, inSheet }: { onClose: () => void; only: Only; tools?: ReactNode; inSheet?: boolean }) {
  const { list, error, fresh, leaving } = useNotifications();
  useEffect(ensureNotifications, []);
  const open = useOpenNotification(onClose);
  const shown = (list ?? []).filter((n) => only === 'all' || !n.read);
  const body = (
    <>
      {error && !list && <p className="small text-red notif-pad">{error}</p>}
      {!list && !error ? (
        <div className="notif-pad" aria-busy="true">
          <div className="skeleton" style={{ height: 56, marginBottom: 8 }} />
          <div className="skeleton" style={{ height: 56, marginBottom: 8 }} />
          <div className="skeleton" style={{ height: 56 }} />
        </div>
      ) : list && !shown.length ? (
        <Empty icon="bell" title={only === 'unread' ? 'הכל נקרא' : 'אין התראות'} text={only === 'unread' ? 'התראות חדשות יופיעו כאן ברגע שיגיעו.' : 'כשמשהו ידרוש את תשומת לבך - הוא יופיע כאן.'} />
      ) : (
        <NotificationsScope list={shown.filter((n) => !leaving.has(n.id))}>
          <NotificationList list={shown} fresh={fresh} leaving={leaving} onOpen={open} />
        </NotificationsScope>
      )}
    </>
  );
  const foot = (
    <div className="notif-foot">
      <Link to="/notifications" className="btn btn-ghost btn-sm" onClick={onClose}>
        לכל ההתראות <Icon name="chevronLeft" size={15} />
      </Link>
    </div>
  );
  if (inSheet)
    return (
      <>
        <div className="pick-sheet-body notif-sheet-body">{body}</div>
        {foot}
      </>
    );
  return (
    <>
      <div className="notif-panel-head">
        <h2>התראות</h2>
        <button type="button" className="icon-btn" onClick={onClose} aria-label="סגירה">
          <Icon name="x" />
        </button>
      </div>
      {tools}
      <div className="notif-panel-body">{body}</div>
      {foot}
    </>
  );
}

/** the bell's notifications, without leaving the screen: a sheet on a phone, a panel under the bell on a computer */
export function NotificationsPanel({ open, onClose, anchor }: { open: boolean; onClose: () => void; anchor: RefObject<HTMLElement | null> }) {
  const phone = usePhonePicker();
  const [only, setOnly] = useState<Only>('all');
  useEffect(() => {
    setPanelOpen(open);
    return () => setPanelOpen(false);
  }, [open]);
  const tools = <PanelTools only={only} setOnly={setOnly} />;
  if (phone)
    return (
      <Sheet open={open} title="התראות" onClose={onClose} back={anchor} tall className="notif-sheet" head={tools}>
        <PanelBody onClose={onClose} only={only} inSheet />
      </Sheet>
    );
  return (
    <Popover open={open} onClose={onClose} anchor={anchor}>
      <PanelBody onClose={onClose} only={only} tools={tools} />
    </Popover>
  );
}

function Popover({ open, onClose, anchor, children }: { open: boolean; onClose: () => void; anchor: RefObject<HTMLElement | null>; children: ReactNode }) {
  const presence = usePresence(open, 160);
  const ref = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  const [style, setStyle] = useState<CSSProperties>({ visibility: 'hidden' });
  // under the bell, grown out of it; as tall as the window allows
  useLayoutEffect(() => {
    if (!presence.mounted) return;
    const place = () => {
      const r = anchor.current?.getBoundingClientRect();
      if (!r) return;
      const vw = document.documentElement.clientWidth;
      const w = Math.min(420, vw - 16);
      const left = Math.min(Math.max(8, r.left - 12), vw - w - 8);
      setStyle({ position: 'fixed', top: r.bottom + 8, left, width: w, maxHeight: Math.min(640, window.innerHeight - r.bottom - 24), transformOrigin: `${r.left + r.width / 2 - left}px top` });
    };
    place();
    window.addEventListener('resize', place);
    return () => window.removeEventListener('resize', place);
  }, [presence.mounted, anchor]);
  useEffect(() => {
    if (!open) return;
    ref.current?.focus({ preventScroll: true });
    const down = (e: Event) => {
      const t = e.target as Node;
      if (ref.current?.contains(t) || anchor.current?.contains(t)) return;
      // a message on top (its "ביטול") is not outside
      if ((t as Element).closest?.('.toasts, .confirm-dialog, .modal-backdrop')) return;
      close.current();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      close.current();
    };
    document.addEventListener('mousedown', down, true);
    document.addEventListener('keydown', key);
    const unlock = window.innerWidth < 600 ? lockScroll() : null;
    return () => {
      document.removeEventListener('mousedown', down, true);
      document.removeEventListener('keydown', key);
      unlock?.();
      // the focus goes back to the bell - when it was inside, or lost with a button that went away
      const at = document.activeElement;
      if (!at || at === document.body || ref.current?.contains(at)) anchor.current?.focus({ preventScroll: true });
    };
  }, [open, anchor]);
  if (!presence.mounted) return null;
  return createPortal(
    <div ref={ref} className={`notif-panel${presence.leaving ? ' is-leaving' : ''}`} style={style} role="dialog" aria-label="התראות" tabIndex={-1} dir="rtl" inert={presence.leaving || undefined}>
      {children}
    </div>,
    document.body,
  );
}
