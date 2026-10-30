// An event's whole form, as Google Calendar's "more options" page: the title across the top with "שמירה",
// the day and the hours, all day, repeating (and a custom rule); then the event's details - who runs it,
// where, the notifications, the calendar it is in and its colour, busy or free, who sees it, a
// description - and its guests with their answers and what they may do. A phone has it as one column, as
// the Google Calendar app. A repeating event asks on saving which of its days the change is for.

import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router';
import { CAL_COLOR_LABELS, isCalColor, type CalColor } from '@shared/calendarLayers';
import { addDays, isDateKey } from '@shared/dates';
import { parseRRule } from '@shared/rrule';
import type { EventCalendar, EventDetail, EventGoogle, EventReminder, ScheduleEvent, Task } from '@shared/types';
import { CalendarPicker } from '../components/CalendarPicker';
import { pickBody, pickColor, pickOf, rememberPick, useGoogleCalendar, type CalendarPick } from '../lib/googleWrite';
import { ask } from '../components/Confirm';
import { ColorMenu, GuestsEditor, RemindersEditor, RepeatSelect, ScopeDialog, ShiftTasks, type Scope } from '../components/EventDialogs';
import { FindTime, type FindTimePerson } from '../components/FindTime';
import { Icon } from '../components/Icon';
import { useToast } from '../components/Toasts';
import { DateInput, ErrorBox, Loading, Select, TimeInput } from '../components/ui';
import { api, changedFields } from '../lib/api';
import { todayKey } from '../lib/format';
import { emitLocalChange } from '../lib/realtime';
import { useSession } from '../lib/session';
import { usePageTitle } from '../lib/title';
import { useApi } from '../lib/useApi';

/** what a new event starts from (the quick create's "אפשרויות נוספות", a duplicate) */
export interface EventPrefill {
  date?: string;
  start?: string;
  end?: string | null;
  allDay?: boolean;
  endDate?: string | null;
  title?: string;
  location?: string;
  ownerId?: number | null;
  color?: string | null;
  notes?: string;
  calendar?: EventCalendar;
  /** the calendar chosen in the quick create, a Google calendar among them */
  pick?: CalendarPick;
  guests?: { userId: number; optional?: boolean }[];
  recurrence?: string | null;
}

/** the notifications a new event has: Google's default, 30 minutes before */
const DEFAULT_REMINDERS: EventReminder[] = [{ minutes: 30 }];
const sameReminders = (a: EventReminder[], b: EventReminder[]) => a.length === b.length && a.every((r, i) => r.minutes === b[i].minutes);
const plusHour = (t: string) => {
  const m = Math.min(23 * 60 + 59, Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5)) + 60);
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
};

export function EventEditorPage() {
  const { id } = useParams();
  const editing = id ? Number(id) : null;
  const detail = useApi<EventDetail>(editing ? `/api/events/${editing}` : null, ['events']);
  if (editing && !detail.data) {
    return (
      <div className="g-editor">
        {detail.error ? <ErrorBox error={detail.error} /> : <Loading rows={6} />}
      </div>
    );
  }
  return <Editor key={editing ?? 'new'} event={detail.data?.event ?? null} google={detail.data?.google ?? null} />;
}

function Editor({ event, google }: { event: ScheduleEvent | null; google: EventGoogle | null }) {
  const navigate = useNavigate();
  const location = useLocation();
  const [params] = useSearchParams();
  const toast = useToast();
  const { users, user, can, weeks, viewing } = useSession();
  const pre = (location.state as { prefill?: EventPrefill } | null)?.prefill ?? {};
  usePageTitle(event ? 'עריכת אירוע' : 'אירוע חדש');

  const qDate = params.get('date');
  const initialDate = event?.date ?? pre.date ?? (isDateKey(qDate) ? qDate : todayKey());
  const initialStart = event?.startTime ?? pre.start ?? params.get('start') ?? '08:00';
  const leadOn = (d: string) => weeks.some((w) => w.startDate <= d && w.endDate >= d && w.leadId === user.id);
  const mayCourse = (d: string) => !viewing && (can('schedule') || leadOn(d));

  const [title, setTitle] = useState(event?.title ?? pre.title ?? '');
  const [date, setDate] = useState(initialDate);
  const [start, setStart] = useState(event && !event.allDay ? event.startTime : initialStart === '00:00' ? '08:00' : initialStart);
  const [end, setEnd] = useState(event ? (event.endTime ?? '') : (pre.end ?? params.get('end') ?? plusHour(initialStart)));
  const [allDay, setAllDay] = useState(event?.allDay ?? pre.allDay ?? params.get('allDay') === '1');
  const [endDate, setEndDate] = useState(event?.endDate ?? pre.endDate ?? '');
  const [recurrence, setRecurrence] = useState<string | null>(event?.recurrence ?? pre.recurrence ?? null);
  const [owner, setOwner] = useState<string>(String(event ? (event.ownerId ?? '') : (pre.ownerId ?? '')));
  const [place, setPlace] = useState(event?.location ?? pre.location ?? '');
  const [notes, setNotes] = useState(event?.notes ?? pre.notes ?? '');
  const initialColor = event?.color ?? pre.color;
  const [color, setColor] = useState<CalColor | null>(isCalColor(initialColor) && initialColor !== 'blue' ? initialColor : null);
  // the calendar it goes in - the course's, one's own, or a Google calendar of one's account
  const gcal = useGoogleCalendar().data;
  const initialPick: CalendarPick = event ? pickOf(event, google) : (pre.pick ?? pre.calendar ?? (mayCourse(initialDate) ? 'course' : 'personal'));
  const [pick, setPick] = useState<CalendarPick>(initialPick);
  const calendar: EventCalendar = pickBody(pick, gcal, false).calendar;
  const [transparency, setTransparency] = useState(event?.transparency ?? 'opaque');
  const [visibility, setVisibility] = useState(event?.visibility ?? 'default');
  const [reminders, setReminders] = useState<EventReminder[]>(event?.reminders ?? DEFAULT_REMINDERS);
  const [guests, setGuests] = useState<{ userId: number; optional?: boolean }[]>(event?.guests ?? pre.guests ?? []);
  const [perms, setPerms] = useState({ modify: event?.guestsCanModify ?? false, invite: event?.guestsCanInvite ?? true, see: event?.guestsCanSee ?? true });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [askScope, setAskScope] = useState<null | { allowOne: boolean }>(null);
  const [deleteScope, setDeleteScope] = useState(false);
  const [affected, setAffected] = useState<{ tasks: Task[]; delta: number; id: number } | null>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  const [tab, setTab] = useState<'details' | 'time'>('details');

  useEffect(() => {
    if (!event) titleRef.current?.focus();
  }, [event]);

  // the course's calendar for one who may not add to it that day: in their own charge (as the server has it)
  const courseFree = mayCourse(date);
  const forcedOwner = calendar === 'course' && !courseFree;
  // who is in it, for finding a time: who runs it, who made it, its guests
  const people = useMemo<FindTimePerson[]>(() => {
    const nameOf = (id: number) => users.find((u) => u.id === id)?.displayName ?? '';
    const list: FindTimePerson[] = [];
    const add = (id: number | null | undefined, role?: string) => {
      if (!id || list.some((p) => p.id === id) || !nameOf(id)) return;
      list.push({ id, name: nameOf(id), role });
    };
    add(Number(owner) || null, 'אחראי');
    add(event?.createdBy ?? user.id, 'מארגן/ת');
    for (const g of guests) add(g.userId, g.optional ? 'רשות' : undefined);
    return list;
  }, [users, owner, event?.createdBy, user.id, guests]);
  const ownerValue = forcedOwner ? String(user.id) : owner;

  const body = useMemo(
    () => ({
      title: title.trim() || '(ללא כותרת)',
      date,
      startTime: allDay ? '00:00' : start,
      endTime: allDay ? null : end || null,
      allDay,
      endDate: allDay && endDate && endDate > date ? endDate : null,
      location: place,
      notes,
      ownerId: ownerValue ? Number(ownerValue) : null,
      color,
      ...pickBody(pick, gcal, false),
      transparency,
      visibility,
      // left as Google's default: kept as the default (it follows the default if that ever changes)
      reminders: !event?.reminders && sameReminders(reminders, DEFAULT_REMINDERS) ? null : reminders,
      guests: guests.map((g) => ({ userId: g.userId, ...(g.optional ? { optional: true } : {}) })),
      guestsCanModify: perms.modify,
      guestsCanInvite: perms.invite,
      guestsCanSee: perms.see,
      recurrence,
    }),
    [title, date, allDay, start, end, endDate, place, notes, ownerValue, color, pick, gcal, transparency, visibility, reminders, guests, perms, recurrence, event?.reminders],
  );

  const original = useMemo(
    () =>
      event && {
        title: event.title,
        date: event.date,
        startTime: event.startTime,
        endTime: event.endTime || null,
        allDay: !!event.allDay,
        endDate: event.endDate ?? null,
        location: event.location,
        notes: event.notes,
        ownerId: event.ownerId,
        color: isCalColor(event.color) && event.color !== 'blue' ? event.color : null,
        calendar: event.calendar ?? 'course',
        transparency: event.transparency ?? 'opaque',
        visibility: event.visibility ?? 'default',
        reminders: event.reminders ?? null,
        guests: (event.guests ?? []).map((g) => ({ userId: g.userId, ...(g.optional ? { optional: true } : {}) })),
        guestsCanModify: !!event.guestsCanModify,
        guestsCanInvite: event.guestsCanInvite ?? true,
        guestsCanSee: event.guestsCanSee ?? true,
        recurrence: event.recurrence ?? null,
      },
    [event],
  );
  const { googleCalendarId: _newGoogle, ...compared } = body;
  void _newGoogle;
  const changedPatch = original ? changedFields<typeof compared>(original, compared) : null;
  // a Google calendar chosen anew: said with the change (the course's again: as the course's events go)
  const patch = original ? { ...changedPatch, ...(pick !== initialPick ? { googleCalendarId: pickBody(pick, gcal, true).googleCalendarId } : {}) } : null;
  const dirty = event ? !!patch && Object.keys(patch).length > 0 : !!title.trim() || !!place || !!notes || guests.length > 0;

  const back = () => {
    if (location.key !== 'default') navigate(-1);
    else navigate(`/?date=${date}`);
  };
  const close = async () => {
    if (dirty && !(await ask({ title: 'לבטל את השינויים שלא נשמרו?', confirm: 'ביטול השינויים', cancel: 'המשך עריכה', danger: true }))) return;
    back();
  };

  const save = async (scope?: Scope) => {
    setError(null);
    setBusy(true);
    try {
      if (event) {
        if (!patch || !Object.keys(patch).length) return back();
        // one of a series: which of its days - a new rule is never for one day alone
        if (event.seriesId && !scope) {
          setBusy(false);
          return setAskScope({ allowOne: !('recurrence' in patch) });
        }
        const res = await api.patch<EventDetail & { affectedTasks: Task[]; deltaMinutes: number }>(`/api/events/${event.id}`, { ...patch, ...(scope && scope !== 'one' ? { scope } : {}) });
        emitLocalChange('events');
        toast({ title: scope === 'following' || scope === 'all' ? 'האירועים נשמרו' : 'האירוע נשמר', tone: 'green' });
        if (res.google && (res.google.state === 'error' || res.google.state === 'off')) toast({ title: 'השינוי לא נכנס ל-Google', body: res.google.error ?? '', tone: 'red' });
        if (res.affectedTasks.length) return setAffected({ tasks: res.affectedTasks, delta: res.deltaMinutes, id: event.id });
      } else {
        const res = await api.post<EventDetail>('/api/events', body);
        emitLocalChange('events');
        rememberPick(pick);
        const rule = recurrence ? parseRRule(recurrence) : null;
        toast({ title: rule ? 'האירוע החוזר נוצר' : 'האירוע נוצר', body: `${body.title}${res.event.recurrenceText ? ` · ${res.event.recurrenceText}` : ''}${res.google?.state === 'synced' ? ` · נוסף גם ל-Google (${res.google.calendarName})` : ''}`, tone: 'green' });
        if (res.google && (res.google.state === 'error' || res.google.state === 'off')) toast({ title: 'האירוע נשמר, אבל לא נכנס ל-Google', body: res.google.error ?? '', tone: 'red' });
      }
      back();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  const remove = async (scope?: Scope) => {
    if (!event) return;
    // one of a series: which of its days go
    if (event.seriesId && !scope) {
      setDeleteScope(true);
      return;
    }
    if (!event.seriesId && !(await ask({ title: 'למחוק את האירוע?', body: 'הוא יעבור לאשפה, ואפשר יהיה לשחזר אותו 30 יום.', confirm: 'מחיקה', danger: true }))) return;
    try {
      await api.del(`/api/events/${event.id}${scope && scope !== 'one' ? `?scope=${scope}` : ''}`);
      emitLocalChange('events', 'tasks');
      toast({
        title: scope && scope !== 'one' ? 'האירועים נמחקו' : 'האירוע נמחק',
        tone: 'green',
        action: { label: 'ביטול', run: () => void api.post(`/api/events/${event.id}/untrash`).then(() => emitLocalChange('events', 'tasks')) },
      });
      navigate(`/?date=${event.date}`);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  // keyboard: Ctrl/⌘+S saves, Escape closes - as in Google's page
  const keys = useRef({ save, close });
  keys.current = { save, close };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        void keys.current.save();
      } else if (e.key === 'Escape' && !document.querySelector('.modal, .dd-panel, .pop, .g-color-menu')) {
        e.preventDefault();
        void keys.current.close();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const onDate = (v: string) => {
    if (!v) return;
    setDate(v);
    if (endDate && endDate < v) setEndDate(v);
  };
  const onStart = (v: string) => {
    // the end keeps the length the event had, as Google's
    if (start && end && v) {
      const len = Number(end.slice(0, 2)) * 60 + Number(end.slice(3, 5)) - (Number(start.slice(0, 2)) * 60 + Number(start.slice(3, 5)));
      if (len > 0) {
        const m = Math.min(23 * 60 + 59, Number(v.slice(0, 2)) * 60 + Number(v.slice(3, 5)) + len);
        setEnd(`${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`);
      }
    }
    setStart(v);
  };

  if (affected) return <ShiftTasks {...affected} onClose={back} />;

  const saveLabel = busy ? 'שומר...' : 'שמירה';
  return (
    <div className="g-editor">
      <form
        className="g-ed-form"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        {/* the head: close, the title, save - and, an event there is, delete */}
        <header className="g-ed-head">
          <button type="button" className="icon-btn g-ed-close" onClick={() => void close()} aria-label="סגירה" title="סגירה">
            <Icon name="x" />
          </button>
          <input ref={titleRef} className="g-ed-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="הוספת כותרת" aria-label="כותרת" maxLength={200} />
          <div className="g-ed-actions">
            {event && (
              <button type="button" className="icon-btn" onClick={() => void remove()} aria-label="מחיקת האירוע" title="מחיקה">
                <Icon name="trash" />
              </button>
            )}
            <button type="submit" className="btn g-filled-btn g-ed-save" disabled={busy}>
              {saveLabel}
            </button>
          </div>
        </header>

        {/* when: the day and the hours (all day: the days), all day, and repeating */}
        <div className="g-ed-when">
          <div className="g-ed-times">
            <DateInput value={date} onChange={onDate} aria-label={allDay ? 'מתאריך' : 'תאריך'} className="input g-ed-date" />
            {allDay ? (
              <>
                <span className="g-ed-dash">עד</span>
                <DateInput value={endDate || date} min={date} onChange={(v) => v && setEndDate(v)} aria-label="עד תאריך" className="input g-ed-date" />
              </>
            ) : (
              <>
                <TimeInput value={start} onChange={onStart} aria-label="שעת התחלה" className="input g-ed-time" />
                <span className="g-ed-dash">עד</span>
                <TimeInput value={end} onChange={setEnd} aria-label="שעת סיום" className="input g-ed-time" />
              </>
            )}
          </div>
          <div className="g-ed-when2">
            <label className="g-check">
              <input
                type="checkbox"
                checked={allDay}
                onChange={(e) => {
                  setAllDay(e.target.checked);
                  if (e.target.checked && !endDate) setEndDate(date);
                }}
              />
              כל היום
            </label>
            <RepeatSelect date={date} value={recurrence} onChange={setRecurrence} className="select g-ed-repeat" fit />
          </div>
        </div>

        {/* as Google's: the event's details, and finding a time when everyone in it is free */}
        <div className="g-ed-tabs" role="tablist">
          <button type="button" role="tab" aria-selected={tab === 'details'} className={`g-ed-tab${tab === 'details' ? ' on' : ''}`} onClick={() => setTab('details')}>
            פרטי האירוע
          </button>
          {!allDay && (
            <button type="button" role="tab" aria-selected={tab === 'time'} className={`g-ed-tab${tab === 'time' ? ' on' : ''}`} onClick={() => setTab('time')}>
              מציאת זמן
            </button>
          )}
        </div>

        {tab === 'time' && !allDay ? (
          <FindTime
            date={date}
            start={start}
            end={end}
            people={people}
            exceptId={event?.id}
            onPick={(d, s, e) => {
              onDate(d);
              setStart(s);
              setEnd(e);
            }}
          />
        ) : (
        <div className="g-ed-cols">
          <section className="g-ed-details" aria-label="פרטי האירוע">
            <div className="g-ed-row">
              <Icon name="my" size={20} />
              <div className="grow">
                <Select className="select" value={ownerValue} onChange={(e) => setOwner(e.target.value)} searchable aria-label="אחראי" disabled={forcedOwner}>
                  <option value="">ללא אחראי</option>
                  {users.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.displayName}
                    </option>
                  ))}
                </Select>
                {forcedOwner && <p className="tiny muted g-ed-note">אירוע שתוסיף ללו"ז הקורס ביום הזה יירשם עליך כאחראי.</p>}
              </div>
            </div>
            <div className="g-ed-row">
              <Icon name="pin" size={20} />
              <input className="input grow" value={place} onChange={(e) => setPlace(e.target.value)} placeholder="הוספת מיקום" aria-label="מיקום" maxLength={200} />
            </div>
            <div className="g-ed-row is-top">
              <Icon name="bell" size={20} />
              <div className="grow">
                <RemindersEditor value={reminders} onChange={setReminders} />
              </div>
            </div>
            <div className="g-ed-row">
              <Icon name="calendar" size={20} />
              <CalendarPicker
                className="select g-ed-cal"
                value={pick}
                onChange={setPick}
                status={gcal}
                beforeConnect={async () => !dirty || (await ask({ title: 'לעבור לחיבור Google Calendar?', body: 'מה שנכתב כאן ולא נשמר לא יישמר. אחרי החיבור חוזרים לכאן.', confirm: 'מעבר ל-Google' }))}
              />
              <ColorMenu value={color} onChange={setColor} calendarColor={pickColor(pick, gcal)} />
              {color && <span className="tiny muted">{CAL_COLOR_LABELS[color]}</span>}
            </div>
            <div className="g-ed-row">
              <Icon name="lock" size={20} />
              <Select className="select g-ed-small" value={transparency} onChange={(e) => setTransparency(e.target.value as 'opaque' | 'transparent')} aria-label="פנוי או עסוק">
                <option value="opaque">עסוק</option>
                <option value="transparent">פנוי</option>
              </Select>
              <Select className="select g-ed-small" value={visibility} onChange={(e) => setVisibility(e.target.value as 'default' | 'public' | 'private')} aria-label="נראות">
                <option value="default">נראות ברירת מחדל</option>
                <option value="public">ציבורי</option>
                <option value="private">פרטי</option>
              </Select>
            </div>
            <div className="g-ed-row is-top">
              <Icon name="edit" size={20} />
              <textarea className="textarea grow g-ed-notes" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="הוספת תיאור" aria-label="תיאור" />
            </div>
            <ErrorBox error={error} />
          </section>

          <section className="g-ed-guests" aria-label="אורחים">
            <h2 className="g-ed-side-title">אורחים</h2>
            <GuestsEditor guests={guests} onChange={setGuests} perms={perms} onPerms={setPerms} organizerId={event?.createdBy ?? user.id} />
          </section>
        </div>
        )}
      </form>

      {askScope && (
        <ScopeDialog
          title="עריכת אירוע חוזר"
          allowOne={askScope.allowOne}
          onClose={() => setAskScope(null)}
          onPick={(s) => {
            setAskScope(null);
            void save(s);
          }}
        />
      )}
      {deleteScope && (
        <ScopeDialog
          title="מחיקת אירוע חוזר"
          danger
          onClose={() => setDeleteScope(false)}
          onPick={(s) => {
            setDeleteScope(false);
            void remove(s);
          }}
        />
      )}
    </div>
  );
}

/** the editor's address for an event, or for a new one from what is known */
export const editPath = (id: number) => `/event/${id}/edit`;
export const newEventState = (prefill: EventPrefill) => ({ state: { prefill } });
export const dayAfter = (d: string) => addDays(d, 1);
