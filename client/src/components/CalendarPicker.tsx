// The calendar an event goes in, as Google Calendar's own choice under an event: the course's calendar (and
// with it the course's calendar in Google, once the commander chose one), one's own, or any Google calendar
// of one's connected account. The Google calendars added here by their address ("יומנים נוספים") are offered
// too, by their names: once one's account is connected and may edit one, it is chosen like any other; before
// that, choosing it says what is missing - connecting one's account (Google's sign-in, back here), or the
// server's connection to Google not set up yet. Connected, a calendar one may only read says how to get leave
// to edit it (or to connect another account), and a list Google would not give says why, and what fixes it.

import { useNavigate } from 'react-router';
import type { CalendarSource, GoogleCalendarStatus } from '@shared/types';
import { connectGoogleCalendar, rememberPick, type CalendarPick } from '../lib/googleWrite';
import { emitLocalChange } from '../lib/realtime';
import { useApi } from '../lib/useApi';
import { ask } from './Confirm';
import { Select } from './ui';

const CONNECT = '__connect';
const LINKED = 'link:';
const READ_ONLY = 'ro:';
const UNLISTED = 'err:';

export function CalendarPicker({
  value,
  onChange,
  status,
  className = 'select',
  unsaved = false,
}: {
  value: CalendarPick;
  onChange: (p: CalendarPick) => void;
  status: GoogleCalendarStatus | undefined;
  className?: string;
  /** leaving for Google's sign-in would lose what was typed here: said before going */
  unsaved?: boolean;
}) {
  const navigate = useNavigate();
  const sources = useApi<CalendarSource[]>('/api/calendar/sources', ['events']).data ?? [];
  const course = status?.course ?? null;
  const google = (status?.calendars ?? []).filter((c) => c.id !== course?.calendarId);
  const writable = new Set((status?.calendars ?? []).map((c) => c.id));
  // the Google calendars added here by their address, each once
  const linked = sources.filter((s, i) => s.googleId && sources.findIndex((o) => o.googleId === s.googleId) === i) as (CalendarSource & { googleId: string })[];
  // connected, and Google gave no list of one's calendars (it said why): none of them can be told apart yet
  const unlisted = status?.connected && status.error && !status.calendars.length ? linked : [];
  // connected: the added ones one may not edit (the rest are in the list already); not connected: all of them
  const readOnly = status?.connected && !unlisted.length ? linked.filter((s) => !writable.has(s.googleId) && s.googleId !== course?.calendarId) : [];
  const toConnect = status?.connected ? [] : linked;
  const byId = (v: string, prefix: string) => linked.find((s) => String(s.id) === v.slice(prefix.length));
  // an event's Google calendar that is not in one's own list (another's account): still shown as it is
  const chosen = value.startsWith('g:') ? value.slice(2) : null;
  const foreign = chosen && !google.some((c) => c.id === chosen) && chosen !== course?.calendarId;

  /** what writing into a Google calendar needs, said - and, when it is only one's sign-in, done */
  const connect = async (target?: CalendarSource & { googleId: string }) => {
    const name = target ? target.calendarName || target.name : null;
    if (!status?.available) {
      const go = await ask({
        title: 'החיבור ל-Google עוד לא הוגדר',
        body: `כדי שאירועים ייכנסו ${name ? `ל"${name}"` : 'ליומני Google'}, צריך להגדיר פעם אחת בשרת את החיבור ל-Google. מה בדיוק צריך - בהגדרות יומן, תחת Google Calendar.`,
        confirm: 'להגדרות יומן',
        cancel: 'סגירה',
      });
      if (go) navigate('/?settings=calendar');
      return;
    }
    const ok = await ask({
      title: name ? `להוסיף אירועים ל"${name}"?` : 'חיבור Google Calendar',
      body: [
        name
          ? 'מחברים פעם אחת את חשבון Google שלך - חשבון שמותר לו לערוך את היומן הזה - ומאז בוחרים אותו כאן, וכל אירוע נכנס אליו ומתעדכן בו.'
          : 'מחברים פעם אחת את חשבון Google שלך, ומאז בוחרים כאן כל יומן Google שמותר לך לערוך.',
        unsaved ? 'מה שנכתב כאן ולא נשמר לא יישמר.' : '',
      ]
        .filter(Boolean)
        .join(' '),
      confirm: 'חיבור Google',
    });
    if (!ok) return;
    // the next new event starts in that calendar, once the account may write to it
    if (target) rememberPick(`g:${target.googleId}`);
    await connectGoogleCalendar();
  };

  /** a calendar the connected account may only read: who can change that, or another account */
  const readOnlyInfo = async (target: CalendarSource & { googleId: string }) => {
    const name = target.calendarName || target.name;
    const other = await ask({
      title: `אין הרשאת עריכה ב"${name}"`,
      body: `החשבון ${status?.email || 'שחיברת'} יכול רק לקרוא את היומן הזה ב-Google. כדי להוסיף אליו אירועים: מי שמנהל את היומן ב-Google Calendar משתף אותו עם החשבון שלך בהרשאה "ביצוע שינויים באירועים" - ואחרי כמה דקות הוא מופיע כאן לבחירה. אפשר גם להתחבר עם חשבון Google אחר שיש לו הרשאה.${unsaved ? ' מה שנכתב כאן ולא נשמר לא יישמר.' : ''}`,
      confirm: 'חשבון Google אחר',
      cancel: 'סגירה',
    });
    if (!other) return;
    rememberPick(`g:${target.googleId}`);
    await connectGoogleCalendar();
  };

  /** Google would not list the account's calendars: what it said, and what fixes it */
  const unlistedInfo = async () => {
    const api = /API/.test(status?.error ?? '');
    const again = await ask({
      title: 'Google לא נתן את רשימת היומנים',
      body: `${status?.error ?? ''}${api ? '. אחרי ההפעלה היומנים שמותר לך לערוך יופיעו כאן לבחירה.' : '. אם זה נמשך - מתחברים שוב.'}`,
      confirm: api ? 'לבדוק שוב' : 'התחברות מחדש',
      cancel: 'סגירה',
    });
    if (!again) return;
    if (api) emitLocalChange('google');
    else await connectGoogleCalendar();
  };

  return (
    <Select
      className={className}
      value={value}
      onChange={(e) => {
        const v = e.target.value;
        if (v === CONNECT) return void connect();
        if (v.startsWith(LINKED)) return void connect(byId(v, LINKED));
        if (v.startsWith(READ_ONLY)) {
          const t = byId(v, READ_ONLY);
          return void (t && readOnlyInfo(t));
        }
        if (v.startsWith(UNLISTED)) return void unlistedInfo();
        onChange(v as CalendarPick);
      }}
      aria-label="יומן"
    >
      <option value="course" data-shown={course ? `יומן הקורס · Google` : 'יומן הקורס'}>
        {course ? `יומן הקורס (גם ב-Google: ${course.name})` : 'יומן הקורס'}
      </option>
      <option value="personal">היומן שלי</option>
      {google.length > 0 && (
        <optgroup label={status?.email ? `יומני Google · ${status.email}` : 'יומני Google'}>
          {google.map((c) => (
            <option key={c.id} value={`g:${c.id}`} data-shown={`${c.summary} · Google`}>
              {c.primary ? `${c.summary} (היומן הראשי)` : c.summary}
            </option>
          ))}
        </optgroup>
      )}
      {foreign && <option value={value}>יומן Google של מישהו אחר</option>}
      {!status && <option value="__loading" disabled>יומני Google - טוען...</option>}
      {status && toConnect.length > 0 && (
        <optgroup label={status.available ? 'יומני Google - צריך לחבר חשבון פעם אחת' : 'יומני Google - החיבור עוד לא הוגדר'}>
          {toConnect.map((s) => (
            <option key={s.id} value={`${LINKED}${s.id}`}>
              {s.calendarName || s.name}
            </option>
          ))}
        </optgroup>
      )}
      {unlisted.length > 0 && (
        <optgroup label="יומני Google - Google לא נתן את הרשימה">
          {unlisted.map((s) => (
            <option key={s.id} value={`${UNLISTED}${s.id}`}>
              {s.calendarName || s.name}
            </option>
          ))}
        </optgroup>
      )}
      {readOnly.length > 0 && (
        <optgroup label="לקריאה בלבד - אין לך הרשאת עריכה ב-Google">
          {readOnly.map((s) => (
            <option key={s.id} value={`${READ_ONLY}${s.id}`}>
              {s.calendarName || s.name}
            </option>
          ))}
        </optgroup>
      )}
      {status && !status.connected && (
        <option value={CONNECT}>{status.available && status.reconnect ? 'התחברות מחדש ל-Google Calendar…' : toConnect.length ? 'יומן Google אחר…' : 'יומן Google…'}</option>
      )}
    </Select>
  );
}
