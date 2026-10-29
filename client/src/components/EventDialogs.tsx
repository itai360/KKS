// The pieces of an event's editing, as Google Calendar has them: the repeat menu and its custom rule, the
// question a repeating event asks on a change ("this event / this and following / all events"), the
// colour menu, the notifications, the guests with their answers - and, KKS's own, moving the preparation
// tasks' deadlines with a moved event.

import { useEffect, useRef, useState } from 'react';
import { CAL_COLOR_LABELS, CAL_COLORS, type CalColor } from '@shared/calendarLayers';
import { addDays, parseDateKey, weekdayOf } from '@shared/dates';
import { describeRRule, formatRRule, parseRRule, placeInMonth, repeatPresets, WEEKDAY_WORDS, WEEKDAYS, type Freq, type RRule, type Weekday } from '@shared/rrule';
import type { EventGuest, EventReminder, GuestResponse, Task } from '@shared/types';
import { api } from '../lib/api';
import { fmtDeadline } from '../lib/format';
import { emitLocalChange } from '../lib/realtime';
import { useSession } from '../lib/session';
import { Icon } from './Icon';
import { useToast } from './Toasts';
import { DateInput, ErrorBox, Modal, Select } from './ui';

export type Scope = 'one' | 'following' | 'all';

/** "עריכת אירוע חוזר" / "מחיקת אירוע חוזר": this event, this and following, or all - as Google asks */
export function ScopeDialog({ title, allowOne = true, only, danger, onPick, onClose }: { title: string; allowOne?: boolean; only?: Scope[]; danger?: boolean; onPick: (s: Scope) => void; onClose: () => void }) {
  const options = (
    [
      ['one', 'האירוע הזה'],
      ['following', 'האירוע הזה והאירועים הבאים'],
      ['all', 'כל האירועים'],
    ] as [Scope, string][]
  ).filter(([v]) => (only ? only.includes(v) : allowOne || v !== 'one'));
  const [scope, setScope] = useState<Scope>(options[0][0]);
  return (
    <Modal
      title={title}
      narrow
      className="g-scope"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn g-text-btn" onClick={onClose}>
            ביטול
          </button>
          <button type="button" className={`btn g-filled-btn${danger ? ' is-danger' : ''}`} onClick={() => onPick(scope)} data-autofocus>
            אישור
          </button>
        </>
      }
    >
      <div className="g-radios" role="radiogroup" aria-label={title}>
        {options.map(([v, l]) => (
          <label key={v} className="g-radio">
            <input type="radio" name="g-scope" checked={scope === v} onChange={() => setScope(v)} />
            <span>{l}</span>
          </label>
        ))}
      </div>
    </Modal>
  );
}

// ---------------- repeating ----------------

const FREQ_WORDS: Record<Freq, [string, string]> = { DAILY: ['יום', 'ימים'], WEEKLY: ['שבוע', 'שבועות'], MONTHLY: ['חודש', 'חודשים'], YEARLY: ['שנה', 'שנים'] };
const DAY_LETTERS: Record<Weekday, string> = { SU: 'א', MO: 'ב', TU: 'ג', WE: 'ד', TH: 'ה', FR: 'ו', SA: 'ש' };
const PLACE: Record<number, string> = { 1: 'הראשון', 2: 'השני', 3: 'השלישי', 4: 'הרביעי', 5: 'החמישי', [-1]: 'האחרון' };

/** The repeat menu, as Google's: does not repeat, the day's usual repeats, a rule already set, and custom. */
export function RepeatSelect({ date, value, onChange, className = 'select', fit }: { date: string; value: string | null; onChange: (rrule: string | null) => void; className?: string; fit?: boolean }) {
  const [custom, setCustom] = useState(false);
  const presets = repeatPresets(date);
  const known = presets.some((p) => p.rrule === value);
  const rule = value ? parseRRule(value) : null;
  return (
    <>
      <Select
        className={className}
        fit={fit}
        value={value ?? ''}
        aria-label="חזרה"
        onChange={(e) => {
          const v = e.target.value;
          if (v === 'custom') setCustom(true);
          else onChange(v || null);
        }}
      >
        {presets.map((p) =>
          p.rrule === 'custom' ? null : (
            <option key={p.label} value={p.rrule ?? ''}>
              {p.label}
            </option>
          ),
        )}
        {value && !known && rule && <option value={value}>{describeRRule(rule, date)}</option>}
        <option value="custom">בהתאמה אישית...</option>
      </Select>
      {custom && (
        <RecurrenceDialog
          date={date}
          value={rule}
          onClose={() => setCustom(false)}
          onDone={(r) => {
            setCustom(false);
            onChange(formatRRule(r));
          }}
        />
      )}
    </>
  );
}

/** "חזרה בהתאמה אישית": every n days / weeks / months / years, on which days, and how it ends - Google's dialog */
export function RecurrenceDialog({ date, value, onDone, onClose }: { date: string; value: RRule | null; onDone: (r: RRule) => void; onClose: () => void }) {
  const wd = WEEKDAYS[weekdayOf(date)];
  const { n: place, last } = placeInMonth(date);
  const [freq, setFreq] = useState<Freq>(value?.freq ?? 'WEEKLY');
  const [interval, setInterval] = useState(value?.interval ?? 1);
  const [days, setDays] = useState<Weekday[]>(value?.freq === 'WEEKLY' && value.byDay?.length ? value.byDay.map((b) => b.day) : [wd]);
  // monthly: on the day of the month, or on the weekday's place in the month (the last, when it is)
  const nth = value?.byDay?.find((b) => b.n);
  const [monthly, setMonthly] = useState<'day' | 'nth' | 'last'>(nth ? (nth.n === -1 ? 'last' : 'nth') : 'day');
  const [ends, setEnds] = useState<'never' | 'until' | 'count'>(value?.until ? 'until' : value?.count ? 'count' : 'never');
  const [until, setUntil] = useState(value?.until ?? addDays(date, 90));
  const [count, setCount] = useState(value?.count ?? 13);
  const { day, month } = parseDateKey(date);

  const build = (): RRule => {
    const r: RRule = { freq, interval: Math.max(1, Math.min(99, interval || 1)) };
    if (freq === 'WEEKLY') r.byDay = WEEKDAYS.filter((d) => days.includes(d)).map((d) => ({ day: d }));
    if (freq === 'MONTHLY' && monthly !== 'day') r.byDay = [{ day: wd, n: monthly === 'last' ? -1 : Math.min(place, 4) }];
    if (ends === 'until') r.until = until < date ? date : until;
    if (ends === 'count') r.count = Math.max(1, Math.min(999, count || 1));
    return r;
  };
  const rule = build();
  return (
    <Modal
      title="חזרה בהתאמה אישית"
      narrow
      className="g-recur"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn g-text-btn" onClick={onClose}>
            ביטול
          </button>
          <button type="button" className="btn g-filled-btn" onClick={() => onDone(rule)} disabled={freq === 'WEEKLY' && !days.length}>
            סיום
          </button>
        </>
      }
    >
      <div className="g-recur-body">
        <div className="g-recur-line">
          <span>חוזר כל</span>
          <input className="input g-num" type="number" min={1} max={99} value={interval} onChange={(e) => setInterval(Number(e.target.value))} aria-label="כל כמה" />
          <Select className="select g-unit" value={freq} onChange={(e) => setFreq(e.target.value as Freq)} aria-label="יחידה">
            {(Object.keys(FREQ_WORDS) as Freq[]).map((f) => (
              <option key={f} value={f}>
                {interval > 1 ? FREQ_WORDS[f][1] : FREQ_WORDS[f][0]}
              </option>
            ))}
          </Select>
        </div>
        {freq === 'WEEKLY' && (
          <div className="g-recur-block">
            <div className="g-recur-label">חוזר ב-</div>
            <div className="g-days" role="group" aria-label="ימים בשבוע">
              {WEEKDAYS.map((d) => {
                const on = days.includes(d);
                return (
                  <button
                    key={d}
                    type="button"
                    className={`g-day${on ? ' on' : ''}`}
                    aria-pressed={on}
                    aria-label={WEEKDAY_WORDS[d]}
                    title={WEEKDAY_WORDS[d]}
                    onClick={() => setDays(on ? days.filter((x) => x !== d) : [...days, d])}
                  >
                    {DAY_LETTERS[d]}
                  </button>
                );
              })}
            </div>
          </div>
        )}
        {freq === 'MONTHLY' && (
          <Select className="select g-month-pick" value={monthly} onChange={(e) => setMonthly(e.target.value as typeof monthly)} aria-label="באיזה יום בחודש">
            <option value="day">כל חודש ב-{day} לחודש</option>
            {place <= 4 && <option value="nth">כל חודש ביום {WEEKDAY_WORDS[wd]} {PLACE[place]}</option>}
            {last && <option value="last">כל חודש ביום {WEEKDAY_WORDS[wd]} האחרון</option>}
          </Select>
        )}
        {freq === 'YEARLY' && <p className="small muted">כל שנה ב-{day} ב{['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני', 'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'][month - 1]}</p>}
        <div className="g-recur-block">
          <div className="g-recur-label">מסתיים</div>
          <div className="g-radios" role="radiogroup" aria-label="מסתיים">
            <label className="g-radio">
              <input type="radio" name="g-ends" checked={ends === 'never'} onChange={() => setEnds('never')} />
              <span>אף פעם</span>
            </label>
            <label className="g-radio">
              <input type="radio" name="g-ends" checked={ends === 'until'} onChange={() => setEnds('until')} />
              <span>בתאריך</span>
              <DateInput value={until} min={date} onChange={(v) => v && (setUntil(v), setEnds('until'))} aria-label="תאריך סיום" className="input g-ends-date" />
            </label>
            <label className="g-radio">
              <input type="radio" name="g-ends" checked={ends === 'count'} onChange={() => setEnds('count')} />
              <span>אחרי</span>
              <input className="input g-num" type="number" min={1} max={999} value={count} onFocus={() => setEnds('count')} onChange={(e) => setCount(Number(e.target.value))} aria-label="כמה פעמים" />
              <span>מופעים</span>
            </label>
          </div>
        </div>
        <p className="g-recur-says" aria-live="polite">
          {describeRRule(rule, date)}
        </p>
      </div>
    </Modal>
  );
}

// ---------------- colour ----------------

/** The event's colour, as Google's menu: the calendar's own, then Google's eleven event colours. */
export function ColorMenu({ value, onChange, calendarColor = 'blue' }: { value: CalColor | null; onChange: (c: CalColor | null) => void; calendarColor?: CalColor }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const off = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const key = (e: KeyboardEvent) => e.key === 'Escape' && (e.stopPropagation(), setOpen(false));
    document.addEventListener('pointerdown', off);
    document.addEventListener('keydown', key, true);
    return () => {
      document.removeEventListener('pointerdown', off);
      document.removeEventListener('keydown', key, true);
    };
  }, [open]);
  const shown = value ?? calendarColor;
  return (
    <div className="g-color" ref={ref}>
      <button type="button" className="g-color-btn" aria-haspopup="true" aria-expanded={open} onClick={() => setOpen((o) => !o)} aria-label={`צבע האירוע: ${value ? CAL_COLOR_LABELS[value] : 'צבע היומן'}`} title="צבע האירוע">
        <span className={`g-dot c-${shown}`} />
        <Icon name="chevronDown" size={16} />
      </button>
      {open && (
        <div className="g-color-menu" role="radiogroup" aria-label="צבע האירוע">
          <button type="button" role="radio" aria-checked={!value} className={`g-swatch c-${calendarColor}${!value ? ' on' : ''}`} onClick={() => (onChange(null), setOpen(false))} title="צבע היומן" aria-label="צבע היומן">
            {!value && <Icon name="check" size={14} />}
          </button>
          {CAL_COLORS.map((c) => (
            <button key={c} type="button" role="radio" aria-checked={value === c} className={`g-swatch c-${c}${value === c ? ' on' : ''}`} onClick={() => (onChange(c), setOpen(false))} title={CAL_COLOR_LABELS[c]} aria-label={CAL_COLOR_LABELS[c]}>
              {value === c && <Icon name="check" size={14} />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------- notifications ----------------

const UNITS = [
  ['minutes', 'דקות', 1],
  ['hours', 'שעות', 60],
  ['days', 'ימים', 24 * 60],
  ['weeks', 'שבועות', 7 * 24 * 60],
] as const;
type Unit = (typeof UNITS)[number][0];
const unitOf = (minutes: number): { n: number; unit: Unit } => {
  for (const [u, , m] of [...UNITS].reverse()) if (minutes && minutes % m === 0) return { n: minutes / m, unit: u };
  return { n: minutes, unit: 'minutes' };
};
const factor = (u: Unit) => UNITS.find((x) => x[0] === u)![2];

/** "התראה: 30 דקות" rows, as Google's - each its number and unit, removable, and "הוספת התראה" */
export function RemindersEditor({ value, onChange }: { value: EventReminder[]; onChange: (r: EventReminder[]) => void }) {
  return (
    <div className="g-reminders">
      {value.map((r, i) => {
        const { n, unit } = unitOf(r.minutes);
        const put = (next: { n?: number; unit?: Unit }) => {
          const nn = Math.max(0, Math.min(999, Math.round(next.n ?? n)));
          const minutes = Math.min(40320, nn * factor(next.unit ?? unit));
          onChange(value.map((x, j) => (j === i ? { minutes } : x)));
        };
        return (
          <div key={i} className="g-reminder">
            <span className="g-reminder-kind">התראה</span>
            <input className="input g-num" type="number" min={0} max={999} value={n} onChange={(e) => put({ n: Number(e.target.value) })} aria-label="כמה זמן לפני" />
            <Select className="select g-unit" value={unit} onChange={(e) => put({ unit: e.target.value as Unit })} aria-label="יחידה">
              {UNITS.map(([u, l]) => (
                <option key={u} value={u}>
                  {l}
                </option>
              ))}
            </Select>
            <span className="small muted">לפני</span>
            <button type="button" className="icon-btn g-x" onClick={() => onChange(value.filter((_, j) => j !== i))} aria-label="הסרת ההתראה" title="הסרת ההתראה">
              <Icon name="x" size={16} />
            </button>
          </div>
        );
      })}
      {value.length < 5 && (
        <button type="button" className="g-link-btn" onClick={() => onChange([...value, { minutes: 30 }])}>
          הוספת התראה
        </button>
      )}
    </div>
  );
}

/** "30 דקות לפני", "שעה לפני", "יום לפני" */
export function reminderText(minutes: number): string {
  if (minutes === 0) return 'בזמן האירוע';
  const { n, unit } = unitOf(minutes);
  if (n === 1) return { minutes: 'דקה לפני', hours: 'שעה לפני', days: 'יום לפני', weeks: 'שבוע לפני' }[unit];
  if (n === 2 && unit !== 'minutes') return { hours: 'שעתיים לפני', days: 'יומיים לפני', weeks: 'שבועיים לפני' }[unit];
  return `${n} ${UNITS.find((u) => u[0] === unit)![1]} לפני`;
}

// ---------------- guests ----------------

export const RESPONSE_LABEL: Record<GuestResponse, string> = { accepted: 'מגיע/ה', declined: 'לא מגיע/ה', tentative: 'אולי', needsAction: 'עוד לא ענה/תה' };

/** an avatar with the answer on it, as Google marks a guest: a check, a cross, a question mark */
export function GuestAvatar({ name, response }: { name: string; response?: GuestResponse }) {
  const initials = name
    .replace(/["״']/g, '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join('');
  return (
    <span className="g-avatar" aria-hidden="true">
      {initials}
      {response && response !== 'needsAction' && <span className={`g-answer is-${response}`}>{response === 'accepted' ? '✓' : response === 'declined' ? '✕' : '?'}</span>}
    </span>
  );
}

/** "הוספת אורחים": the staff, each once, with their answers, optional or not - and what guests may do */
export function GuestsEditor({
  guests,
  onChange,
  perms,
  onPerms,
  organizerId,
}: {
  guests: { userId: number; optional?: boolean }[];
  onChange: (g: { userId: number; optional?: boolean }[]) => void;
  perms: { modify: boolean; invite: boolean; see: boolean };
  onPerms: (p: { modify: boolean; invite: boolean; see: boolean }) => void;
  organizerId?: number | null;
}) {
  const { staff, users } = useSession();
  const people = staff.length ? staff : users;
  const nameOf = (id: number) => people.find((u) => u.id === id)?.displayName ?? users.find((u) => u.id === id)?.displayName ?? '';
  const answered = new Map<number, GuestResponse>();
  for (const g of guests as EventGuest[]) if (g.response) answered.set(g.userId, g.response);
  const counts = { accepted: 0, declined: 0, tentative: 0, needsAction: 0 };
  for (const g of guests) counts[answered.get(g.userId) ?? 'needsAction']++;
  const free = people.filter((u) => !guests.some((g) => g.userId === u.id));
  return (
    <div className="g-guests">
      <Select className="select g-guest-add" value="" searchable aria-label="הוספת אורחים" onChange={(e) => e.target.value && onChange([...guests, { userId: Number(e.target.value) }])}>
        <option value="">הוספת אורחים</option>
        {free.map((u) => (
          <option key={u.id} value={u.id}>
            {u.displayName}
          </option>
        ))}
      </Select>
      {guests.length > 0 && (
        <>
          <div className="g-guest-sum">
            {guests.length} אורחים
            <span className="muted">
              {[counts.accepted && `${counts.accepted} כן`, counts.declined && `${counts.declined} לא`, counts.tentative && `${counts.tentative} אולי`, counts.needsAction && `${counts.needsAction} ממתינים`].filter(Boolean).join(', ')}
            </span>
          </div>
          <ul className="g-guest-list">
            {guests.map((g) => (
              <li key={g.userId} className="g-guest">
                <GuestAvatar name={nameOf(g.userId)} response={answered.get(g.userId)} />
                <span className="grow g-guest-name">
                  {nameOf(g.userId)}
                  {g.userId === organizerId && <span className="tiny muted"> · מארגן</span>}
                  {g.optional && <span className="tiny muted"> · אופציונלי</span>}
                  {answered.get(g.userId) && <span className="tiny muted"> · {RESPONSE_LABEL[answered.get(g.userId)!]}</span>}
                </span>
                <button type="button" className={`icon-btn g-x${g.optional ? ' on' : ''}`} onClick={() => onChange(guests.map((x) => (x.userId === g.userId ? { ...x, optional: !x.optional } : x)))} aria-pressed={!!g.optional} aria-label={g.optional ? 'חובה' : 'סימון כאופציונלי'} title={g.optional ? 'לסמן כחובה' : 'לסמן כאופציונלי'}>
                  <Icon name="help" size={16} />
                </button>
                <button type="button" className="icon-btn g-x" onClick={() => onChange(guests.filter((x) => x.userId !== g.userId))} aria-label={`הסרת ${nameOf(g.userId)}`} title="הסרה">
                  <Icon name="x" size={16} />
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
      <div className="g-perms">
        <div className="g-perms-title">הרשאות אורחים</div>
        <label className="g-check">
          <input type="checkbox" checked={perms.modify} onChange={(e) => onPerms({ ...perms, modify: e.target.checked })} /> שינוי האירוע
        </label>
        <label className="g-check">
          <input type="checkbox" checked={perms.invite} onChange={(e) => onPerms({ ...perms, invite: e.target.checked })} /> הזמנת אחרים
        </label>
        <label className="g-check">
          <input type="checkbox" checked={perms.see} onChange={(e) => onPerms({ ...perms, see: e.target.checked })} /> צפייה ברשימת האורחים
        </label>
      </div>
    </div>
  );
}

// ---------------- a moved event's tasks ----------------

function deltaText(min: number): string {
  const abs = Math.abs(min);
  const d = Math.floor(abs / 1440);
  const h = Math.floor((abs % 1440) / 60);
  const m = abs % 60;
  const parts = [d && `${d} ימים`, h && `${h} שעות`, m && `${m} דקות`].filter(Boolean).join(' ו-');
  return `${min > 0 ? 'קדימה' : 'אחורה'} ${parts}`;
}

/** the event moved: move its preparation tasks' deadlines along? (section 66) */
export function ShiftTasks({ tasks, delta, id, onClose }: { tasks: Task[]; delta: number; id: number; onClose: () => void }) {
  const toast = useToast();
  const [selected, setSelected] = useState<Set<number>>(new Set(tasks.map((t) => t.id)));
  const [error, setError] = useState<string | null>(null);
  const shift = async () => {
    try {
      const r = await api.post<{ shifted: number }>(`/api/events/${id}/shift-tasks`, { taskIds: [...selected], deltaMinutes: delta });
      toast({ title: `עודכנו ${r.shifted} דד-ליינים`, tone: 'green' });
      emitLocalChange('tasks');
      onClose();
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <Modal
      title="משימות שעשויות להיות מושפעות"
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-primary" onClick={() => void shift()} disabled={!selected.size}>
            הזז {selected.size} דד-ליינים
          </button>
          <button className="btn btn-ghost" onClick={onClose}>
            השאר כמו שהן
          </button>
        </>
      }
    >
      <div className="col gap-16">
        <div className="info-box">
          הפעילות הוזזה <b>{deltaText(delta)}</b>. לעדכן גם את הדד-ליינים של משימות ההכנה המקושרות?
        </div>
        {tasks.map((t) => (
          <label key={t.id} className="check">
            <input
              type="checkbox"
              checked={selected.has(t.id)}
              onChange={(e) => {
                const n = new Set(selected);
                if (e.target.checked) n.add(t.id);
                else n.delete(t.id);
                setSelected(n);
              }}
            />
            <span className="grow">
              <b>{t.title}</b>
              <span className="tiny muted">
                {' '}
                · {t.ownerName} · {fmtDeadline(t.deadline)} ← {fmtDeadline(new Date(Date.parse(t.deadline) + delta * 60000).toISOString())}
              </span>
            </span>
          </label>
        ))}
        <ErrorBox error={error} />
      </div>
    </Modal>
  );
}
