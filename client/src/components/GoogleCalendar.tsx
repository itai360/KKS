// The schedule and Google Calendar, both ways (see server/src/calendar.ts).

import { useState } from 'react';
import type { CalendarFeed, CalendarSource } from '@shared/types';
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
