// Visitors' entry to the base (אישור כניסה). The commander sees the requests still to send on - each with its
// message in the base's format, to send in WhatsApp or copy, then marked sent - and the sent ones folded
// under them; anyone else sees their own requests and where each stands, and copies their message too. The
// base's format pasted anywhere on the screen (Ctrl+V, or "הדבקת פורמט") opens the request filled from it.

import { useEffect, useMemo, useState } from 'react';
import { entryMessage, VISITOR_KIND_LABELS, type EntryPlace } from '@shared/entry';
import type { EntryRequest } from '@shared/types';
import { ask } from '../components/Confirm';
import { DoneDrawer } from '../components/DoneDrawer';
import { addEntry, pasteEntry, readEntryPaste } from '../components/EntryAdd';
import { Icon } from '../components/Icon';
import { useToast } from '../components/Toasts';
import { Empty, ErrorBox, Field, Loading, PageHead } from '../components/ui';
import { api } from '../lib/api';
import { copyText } from '../lib/clipboard';
import { leaveClass, useLeaving } from '../lib/leaving';
import { emitLocalChange } from '../lib/realtime';
import { useSession } from '../lib/session';
import { useApi } from '../lib/useApi';

export function EntriesPage() {
  const { isCommander, settings } = useSession();
  const { data, error, loading } = useApi<EntryRequest[]>('/api/entries', ['entries']);
  // the same lists until the data changes: the fold below follows them
  const { pending, sent } = useMemo(() => ({ pending: (data ?? []).filter((e) => e.status === 'pending'), sent: (data ?? []).filter((e) => e.status === 'sent') }), [data]);
  // marked sent while on screen: a moment ticked, then it folds into "נשלחו"
  const leaving = useLeaving(pending, (e) => e.id, (id) => sent.find((e) => e.id === id));
  const place: EntryPlace = { camp: settings.entryCamp ?? '', unit: settings.entryUnit ?? '' };

  // opened from a notification: to its request
  useEffect(() => {
    if (!data || !location.hash.startsWith('#entry-')) return;
    document.getElementById(location.hash.slice(1))?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [data]);

  // the base's format pasted on the screen itself (not into a field, not with a dialog open): the request, filled
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t?.closest('input, textarea, [contenteditable="true"], .modal, [role="dialog"]')) return;
      const text = e.clipboardData?.getData('text') ?? '';
      if (!text.includes('\n') || !readEntryPaste(text, place).length) return;
      e.preventDefault();
      pasteEntry(text);
    };
    document.addEventListener('paste', onPaste);
    return () => document.removeEventListener('paste', onPaste);
  }, [place.camp, place.unit]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="page narrow">
      <PageHead
        title="אישורי כניסה"
        sub={isCommander ? 'מבקרים שמגיעים לבסיס: כל בקשה מגיעה אליך עם ההודעה מוכנה לשליחה.' : 'מבקר שמגיע לבסיס? ממלאים כאן, והבקשה מגיעה למפקד הקורס.'}
        actions={
          <>
            <button className="btn" onClick={() => pasteEntry()} title="מדביקים את הפורמט כמו שהגיע בוואטסאפ, והבקשה מתמלאת לבד">
              <Icon name="clipboard" /> הדבקת פורמט
            </button>
            <button className="btn btn-primary" onClick={() => addEntry()}>
              <Icon name="plus" /> בקשה חדשה
            </button>
          </>
        }
      />
      <ErrorBox error={error} />
      {loading && !data ? (
        <Loading rows={3} />
      ) : (
        <div className="col gap-16 fade-in">
          {isCommander && <PlaceCard place={place} />}
          <section className="card">
            <div className="card-head">
              <Icon name="stamp" />
              <h3 className="grow">{isCommander ? 'ממתינים לשליחה' : 'הבקשות שלי'}</h3>
              <span className="mono tiny muted">{pending.length}</span>
            </div>
            {!leaving.rows.length ? (
              <Empty icon="stamp" title={isCommander ? 'אין בקשות שממתינות' : 'אין בקשות שממתינות למפקד'} text={sent.length ? undefined : 'קיבלתם פורמט בוואטסאפ? מדביקים אותו כאן כמו שהוא. בקשה חדשה נפתחת גם מה-"+".'} />
            ) : (
              leaving.rows.map((e) => (
                <div key={e.id} className={leaveClass(leaving.phaseOf(e.id))}>
                  <EntryCard e={e} place={place} />
                </div>
              ))
            )}
            {sent.length > 0 && (
              <div className="card-body">
                <DoneDrawer id="entries-sent" count={sent.length} label="נשלחו לבסיס">
                  {sent.map((e) => (
                    <EntryCard key={e.id} e={e} place={place} />
                  ))}
                </DoneDrawer>
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  );
}

/** one request: who, when and why; for the commander its message, to send and to mark */
function EntryCard({ e, place }: { e: EntryRequest; place: EntryPlace }) {
  const { isCommander } = useSession();
  const toast = useToast();
  const [showMsg, setShowMsg] = useState(false);
  const [busy, setBusy] = useState(false);
  const msg = entryMessage(e, place);
  const wa = `https://wa.me/?text=${encodeURIComponent(msg)}`;
  const isSent = e.status === 'sent';

  const copy = async () => {
    if (await copyText(msg)) {
      toast({ title: 'הפורמט הועתק', body: e.fullName, tone: 'green' });
      return;
    }
    setShowMsg(true);
    toast({ title: 'לא הצלחנו להעתיק', body: 'ההודעה פתוחה למטה - אפשר לסמן ולהעתיק', tone: 'gray' });
  };
  const mark = async (sent: boolean) => {
    setBusy(true);
    try {
      await api.post(`/api/entries/${e.id}/sent`, { sent });
      emitLocalChange('entries');
      if (sent) toast({ title: 'סומן כנשלח לבסיס', body: e.createdByName && e.createdBy ? `${e.fullName} · עדכון נשלח ל${e.createdByName}` : e.fullName, tone: 'green' });
    } catch (err) {
      toast({ title: (err as Error).message, tone: 'red' });
    } finally {
      setBusy(false);
    }
  };
  const remove = async () => {
    if (!(await ask({ title: `למחוק את הבקשה של ${e.fullName}?`, confirm: 'מחיקה', danger: true }))) return;
    try {
      await api.del(`/api/entries/${e.id}`);
      emitLocalChange('entries');
      toast({ title: 'הבקשה נמחקה', body: e.fullName, tone: 'gray' });
    } catch (err) {
      toast({ title: (err as Error).message, tone: 'red' });
    }
  };

  return (
    <article id={`entry-${e.id}`} className={`entry-card${isSent ? ' is-sent' : ''}`}>
      <div className="entry-head">
        <div className="grow" style={{ minWidth: 0 }}>
          <div className="strong entry-name">{e.fullName}</div>
          <div className="small">{e.reason}</div>
          <div className="tiny muted">
            {VISITOR_KIND_LABELS[e.visitorKind]}
            {e.rank ? ` · ${e.rank}` : ''} · {e.escort ? 'דרוש ליווי' : 'בלי ליווי'} · {e.byCar ? `רכוב, רכב ${e.carMilitary ? 'צבאי' : 'אזרחי'} ${e.carNumber}` : 'רגלי'}
            {isCommander && e.createdByName ? ` · ביקש/ה: ${e.createdByName}` : ''}
          </div>
        </div>
        {!isCommander && <span className={`chip entry-state${isSent ? ' is-sent' : ''}`}>{isSent ? 'נשלח לבסיס' : 'ממתין למפקד'}</span>}
      </div>
      <div className="entry-actions">
        {isCommander && (
          <a className="btn btn-sm" href={wa} target="_blank" rel="noopener noreferrer">
            <Icon name="message" /> וואטסאפ
          </a>
        )}
        <button type="button" className={`btn btn-sm${isCommander ? '' : ' btn-primary'}`} onClick={() => void copy()}>
          <Icon name="copy" /> העתקת הפורמט
        </button>
        {isCommander &&
          (isSent ? (
            <button type="button" className="btn btn-sm btn-ghost" onClick={() => void mark(false)} disabled={busy}>
              ביטול "נשלח"
            </button>
          ) : (
            <button type="button" className="btn btn-sm btn-primary" onClick={() => void mark(true)} disabled={busy}>
              <Icon name="check" /> נשלח לבסיס
            </button>
          ))}
      </div>
      <div className="entry-foot">
        <button type="button" className="link-btn tiny" onClick={() => setShowMsg((v) => !v)} aria-expanded={showMsg}>
          {showMsg ? 'הסתרת ההודעה' : 'הצגת ההודעה'}
        </button>
        {e.canEdit && (
          <>
            <button type="button" className="link-btn tiny" onClick={() => addEntry(e)}>
              עריכה
            </button>
            <button type="button" className="link-btn tiny text-red" onClick={() => void remove()}>
              מחיקה
            </button>
          </>
        )}
      </div>
      {showMsg && <pre className="entry-msg">{msg}</pre>}
    </article>
  );
}

/** the camp in the message's title and the unit on its first line - the course's own, set once by the commander */
function PlaceCard({ place }: { place: EntryPlace }) {
  const toast = useToast();
  const missing = !place.camp.trim() || !place.unit.trim();
  const [open, setOpen] = useState(missing);
  const [camp, setCamp] = useState(place.camp);
  const [unit, setUnit] = useState(place.unit);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.patch('/api/settings', { entryCamp: camp.trim(), entryUnit: unit.trim() });
      emitLocalChange('settings', 'entries');
      toast({ title: 'פרטי ההודעה נשמרו', tone: 'green' });
      setOpen(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (!open)
    return (
      <div className="entry-place small">
        <Icon name="shield" size={15} />
        <span className="grow">
          פורמט אישור כניסה ל{place.camp} · יחידה: {place.unit}
        </span>
        <button type="button" className="link-btn tiny" onClick={() => setOpen(true)}>
          שינוי
        </button>
      </div>
    );
  return (
    <section className="card">
      <div className="card-head">
        <Icon name="shield" />
        <h3 className="grow">פרטי ההודעה</h3>
      </div>
      <form
        className="card-body col gap-12"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <p className="small muted">פעם אחת: המחנה שמופיע בכותרת ההודעה ("פורמט אישור כניסה ל...") והיחידה שאליה המבקרים מגיעים.</p>
        <div className="form-grid">
          <Field label="המחנה" hint='כמו בכותרת, אחרי "ל"'>
            <input className="input" value={camp} onChange={(e) => setCamp(e.target.value)} maxLength={80} />
          </Field>
          <Field label="היחידה">
            <input className="input" value={unit} onChange={(e) => setUnit(e.target.value)} maxLength={80} />
          </Field>
        </div>
        <ErrorBox error={error} />
        <div className="row gap-8">
          <button className="btn btn-primary btn-sm" disabled={busy}>
            <Icon name="check" /> שמירה
          </button>
          {!missing && (
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setOpen(false)}>
              ביטול
            </button>
          )}
        </div>
      </form>
    </section>
  );
}
