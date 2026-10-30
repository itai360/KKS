// The calendar's own settings, as Google Calendar's (Settings): writing events into Google Calendar (my
// account, and for the commander the Google calendar every event of the course goes to), the reminder an
// event left as it is gives me - kept on the server, for me alone - and how the calendar looks on this
// device: what is over drawn paler, the weekend shown or not, and the events I said no to shown or not.

import { useEffect, useState } from 'react';
import type { GoogleCalendarStatus } from '@shared/types';
import { api } from '../lib/api';
import { setCalendarPrefs, useCalendarPrefs } from '../lib/calendarPrefs';
import { connectGoogleCalendar, useGoogleCalendar } from '../lib/googleWrite';
import { emitLocalChange } from '../lib/realtime';
import { ask } from './Confirm';
import { Icon } from './Icon';
import { useToast } from './Toasts';
import { Modal } from './ui';

/** the reminder an event left as it is gives me: Google's choices, from none to a day before */
const REMINDERS: [number | null, string][] = [
  [null, 'ללא התראה'],
  [0, 'בזמן האירוע'],
  [5, '5 דקות לפני'],
  [10, '10 דקות לפני'],
  [15, '15 דקות לפני'],
  [30, '30 דקות לפני'],
  [60, 'שעה לפני'],
  [120, 'שעתיים לפני'],
  [1440, 'יום לפני'],
];
const NONE = 'none';

export function CalendarSettings({ onClose }: { onClose: () => void }) {
  const prefs = useCalendarPrefs();
  const toast = useToast();
  // undefined: still being read
  const [reminder, setReminder] = useState<number | null | undefined>(undefined);
  useEffect(() => {
    let live = true;
    api
      .get<{ defaultReminder: number | null }>('/api/me/calendar')
      .then((r) => live && setReminder(r.defaultReminder))
      .catch(() => live && setReminder(30));
    return () => {
      live = false;
    };
  }, []);

  const save = async (v: number | null) => {
    const before = reminder;
    setReminder(v);
    try {
      await api.patch('/api/me/calendar', { defaultReminder: v });
      toast({ title: v === null ? 'בלי התראה לאירועים' : `התראה ${REMINDERS.find(([m]) => m === v)?.[1] ?? ''}`, body: 'לאירועים שלא נקבעה להם התראה משלהם', tone: 'green' });
    } catch (e) {
      setReminder(before);
      toast({ title: (e as Error).message, tone: 'red' });
    }
  };
  const known = reminder === undefined || REMINDERS.some(([m]) => m === reminder);

  return (
    <Modal
      title="הגדרות יומן"
      onClose={onClose}
      className="g-settings"
      footer={
        <button type="button" className="btn g-filled-btn" onClick={onClose} data-autofocus>
          סיום
        </button>
      }
    >
      <GoogleSection />
      <section className="g-set" aria-labelledby="g-set-alerts">
        <h3 id="g-set-alerts">התראות</h3>
        <label className="g-set-row">
          <span className="g-set-text">
            <b>התראה לאירוע</b>
            <small>לאירוע שלא נקבעה לו התראה משלו - לך בלבד. לאירוע של יום שלם אין התראה.</small>
          </span>
          <select
            className="g-set-select"
            value={reminder === undefined ? '' : reminder === null ? NONE : String(reminder)}
            disabled={reminder === undefined}
            onChange={(e) => void save(e.target.value === NONE ? null : Number(e.target.value))}
          >
            {reminder === undefined && <option value="">טוען...</option>}
            {!known && <option value={String(reminder)}>{`${reminder} דקות לפני`}</option>}
            {REMINDERS.map(([m, label]) => (
              <option key={String(m)} value={m === null ? NONE : String(m)}>
                {label}
              </option>
            ))}
          </select>
        </label>
      </section>
      <section className="g-set" aria-labelledby="g-set-view">
        <h3 id="g-set-view">תצוגה במכשיר הזה</h3>
        <label className="g-set-row">
          <span className="g-set-text">
            <b>אירועי עבר בהירים יותר</b>
            <small>מה שכבר עבר מצויר בהיר, כך שמה שבא אחריו בולט</small>
          </span>
          <span className="switch">
            <input type="checkbox" role="switch" checked={prefs.dimPast} onChange={(e) => setCalendarPrefs({ dimPast: e.target.checked })} />
            <span className="switch-track" aria-hidden="true" />
          </span>
        </label>
        <label className="g-set-row">
          <span className="g-set-text">
            <b>הצגת סופי שבוע</b>
            <small>שישי ושבת בתצוגת השבוע והחודש. כבוי - ראשון עד חמישי, עמודות רחבות יותר</small>
          </span>
          <span className="switch">
            <input type="checkbox" role="switch" checked={prefs.showWeekend} onChange={(e) => setCalendarPrefs({ showWeekend: e.target.checked })} />
            <span className="switch-track" aria-hidden="true" />
          </span>
        </label>
        <label className="g-set-row">
          <span className="g-set-text">
            <b>הצגת אירועים שדחיתי</b>
            <small>מוזמנים שאמרת שלא תגיע/י אליהם - בקו חוצה</small>
          </span>
          <span className="switch">
            <input type="checkbox" role="switch" checked={prefs.showDeclined} onChange={(e) => setCalendarPrefs({ showDeclined: e.target.checked })} />
            <span className="switch-track" aria-hidden="true" />
          </span>
        </label>
      </section>
    </Modal>
  );
}

/**
 * Writing into Google Calendar: my account (connected by Google's own sign-in, or let go), the course's
 * calendar in Google (the commander's choice - every event of the course's calendar from today on), and
 * what still waits to be written.
 */
function GoogleSection() {
  const toast = useToast();
  const g = useGoogleCalendar();
  const s = g.data;
  const [busy, setBusy] = useState(false);
  if (!s) return null;
  const run = async (what: () => Promise<GoogleCalendarStatus | void>, done?: string) => {
    setBusy(true);
    try {
      const next = await what();
      if (next) g.setData(next);
      emitLocalChange('events', 'google');
      if (done) toast({ title: done, tone: 'green' });
    } catch (e) {
      toast({ title: (e as Error).message, tone: 'red' });
    } finally {
      setBusy(false);
    }
  };
  const connect = () => run(() => connectGoogleCalendar('/?settings=calendar'));
  const disconnect = async () => {
    if (!(await ask({ title: 'לנתק את Google Calendar?', body: 'אירועים שכבר נכתבו ל-Google יישארו שם. שינויים מעכשיו לא יגיעו אליהם עד שתתחבר שוב.', confirm: 'ניתוק', danger: true }))) return;
    await run(() => api.del<GoogleCalendarStatus>('/api/google/calendar'), 'החשבון נותק מ-Google');
  };
  const setCourse = (calendarId: string | null) =>
    run(() => api.put<GoogleCalendarStatus>('/api/google/calendar/course', { calendarId }), calendarId ? 'אירועי יומן הקורס ייכנסו ל-Google' : 'אירועי יומן הקורס לא ייכנסו עוד ל-Google');
  const syncNow = () => run(async () => (await api.post<{ status: GoogleCalendarStatus }>('/api/google/calendar/sync')).status);

  return (
    <section className="g-set" aria-labelledby="g-set-google">
      <h3 id="g-set-google">Google Calendar</h3>
      {!s.available ? (
        <div className="g-set-note">
          <p>כדי להוסיף אירועים ליומני Google צריך להגדיר פעם אחת את החיבור ל-Google. עד אז היומנים שחוברו בכתובת שלהם ("יומנים נוספים") מוצגים כאן לקריאה בלבד.</p>
          <ol>
            <li>ב-Google Cloud Console, בפרויקט של האתר: להפעיל את Google Calendar API, ובמסך ההסכמה (OAuth consent screen) להוסיף את ההרשאות calendar.events ו-calendar.calendarlist.readonly.</li>
            <li>ב-Vercel, בהגדרות הפרויקט: להגדיר את GOOGLE_CLIENT_ID ו-GOOGLE_CLIENT_SECRET (אותו לקוח של השמירה ב-Drive), ולפרוס מחדש.</li>
            <li>כאן: "חיבור" - וכל אחד בסגל מחבר את החשבון שלו.</li>
          </ol>
        </div>
      ) : s.connected ? (
        <div className="g-set-row">
          <span className="g-set-text">
            <b>
              <Icon name="cloud" size={16} /> מחובר כ-{s.email || 'חשבון Google'}
            </b>
            <small>באירוע חדש בוחרים באיזה יומן Google הוא יהיה, וכל שינוי בו מתעדכן שם.</small>
            {s.error && <small className="text-red">{s.error}</small>}
          </span>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => void disconnect()} disabled={busy}>
            ניתוק
          </button>
        </div>
      ) : (
        <div className="g-set-row">
          <span className="g-set-text">
            <b>{s.reconnect ? 'צריך להתחבר שוב ל-Google' : 'כתיבה לתוך Google Calendar'}</b>
            <small>{s.reconnect ? 'ההרשאה בוטלה ב-Google. אחרי התחברות האירועים שחיכו ייכנסו.' : 'מתחברים פעם אחת, ואז כל אירוע שמוסיפים כאן נכנס גם ליומן Google שבוחרים - ומתעדכן שם כשמשנים או מוחקים אותו.'}</small>
          </span>
          <button type="button" className="btn btn-primary btn-sm" onClick={() => void connect()} disabled={busy}>
            {s.reconnect ? 'התחברות מחדש' : 'חיבור'}
          </button>
        </div>
      )}
      {s.available && s.canSetCourse && (
        <label className="g-set-row">
          <span className="g-set-text">
            <b>אירועי יומן הקורס ב-Google</b>
            <small>
              {s.course
                ? `כל אירוע ביומן הקורס, מכל הסגל, נכנס גם ל"${s.course.name}"${s.course.mine ? '' : ` (דרך החשבון של ${s.course.ownerName})`}.`
                : 'בוחרים יומן Google, וכל אירוע ביומן הקורס - מהיום והלאה, מכל אחד בסגל - ייכנס אליו ויתעדכן בו.'}
            </small>
          </span>
          <select className="g-set-select" value={s.course?.calendarId ?? ''} disabled={busy || (!s.connected && !s.course)} onChange={(e) => void setCourse(e.target.value || null)}>
            <option value="">{s.connected ? 'לא נכנסים ל-Google' : 'קודם מתחברים'}</option>
            {s.course && !s.calendars.some((c) => c.id === s.course!.calendarId) && <option value={s.course.calendarId}>{s.course.name}</option>}
            {s.calendars.map((c) => (
              <option key={c.id} value={c.id}>
                {c.summary}
              </option>
            ))}
          </select>
        </label>
      )}
      {s.available && (s.pending > 0 || s.failed > 0) && (
        <div className="g-set-row">
          <span className="g-set-text">
            <b>{s.pending > 0 ? `${s.pending} אירועים ממתינים להיכנס ל-Google` : `${s.failed} אירועים לא נכנסו ל-Google`}</b>
            <small>{s.failed > 0 && s.pending > 0 ? `ועוד ${s.failed} שלא נכנסו - ננסה שוב.` : 'הם נכנסים לבד; אפשר גם עכשיו.'}</small>
          </span>
          <button type="button" className="btn btn-sm" onClick={() => void syncNow()} disabled={busy}>
            {busy ? 'שולח...' : 'עכשיו'}
          </button>
        </div>
      )}
    </section>
  );
}
