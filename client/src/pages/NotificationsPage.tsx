// Section 73 - notification center: action required / information / exceptions. The same live list as
// the bell's panel (components/Notifications.tsx), with every kind, the ones put off, and selecting.

import { useEffect, useState } from 'react';
import { NOTIFICATION_CATEGORY_LABELS, type NotificationCategory } from '@shared/constants';
import type { Notification } from '@shared/types';
import { BulkToggle } from '../components/Bulk';
import { Icon } from '../components/Icon';
import { NotificationList, NotificationsScope, useOpenNotification } from '../components/Notifications';
import { useToast } from '../components/Toasts';
import { Empty, ErrorBox, Loading, PageHead } from '../components/ui';
import { ensureNotifications, markAllRead, useNotifications } from '../lib/notifications';
import { useApi } from '../lib/useApi';

type Tab = '' | 'unread' | NotificationCategory | 'snoozed';

export function NotificationsPage() {
  const [tab, setTab] = useState<Tab>('');
  const { list, error, unread, fresh } = useNotifications();
  useEffect(ensureNotifications, []);
  const snoozed = useApi<Notification[]>(tab === 'snoozed' ? '/api/notifications?snoozed=1' : null, ['notifications']);
  const toast = useToast();
  const open = useOpenNotification();

  const shown = tab === 'snoozed' ? snoozed.data : list?.filter((n) => (tab === 'unread' ? !n.read : !tab || n.category === tab));
  const waiting = tab === 'snoozed' ? snoozed.loading && !snoozed.data : !list && !error;
  const tabs: [Tab, string][] = [
    ['', 'הכל'],
    ['unread', `חדשות${unread ? ` (${unread > 99 ? '99+' : unread})` : ''}`],
    ...(Object.entries(NOTIFICATION_CATEGORY_LABELS) as [NotificationCategory, string][]),
  ];

  return (
    <NotificationsScope list={shown ?? []} actions={tab === 'snoozed' ? [] : [{ key: 'read', label: 'סימון כנקראו', icon: 'check' }]}>
      <div className="page narrow">
        <PageHead
          title="התראות"
          sub="מקבלים רק מה שחשוב: חריגות, חסמים, בקשות שמחייבות אישור ודד-ליינים. מתעדכן בזמן אמת."
          actions={
            <>
              {!!shown?.length && <BulkToggle />}
              {unread > 0 && tab !== 'snoozed' && (
                <button className="btn" onClick={() => void markAllRead().catch((e: Error) => toast({ title: e.message, tone: 'red' }))}>
                  <Icon name="check" /> סמן הכל כנקרא
                </button>
              )}
            </>
          }
        />
        <div className="tabs">
          {tabs.map(([v, label]) => (
            <button key={v || 'all'} className={`tab${tab === v ? ' on' : ''}`} onClick={() => setTab(v)}>
              {label}
            </button>
          ))}
          <button className={`tab${tab === 'snoozed' ? ' on' : ''}`} onClick={() => setTab('snoozed')}>
            <Icon name="clock" size={13} /> נדחו
          </button>
        </div>
        <ErrorBox error={tab === 'snoozed' ? snoozed.error : error} />
        {waiting ? (
          <Loading rows={4} />
        ) : !shown?.length ? (
          <Empty
            icon={tab === 'snoozed' ? 'clock' : 'bell'}
            title={tab === 'snoozed' ? 'אין התראות שנדחו' : tab === 'unread' ? 'הכל נקרא' : 'אין התראות'}
            text={tab === 'snoozed' ? 'בכל התראה - "אחר כך" מעלים אותה עד הזמן שבוחרים, ואז היא חוזרת כחדשה.' : 'התראות חדשות יופיעו כאן ברגע שיגיעו.'}
          />
        ) : (
          <div className="card notif-card">
            <NotificationList list={shown} fresh={fresh} onOpen={open} snoozedView={tab === 'snoozed'} />
          </div>
        )}
      </div>
    </NotificationsScope>
  );
}
