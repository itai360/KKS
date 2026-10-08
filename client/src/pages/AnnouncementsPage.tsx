// Announcements to the staff: the commander writes one (with or without "confirm reading",
// urgent or not); everyone sees it pinned until they confirm; the commander sees who has
// and who has not, and reminds the rest in one click.

import { useEffect, useRef, useState } from 'react';
import type { Announcement } from '@shared/types';
import { CheckMark } from '../components/CheckMark';
import { ask } from '../components/Confirm';
import { Icon } from '../components/Icon';
import { useToast } from '../components/Toasts';
import { Empty, ErrorBox, Field, Loading, PageHead } from '../components/ui';
import { api } from '../lib/api';
import { fmtAgo, fmtDateTime } from '../lib/format';
import { useFresh } from '../lib/fresh';
import { haptic } from '../lib/haptics';
import { emitLocalChange } from '../lib/realtime';
import { useSession } from '../lib/session';
import { useApi } from '../lib/useApi';

export function AnnouncementsPage() {
  const { isCommander } = useSession();
  const { data, error, loading, setData } = useApi<Announcement[]>('/api/announcements', ['announcements']);
  const toast = useToast();
  const seen = useRef(new Set<number>());
  // one written here (or by the commander, while this is open) comes in at the top
  const fresh = useFresh(data?.map((a) => a.id));

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
              fresh={fresh(a.id)}
              onAck={() => run(() => api.post<Announcement[]>(`/api/announcements/${a.id}/read`, { ack: true }))}
              onRemind={async () => {
                try {
                  const r = await api.post<{ reminded: number }>(`/api/announcements/${a.id}/remind`);
                  toast({ title: r.reminded ? `נשלחה תזכורת ל-${r.reminded}` : 'כולם כבר אישרו', tone: 'green' });
                  return true;
                } catch (e) {
                  toast({ title: (e as Error).message, tone: 'red' });
                  return false;
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
      className={`card card-pad col gap-12 mb-12 announce-composer${urgent ? ' is-urgent' : ''}`}
      onSubmit={async (e) => {
        e.preventDefault();
        if (busy || !title.trim()) return;
        setBusy(true);
        if (await onPost({ title, body, requireAck, urgent })) {
          haptic('success');
          setTitle('');
          setBody('');
          setUrgent(false);
          setOpen(false);
        }
        setBusy(false);
      }}
      // Ctrl+Enter (⌘+Enter) sends from the text too, as in a chat
      onKeyDown={(e) => {
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
          e.preventDefault();
          e.currentTarget.requestSubmit();
        }
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
        <button className="btn btn-primary" disabled={busy || !title.trim()} aria-keyshortcuts="Control+Enter">
          <Icon name="check" /> {busy ? 'שולח...' : urgent ? 'שליחה דחופה לכל הסגל' : 'שליחה לכל הסגל'}
        </button>
        <span className="tiny muted hide-mobile announce-hint">Ctrl+Enter</span>
        <button type="button" className="btn btn-ghost" onClick={() => setOpen(false)}>
          ביטול
        </button>
      </div>
    </form>
  );
}

function AnnouncementCard({ a, fresh, onAck, onRemind, onDelete }: { a: Announcement; fresh?: boolean; onAck: () => Promise<boolean>; onRemind: () => Promise<boolean>; onDelete: () => void }) {
  const acked = a.audience?.filter((x) => x.ackedAt) ?? [];
  const waiting = a.audience?.filter((x) => !x.ackedAt) ?? [];
  // "קראתי" answers at once: the confirmation shows, with a buzz; if the server says no, the button is back
  const [confirming, setConfirming] = useState(false);
  const [justAcked, setJustAcked] = useState(false);
  const ack = async () => {
    setConfirming(true);
    haptic('success');
    if (await onAck()) setJustAcked(true);
    setConfirming(false);
  };
  // a reminder just sent: the button says so for a moment, and cannot send it twice
  const [reminded, setReminded] = useState(false);
  useEffect(() => {
    if (!reminded) return;
    const t = setTimeout(() => setReminded(false), 6000);
    return () => clearTimeout(t);
  }, [reminded]);
  const remind = async () => {
    setReminded(true);
    if (!(await onRemind())) setReminded(false);
  };
  const total = a.audience?.length ?? 0;
  const confirmed = !!a.ackedAt || confirming;
  return (
    <article className={`card announce ${a.urgent ? 't-red' : 't-blue'}${fresh ? ' is-arrived' : ''}${a.requireAck && !a.audience && !confirmed ? ' is-waiting' : ''}`}>
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
                  אישרו {acked.length}/{total}
                </span>
                <span className="mini-bar announce-bar" aria-hidden="true">
                  <i style={{ width: `${total ? (acked.length / total) * 100 : 0}%` }} />
                </span>
                {waiting.length > 0 && (
                  <button className={`btn btn-sm${reminded ? ' is-sent' : ''}`} onClick={() => void remind()} disabled={reminded}>
                    <Icon name={reminded ? 'check' : 'bell'} /> {reminded ? 'התזכורת נשלחה' : 'תזכורת למי שלא אישר'}
                  </button>
                )}
                <span className="grow" />
                <button className="icon-btn" aria-label="מחיקת ההודעה" onClick={onDelete}>
                  <Icon name="trash" size={15} />
                </button>
              </div>
              {waiting.length > 0 && (
                <div className="row wrap gap-4 announce-waiting" aria-label="ממתינים לאישור">
                  <span className="tiny muted">ממתינים:</span>
                  {waiting.map((w) => (
                    <span key={w.userId} className="chip chip-sm" title={w.readAt ? `ראה ב-${fmtDateTime(w.readAt)}, עוד לא אישר` : 'עוד לא ראה'}>
                      {w.readAt && <Icon name="eye" size={12} />}
                      {w.name}
                      {w.readAt && <span className="sr-only"> (ראה)</span>}
                    </span>
                  ))}
                </div>
              )}
            </div>
          )
        ) : a.requireAck ? (
          confirmed ? (
            <span className={`announce-acked${justAcked || confirming ? ' just-cleared' : ''}`} role="status">
              <CheckMark size={18} /> אישרת קריאה
            </span>
          ) : (
            <button className="btn btn-primary btn-sm" onClick={() => void ack()} style={{ alignSelf: 'flex-start' }}>
              <Icon name="check" /> קראתי
            </button>
          )
        ) : null}
      </div>
    </article>
  );
}
