// Announcements waiting for this person's "read": pinned at the top of the home screen
// until confirmed, so an order to the whole staff is not lost among the notifications.
// Confirmed, it says so a moment - with a check - and folds away.

import { useRef, useState } from 'react';
import { Link } from 'react-router';
import type { Announcement } from '@shared/types';
import { CheckMark } from './CheckMark';
import { Icon } from './Icon';
import { useToast } from './Toasts';
import { api } from '../lib/api';
import { fmtAgo } from '../lib/format';
import { haptic } from '../lib/haptics';
import { leaveClass, useLeaving } from '../lib/leaving';
import { emitLocalChange } from '../lib/realtime';
import { useApi } from '../lib/useApi';

const NONE: Announcement[] = [];

export function PendingAnnouncements({ spaced }: { spaced?: boolean }) {
  const { data, reload } = useApi<Announcement[]>('/api/announcements?pending=1', ['announcements']);
  const toast = useToast();
  const [busy, setBusy] = useState<number | null>(null);
  // confirmed here: when it is gone from the pending ones, it goes confirmed
  const acked = useRef(new Set<number>());
  const leaving = useLeaving(data ?? NONE, (a) => a.id, (id, last) => acked.current.has(id) && { ...last, ackedAt: new Date().toISOString() });
  if (!leaving.rows.length) return null;
  const ack = async (a: Announcement) => {
    setBusy(a.id);
    haptic('success');
    try {
      await api.post(`/api/announcements/${a.id}/read`, { ack: true });
      acked.current.add(a.id);
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
      {leaving.rows.map((a) => (
        <div key={a.id} className={leaveClass(leaving.phaseOf(a.id))}>
          <div className={`card announce-pin ${a.urgent ? 't-red' : 't-blue'}`} role="status">
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
            {a.ackedAt ? (
              <span className="announce-acked just-cleared">
                <CheckMark size={18} /> אישרת
              </span>
            ) : (
              <button className="btn btn-primary btn-sm" disabled={busy === a.id} onClick={() => void ack(a)}>
                <Icon name="check" /> קראתי
              </button>
            )}
          </div>
        </div>
      ))}
    </section>
  );
}
