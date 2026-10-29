// The calendar's own settings, as Google Calendar's (Settings): the reminder an event left as it is gives
// me - kept on the server, for me alone - and how the calendar looks on this device: what is over drawn
// paler, the weekend shown or not, and the events I said no to shown (struck through) or not.

import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { setCalendarPrefs, useCalendarPrefs } from '../lib/calendarPrefs';
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
