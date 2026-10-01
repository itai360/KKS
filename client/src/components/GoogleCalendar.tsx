// The schedule and Google Calendar, both ways (see server/src/calendar.ts).

import { useState } from 'react';
import { shortDate } from '@shared/dates';
import type { CalendarFeed, CalendarSource, CalendarWeeksPreview } from '@shared/types';
import { api } from '../lib/api';
import { emitLocalChange } from '../lib/realtime';
import { useSession } from '../lib/session';
import { useApi } from '../lib/useApi';
import { Icon } from './Icon';
import { useToast } from './Toasts';
import { ErrorBox, Field, Loading, Modal } from './ui';

export function GoogleCalendarModal({ onClose }: { onClose: () => void }) {
  return (
    <Modal
      title="סנכרון עם יומן Google"
      onClose={onClose}
      footer={
        <button className="btn btn-ghost" onClick={onClose}>
          סגירה
        </button>
      }
    >
      <div className="col gap-16">
        <MyFeed />
        <div className="divider" style={{ margin: 0 }} />
        <Sources />
      </div>
    </Modal>
  );
}

/** The schedule in the user's own Google Calendar. */
function MyFeed() {
  const toast = useToast();
  const feed = useApi<CalendarFeed>('/api/calendar/feed', []);
  const [error, setError] = useState<string | null>(null);

  const copy = async () => {
    if (!feed.data) return;
    try {
      await navigator.clipboard.writeText(feed.data.url);
      toast({ title: 'הקישור הועתק', tone: 'green' });
    } catch {
      setError('לא ניתן להעתיק אוטומטית - סמנו את הקישור והעתיקו אותו.');
    }
  };

  const rotate = async () => {
    if (!confirm('ליצור קישור חדש? הקישור הקודם יפסיק לעבוד, וצריך יהיה להוסיף את היומן מחדש ב-Google.')) return;
    try {
      feed.setData(await api.post<CalendarFeed>('/api/calendar/feed/rotate'));
      toast({ title: 'נוצר קישור חדש', tone: 'green' });
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <section className="col gap-6">
      <h3>הלו"ז ביומן Google שלך</h3>
      <div className="small muted">כל אירועי הלו"ז יופיעו ביומן Google שלך ויתעדכנו מעצמם. Google בודק שינויים כמה פעמים ביום, כך ששינוי חדש מופיע שם באיחור של עד כמה שעות. הכי נוח להוסיף מהמחשב, ומשם היומן מופיע גם באפליקציה בטלפון.</div>
      <ErrorBox error={error ?? feed.error} />
      {!feed.data ? (
        <Loading rows={1} />
      ) : (
        <>
          <div className="row wrap gap-6">
            <a className="btn btn-primary" href={feed.data.googleUrl} target="_blank" rel="noopener noreferrer" data-autofocus>
              <Icon name="calendar" /> הוספה ליומן Google
            </a>
            <button className="btn" onClick={() => void copy()}>
              <Icon name="link" /> העתקת הקישור
            </button>
          </div>
          <details className="small">
            <summary style={{ cursor: 'pointer' }}>לא נפתח? הוספה ידנית</summary>
            <div className="col gap-6 mt-12">
              <div>ב-Google Calendar במחשב: ליד "יומנים אחרים" לוחצים על + ובוחרים "מכתובת URL", ומדביקים את הקישור:</div>
              <input className="input mono" dir="ltr" readOnly value={feed.data.url} onFocus={(e) => e.currentTarget.select()} aria-label="קישור ליומן" />
              <div className="muted">אפשר להוסיף את אותו הקישור גם ליומן של אייפון או Outlook.</div>
            </div>
          </details>
          <div className="row wrap gap-6 tiny muted">
            <span className="grow">הקישור אישי: מי שמחזיק בו רואה את הלו"ז. אל תשתפו אותו.</span>
            <button className="btn btn-ghost btn-sm" onClick={() => void rotate()}>
              יצירת קישור חדש
            </button>
          </div>
        </>
      )}
    </section>
  );
}

/** Google calendars whose events appear in the schedule. */
function Sources() {
  const { isCommander } = useSession();
  const toast = useToast();
  const sources = useApi<CalendarSource[]>('/api/calendar/sources', ['events']);
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const add = async () => {
    setError(null);
    setBusy(true);
    try {
      sources.setData(await api.post<CalendarSource[]>('/api/calendar/sources', { name, url }));
      setName('');
      setUrl('');
      emitLocalChange('events');
      toast({ title: 'היומן חובר - האירועים שלו מופיעים בלו"ז', tone: 'green' });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (s: CalendarSource) => {
    if (!confirm(`להפסיק להציג את "${s.name}" בלו"ז?`)) return;
    try {
      sources.setData(await api.del<CalendarSource[]>(`/api/calendar/sources/${s.id}`));
      emitLocalChange('events');
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const list = sources.data ?? [];
  return (
    <section className="col gap-6">
      <h3>יומני Google בתוך הלו"ז</h3>
      <div className="small muted">אירועים מיומן Google מופיעים בלו"ז לכל הסגל, לקריאה בלבד, ומתעדכנים כל כמה דקות.</div>
      <ErrorBox error={error ?? sources.error} />
      {list.map((s) => (
        <div key={s.id} className="row gap-6">
          <Icon name="calendar" />
          <div className="grow" style={{ minWidth: 0 }}>
            <div className="strong">{s.name}</div>
            {s.error && <div className="small text-red">{s.error}</div>}
          </div>
          {isCommander && (
            <button className="btn btn-ghost btn-sm" onClick={() => void remove(s)}>
              הסרה
            </button>
          )}
        </div>
      ))}
      {!isCommander && list.length === 0 && <div className="small muted">עדיין לא חובר יומן. מפקד הקורס יכול לחבר אותו מכאן.</div>}
      {isCommander && (
        <div className="info-box col gap-6">
          <Field label="שם היומן">
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder='לדוגמה: יומן הגדוד' maxLength={60} />
          </Field>
          <Field
            label="הכתובת הסודית של היומן בפורמט iCal"
            hint={'ב-Google Calendar במחשב: ליד שם היומן ⋮ ← "הגדרות ושיתוף" ← "שילוב היומן" ← "כתובת סודית בפורמט iCal". ליומן ציבורי אפשר גם "כתובת ציבורית בפורמט iCal".'}
          >
            <input className="input mono" dir="ltr" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://calendar.google.com/calendar/ical/.../basic.ics" />
          </Field>
          <div>
            <button className="btn btn-primary btn-sm" disabled={busy || !url.trim()} onClick={() => void add()}>
              {busy ? 'בודק את היומן...' : 'חיבור היומן'}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

/** Course weeks from a Google calendar: preview what was found, then create / update the chosen weeks. */
export function CalendarWeeksModal({ onClose }: { onClose: () => void }) {
  const toast = useToast();
  const saved = useApi<{ url: string | null }>('/api/weeks/calendar', []);
  const [url, setUrl] = useState<string | null>(null);
  const [preview, setPreview] = useState<CalendarWeeksPreview | null>(null);
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [showInSchedule, setShowInSchedule] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const address = url ?? saved.data?.url ?? '';

  const check = async () => {
    setError(null);
    setBusy(true);
    try {
      const p = await api.post<CalendarWeeksPreview>('/api/weeks/calendar/preview', { url: address });
      setPreview(p);
      setChosen(new Set(p.weeks.filter((w) => w.action !== 'same').map((w) => w.uid)));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const apply = async () => {
    if (!preview) return;
    setError(null);
    setBusy(true);
    try {
      const items = preview.weeks.filter((w) => chosen.has(w.uid));
      await api.post('/api/weeks/calendar/apply', { url: address, items, showInSchedule });
      emitLocalChange('weeks', 'events');
      toast({ title: `השבועות עודכנו מהיומן (${items.length})`, tone: 'green' });
      onClose();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  const toggle = (uid: string) =>
    setChosen((prev) => {
      const next = new Set(prev);
      if (next.has(uid)) next.delete(uid);
      else next.add(uid);
      return next;
    });

  return (
    <Modal
      title="שבועות הקורס מיומן Google"
      onClose={onClose}
      wide
      footer={
        <>
          {preview && preview.weeks.length > 0 && (
            <button className="btn btn-primary" disabled={busy || chosen.size === 0} onClick={() => void apply()}>
              {busy ? 'מעדכן...' : `עדכון ${chosen.size} שבועות`}
            </button>
          )}
          <button className="btn btn-ghost" onClick={onClose}>
            ביטול
          </button>
        </>
      }
    >
      <div className="col gap-16">
        <div className="small muted">
          כל אירוע ביומן ששמו מתחיל ב"שבוע" הופך לשבוע בקורס. אירוע של יום אחד מסמן את השבוע שמתחיל בו. אם אין אירועים כאלה, נלקחים אירועים של 3 עד 14 ימים. לפני שמשהו
          משתנה תראו את הרשימה ותבחרו מה לעדכן. אפשר לחזור לכאן בכל פעם שהיומן משתנה.
        </div>
        <Field label="הכתובת הסודית של היומן בפורמט iCal" hint={'ב-Google Calendar במחשב: ליד שם היומן ⋮ ← "הגדרות ושיתוף" ← "שילוב היומן" ← "כתובת סודית בפורמט iCal".'}>
          <div className="row gap-6">
            <input
              className="input mono grow"
              dir="ltr"
              value={address}
              onChange={(e) => {
                setUrl(e.target.value);
                setPreview(null);
              }}
              placeholder="https://calendar.google.com/calendar/ical/.../basic.ics"
              data-autofocus
            />
            <button className="btn" disabled={busy || address.trim().length < 8} onClick={() => void check()}>
              {busy && !preview ? 'קורא את היומן...' : 'בדיקת היומן'}
            </button>
          </div>
        </Field>
        <ErrorBox error={error} />
        {preview &&
          (preview.weeks.length === 0 ? (
            <div className="info-box">לא נמצאו ביומן אירועים שנראים כמו שבועות ({preview.ignored} אירועים נבדקו). תנו לאירועי השבועות שם שמתחיל ב"שבוע", למשל "שבוע 1 - הכרות".</div>
          ) : (
            <div className="col gap-6">
              {preview.weeks.map((w) => (
                <label key={w.uid} className="row gap-6" style={{ cursor: w.action === 'same' ? 'default' : 'pointer', opacity: w.action === 'same' ? 0.6 : 1 }}>
                  <input type="checkbox" checked={chosen.has(w.uid)} disabled={w.action === 'same'} onChange={() => toggle(w.uid)} />
                  <div className="grow" style={{ minWidth: 0 }}>
                    <div className="strong">{w.name}</div>
                    <div className="tiny muted">
                      <span className="mono">
                        {shortDate(w.startDate)}-{shortDate(w.endDate)}
                      </span>
                      {w.changes.length > 0 && ` · ${w.changes.join(' · ')}`}
                    </div>
                  </div>
                  <span className={`badge ${w.action === 'create' ? 't-green' : w.action === 'update' ? 't-orange' : 't-gray'}`}>
                    {w.action === 'create' ? 'חדש' : w.action === 'update' ? 'עדכון' : 'ללא שינוי'}
                  </span>
                </label>
              ))}
              {preview.ignored > 0 && <div className="tiny muted">עוד {preview.ignored} אירועים ביומן לא נראים כמו שבועות ולא ייכנסו.</div>}
              <label className="row gap-6 small mt-12">
                <input type="checkbox" checked={showInSchedule} onChange={(e) => setShowInSchedule(e.target.checked)} />
                להציג את שאר אירועי היומן גם בלו"ז
              </label>
            </div>
          ))}
      </div>
    </Modal>
  );
}
