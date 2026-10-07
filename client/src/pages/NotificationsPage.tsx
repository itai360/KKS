// Section 73 - notification center: action required / information / exceptions.

import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { NOTIFICATION_CATEGORY_LABELS, type NotificationCategory } from '@shared/constants';
import type { Notification } from '@shared/types';
import { BulkCheck, BulkRow, BulkScope, BulkToggle } from '../components/Bulk';
import { Icon } from '../components/Icon';
import { Empty, ErrorBox, Loading, PageHead } from '../components/ui';
import { api } from '../lib/api';
import { fmtAgo, fmtDateTime, fmtTime, isoAt, todayKey } from '../lib/format';
import { addDays, startOfWeek } from '@shared/dates';
import { useToast } from '../components/Toasts';
import { onNotification } from '../lib/realtime';
import { useSession } from '../lib/session';
import { useApi, useTick } from '../lib/useApi';

const TONE: Record<NotificationCategory, string> = { action: 'blue', info: 'green', exception: 'red' };
const ICON: Record<NotificationCategory, string> = { action: 'hand', info: 'bell', exception: 'alert' };

/** when a notification put off comes back */
function laterOptions(): { label: string; at: string }[] {
  const now = new Date();
  const today = todayKey();
  const hour = Number(fmtTime(now.toISOString()).slice(0, 2));
  const sunday = addDays(startOfWeek(today), 7);
  return [
    { label: 'בעוד 3 שעות', at: new Date(now.getTime() + 3 * 3600_000).toISOString() },
    ...(hour < 17 ? [{ label: 'הערב 18:00', at: isoAt(today, '18:00') }] : []),
    { label: 'מחר 08:00', at: isoAt(addDays(today, 1), '08:00') },
    ...(addDays(today, 1) !== sunday ? [{ label: 'ראשון 08:00', at: isoAt(sunday, '08:00') }] : []),
  ];
}

export function NotificationsPage() {
  const [cat, setCat] = useState<NotificationCategory | '' | 'snoozed'>('');
  const { data, error, loading, reload } = useApi<Notification[]>(`/api/notifications${cat === 'snoozed' ? '?snoozed=1' : cat ? `?category=${cat}` : ''}`, []);
  const toast = useToast();
  const [later, setLater] = useState<number | null>(null);
  const snooze = async (n: Notification, until: string | null, label?: string) => {
    try {
      const r = await api.post<{ unread: number }>(`/api/notifications/${n.id}/snooze`, { until });
      setUnread(r.unread);
      setLater(null);
      toast({ title: until ? `תחזור ${label}` : 'ההתראה חזרה', tone: 'green' });
      void reload();
    } catch (e) {
      toast({ title: (e as Error).message, tone: 'red' });
    }
  };
  const { setUnread } = useSession();
  const navigate = useNavigate();
  useTick();
  useEffect(() => onNotification(() => void reload()), [reload]);

  const markAll = async () => {
    const r = await api.post<{ unread: number }>('/api/notifications/read', { all: true });
    setUnread(r.unread);
    void reload();
  };

  const open = async (n: Notification) => {
    if (!n.read) {
      const r = await api.post<{ unread: number }>('/api/notifications/read', { ids: [n.id] });
      setUnread(r.unread);
    }
    if (n.link) navigate(n.link);
    else void reload();
  };

  const unreadCount = data?.filter((n) => !n.read).length ?? 0;
  // the bell follows changes made here in bulk
  useEffect(() => {
    if (data && !cat) setUnread(unreadCount);
  }, [data, cat, unreadCount, setUnread]);
  const options = laterOptions();

  return (
    <BulkScope
      entity="notifications"
      noun="התראות"
      topics={['*']}
      ids={(data ?? []).map((n) => n.id)}
      actions={[
        { key: 'read', label: 'סימון כנקראו', icon: 'check' },
        { key: 'delete', label: 'מחיקה', icon: 'trash', danger: true, confirm: 'למחוק {n} התראות?' },
      ]}
    >
    <div className="page narrow">
      <PageHead
        title="התראות"
        sub="מקבלים רק מה שחשוב: חריגות, חסמים, בקשות שמחייבות אישור ודד-ליינים."
        actions={
          <>
            {!!data?.length && <BulkToggle />}
            {unreadCount > 0 && (
              <button className="btn" onClick={() => void markAll()}>
                <Icon name="check" /> סמן הכל כנקרא
              </button>
            )}
          </>
        }
      />
      <div className="tabs">
        <button className={`tab${cat === '' ? ' on' : ''}`} onClick={() => setCat('')}>
          הכל
        </button>
        {(Object.keys(NOTIFICATION_CATEGORY_LABELS) as NotificationCategory[]).map((c) => (
          <button key={c} className={`tab${cat === c ? ' on' : ''}`} onClick={() => setCat(c)}>
            {NOTIFICATION_CATEGORY_LABELS[c]}
          </button>
        ))}
        <button className={`tab${cat === 'snoozed' ? ' on' : ''}`} onClick={() => setCat('snoozed')}>
          <Icon name="clock" size={13} /> נדחו
        </button>
      </div>
      <ErrorBox error={error} />
      {loading && !data ? (
        <Loading rows={4} />
      ) : !data?.length ? (
        <Empty icon={cat === 'snoozed' ? 'clock' : 'bell'} title={cat === 'snoozed' ? 'אין התראות שנדחו' : 'אין התראות'} text={cat === 'snoozed' ? 'בכל התראה - "אחר כך" מעלים אותה עד הזמן שבוחרים, ואז היא חוזרת כחדשה.' : undefined} />
      ) : (
        <div className="card">
          {data.map((n) => (
            <BulkRow
              key={n.id}
              itemId={n.id}
              label={n.title}
              className={`attn-item t-${TONE[n.category]}`}
              onOpen={() => void open(n)}
              style={{ background: n.read ? undefined : 'var(--card-2)' }}
            >
              <span className="attn-bar" style={{ opacity: n.read ? 0.3 : 1 }} />
              <BulkCheck id={n.id} />
              <div style={{ minWidth: 0 }}>
                <div className="attn-kind">
                  <Icon name={ICON[n.category]} size={12} /> {NOTIFICATION_CATEGORY_LABELS[n.category]}
                </div>
                <div className="attn-title" style={{ fontWeight: n.read ? 500 : 700 }}>
                  {n.title}
                </div>
                {n.body && <div className="attn-sub">{n.body}</div>}
              </div>
              <span className="col notif-side">
                <span className="tiny muted" style={{ whiteSpace: 'nowrap' }}>
                  {n.snoozedUntil ? `חוזרת ${fmtDateTime(n.snoozedUntil)}` : fmtAgo(n.createdAt)}
                </span>
                {n.snoozedUntil ? (
                  <button className="btn btn-ghost btn-sm" onClick={(e) => (e.stopPropagation(), void snooze(n, null))}>
                    החזר עכשיו
                  </button>
                ) : (
                  <button className="icon-btn notif-later" aria-label="אחר כך" aria-expanded={later === n.id} title="להזכיר אחר כך" onClick={(e) => (e.stopPropagation(), setLater(later === n.id ? null : n.id))}>
                    <Icon name="clock" size={15} />
                  </button>
                )}
              </span>
              {later === n.id && (
                <div className="notif-later-menu" role="group" aria-label="מתי להזכיר" onClick={(e) => e.stopPropagation()}>
                  {options.map((o) => (
                    <button key={o.label} className="chip chip-sm" onClick={() => void snooze(n, o.at, o.label)}>
                      {o.label}
                    </button>
                  ))}
                </div>
              )}
            </BulkRow>
          ))}
        </div>
      )}
    </div>
    </BulkScope>
  );
}
