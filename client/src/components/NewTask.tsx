// Section 8 + 33: "+ משימה" must be faster than a WhatsApp message:
// name, owner, deadline, send. Section 27: or just write a sentence.

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { ABSENCE_REASON_LABELS, PRIORITIES, PRIORITY_LABELS, VISIBILITIES, VISIBILITY_LABELS, type Priority, type Visibility } from '@shared/constants';
import { addDays, shortDate, startOfWeek, weekdayOf } from '@shared/dates';
import type { UserLoad } from '@shared/types';
import { parseTaskText, type ParsedTask } from '@shared/parser';
import { api } from '../lib/api';
import { dateKeyOf, fmtDeadline, fmtTime, getTz, isoAt, todayKey } from '../lib/format';
import { emitLocalChange } from '../lib/realtime';
import { useSession } from '../lib/session';
import { useApi } from '../lib/useApi';
import { Icon } from './Icon';
import { useToast } from './Toasts';
import { ErrorBox, Field, Modal, Seg } from './ui';

export interface NewTaskInitial {
  title?: string;
  ownerIds?: number[];
  allStaff?: boolean;
  deadline?: string;
  weekId?: number | null;
  eventId?: number | null;
  parentId?: number | null;
  meetingId?: number | null;
  domain?: string;
  priority?: Priority;
  description?: string;
  text?: string;
  heading?: string;
}

const Ctx = createContext<(initial?: NewTaskInitial, onCreated?: (ids: number[]) => void) => void>(() => undefined);
export const useNewTask = () => useContext(Ctx);

export function NewTaskProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<{ initial: NewTaskInitial; onCreated?: (ids: number[]) => void } | null>(null);
  const open = useCallback((initial: NewTaskInitial = {}, onCreated?: (ids: number[]) => void) => setState({ initial, onCreated }), []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)) return;
      // not on top of an open dialog
      if (document.querySelector('.modal')) return;
      if ((e.key === 'n' || e.key === 'מ') && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        open();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  return (
    <Ctx.Provider value={open}>
      {children}
      {state && (
        <NewTaskModal
          initial={state.initial}
          onClose={() => setState(null)}
          onCreated={(ids) => {
            state.onCreated?.(ids);
            setState(null);
          }}
        />
      )}
    </Ctx.Provider>
  );
}

export function quickDeadlines(defaultTime: string): { label: string; date: string; time: string }[] {
  const today = todayKey();
  const thursday = (() => {
    const t = addDays(startOfWeek(today), 4);
    return t >= today ? t : addDays(t, 7);
  })();
  const out = [
    { label: `היום ${defaultTime}`, date: today, time: defaultTime },
    { label: 'מחר 12:00', date: addDays(today, 1), time: '12:00' },
    { label: `מחר ${defaultTime}`, date: addDays(today, 1), time: defaultTime },
  ];
  if (weekdayOf(today) < 4) out.push({ label: 'סוף השבוע', date: thursday, time: '16:00' });
  out.push({ label: 'בעוד שבוע', date: addDays(today, 7), time: defaultTime });
  return out;
}

export function DateTimeInputs({ date, time, onDate, onTime }: { date: string; time: string; onDate: (v: string) => void; onTime: (v: string) => void }) {
  return (
    <div className="row gap-6">
      <input className="input" type="date" value={date} onChange={(e) => onDate(e.target.value)} required aria-label="תאריך" style={{ flex: 1.4 }} />
      <input className="input" type="time" value={time} onChange={(e) => onTime(e.target.value)} required aria-label="שעה" style={{ flex: 1 }} />
    </div>
  );
}

export function UserPicker({
  value,
  onChange,
  allowAll,
  all,
  onAll,
  multiple = true,
  date,
}: {
  value: number[];
  onChange: (ids: number[]) => void;
  allowAll?: boolean;
  all?: boolean;
  onAll?: (v: boolean) => void;
  multiple?: boolean;
  /** the day the task is due: who is away then, and what else they have that day */
  date?: string;
}) {
  const { users, user, settings } = useSession();
  // how loaded each person is, and who is away - so a task goes to someone who can take it
  const load = useApi<UserLoad[]>(`/api/load${date ? `?date=${date}` : ''}`, ['tasks', 'users']).data;
  const loadOf = (id: number) => load?.find((l) => l.userId === id);
  const people = [...users].sort((a, b) => (a.id === user.id ? -1 : b.id === user.id ? 1 : a.role === b.role ? a.displayName.localeCompare(b.displayName, 'he') : a.role === 'staff' ? -1 : 1));
  const heavy = (n: number) => (n >= settings.overloadThreshold ? 't-red' : n >= Math.ceil(settings.overloadThreshold * 0.6) ? 't-orange' : '');
  const awayChosen = all ? [] : value.map((id) => ({ u: users.find((x) => x.id === id), l: loadOf(id) })).filter((x) => x.u && x.l?.away);
  return (
    <div className="col gap-6">
      <div className="chips">
        {allowAll && (
          <button type="button" className={`chip${all ? ' on' : ''}`} onClick={() => onAll?.(!all)}>
            <Icon name="users" size={15} /> כל הסגל
          </button>
        )}
        {people.map((u) => {
          const on = !all && value.includes(u.id);
          const l = loadOf(u.id);
          const name = u.id === user.id ? `אני (${u.displayName})` : u.displayName;
          const about = l
            ? [
                l.away && `${ABSENCE_REASON_LABELS[l.away.reason]} עד ${shortDate(l.away.endDate)}`,
                `${l.week} משימות פתוחות בשבוע הקרוב`,
                l.overdue ? `${l.overdue} באיחור` : '',
                date && l.onDay ? `${l.onDay} באותו יום` : '',
              ]
                .filter(Boolean)
                .join(' · ')
            : '';
          return (
            <button
              key={u.id}
              type="button"
              className={`chip${on ? ' on' : ''}${l?.away ? ' chip-away' : ''}`}
              title={about || undefined}
              aria-label={about ? `${name} - ${about}` : name}
              aria-pressed={on}
              onClick={() => {
                onAll?.(false);
                if (!multiple) onChange([u.id]);
                else onChange(on ? value.filter((v) => v !== u.id) : [...value, u.id]);
              }}
            >
              {name}
              {l?.away ? (
                <span className="chip-note">{ABSENCE_REASON_LABELS[l.away.reason]}</span>
              ) : (
                l && l.week > 0 && (
                  <span className={`chip-load ${heavy(l.week)}`} aria-hidden="true">
                    {l.week}
                  </span>
                )
              )}
            </button>
          );
        })}
      </div>
      {awayChosen.map(({ u, l }) => (
        <span key={u!.id} className="small text-orange away-warn" role="status">
          <Icon name="alert" size={13} /> {u!.displayName} ב{ABSENCE_REASON_LABELS[l!.away!.reason]} {date ? `ב-${shortDate(date)}` : 'היום'} (עד {shortDate(l!.away!.endDate)}) - אולי מישהו אחר?
        </span>
      ))}
    </div>
  );
}

function NewTaskModal({ initial, onClose, onCreated }: { initial: NewTaskInitial; onClose: () => void; onCreated: (ids: number[]) => void }) {
  const { user, isCommander, settings, users, weeks } = useSession();
  const toast = useToast();
  const defaultTime = settings.defaultDeadlineTime;
  const initDate = initial.deadline ? dateKeyOf(initial.deadline) : '';
  const initTime = initial.deadline ? fmtTime(initial.deadline) : defaultTime;

  const [text, setText] = useState(initial.text ?? '');
  const [title, setTitle] = useState(initial.title ?? '');
  const [ownerIds, setOwnerIds] = useState<number[]>(initial.ownerIds ?? (isCommander ? [] : [user.id]));
  const [allStaff, setAllStaff] = useState(!!initial.allStaff);
  const [mode, setMode] = useState<'shared' | 'copies'>('shared');
  const [date, setDate] = useState(initDate);
  const [time, setTime] = useState(initTime);
  const [more, setMore] = useState(false);
  const [description, setDescription] = useState(initial.description ?? '');
  const [priority, setPriority] = useState<Priority>(initial.priority ?? 'normal');
  const [domain, setDomain] = useState(initial.domain ?? '');
  const [weekId, setWeekId] = useState<string>(initial.weekId ? String(initial.weekId) : 'auto');
  const [requiresApproval, setRequiresApproval] = useState(false);
  const [visibility, setVisibility] = useState<Visibility>('normal');
  const [link, setLink] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [parsed, setParsed] = useState<ParsedTask | null>(null);

  const applyText = useCallback(
    (value: string) => {
      setText(value);
      if (!value.trim()) {
        setParsed(null);
        return;
      }
      const p = parseTaskText(value, {
        users: users.map((u) => ({ id: u.id, displayName: u.displayName, title: u.title })),
        weeks: weeks.map((w) => ({ id: w.id, name: w.name })),
        domains: settings.domains,
        tz: getTz(),
        defaultTime,
      });
      setParsed(p);
      if (p.title) setTitle(p.title);
      if (p.allStaff && isCommander) setAllStaff(true);
      else if (p.ownerIds.length) {
        setAllStaff(false);
        setOwnerIds(p.ownerIds);
      }
      if (p.deadlineDate) setDate(p.deadlineDate);
      if (p.deadlineTime) setTime(p.deadlineTime);
      if (p.priority) setPriority(p.priority);
      if (p.domain) setDomain(p.domain);
      if (p.weekId) setWeekId(String(p.weekId));
      if (p.priority || p.domain || p.weekId) setMore(true);
    },
    [users, weeks, settings.domains, defaultTime, isCommander],
  );

  useEffect(() => {
    if (initial.text) applyText(initial.text);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const quick = useMemo(() => quickDeadlines(defaultTime), [defaultTime]);
  const deadlineIso = date && time ? isoAt(date, time) : null;
  const hasMany = !allStaff && ownerIds.length > 1;
  // what the form holds now - picked by hand or read from the sentence
  const ownerNames = allStaff ? ['כל הסגל'] : ownerIds.map((id) => users.find((u) => u.id === id)?.displayName ?? '');
  const missing = [!title.trim() && 'שם', !allStaff && !ownerIds.length && 'אחראי', !deadlineIso && 'דד-ליין'].filter((x): x is string => !!x);

  const submit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    setError(null);
    if (!title.trim()) return setError('חובה למלא שם משימה');
    if (!allStaff && !ownerIds.length) return setError('חובה לבחור אחראי');
    if (!deadlineIso) return setError('כל משימה חייבת דד-ליין - משימה בלי זמן היא רק תזכורת');
    setBusy(true);
    try {
      const res = await api.post<{ ids: number[] }>('/api/tasks', {
        title: title.trim(),
        description,
        assignMode: allStaff ? 'all' : mode,
        ownerIds: allStaff ? [] : ownerIds,
        deadline: deadlineIso,
        priority,
        domain,
        weekId: weekId === 'auto' ? undefined : weekId === 'none' ? null : Number(weekId),
        eventId: initial.eventId ?? null,
        parentId: initial.parentId ?? null,
        meetingId: initial.meetingId ?? null,
        requiresApproval,
        visibility,
        links: link.trim() ? [{ url: link.trim() }] : [],
      });
      toast({
        title: res.ids.length > 1 ? `נפתחו ${res.ids.length} משימות` : 'המשימה נפתחה',
        body: `${title.trim()} · ${fmtDeadline(deadlineIso)}`,
        tone: 'green',
      });
      emitLocalChange('tasks');
      onCreated(res.ids);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={initial.heading ?? 'משימה חדשה'} onClose={onClose}>
      <form
        onSubmit={submit}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) void submit();
        }}
        className="col gap-16"
      >
        <div>
          <div className="nl-box">
            <input
              className="input"
              value={text}
              onChange={(e) => applyText(e.target.value)}
              placeholder='כתבו משפט: "מפק"צ 2 לסגור את המטווח עד רביעי 18:00 בעדיפות גבוהה"'
              aria-label="יצירת משימה בטקסט חופשי"
              data-autofocus
            />
            <span className="btn btn-sm btn-ghost" aria-hidden style={{ pointerEvents: 'none' }}>
              <Icon name="zap" /> זיהוי
            </span>
          </div>
          {parsed && (
            <div className="parse-preview" aria-live="polite">
              {title.trim() && <span className="badge t-gray">משימה: {title.trim()}</span>}
              {ownerNames.map((n) => (
                <span key={n} className="badge t-blue">
                  אחראי: {n}
                </span>
              ))}
              {deadlineIso && <span className="badge t-green">דד-ליין: {fmtDeadline(deadlineIso)}</span>}
              {priority !== 'normal' && <span className="badge t-orange">עדיפות: {PRIORITY_LABELS[priority]}</span>}
              {missing.map((m) => (
                <span key={m} className="badge t-red">
                  חסר {m}
                </span>
              ))}
            </div>
          )}
        </div>

        <Field label="שם המשימה" required>
          <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder='לדוגמה: לסגור לו"ז לשבוע התקפה' maxLength={200} />
        </Field>

        <Field label="אחראי" required hint={!isCommander ? 'ניתן לפתוח משימות לאחרים רק בשבוע שבאחריותך' : undefined}>
          <UserPicker value={ownerIds} onChange={setOwnerIds} allowAll={isCommander} all={allStaff} onAll={setAllStaff} date={date || undefined} />
        </Field>
        {hasMany && (
          <Seg
            wrap
            value={mode}
            onChange={setMode}
            options={[
              { value: 'shared', label: `משימה משותפת - אחראי ראשי: ${users.find((u) => u.id === ownerIds[0])?.displayName ?? ''}` },
              { value: 'copies', label: 'עותק נפרד לכל אחד' },
            ]}
          />
        )}
        {allStaff && <div className="info-box">תיפתח משימה נפרדת לכל איש סגל, ותוכל לראות מי השלים ומי עדיין לא.</div>}

        <Field label="דד-ליין" required>
          <DateTimeInputs date={date} time={time} onDate={setDate} onTime={setTime} />
          <div className="chips mt-8">
            {quick.map((q) => (
              <button
                key={q.label}
                type="button"
                className={`chip chip-sm${date === q.date && time === q.time ? ' on' : ''}`}
                onClick={() => {
                  setDate(q.date);
                  setTime(q.time);
                }}
              >
                {q.label}
              </button>
            ))}
          </div>
        </Field>

        <button type="button" className="btn btn-ghost btn-sm" style={{ alignSelf: 'flex-start' }} onClick={() => setMore(!more)}>
          <Icon name={more ? 'chevronDown' : 'chevronLeft'} /> פרטים נוספים
        </button>

        {more && (
          <div className="form-grid">
            <Field label="פירוט" className="span-2">
              <textarea className="textarea" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="מה בדיוק צריך לבצע" />
            </Field>
            <Field label="עדיפות" className="span-2">
              <Seg value={priority} onChange={setPriority} options={PRIORITIES.map((p) => ({ value: p, label: PRIORITY_LABELS[p] }))} />
            </Field>
            <Field label="תחום">
              <select className="select" value={domain} onChange={(e) => setDomain(e.target.value)}>
                <option value="">ללא</option>
                {settings.domains.map((d) => (
                  <option key={d}>{d}</option>
                ))}
              </select>
            </Field>
            <Field label="שבוע בקורס">
              <select className="select" value={weekId} onChange={(e) => setWeekId(e.target.value)}>
                <option value="auto">אוטומטי לפי הדד-ליין</option>
                <option value="none">ללא שבוע</option>
                {weeks.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="נראות">
              <select className="select" value={visibility} onChange={(e) => setVisibility(e.target.value as Visibility)}>
                {VISIBILITIES.map((v) => (
                  <option key={v} value={v}>
                    {VISIBILITY_LABELS[v]}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="קישור / מסמך">
              <input className="input" type="url" dir="ltr" value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://drive.google.com/..." />
            </Field>
            <label className="check span-2">
              <input type="checkbox" checked={requiresApproval} onChange={(e) => setRequiresApproval(e.target.checked)} />
              נדרש אישור מפקד לסגירת המשימה
            </label>
          </div>
        )}
        <ErrorBox error={error} />
        {/* stays in view while the form scrolls */}
        <div className="fab-dock">
          <span className="tiny muted hide-mobile fab-hint">
            <span className="kbd">Ctrl</span>+<span className="kbd">Enter</span> לשליחה
          </span>
          {missing.length > 0 && <span className="fab-missing">חסר: {missing.join(', ')}</span>}
          <button className={`btn btn-primary fab-send${missing.length ? ' incomplete' : ''}`} type="submit" disabled={busy}>
            <Icon name="check" /> {busy ? 'שולח...' : 'שלח'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
