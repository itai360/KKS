// Announcements waiting for this person's "read": pinned at the top of the home screen
// until confirmed, so an order to the whole staff is not lost among the notifications.

import { useState } from 'react';
import { Link } from 'react-router';
import type { Announcement } from '@shared/types';
import { Icon } from './Icon';
import { useToast } from './Toasts';
import { api } from '../lib/api';
import { fmtAgo } from '../lib/format';
import { emitLocalChange } from '../lib/realtime';
import { useApi } from '../lib/useApi';

export function PendingAnnouncements({ spaced }: { spaced?: boolean }) {
  const { data, reload } = useApi<Announcement[]>('/api/announcements?pending=1', ['announcements']);
  const toast = useToast();
  const [busy, setBusy] = useState<number | null>(null);
  if (!data?.length) return null;
  const ack = async (a: Announcement) => {
    setBusy(a.id);
    try {
      await api.post(`/api/announcements/${a.id}/read`, { ack: true });
      emitLocalChange('announcements');
      await reload();
    } catch (e) {
      toast({ title: (e as Error).message, tone: 'red' });
    } finally {
      setBusy(null);
    }
  };
  return (
    <section className={`col gap-6${spaced ? ' mb-12' : ''}`} aria-label="הודעות שממתינות לאישור קריאה">
      {data.map((a) => (
        <div key={a.id} className={`card announce-pin ${a.urgent ? 't-red' : 't-blue'}`} role="status">
          <Icon name={a.urgent ? 'alert' : 'flag'} />
          <div className="grow" style={{ minWidth: 0 }}>
            <div className="strong">
              {a.urgent && <span className="badge t-red">דחוף</span>} {a.title}
            </div>
            {a.body && <div className="small prewrap announce-body">{a.body}</div>}
            <div className="tiny muted">
              {a.createdByName} · {fmtAgo(a.createdAt)} · <Link to="/announcements">כל ההודעות</Link>
            </div>
          </div>
          <button className="btn btn-primary btn-sm" disabled={busy === a.id} onClick={() => void ack(a)}>
            <Icon name="check" /> קראתי
          </button>
        </div>
      ))}
    </section>
  );
}
