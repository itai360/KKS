// The calendar an event goes in, as Google Calendar's own choice under an event: the course's calendar (and
// with it the course's calendar in Google, once the commander chose one), one's own, or any Google calendar
// of one's connected account. Not connected yet: the choice itself connects (Google's sign-in, back here).

import type { GoogleCalendarStatus } from '@shared/types';
import { connectGoogleCalendar, type CalendarPick } from '../lib/googleWrite';
import { Select } from './ui';

const CONNECT = '__connect';

export function CalendarPicker({
  value,
  onChange,
  status,
  className = 'select',
  beforeConnect,
}: {
  value: CalendarPick;
  onChange: (p: CalendarPick) => void;
  status: GoogleCalendarStatus | undefined;
  className?: string;
  /** asked before leaving for Google's sign-in (what was typed would be lost): false stays */
  beforeConnect?: () => boolean | Promise<boolean>;
}) {
  const course = status?.course ?? null;
  const google = (status?.calendars ?? []).filter((c) => c.id !== course?.calendarId);
  // an event's Google calendar that is not in one's own list (another's account): still shown as it is
  const chosen = value.startsWith('g:') ? value.slice(2) : null;
  const foreign = chosen && !google.some((c) => c.id === chosen) && chosen !== course?.calendarId;
  return (
    <Select
      className={className}
      value={value}
      onChange={(e) => {
        const v = e.target.value;
        if (v === CONNECT) {
          void (async () => {
            if (beforeConnect && !(await beforeConnect())) return;
            await connectGoogleCalendar();
          })();
          return;
        }
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
      {status?.available && !status.connected && <option value={CONNECT}>{status.reconnect ? 'התחברות מחדש ל-Google Calendar…' : 'חיבור Google Calendar - לבחירת יומן…'}</option>}
    </Select>
  );
}
