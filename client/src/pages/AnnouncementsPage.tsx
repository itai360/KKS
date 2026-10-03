// Announcements to the staff: the commander writes one (with or without "confirm reading",
// urgent or not); everyone sees it pinned until they confirm; the commander sees who has
// and who has not, and reminds the rest in one click.

import { useEffect, useRef, useState } from 'react';
import type { Announcement } from '@shared/types';
import { ask } from '../components/Confirm';
import { Icon } from '../components/Icon';
import { useToast } from '../components/Toasts';
import { Empty, ErrorBox, Field, Loading, PageHead } from '../components/ui';
import { api } from '../lib/api';
import { fmtAgo, fmtDateTime } from '../lib/format';
import { emitLocalChange } from '../lib/realtime';
import { useSession } from '../lib/session';
import { useApi } from '../lib/useApi';

export function AnnouncementsPage() {
  const { isCommander } = useSession();
  const { data, error, loading, setData } = useApi<Announcement[]>('/api/announcements', ['announcements']);
  const toast = useToast();
  const seen = useRef(new Set<number>());

  // on screen counts as read (not as confirmed)
  useEffect(() => {
    for (const a of data ?? []) {
      if (a.readAt || seen.current.has(a.id) || a.audience) continue;
      seen.current.add(a.id);
      void api.post(`/api/announcements/${a.id}/read`, {}).catch(() => seen.current.delete(a.id));
    }
  }, [data]);

  const run = async (fn: () => Promise<Announcement[]>, ok?: string) => {
    try {
      setData(await fn());
      emitLocalChange('announcements');
      if (ok) toast({ title: ok, tone: 'green' });
      return true;
    } catch (e) {
      toast({ title: (e as Error).message, tone: 'red' });
      return false;
    }
  };

  return (
    <div className="page narrow">
      <PageHead title="הודעות לסגל" sub={isCommander ? 'הודעה לכל הסגל - ומי אישר שקרא.' : 'הודעות ממפקד הקורס. "קראתי" מאשר שראית.'} />
      {isCommander && <Composer onPost={(body) => run(() => api.post<Announcement[]>('/api/announcements', body), 'ההודעה נשלחה לכל הסגל')} />}
      <ErrorBox error={error} />
      {loading && !data ? (
        <Loading rows={3} />
      ) : !data?.length ? (
        <Empty icon="flag" title="אין הודעות" text={isCommander ? 'הודעה שתכתבו כאן תגיע לכולם, ותישאר בראש המסך שלהם עד שיאשרו שקראו.' : 'הודעות ממפקד הקורס יופיעו כאן.'} />
      ) : (
        <div className="col gap-12">
          {data.map((a) => (
            <AnnouncementCard
              key={a.id}
              a={a}
              onAck={() => run(() => api.post<Announcement[]>(`/api/announcements/${a.id}/read`, { ack: true }))}
              onRemind={async () => {
                try {
                  const r = await api.post<{ reminded: number }>(`/api/announcements/${a.id}/remind`);
                  toast({ title: r.reminded ? `נשלחה תזכורת ל-${r.reminded}` : 'כולם כבר אישרו', tone: 'green' });
                } catch (e) {
                  toast({ title: (e as Error).message, tone: 'red' });
                }
              }}
              onDelete={async () => (await ask({ title: 'למחוק את ההודעה?', body: a.title, confirm: 'מחיקה', danger: true })) && void run(() => api.del<Announcement[]>(`/api/announcements/${a.id}`))}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function Composer({ onPost }: { onPost: (body: object) => Promise<boolean> }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [requireAck, setRequireAck] = useState(true);
  const [urgent, setUrgent] = useState(false);
  const [busy, setBusy] = useState(false);
  if (!open)
    return (
      <button className="btn btn-primary mb-12" onClick={() => setOpen(true)}>
        <Icon name="plus" /> הודעה חדשה לסגל
      </button>
    );
  return (
    <form
      className="card card-pad col gap-12 mb-12"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        if (await onPost({ title, body, requireAck, urgent })) {
          setTitle('');
          setBody('');
          setUrgent(false);
          setOpen(false);
        }
        setBusy(false);
      }}
    >
      <Field label="כותרת" required>
        <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={160} placeholder='לדוגמה: מסדר מפקד ביום חמישי ב-07:00' data-autofocus autoFocus />
      </Field>
      <Field label="פירוט">
        <textarea className="textarea" value={body} onChange={(e) => setBody(e.target.value)} maxLength={5000} />
      </Field>
      <label className="row gap-6 small">
        <input type="checkbox" checked={requireAck} onChange={(e) => setRequireAck(e.target.checked)} /> דורש אישור קריאה ("קראתי") - נשאר בראש המסך עד שמאשרים
      </label>
      <label className="row gap-6 small">
        <input type="checkbox" checked={urgent} onChange={(e) => setUrgent(e.target.checked)} /> דחוף
      </label>
      <div className="row gap-6">
        <button className="btn btn-primary" disabled={busy || !title.trim()}>
          <Icon name="check" /> שליחה לכל הסגל
        </button>
        <button type="button" className="btn btn-ghost" onClick={() => setOpen(false)}>
          ביטול
        </button>
      </div>
    </form>
  );
}

function AnnouncementCard({ a, onAck, onRemind, onDelete }: { a: Announcement; onAck: () => void; onRemind: () => void; onDelete: () => void }) {
  const acked = a.audience?.filter((x) => x.ackedAt) ?? [];
  const waiting = a.audience?.filter((x) => !x.ackedAt) ?? [];
  return (
    <article className={`card announce ${a.urgent ? 't-red' : 't-blue'}`}>
      <div className="card-head">
        <Icon name={a.urgent ? 'alert' : 'flag'} />
        <h2 className="grow">
          {a.urgent && <span className="badge t-red">דחוף</span>} {a.title}
        </h2>
        <span className="tiny muted" title={fmtDateTime(a.createdAt)}>
          {fmtAgo(a.createdAt)}
        </span>
      </div>
      <div className="card-body col gap-12">
        {a.body && <p className="prewrap">{a.body}</p>}
        <div className="tiny muted">{a.createdByName}</div>
        {a.audience ? (
          a.requireAck && (
            <div className="col gap-6">
              <div className="row wrap gap-6">
                <span className={`badge ${waiting.length ? 't-orange' : 't-green'}`}>
                  אישרו {acked.length}/{a.audience.length}
                </span>
                {waiting.length > 0 && (
                  <button className="btn btn-sm" onClick={onRemind}>
                    <Icon name="bell" /> תזכורת למי שלא אישר
                  </button>
                )}
                <span className="grow" />
                <button className="icon-btn" aria-label="מחיקת ההודעה" onClick={onDelete}>
                  <Icon name="trash" size={15} />
                </button>
              </div>
              {waiting.length > 0 && <div className="small">ממתינים: {waiting.map((w) => (w.readAt ? `${w.name} (ראה)` : w.name)).join(', ')}</div>}
            </div>
          )
        ) : a.requireAck ? (
          a.ackedAt ? (
            <span className="badge t-green">
              <Icon name="check" size={11} /> אישרת קריאה
            </span>
          ) : (
            <button className="btn btn-primary btn-sm" onClick={onAck} style={{ alignSelf: 'flex-start' }}>
              <Icon name="check" /> קראתי
            </button>
          )
        ) : null}
      </div>
    </article>
  );
}
