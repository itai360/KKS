// The weekly (שבועי): the staff's meeting of a course week, in the order it runs - the week's schedule,
// the professional closures, the topics the team commanders raise, and the commander's points at the end.
// What comes up during the week is added here or from the bottom bar's "+"; holding it sends the summary
// to the staff and moves what was left open to the next week's weekly (server/src/weekly.ts).

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router';
import { addDays, diffDays, shortDate, weekdayName } from '@shared/dates';
import type { ExternalEvent } from '@shared/types';
import { WEEKLY_DONE_LABELS, WEEKLY_KIND_LABELS, weeklySummaryText, type WeeklyHoldResult, type WeeklyItem, type WeeklyKind, type WeeklyTarget, type WeeklyView } from '@shared/weekly';
import { ask } from '../components/Confirm';
import { Icon } from '../components/Icon';
import { useNewTask } from '../components/NewTask';
import { usePhonePicker } from '../components/pickers';
import { SectionRail } from '../components/SectionRail';
import { useSwipeAction } from '../components/swipeAction';
import { TaskRow, useLiveFlash } from '../components/TaskRow';
import { useToast } from '../components/Toasts';
import { Empty, ErrorBox, Field, Loading, Modal, PageError, PageHead, Select } from '../components/ui';
import { api } from '../lib/api';
import { fmtAgo, fmtDateTime, todayKey } from '../lib/format';
import { useFresh } from '../lib/fresh';
import { haptic } from '../lib/haptics';
import { emitLocalChange } from '../lib/realtime';
import { useSession } from '../lib/session';
import { useApi } from '../lib/useApi';

/** /weekly: the weekly coming up - the week on now until its weekly is held, then the next */
export function WeeklyHome() {
  const { data, error, status } = useApi<WeeklyTarget>('/api/weekly/target', ['weekly', 'weeks']);
  if (data?.weekId) return <Navigate to={`/weekly/${data.weekId}`} replace />;
  return (
    <div className="page">
      <PageHead title="שבועי" sub="הישיבה השבועית של הסגל: הלו״ז, סגירות מקצועיות, נושאים לשיח ודגשי המפקד." />
      {data ? (
        <Empty
          icon="weekly"
          title="אין עדיין שבועות בקורס"
          text={
            <>
              השבועי שייך לשבוע בקורס. <Link to="/weeks">להוספת שבועות</Link>
            </>
          }
        />
      ) : error ? (
        <PageError error={error} status={status} what="השבועי" back="/weeks" backLabel="לשבועות הקורס" />
      ) : (
        <Loading rows={4} />
      )}
    </div>
  );
}

const SECTIONS: { kind: WeeklyKind; id: string; title: string; icon: string }[] = [
  { kind: 'schedule', id: 'weekly-schedule', title: 'לו"ז השבוע', icon: 'calendar' },
  { kind: 'closure', id: 'weekly-closures', title: 'סגירות מקצועיות', icon: 'check' },
  { kind: 'topic', id: 'weekly-topics', title: 'נושאים לשיח', icon: 'hand' },
  { kind: 'point', id: 'weekly-points', title: 'דגשי המפקד', icon: 'flag' },
];

export function WeeklyPage() {
  const { weekId } = useParams();
  const { data, error, loading, status } = useApi<WeeklyView>(`/api/weekly/${weekId}`, ['weekly', 'tasks', 'events', 'weeks']);
  const external = useApi<ExternalEvent[]>(data ? `/api/calendar/external?from=${data.week.startDate}&to=${data.week.endDate}` : null, ['events']);
  const navigate = useNavigate();
  const toast = useToast();
  const [editing, setEditing] = useState<WeeklyItem | null>(null);
  const [holding, setHolding] = useState(false);
  // summed up while the page is open: the banner that says so arrives with a moment's glow
  // (the same week's weekly, not yet held a moment ago: not a page opened on one already held, nor another week)
  const heldWeek = data?.week.id;
  const heldAt = data ? (data.heldAt ?? null) : undefined;
  const wasHeld = useRef<{ week: number; at: string | null } | null>(null);
  const [justHeld, setJustHeld] = useState(false);
  useEffect(() => {
    if (heldWeek === undefined || heldAt === undefined) return;
    const before = wasHeld.current;
    wasHeld.current = { week: heldWeek, at: heldAt };
    const now = !!before && before.week === heldWeek && !before.at && !!heldAt;
    setJustHeld(now);
    if (now) haptic('success');
  }, [heldWeek, heldAt]);

  if (loading && !data)
    return (
      <div className="page">
        <Loading rows={5} />
      </div>
    );
  if (!data)
    return (
      <div className="page">
        <PageError error={error} status={status} what="השבועי" back="/weeks" backLabel="לשבועות הקורס" />
      </div>
    );

  const w = data.week;
  const held = !!data.heldAt;
  const canAdd = !held || data.canHold;
  const today = todayKey();
  const of = (k: WeeklyKind) => data.items.filter((i) => i.kind === k);
  const editingItem = editing ? data.items.find((i) => i.id === editing.id) : undefined;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(weeklySummaryText(data));
      toast({ title: 'הסיכום הועתק', body: 'אפשר להדביק אותו בקבוצת הוואטסאפ של הסגל.', tone: 'green' });
    } catch {
      toast({ title: 'ההעתקה לא הצליחה', body: 'הדפדפן לא איפשר גישה ללוח.', tone: 'red' });
    }
  };
  const reopen = async () => {
    if (!(await ask({ title: 'לפתוח את השבועי מחדש?', body: 'אפשר יהיה לשנות הכול ולסכם שוב. הסגל יקבל את הסיכום מחדש.', confirm: 'פתיחה מחדש' }))) return;
    try {
      await api.post(`/api/weekly/${w.id}/reopen`);
      emitLocalChange('weekly');
    } catch (e) {
      toast({ title: (e as Error).message, tone: 'red' });
    }
  };

  return (
    // another week's weekly: its own page (what was there when it opened, what came in since)
    <div className="page weekly-page" key={w.id}>
      <PageHead
        eyebrow={
          <Link to={`/weeks/${w.id}`} className="muted">
            שבועות הקורס · שבוע {w.number}
          </Link>
        }
        title={`שבועי - ${w.name}`}
        sub={
          <>
            <span className="mono">
              {shortDate(w.startDate)}-{shortDate(w.endDate)}
            </span>
            {w.leadName && ` · מפק"צ אחראי: ${w.leadName}`}
            {' · '}
            {held ? `התקיים ${fmtDateTime(data.heldAt!)}${data.heldByName ? ` · סוכם ע"י ${data.heldByName}` : ''}` : w.endDate < today ? 'עוד לא סוכם' : 'בהכנה'}
          </>
        }
        actions={
          <>
            <Select value={w.id} onChange={(e) => navigate(`/weekly/${e.target.value}`)} aria-label="מעבר לשבועי של שבוע אחר" className="select weekly-week-pick">
              {data.weeks.map((x) => (
                <option key={x.id} value={x.id}>
                  {`שבוע ${x.number} - ${x.name}${x.heldAt ? ' ✓' : ''}`}
                </option>
              ))}
            </Select>
            <button className="btn btn-ghost" onClick={() => void copy()} title="העתקת הסיכום כטקסט, להדבקה בוואטסאפ">
              <Icon name="clip" /> העתקת סיכום
            </button>
            {data.canHold &&
              (held ? (
                <button className="btn" onClick={() => void reopen()}>
                  <Icon name="repeat" /> פתיחה מחדש
                </button>
              ) : (
                <button className="btn btn-primary" onClick={() => setHolding(true)}>
                  <Icon name="check" /> סיכום השבועי
                </button>
              ))}
          </>
        }
      />

      {held && (
        <div className={`weekly-held card card-pad row wrap${justHeld ? ' just-cleared' : ''}`} role="status">
          <Icon name="check" className="text-green" />
          <span className="grow small">
            <b>השבועי התקיים והסיכום נשלח לסגל.</b> {data.next && 'מה שעולה מעכשיו נכנס לשבועי הבא.'}
          </span>
          {data.next && (
            <Link to={`/weekly/${data.next.id}`} className="btn btn-sm">
              לשבועי של {data.next.name}
              <Icon name="chevronLeft" size={15} />
            </Link>
          )}
        </div>
      )}

      <nav className="weekly-agenda" aria-label="סדר השבועי">
        {SECTIONS.map((s, i) => {
          const items = of(s.kind);
          const open = items.filter((x) => !x.done).length;
          const n = s.kind === 'point' && data.pointsHidden ? null : s.kind === 'schedule' ? data.events.filter((e) => !e.cancelled).length + (external.data?.length ?? 0) : items.length;
          return (
            <a
              key={s.kind}
              href={`#${s.id}`}
              className="weekly-step"
              onClick={(e) => {
                e.preventDefault();
                document.getElementById(s.id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
              }}
            >
              <span className="weekly-step-n" aria-hidden="true">
                {i + 1}
              </span>
              <span className="grow">
                <span className="weekly-step-title">{s.title}</span>
                <span className="tiny muted">
                  {n === null
                    ? 'בסוף השבועי'
                    : s.kind === 'schedule'
                      ? `${n} אירועים${items.length ? ` · ${items.length} הערות` : ''}`
                      : n === 0
                        ? 'אין עדיין'
                        : s.kind === 'point'
                          ? `${n} דגשים`
                          : `${n} ·${open ? `${open} פתוחים` : `כולם ${s.kind === 'closure' ? 'נסגרו' : 'נדונו'}`}`}
                </span>
              </span>
            </a>
          );
        })}
      </nav>
      <SectionRail
        label="השלב בשבועי"
        wide
        items={SECTIONS.map((s, i) => {
          const items = of(s.kind);
          const open = items.filter((x) => !x.done).length;
          const settles = s.kind === 'closure' || s.kind === 'topic';
          return { id: s.id, n: i + 1, label: s.title, state: settles && items.length && !open ? 'ok' : null, count: settles && open ? `${open} פתוחים` : undefined };
        })}
      />

      <div className="col gap-16">
        <Section n={1} {...SECTIONS[0]} hint="עוברים על הלו״ז יום אחרי יום. הערה על אירוע - בכפתור שליד האירוע.">
          <ScheduleDays view={data} external={external.data ?? []} canAdd={canAdd} onEdit={setEditing} />
        </Section>

        <Section n={2} {...SECTIONS[1]} hint="תיאומים מקצועיים שצריך לסגור, ומי סוגר כל אחד." progress={settled(of('closure'))}>
          <Items items={of('closure')} onEdit={setEditing} empty="אין עדיין סגירות מקצועיות לשבוע הזה." />
          {canAdd && <QuickAdd weekId={w.id} kind="closure" placeholder="סגירה מקצועית חדשה - למשל: אישור שטח אש" />}
          {data.openTasks.length > 0 && (
            <details className="weekly-tasks">
              <summary className="small">
                <Icon name="tasks" size={15} />
                <span className="grow strong">משימות השבוע שעוד פתוחות</span>
                <span className="count-pill">{data.openTasks.length}</span>
                <Icon name="chevronDown" size={15} />
              </summary>
              <div className="list mt-8">
                {data.openTasks.slice(0, 8).map((t) => (
                  <TaskRow key={t.id} task={t} />
                ))}
              </div>
              {data.openTasks.length > 8 && (
                <Link to={`/weeks/${w.id}`} className="btn btn-ghost btn-sm mt-8">
                  לכל משימות השבוע
                  <Icon name="chevronLeft" size={15} />
                </Link>
              )}
            </details>
          )}
        </Section>

        <Section n={3} {...SECTIONS[2]} hint="מה שעלה במהלך השבוע והמפק״צים רוצים להעלות לשיח. בשבועי מסמנים ״נדון״ וכותבים מה הוחלט." progress={settled(of('topic'))}>
          <Items items={of('topic')} onEdit={setEditing} empty="אין עדיין נושאים. כל אחד בסגל יכול להוסיף - כאן, או מה-+ בסרגל התחתון בטלפון." />
          {canAdd && <QuickAdd weekId={w.id} kind="topic" placeholder="נושא לשיח - למשל: עומס השמירות על הצוערים" />}
        </Section>

        <Section n={4} {...SECTIONS[3]} hint={data.canHold ? 'הדגשים שלך לסוף השבועי - גם מה שעלה לך במהלך השבוע. רק אתה רואה אותם, גם אחרי הסיכום.' : undefined}>
          {data.pointsHidden ? (
            <div className="weekly-locked small">
              <Icon name="lock" size={16} />
              <span>מפקד הקורס יציג את הדגשים שלו בסוף השבועי.</span>
            </div>
          ) : (
            <>
              <Items items={of('point')} onEdit={setEditing} empty={data.canHold ? 'אין עדיין דגשים. כתוב כאן מה חשוב לך שיעלה בסוף השבועי.' : 'לא נכתבו דגשים בשבועי הזה.'} numbered />
              {data.canHold && canAdd && <QuickAdd weekId={w.id} kind="point" placeholder="דגש לסוף השבועי" />}
            </>
          )}
        </Section>
      </div>

      {/* the item may go while its dialog is open (deleted, or moved on to the next weekly) */}
      {editingItem && <ItemDialog item={editingItem} weekId={w.id} onClose={() => setEditing(null)} />}
      {holding && <HoldDialog view={data} onClose={() => setHolding(false)} />}
    </div>
  );
}

/** of a part's items, how many are settled (closed, discussed) - none to show while it has none */
const settled = (items: WeeklyItem[]) => (items.length ? { done: items.filter((i) => i.done).length, total: items.length } : undefined);

function Section({ n, id, title, icon, hint, progress, children }: { n: number; id: string; title: string; icon: string; hint?: string; progress?: { done: number; total: number }; children: ReactNode }) {
  const all = !!progress && progress.done === progress.total;
  return (
    <section className="card weekly-section" id={id} aria-labelledby={`${id}-h`}>
      <div className="card-head">
        <span className="weekly-step-n" aria-hidden="true">
          {n}
        </span>
        <Icon name={icon} />
        <h2 className="grow" id={`${id}-h`}>
          {title}
        </h2>
        {progress && (
          <span className={`weekly-progress${all ? ' is-all' : ''}`} title={`${progress.done} מתוך ${progress.total}`}>
            <span className="mono tiny">
              {progress.done}/{progress.total}
            </span>
            <span className="mini-bar" aria-hidden="true">
              <i style={{ width: `${(progress.done / progress.total) * 100}%` }} />
            </span>
          </span>
        )}
      </div>
      <div className="card-body col gap-12">
        {hint && <p className="tiny muted weekly-hint">{hint}</p>}
        {children}
      </div>
    </section>
  );
}

/** a line to add with Enter - the way to keep up during the meeting itself */
function QuickAdd({ weekId, kind, placeholder, eventRef, eventDate, onDone }: { weekId: number; kind: WeeklyKind; placeholder: string; eventRef?: string; eventDate?: string; onDone?: () => void }) {
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const add = async () => {
    if (!title.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await api.post('/api/weekly/items', { weekId, kind, title: title.trim(), eventRef: eventRef ?? null, eventDate: eventDate ?? null });
      setTitle('');
      emitLocalChange('weekly');
      onDone?.();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <form
      className="weekly-quick"
      onSubmit={(e) => {
        e.preventDefault();
        void add();
      }}
    >
      <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder={placeholder} aria-label={placeholder} maxLength={300} autoFocus={!!eventRef} onKeyDown={(e) => {
          if (e.key !== 'Escape' || !onDone) return;
          e.stopPropagation();
          onDone();
        }}
      />
      <button className="btn btn-sm" disabled={busy || !title.trim()}>
        <Icon name="plus" /> הוספה
      </button>
      {error && <ErrorBox error={error} />}
    </form>
  );
}

function Items({ items, onEdit, empty, numbered }: { items: WeeklyItem[]; onEdit: (i: WeeklyItem) => void; empty: string; numbered?: boolean }) {
  const fresh = useFresh(items.map((i) => i.id));
  if (!items.length) return <p className="small muted">{empty}</p>;
  const Tag = numbered ? 'ol' : 'ul';
  return (
    <Tag className={`weekly-items${numbered ? ' numbered' : ''}`}>
      {items.map((i) => (
        <ItemRow key={i.id} item={i} onEdit={onEdit} fresh={fresh(i.id)} />
      ))}
    </Tag>
  );
}

function ItemRow({ item: i, onEdit, fresh }: { item: WeeklyItem; onEdit: (i: WeeklyItem) => void; fresh?: boolean }) {
  const toast = useToast();
  // marked at once; the answer from the server takes over when it comes
  const [mine, setMine] = useState<boolean | null>(null);
  useEffect(() => {
    setMine(null);
  }, [i.done]);
  const done = mine ?? i.done;
  const toggle = async () => {
    const next = !done;
    setMine(next);
    try {
      await api.patch(`/api/weekly/items/${i.id}`, { done: next });
      emitLocalChange('weekly');
    } catch (e) {
      setMine(null);
      toast({ title: (e as Error).message, tone: 'red' });
    }
  };
  const open = i.canEdit || i.canSettle;
  const flash = useLiveFlash(`${i.done}|${i.title}|${i.outcome}|${i.ownerId}`);
  // on a phone, swiped toward its leading side it is closed / discussed (or open again)
  const row = useRef<HTMLDivElement>(null);
  const swipes = i.kind !== 'point' && i.canSettle;
  useSwipeAction(row, { enabled: usePhonePicker() && swipes, lead: () => void toggle() });
  return (
    <li className={`${swipes ? 'swipe-wrap weekly-swipe' : ''}${fresh ? ' is-new' : ''}`}>
      {swipes && (
        <div className="swipe-pad is-lead" aria-hidden="true">
          <Icon name={done ? 'repeat' : 'check'} size={20} />
          <span>{done ? 'פתוח שוב' : WEEKLY_DONE_LABELS[i.kind]}</span>
        </div>
      )}
      <div ref={row} className={`${swipes ? 'swipe-row ' : ''}weekly-item${done ? ' done' : ''}${flash ? ' flash' : ''}`}>
        {i.kind !== 'point' && (
          <button
            type="button"
            className={`task-check small${done ? ' checked' : ''}${mine ? ' just-checked' : ''}`}
            role="checkbox"
            aria-checked={done}
            aria-label={`${WEEKLY_DONE_LABELS[i.kind]}: ${i.title}`}
            title={i.canSettle ? (done ? `סומן ${WEEKLY_DONE_LABELS[i.kind]} - לחיצה מבטלת` : `סימון ${WEEKLY_DONE_LABELS[i.kind]}`) : WEEKLY_DONE_LABELS[i.kind]}
            disabled={!i.canSettle}
            onClick={() => void toggle()}
          >
            <Icon name="check" />
          </button>
        )}
        <div className="grow weekly-item-main">
          {open ? (
            <button type="button" className="weekly-item-title" onClick={() => onEdit(i)}>
              {i.title}
            </button>
          ) : (
            <span className="weekly-item-title">{i.title}</span>
          )}
          {i.details && <div className="small weekly-item-details">{i.details}</div>}
          {i.outcome && (
            <div className="small weekly-outcome">
              <b>הוחלט:</b> {i.outcome}
            </div>
          )}
          <div className="weekly-item-meta tiny muted">
            {i.kind === 'closure' && <span className={`badge${i.ownerName ? ' t-blue' : ''}`}>{i.ownerName ? `סוגר: ${i.ownerName}` : 'עוד לא נקבע מי סוגר'}</span>}
            {i.carriedFrom && <span className="badge t-yellow">עבר מ{i.carriedFrom.name}</span>}
            {i.taskId && (
              <Link to={`/tasks/${i.taskId}`} className="badge t-green">
                <Icon name="tasks" size={12} /> {i.taskTitle ?? 'משימה'}
              </Link>
            )}
            {i.kind !== 'point' && i.createdByName && (
              <span>
                {i.createdByName} · {fmtAgo(i.createdAt)}
              </span>
            )}
          </div>
        </div>
        {open && (
          <button type="button" className="icon-btn" onClick={() => onEdit(i)} aria-label={`פרטים והחלטה: ${i.title}`} title="פרטים, החלטה ומשימה">
            <Icon name="edit" size={16} />
          </button>
        )}
      </div>
    </li>
  );
}

interface DayEvent {
  ref: string;
  time: string;
  title: string;
  location: string;
  cancelled: boolean;
  link: string | null;
  source: string | null;
}

/** the schedule day after day, each event with its notes; a note on an event from the button beside it */
function ScheduleDays({ view, external, canAdd, onEdit }: { view: WeeklyView; external: ExternalEvent[]; canAdd: boolean; onEdit: (i: WeeklyItem) => void }) {
  const [adding, setAdding] = useState<{ ref: string | null; date: string | null } | null>(null);
  const notes = view.items.filter((i) => i.kind === 'schedule');
  const w = view.week;
  const days = useMemo(() => Array.from({ length: Math.max(1, Math.min(14, diffDays(w.endDate, w.startDate) + 1)) }, (_, i) => addDays(w.startDate, i)), [w.startDate, w.endDate]);
  const today = todayKey();
  const eventsOf = (d: string): DayEvent[] =>
    [
      ...view.events
        .filter((e) => e.date === d)
        .map((e) => ({ ref: `e:${e.id}`, time: e.startTime, title: e.title, location: e.location, cancelled: e.cancelled, link: `/schedule?date=${e.date}&event=${e.id}`, source: null })),
      ...external
        .filter((e) => e.date === d)
        .map((e) => ({ ref: `x:${e.id}`.slice(0, 182), time: e.startTime ?? '', title: e.title, location: e.location, cancelled: false, link: null, source: e.sourceName })),
    ].sort((a, b) => a.time.localeCompare(b.time));
  // a note on no day, or on a day the week no longer has (its dates changed): on the week as a whole
  const general = notes.filter((n) => !n.eventDate || !days.includes(n.eventDate));
  const addHere = (ref: string | null, date: string | null) => adding?.ref === ref && adding?.date === date;

  return (
    <div className="weekly-days">
      {(general.length > 0 || canAdd) && (
        <div className="weekly-day weekly-whole">
          <div className="weekly-day-head">
            <span className="strong small grow">על השבוע כולו</span>
            {canAdd && !addHere(null, null) && (
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setAdding({ ref: null, date: null })}>
                <Icon name="plus" /> הערה
              </button>
            )}
          </div>
          <NoteList notes={general} onEdit={onEdit} />
          {addHere(null, null) && <QuickAdd weekId={w.id} kind="schedule" placeholder="הערה על הלו״ז של השבוע" eventRef={undefined} onDone={() => setAdding(null)} />}
        </div>
      )}
      {days.map((d) => {
        const evs = eventsOf(d);
        const dayNotes = notes.filter((n) => n.eventDate === d && (!n.eventRef || !evs.some((e) => e.ref === n.eventRef)));
        return (
          <div key={d} className={`weekly-day${d === today ? ' is-today' : ''}`}>
            <div className="weekly-day-head">
              <span className="strong small grow">
                יום {weekdayName(d)} <span className="mono muted">{shortDate(d)}</span>
                {d === today && <span className="badge t-blue">היום</span>}
              </span>
              {canAdd && !addHere(null, d) && (
                <button type="button" className="icon-btn" onClick={() => setAdding({ ref: null, date: d })} aria-label={`הערה ליום ${weekdayName(d)}`} title="הערה על היום">
                  <Icon name="plus" size={16} />
                </button>
              )}
            </div>
            {evs.length === 0 && dayNotes.length === 0 && !addHere(null, d) && <div className="tiny muted weekly-none">אין אירועים בלו"ז</div>}
            {evs.map((e) => {
              const mine = notes.filter((n) => n.eventRef === e.ref);
              return (
                <div key={e.ref} className="weekly-event">
                  <div className={`weekly-event-line${e.cancelled ? ' cancelled' : ''}`}>
                    <span className="mono tiny weekly-event-time">{e.time || 'כל היום'}</span>
                    {e.link ? (
                      <Link to={e.link} className="grow small">
                        {e.title}
                      </Link>
                    ) : (
                      <span className="grow small">{e.title}</span>
                    )}
                    {e.location && <span className="tiny muted hide-mobile">{e.location}</span>}
                    {e.cancelled && <span className="badge t-red">בוטל</span>}
                    {e.source && <span className="badge" title={`מיומן ${e.source}`}>{e.source}</span>}
                    {canAdd && !addHere(e.ref, d) && (
                      <button type="button" className="icon-btn" onClick={() => setAdding({ ref: e.ref, date: d })} aria-label={`הערה על ${e.title}`} title="הערה על האירוע">
                        <Icon name="message" size={15} />
                      </button>
                    )}
                  </div>
                  <NoteList notes={mine} onEdit={onEdit} />
                  {addHere(e.ref, d) && <QuickAdd weekId={w.id} kind="schedule" placeholder={`הערה על ${e.title}`} eventRef={e.ref} eventDate={d} onDone={() => setAdding(null)} />}
                </div>
              );
            })}
            <NoteList notes={dayNotes} onEdit={onEdit} />
            {addHere(null, d) && <QuickAdd weekId={w.id} kind="schedule" placeholder={`הערה על יום ${weekdayName(d)}`} eventDate={d} onDone={() => setAdding(null)} />}
          </div>
        );
      })}
    </div>
  );
}

function NoteList({ notes, onEdit }: { notes: WeeklyItem[]; onEdit: (i: WeeklyItem) => void }) {
  const fresh = useFresh(notes.map((n) => n.id));
  if (!notes.length) return null;
  return (
    <ul className="weekly-items weekly-notes">
      {notes.map((n) => (
        <ItemRow key={n.id} item={n} onEdit={onEdit} fresh={fresh(n.id)} />
      ))}
    </ul>
  );
}

/** an item's details: its text, who closes it, whether it was done and what was decided; a task from it */
function ItemDialog({ item, weekId, onClose }: { item: WeeklyItem; weekId: number; onClose: () => void }) {
  const { users } = useSession();
  const newTask = useNewTask();
  const toast = useToast();
  const [title, setTitle] = useState(item.title);
  const [details, setDetails] = useState(item.details);
  const [ownerId, setOwnerId] = useState(item.ownerId ? String(item.ownerId) : '');
  const [done, setDone] = useState(item.done);
  const [outcome, setOutcome] = useState(item.outcome);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.patch(`/api/weekly/items/${item.id}`, {
        ...(item.canEdit ? { title: title.trim(), details: details.trim(), ...(item.kind === 'closure' ? { ownerId: ownerId ? Number(ownerId) : null } : {}) } : {}),
        ...(item.canSettle && item.kind !== 'point' ? { done, outcome: outcome.trim() } : {}),
      });
      emitLocalChange('weekly');
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const remove = async () => {
    if (!(await ask({ title: 'למחוק מהשבועי?', body: item.title, confirm: 'מחיקה', danger: true }))) return;
    try {
      await api.del(`/api/weekly/items/${item.id}`);
      emitLocalChange('weekly');
      onClose();
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const toTask = () => {
    newTask(
      {
        title: title.trim() || item.title,
        description: [details.trim(), outcome.trim() && `הוחלט בשבועי: ${outcome.trim()}`].filter(Boolean).join('\n\n'),
        weekId,
        ownerIds: item.kind === 'closure' && ownerId ? [Number(ownerId)] : undefined,
        heading: 'משימה מהשבועי',
      },
      (ids) => {
        if (!ids[0]) return;
        void api
          .patch(`/api/weekly/items/${item.id}`, { taskId: ids[0] })
          .then(() => emitLocalChange('weekly'))
          .catch((e: Error) => toast({ title: e.message, tone: 'red' }));
      },
    );
    onClose();
  };

  return (
    <Modal
      title={WEEKLY_KIND_LABELS[item.kind]}
      onClose={onClose}
      footer={
        <>
          {(item.canEdit || item.canSettle) && (
            <button className="btn btn-primary" onClick={() => void save()} disabled={busy || (item.canEdit && !title.trim())}>
              <Icon name="check" /> שמירה
            </button>
          )}
          {item.canSettle && !item.taskId && item.kind !== 'point' && (
            <button className="btn" onClick={toTask}>
              <Icon name="tasks" /> משימה מזה
            </button>
          )}
          <span className="grow" />
          {item.canEdit && (
            <button className="btn btn-ghost text-red" onClick={() => void remove()}>
              <Icon name="trash" /> מחיקה
            </button>
          )}
        </>
      }
    >
      <div className="col gap-12">
        {item.canEdit ? (
          <>
            <Field label="על מה מדובר" required>
              <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={300} />
            </Field>
            <Field label="פירוט">
              <textarea className="textarea" value={details} onChange={(e) => setDetails(e.target.value)} maxLength={4000} style={{ minHeight: 70 }} />
            </Field>
            {item.kind === 'closure' && (
              <Field label="מי סוגר">
                <Select value={ownerId} onChange={(e) => setOwnerId(e.target.value)}>
                  <option value="">עוד לא נקבע</option>
                  {users.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.displayName}
                    </option>
                  ))}
                </Select>
              </Field>
            )}
          </>
        ) : (
          <div>
            <div className="strong">{item.title}</div>
            {item.details && <p className="small mt-8" style={{ whiteSpace: 'pre-wrap' }}>{item.details}</p>}
            {item.ownerName && <div className="small muted mt-8">סוגר: {item.ownerName}</div>}
          </div>
        )}
        {item.canSettle && item.kind !== 'point' && (
          <>
            <label className="row small">
              <input type="checkbox" checked={done} onChange={(e) => setDone(e.target.checked)} />
              {WEEKLY_DONE_LABELS[item.kind]}
            </label>
            <Field label="מה הוחלט" hint="יופיע בסיכום השבועי">
              <textarea className="textarea" value={outcome} onChange={(e) => setOutcome(e.target.value)} maxLength={4000} style={{ minHeight: 70 }} />
            </Field>
          </>
        )}
        <div className="tiny muted">
          {item.createdByName && `הועלה ע"י ${item.createdByName} · ${fmtAgo(item.createdAt)}`}
          {item.carriedFrom && ` · עבר משבועי ${item.carriedFrom.name}`}
          {item.taskId && (
            <>
              {' · '}
              <Link to={`/tasks/${item.taskId}`}>משימה: {item.taskTitle}</Link>
            </>
          )}
        </div>
        <ErrorBox error={error} />
      </div>
    </Modal>
  );
}

/** the commander holds the weekly: the summary to the staff, what was left open to the next one */
function HoldDialog({ view, onClose }: { view: WeeklyView; onClose: () => void }) {
  const toast = useToast();
  const [carry, setCarry] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const of = (k: WeeklyKind) => view.items.filter((i) => i.kind === k);
  const open = view.items.filter((i) => !i.done && (i.kind === 'topic' || i.kind === 'closure')).length;
  const hold = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await api.post<WeeklyHoldResult>(`/api/weekly/${view.week.id}/hold`, { carry });
      emitLocalChange('weekly', 'weeks');
      toast({
        title: 'השבועי סוכם',
        body: [r.notified ? `הסיכום נשלח ל-${r.notified} אנשי סגל` : '', r.carried ? `${r.carried} עברו לשבועי הבא` : ''].filter(Boolean).join(' · ') || undefined,
        tone: 'green',
      });
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const line = (label: string, items: WeeklyItem[], doneWord?: string) => (
    <li>
      <b>{label}:</b> {items.length}
      {doneWord && items.length > 0 && ` (${items.filter((i) => i.done).length} ${doneWord})`}
    </li>
  );
  return (
    <Modal
      title="סיכום השבועי"
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-primary" onClick={() => void hold()} disabled={busy}>
            <Icon name="check" /> סיכום ושליחה לסגל
          </button>
          <button className="btn btn-ghost" onClick={onClose}>
            ביטול
          </button>
        </>
      }
    >
      <div className="col gap-12">
        <p className="small">הסיכום יישלח לכל הסגל כהתראה. הדגשים שלך נשארים רק אצלך - הם לא נשלחים ולא מוצגים לאף אחד.</p>
        <ul className="small weekly-hold-list">
          {line('הערות ללו"ז', of('schedule'))}
          {line('סגירות מקצועיות', of('closure'), 'נסגרו')}
          {line('נושאים לשיח', of('topic'), 'נדונו')}
          {line('דגשים שלך', of('point'))}
        </ul>
        {open > 0 && view.next && (
          <label className="row small">
            <input type="checkbox" checked={carry} onChange={(e) => setCarry(e.target.checked)} />
            להעביר {open === 1 ? 'פריט אחד שעוד פתוח' : `${open} פריטים שעוד פתוחים`} לשבועי של {view.next.name}
          </label>
        )}
        {open > 0 && !view.next && <p className="tiny muted">{open} פריטים עוד פתוחים, ואין שבוע הבא להעביר אליו - הם יישארו כאן.</p>}
        <ErrorBox error={error} />
      </div>
    </Modal>
  );
}
