// The calendar's quick create, as Google Calendar's: a click (or a drag) on free time opens a small card
// beside it - "הוספת כותרת", event or task, the day and the hours in a line that opens for editing, and
// "הוספת אורחים / מיקום / תיאור" that open as they are needed; the calendar it goes in and its colour.
// Enter saves; "אפשרויות נוספות" opens the whole page with what was typed. Everything is saved through the
// course's own API, so its rules (who may add to the schedule, who may give a task to whom) are the server's.

import { useState } from 'react';
import type { CalColor } from '@shared/calendarLayers';
import { repeatPresets } from '@shared/rrule';
import type { EventCalendar } from '@shared/types';
import type { EventPrefill } from './Agenda';
import { api } from '../lib/api';
import { isoAt } from '../lib/format';
import { emitLocalChange } from '../lib/realtime';
import { useSession } from '../lib/session';
import { ColorMenu, RepeatSelect } from './EventDialogs';
import { Icon } from './Icon';
import { Popover, type Anchor } from './Popover';
import { useToast } from './Toasts';
import { DateInput, ErrorBox, Select, TimeInput } from './ui';
import { longDay } from './ItemCard';

export interface Draft extends EventPrefill {
  /** all day (or several days, to endDate) */
  allDay?: boolean;
  endDate?: string;
  notes?: string;
  color?: string | null;
  calendar?: EventCalendar;
  guests?: { userId: number; optional?: boolean }[];
  recurrence?: string | null;
}

export function QuickCreate({
  anchor,
  draft,
  canEvent,
  onChange,
  onClose,
  onMore,
  onSaved,
}: {
  anchor: Anchor;
  draft: Draft;
  /** may add an event to the course's calendar on this day (otherwise only with themselves in charge, as the server has it) */
  canEvent: (date: string) => boolean;
  /** the draft moved (its day or hours changed): the calendar's ghost follows */
  onChange: (d: Draft) => void;
  onClose: () => void;
  /** the whole page, with what was typed */
  onMore: (d: Draft) => void;
  onSaved: (kind: 'event' | 'task', id: number) => void;
}) {
  const { users, user, staff } = useSession();
  const toast = useToast();
  const [tab, setTab] = useState<'event' | 'task'>('event');
  const [title, setTitle] = useState(draft.title ?? '');
  const [location, setLocation] = useState(draft.location ?? '');
  const [notes, setNotes] = useState('');
  const free = canEvent(draft.date);
  const [calendar, setCalendar] = useState<EventCalendar>(free ? 'course' : 'personal');
  // the course's calendar, not one who may add to it that day: the event is theirs to run (the server allows that)
  const [owner, setOwner] = useState<string>(draft.ownerId ? String(draft.ownerId) : '');
  const [taskOwner, setTaskOwner] = useState<string>(String(user.id));
  const [color, setColor] = useState<CalColor | null>(null);
  const [guests, setGuests] = useState<number[]>([]);
  const [recurrence, setRecurrence] = useState<string | null>(null);
  // the line of the time opens for editing; "add" rows open as they are needed - as Google's
  const [editTime, setEditTime] = useState(false);
  const [open, setOpen] = useState<{ guests?: boolean; location?: boolean; notes?: boolean; owner?: boolean }>({ location: !!draft.location, owner: !!draft.ownerId });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const start = draft.start ?? '08:00';
  const end = draft.end ?? '';
  const set = (patch: Partial<Draft>) => onChange({ ...draft, ...patch });
  const forcedOwner = calendar === 'course' && !free;
  const ownerValue = forcedOwner ? String(user.id) : owner;
  const people = staff.length ? staff : users;
  const nameOf = (id: number) => people.find((u) => u.id === id)?.displayName ?? '';
  const repeatLabel = recurrence ? (repeatPresets(draft.date).find((p) => p.rrule === recurrence)?.label ?? 'חוזר') : 'לא חוזר';

  const current = (): Draft => ({
    ...draft,
    title,
    location,
    notes,
    ownerId: ownerValue ? Number(ownerValue) : null,
    color,
    calendar,
    guests: guests.map((userId) => ({ userId })),
    recurrence,
  });

  const saveEvent = async () => {
    setBusy(true);
    setError(null);
    try {
      const body = {
        date: draft.date,
        startTime: draft.allDay ? '00:00' : start,
        endTime: draft.allDay ? null : end || null,
        allDay: !!draft.allDay,
        endDate: draft.allDay && draft.endDate && draft.endDate > draft.date ? draft.endDate : null,
        color,
        title: title.trim() || '(ללא כותרת)',
        location,
        notes,
        ownerId: ownerValue ? Number(ownerValue) : null,
        calendar,
        guests: guests.map((userId) => ({ userId })),
        recurrence,
      };
      const res = await api.post<{ event: { id: number; recurrenceText?: string | null } }>('/api/events', body);
      emitLocalChange('events');
      toast({ title: recurrence ? 'האירוע החוזר נוצר' : 'האירוע נוצר', body: `${body.title} · ${res.event.recurrenceText ?? longDay(draft.date)}`, tone: 'green' });
      onSaved('event', res.event.id);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  const saveTask = async () => {
    if (!title.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api.post<{ ids: number[] }>('/api/tasks', { title, deadline: isoAt(draft.date, draft.allDay ? '18:00' : start), ownerIds: [Number(taskOwner)] });
      emitLocalChange('tasks');
      toast({ title: 'המשימה נפתחה', body: `${title} · ${longDay(draft.date)}`, tone: 'green' });
      onSaved('task', res.ids[0]);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };
  const save = () => void (tab === 'event' ? saveEvent() : saveTask());

  const footer = (
    <>
      {tab === 'event' && (
        <button type="button" className="btn g-text-btn" onClick={() => onMore(current())}>
          אפשרויות נוספות
        </button>
      )}
      <button type="button" className="btn g-filled-btn" onClick={save} disabled={busy || (tab === 'task' && !title.trim())}>
        {busy ? 'שומר...' : 'שמירה'}
      </button>
    </>
  );

  const whenLine = draft.allDay
    ? `${longDay(draft.date)}${draft.endDate && draft.endDate > draft.date ? ` - ${longDay(draft.endDate)}` : ''}`
    : `${longDay(draft.date)} · ${start}${tab === 'event' && end ? ` – ${end}` : ''}`;

  return (
    <Popover anchor={anchor} label={tab === 'event' ? 'אירוע חדש' : 'משימה חדשה'} onClose={onClose} width={448} className="quick-create g-qc" sheetFooter={footer}>
      <form
        className="qc"
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <div className="qc-top">
          <span className="qc-grip" aria-hidden="true" />
          <button type="button" className="icon-btn qc-close" onClick={onClose} aria-label="סגירה" title="סגירה">
            <Icon name="x" />
          </button>
        </div>
        <input
          className="qc-title"
          value={title}
          onChange={(e) => {
            setTitle(e.target.value);
            set({ title: e.target.value });
          }}
          placeholder={tab === 'event' ? 'הוספת כותרת ושעה' : 'הוספת כותרת'}
          aria-label="כותרת"
          maxLength={200}
          data-autofocus
        />
        <div className="qc-tabs" role="tablist" aria-label="מה יוצרים">
          <button type="button" role="tab" aria-selected={tab === 'event'} className={tab === 'event' ? 'on' : ''} onClick={() => setTab('event')}>
            אירוע
          </button>
          <button type="button" role="tab" aria-selected={tab === 'task'} className={tab === 'task' ? 'on' : ''} onClick={() => setTab('task')}>
            משימה
          </button>
        </div>

        {/* when: a line, as Google's - a press opens the day and the hours for editing */}
        <div className="qc-row">
          <Icon name="clock" size={20} />
          {!editTime ? (
            <button type="button" className="qc-line grow" onClick={() => setEditTime(true)}>
              <span className="qc-line-main">{whenLine}</span>
              {tab === 'event' && <span className="qc-line-sub">{repeatLabel}</span>}
            </button>
          ) : (
            <div className="grow qc-when-edit">
              <div className="qc-when">
                <DateInput value={draft.date} onChange={(v) => v && set({ date: v, endDate: draft.endDate && draft.endDate < v ? v : draft.endDate })} aria-label="תאריך" />
                {!draft.allDay ? (
                  <span className="qc-times">
                    <TimeInput value={start} onChange={(v) => set({ start: v })} aria-label={tab === 'event' ? 'שעת התחלה' : 'שעת הדד-ליין'} />
                    {tab === 'event' && (
                      <>
                        <span className="qc-dash">–</span>
                        <TimeInput value={end} onChange={(v) => set({ end: v })} aria-label="שעת סיום" />
                      </>
                    )}
                  </span>
                ) : (
                  tab === 'event' && (
                    <span className="qc-times">
                      <span className="qc-dash">עד</span>
                      <DateInput value={draft.endDate ?? draft.date} min={draft.date} onChange={(v) => v && set({ endDate: v })} aria-label="היום האחרון" />
                    </span>
                  )
                )}
              </div>
              {tab === 'event' && (
                <div className="qc-when2">
                  <label className="g-check">
                    <input type="checkbox" checked={!!draft.allDay} onChange={(e) => set({ allDay: e.target.checked, endDate: draft.endDate ?? draft.date })} /> כל היום
                  </label>
                  <RepeatSelect date={draft.date} value={recurrence} onChange={setRecurrence} className="select qc-repeat" fit />
                </div>
              )}
            </div>
          )}
        </div>

        {tab === 'event' ? (
          <>
            {/* guests: added as needed */}
            <div className="qc-row">
              <Icon name="users" size={20} />
              {!open.guests && !guests.length ? (
                <button type="button" className="qc-add grow" onClick={() => setOpen({ ...open, guests: true })}>
                  הוספת אורחים
                </button>
              ) : (
                <div className="grow qc-guests">
                  <Select className="select" value="" searchable aria-label="הוספת אורחים" onChange={(e) => e.target.value && setGuests([...guests, Number(e.target.value)])}>
                    <option value="">הוספת אורחים</option>
                    {people
                      .filter((u) => !guests.includes(u.id))
                      .map((u) => (
                        <option key={u.id} value={u.id}>
                          {u.displayName}
                        </option>
                      ))}
                  </Select>
                  {guests.length > 0 && (
                    <div className="qc-chips">
                      {guests.map((g) => (
                        <span key={g} className="qc-chip">
                          {nameOf(g)}
                          <button type="button" onClick={() => setGuests(guests.filter((x) => x !== g))} aria-label={`הסרת ${nameOf(g)}`}>
                            <Icon name="x" size={12} />
                          </button>
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
            <div className="qc-row">
              <Icon name="pin" size={20} />
              {!open.location ? (
                <button type="button" className="qc-add grow" onClick={() => setOpen({ ...open, location: true })}>
                  הוספת מיקום
                </button>
              ) : (
                <input className="input grow" value={location} onChange={(e) => setLocation(e.target.value)} placeholder="הוספת מיקום" aria-label="מיקום" maxLength={200} autoFocus={!draft.location} />
              )}
            </div>
            <div className="qc-row">
              <Icon name="edit" size={20} />
              {!open.notes ? (
                <button type="button" className="qc-add grow" onClick={() => setOpen({ ...open, notes: true })}>
                  הוספת תיאור
                </button>
              ) : (
                <textarea className="textarea grow qc-notes" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="הוספת תיאור" aria-label="תיאור" autoFocus />
              )}
            </div>
            <div className="qc-row">
              <Icon name="my" size={20} />
              {!open.owner && !forcedOwner ? (
                <button type="button" className="qc-add grow" onClick={() => setOpen({ ...open, owner: true })}>
                  הוספת אחראי
                </button>
              ) : (
                <Select className="select grow" value={ownerValue} onChange={(e) => setOwner(e.target.value)} aria-label="אחראי" searchable disabled={forcedOwner}>
                  <option value="">ללא אחראי</option>
                  {users.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.displayName}
                    </option>
                  ))}
                </Select>
              )}
            </div>
            {forcedOwner && <p className="tiny muted qc-note">אירוע שתוסיף ללו"ז הקורס ביום הזה יירשם עליך כאחראי.</p>}
            <div className="qc-row">
              <Icon name="calendar" size={20} />
              <Select className="select qc-cal" value={calendar} onChange={(e) => setCalendar(e.target.value as EventCalendar)} aria-label="יומן">
                <option value="course">יומן הקורס</option>
                <option value="personal">היומן שלי</option>
              </Select>
              <ColorMenu
                value={color}
                onChange={(c) => {
                  setColor(c);
                  set({ color: c });
                }}
                calendarColor={calendar === 'course' ? 'blue' : 'teal'}
              />
            </div>
          </>
        ) : (
          <div className="qc-row">
            <Icon name="my" size={20} />
            <Select className="select grow" value={taskOwner} onChange={(e) => setTaskOwner(e.target.value)} aria-label="אחראי" searchable>
              {staff.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.id === user.id ? `${u.displayName} (אני)` : u.displayName}
                </option>
              ))}
            </Select>
          </div>
        )}
        <ErrorBox error={error} />
        <div className="qc-foot">{footer}</div>
        {/* Enter saves from any field */}
        <button type="submit" hidden />
      </form>
    </Popover>
  );
}
