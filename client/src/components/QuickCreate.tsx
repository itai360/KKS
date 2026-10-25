// The calendar's quick create, as Google Calendar's: a click (or a drag) on free time opens a small card
// beside it - a title, the day and the hours, who runs it and where - and Enter saves. "אפשרויות נוספות"
// opens the whole form with what was typed. A second tab makes it a task with a deadline at that time
// instead. Everything is saved through the course's own API, so its rules (who may add to the schedule,
// who may give a task to whom) are the server's.

import { useState } from 'react';
import { CAL_COLOR_LABELS, CAL_COLORS, type CalColor } from '@shared/calendarLayers';
import type { EventPrefill } from './Agenda';
import { api } from '../lib/api';
import { isoAt } from '../lib/format';
import { emitLocalChange } from '../lib/realtime';
import { useSession } from '../lib/session';
import { Icon } from './Icon';
import { Popover, type Anchor } from './Popover';
import { useToast } from './Toasts';
import { DateInput, ErrorBox, Select, TimeInput } from './ui';
import { longDay } from './ItemCard';

export interface Draft extends EventPrefill {
  /** all day (or several days, to endDate) */
  allDay?: boolean;
  endDate?: string;
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
  /** may add an event on this day (otherwise only with themselves in charge, as the server has it) */
  canEvent: (date: string) => boolean;
  /** the draft moved (its day or hours changed): the calendar's ghost follows */
  onChange: (d: Draft) => void;
  onClose: () => void;
  /** the whole form, with what was typed */
  onMore: (d: Draft) => void;
  onSaved: (kind: 'event' | 'task', id: number) => void;
}) {
  const { users, user, staff } = useSession();
  const toast = useToast();
  const [tab, setTab] = useState<'event' | 'task'>('event');
  const [title, setTitle] = useState(draft.title ?? '');
  const [location, setLocation] = useState(draft.location ?? '');
  const free = canEvent(draft.date);
  // not one who may add to the schedule that day: the event is theirs to run (the server allows that)
  const [owner, setOwner] = useState<string>(draft.ownerId ? String(draft.ownerId) : free ? '' : String(user.id));
  const [taskOwner, setTaskOwner] = useState<string>(String(user.id));
  const [color, setColor] = useState<CalColor | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const start = draft.start ?? '08:00';
  const end = draft.end ?? '';
  const set = (patch: Partial<Draft>) => onChange({ ...draft, ...patch });

  const saveEvent = async () => {
    if (!title.trim()) return;
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
        title,
        location,
        ownerId: owner ? Number(owner) : null,
        notes: '',
      };
      const res = await api.post<{ event: { id: number } }>('/api/events', body);
      emitLocalChange('events');
      toast({ title: 'האירוע נוסף ללו"ז', body: `${title} · ${longDay(draft.date)}`, tone: 'green' });
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
      <button type="button" className="btn btn-primary" onClick={save} disabled={busy || !title.trim()}>
        {busy ? 'שומר...' : 'שמירה'}
      </button>
      {tab === 'event' && (
        <button type="button" className="btn btn-ghost" onClick={() => onMore({ ...draft, title, location, ownerId: owner ? Number(owner) : null })}>
          אפשרויות נוספות
        </button>
      )}
    </>
  );

  return (
    <Popover anchor={anchor} label={tab === 'event' ? 'אירוע חדש' : 'משימה חדשה'} onClose={onClose} width={420} className="quick-create" sheetFooter={footer}>
      <form
        className="qc"
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <div className="qc-top">
          <button type="button" className="icon-btn qc-close" onClick={onClose} aria-label="סגירה" title="סגירה">
            <Icon name="x" />
          </button>
        </div>
        <input
          className="qc-title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={tab === 'event' ? 'הוספת כותרת' : 'מה צריך לעשות'}
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
        <div className="qc-row">
          <Icon name="clock" size={18} />
          <div className="qc-when grow">
            <DateInput value={draft.date} onChange={(v) => v && set({ date: v, endDate: draft.endDate && draft.endDate < v ? v : draft.endDate })} aria-label="תאריך" />
            {/* the hours (or the last day) keep together: on a narrow sheet they go under the day as one */}
            {!draft.allDay ? (
              <span className="qc-times">
                <TimeInput value={start} onChange={(v) => set({ start: v })} aria-label={tab === 'event' ? 'שעת התחלה' : 'שעת הדד-ליין'} />
                {tab === 'event' && (
                  <>
                    <span className="qc-dash">-</span>
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
        </div>
        {tab === 'event' && (
          <label className="check small qc-allday">
            <input type="checkbox" checked={!!draft.allDay} onChange={(e) => set({ allDay: e.target.checked, endDate: draft.endDate ?? draft.date })} /> כל היום
          </label>
        )}
        {tab === 'event' ? (
          <>
            <div className="qc-row">
              <Icon name="my" size={18} />
              <Select className="select grow" value={owner} onChange={(e) => setOwner(e.target.value)} aria-label="אחראי" searchable>
                {free && <option value="">ללא אחראי</option>}
                {(free ? users : users.filter((u) => u.id === user.id)).map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.displayName}
                  </option>
                ))}
              </Select>
            </div>
            {!free && <p className="tiny muted qc-note">אירוע שתוסיף ביום הזה יירשם עליך כאחראי.</p>}
            <div className="qc-row">
              <Icon name="pin" size={18} />
              <input className="input grow" value={location} onChange={(e) => setLocation(e.target.value)} placeholder="מיקום" aria-label="מיקום" maxLength={200} />
            </div>
            <div className="qc-row qc-colors" role="radiogroup" aria-label="צבע">
              <Icon name="sparkle" size={18} />
              <div className="qc-swatches">
                {CAL_COLORS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    role="radio"
                    aria-checked={(color ?? 'blue') === c}
                    className={`qc-swatch c-${c}${(color ?? 'blue') === c ? ' on' : ''}`}
                    onClick={() => setColor(c === 'blue' ? null : c)}
                    aria-label={CAL_COLOR_LABELS[c]}
                    title={CAL_COLOR_LABELS[c]}
                  />
                ))}
              </div>
            </div>
          </>
        ) : (
          <div className="qc-row">
            <Icon name="my" size={18} />
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
