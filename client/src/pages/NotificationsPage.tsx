// Section 73 - notification center: action required / information / exceptions.

import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { NOTIFICATION_CATEGORY_LABELS, type NotificationCategory } from '@shared/constants';
import type { Notification } from '@shared/types';
import { Icon } from '../components/Icon';
import { Empty, ErrorBox, Loading, PageHead } from '../components/ui';
import { api } from '../lib/api';
import { fmtAgo } from '../lib/format';
import { onNotification } from '../lib/realtime';
import { useSession } from '../lib/session';
import { useApi, useTick } from '../lib/useApi';

const TONE: Record<NotificationCategory, string> = { action: 'blue', info: 'green', exception: 'red' };
const ICON: Record<NotificationCategory, string> = { action: 'hand', info: 'bell', exception: 'alert' };

export function NotificationsPage() {
  const [cat, setCat] = useState<NotificationCategory | ''>('');
  const { data, error, loading, reload } = useApi<Notification[]>(`/api/notifications${cat ? `?category=${cat}` : ''}`, []);
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

  return (
    <div className="page narrow">
      <PageHead
        title="התראות"
        sub="מקבלים רק מה שחשוב: חריגות, חסמים, בקשות שמחייבות אישור ודד-ליינים."
        actions={
          unreadCount > 0 && (
            <button className="btn" onClick={() => void markAll()}>
              <Icon name="check" /> סמן הכל כנקרא
            </button>
          )
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
      </div>
      <ErrorBox error={error} />
      {loading && !data ? (
        <Loading rows={4} />
      ) : !data?.length ? (
        <Empty icon="bell" title="אין התראות" />
      ) : (
        <div className="card">
          {data.map((n) => (
            <div
              key={n.id}
              className={`attn-item t-${TONE[n.category]}`}
              onClick={() => void open(n)}
              style={{ background: n.read ? undefined : 'var(--card-2)' }}
              role="link"
              tabIndex={0}
              onKeyDown={(e) => e.key === 'Enter' && void open(n)}
            >
              <span className="attn-bar" style={{ opacity: n.read ? 0.3 : 1 }} />
              <div style={{ minWidth: 0 }}>
                <div className="attn-kind">
                  <Icon name={ICON[n.category]} size={12} /> {NOTIFICATION_CATEGORY_LABELS[n.category]}
                </div>
                <div className="attn-title" style={{ fontWeight: n.read ? 500 : 700 }}>
                  {n.title}
                </div>
                {n.body && <div className="attn-sub">{n.body}</div>}
              </div>
              <span className="tiny muted" style={{ whiteSpace: 'nowrap' }}>
                {fmtAgo(n.createdAt)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
