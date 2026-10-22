// Adding to the weekly (שבועי) from anywhere - the bottom bar's "+", the command palette, the weekly
// itself: topics to discuss, professional closures, notes on the schedule, or (the commander) points
// for the end - several of each at once, all saved together. They go to the weekly of the week on
// now until that one is held, then to the next.

import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { WEEKLY_KIND_LABELS, type WeeklyKind, type WeeklyTarget } from '@shared/weekly';
import { addDays, diffDays, shortDate, weekdayName } from '@shared/dates';
import { api } from '../lib/api';
import { emitLocalChange } from '../lib/realtime';
import { useSession } from '../lib/session';
import { Icon } from './Icon';
import { useToast } from './Toasts';
import { ErrorBox, Field, Loading, Modal, Seg, Select } from './ui';

export interface WeeklyAddInitial {
  weekId?: number;
  kind?: WeeklyKind;
  eventRef?: string | null;
  eventDate?: string | null;
  /** shown above the fields: which event a note on the schedule is about */
  context?: string;
}

let openHost: ((initial: WeeklyAddInitial) => void) | null = null;

/** Opens the dialog (the host is mounted once, beside the screens) */
export function addToWeekly(initial: WeeklyAddInitial = {}): void {
  openHost?.(initial);
}

export function WeeklyAddHost() {
  const [state, setState] = useState<WeeklyAddInitial | null>(null);
  useEffect(() => {
    openHost = setState;
    return () => {
      openHost = null;
    };
  }, []);
  return state ? <WeeklyAddModal initial={state} onClose={() => setState(null)} /> : null;
}

/** what each kind is for, under the choice */
const KIND_HINTS: Record<WeeklyKind, string> = {
  topic: 'משהו שעלה במהלך השבוע ורוצים להעלות לשיח בשבועי.',
  closure: 'תיאום מקצועי שצריך לסגור (שטח, הסעות, מדריכים...) - ומי סוגר אותו.',
  schedule: 'הערה על הלו"ז של השבוע - שינוי, הקדמה, משהו שחסר.',
  point: 'דגש שתאמר בסוף השבועי. רק אתה רואה אותו - גם אחרי הסיכום.',
};

const EXAMPLES: Record<WeeklyKind, string> = {
  topic: 'למשל: עומס השמירות על הצוערים',
  closure: 'למשל: אישור שטח אש לתרגיל הצוותי',
  schedule: 'למשל: להקדים את ההסעה לשטח בשעה',
  point: 'למשל: שמירה על שעות שינה בשבוע השטח',
};

/** the rows after the first */
const NEXT: Record<WeeklyKind, string> = { topic: 'נושא נוסף', closure: 'סגירה נוספת', schedule: 'הערה נוספת', point: 'דגש נוסף' };

/** the button under each kind's list */
const MORE: Record<WeeklyKind, string> = { topic: 'עוד נושא', closure: 'עוד סגירה', schedule: 'עוד הערה', point: 'עוד דגש' };

/** "נושא אחד לשיח", "3 סגירות מקצועיות" */
const ONE: Record<WeeklyKind, string> = { topic: 'נושא אחד לשיח', closure: 'סגירה מקצועית אחת', schedule: 'הערה אחת ללו"ז', point: 'דגש אחד' };
const MANY: Record<WeeklyKind, string> = { topic: 'נושאים לשיח', closure: 'סגירות מקצועיות', schedule: 'הערות ללו"ז', point: 'דגשים' };
export const kindCount = (kind: WeeklyKind, n: number): string => (n === 1 ? ONE[kind] : `${n} ${MANY[kind]}`);

/** rows of one kind in one go (the server takes up to 60 in all) */
const MAX_PER_KIND = 15;

interface Entry {
  key: number;
  title: string;
  details: string;
  /** the details field is open */
  more: boolean;
  /** a closure: who closes it */
  ownerId: string;
  /** a note on the schedule: which day */
  day: string;
}

let nextKey = 1;
const blank = (day = ''): Entry => ({ key: nextKey++, title: '', details: '', more: false, ownerId: '', day });

function WeeklyAddModal({ initial, onClose }: { initial: WeeklyAddInitial; onClose: () => void }) {
  const { isCommander, users } = useSession();
  const toast = useToast();
  const [target, setTarget] = useState<WeeklyTarget | null>(null);
  const [weekId, setWeekId] = useState<number | null>(initial.weekId ?? null);
  const [picked, setKind] = useState<WeeklyKind>(initial.eventRef ? 'schedule' : (initial.kind ?? 'topic'));
  const kinds: WeeklyKind[] = initial.eventRef ? ['schedule'] : isCommander ? ['topic', 'closure', 'schedule', 'point'] : ['topic', 'closure', 'schedule'];
  const kind = kinds.includes(picked) ? picked : kinds[0];
  const [entries, setEntries] = useState<Record<WeeklyKind, Entry[]>>(() => ({
    topic: [blank()],
    closure: [blank()],
    schedule: [blank(initial.eventDate ?? '')],
    point: [blank()],
  }));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const form = useRef<HTMLFormElement>(null);
  // a row just added takes the typing: focused once it is on screen
  const focusAfter = useRef<{ key: number; field: 'title' | 'details' } | null>(null);

  useEffect(() => {
    let live = true;
    api
      .get<WeeklyTarget>('/api/weekly/target')
      .then((t) => {
        if (!live) return;
        setTarget(t);
        setWeekId((w) => w ?? t.weekId);
        // the fields show once the weeks are in: the first one takes the typing
        focusAfter.current = { key: entries[kind][0].key, field: 'title' };
      })
      .catch((e: Error) => live && setError(e.message));
    return () => {
      live = false;
    };
  }, []);

  const focusEntry = (key: number, field: 'title' | 'details' = 'title') => {
    const el = form.current?.querySelector<HTMLInputElement | HTMLTextAreaElement>(`[data-entry="${key}"][data-field="${field}"]`);
    if (!el) return;
    el.focus();
    const end = el.value.length;
    el.setSelectionRange(end, end);
  };
  useEffect(() => {
    const f = focusAfter.current;
    if (!f) return;
    focusAfter.current = null;
    focusEntry(f.key, f.field);
  });

  // a held weekly takes nothing more from the staff; the commander may still add to it
  const weeks = (target?.weeks ?? []).filter((w) => isCommander || !w.heldAt || w.id === weekId);
  const week = weeks.find((w) => w.id === weekId) ?? null;
  const days = week ? Array.from({ length: Math.max(1, Math.min(14, diffDays(week.endDate, week.startDate) + 1)) }, (_, i) => addDays(week.startDate, i)) : [];

  const filled = (k: WeeklyKind) => entries[k].filter((e) => e.title.trim());
  const counts = kinds.map((k) => ({ kind: k, n: filled(k).length })).filter((c) => c.n > 0);
  const total = counts.reduce((s, c) => s + c.n, 0);

  const edit = (k: WeeklyKind, key: number, patch: Partial<Entry>) => setEntries((all) => ({ ...all, [k]: all[k].map((e) => (e.key === key ? { ...e, ...patch } : e)) }));

  /** a new row after the one given (or at the end), taking the typing */
  const addRow = (k: WeeklyKind, after?: number) => {
    const list = entries[k];
    if (list.length >= MAX_PER_KIND) return;
    const at = after === undefined ? list.length : list.findIndex((e) => e.key === after) + 1;
    // a note on the schedule starts on the day of the one before it - a few notes on the same day
    const row = blank(k === 'schedule' ? (list[at - 1]?.day ?? initial.eventDate ?? '') : '');
    focusAfter.current = { key: row.key, field: 'title' };
    setEntries({ ...entries, [k]: [...list.slice(0, at), row, ...list.slice(at)] });
  };

  /** the row goes; the typing moves to the one above it. The last row left is emptied instead */
  const removeRow = (k: WeeklyKind, key: number) => {
    const list = entries[k];
    const i = list.findIndex((e) => e.key === key);
    const rest = list.length > 1 ? list.filter((e) => e.key !== key) : [blank(k === 'schedule' ? (initial.eventDate ?? '') : '')];
    focusAfter.current = { key: rest[Math.max(0, i - 1)].key, field: 'title' };
    setEntries({ ...entries, [k]: rest });
  };

  const save = async () => {
    if (!weekId || busy) return;
    // details written with nothing to say what they are about
    for (const k of kinds) {
      const orphan = entries[k].find((e) => !e.title.trim() && e.details.trim());
      if (orphan) {
        setKind(k);
        setError('כתבו על מה מדובר - יש פירוט בלי כותרת');
        focusAfter.current = { key: orphan.key, field: 'title' };
        return;
      }
    }
    const items = kinds.flatMap((k) =>
      filled(k).map((e) => ({
        kind: k,
        title: e.title.trim(),
        details: e.details.trim(),
        ownerId: k === 'closure' && e.ownerId ? Number(e.ownerId) : null,
        eventRef: k === 'schedule' ? (initial.eventRef ?? null) : null,
        eventDate: k === 'schedule' && e.day ? e.day : null,
      })),
    );
    if (!items.length) {
      setError('כתבו על מה מדובר');
      focusEntry(entries[kind][0].key);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.post('/api/weekly/items/batch', { weekId, items });
      emitLocalChange('weekly');
      const where = week ? ` - ${week.name}` : '';
      toast(
        items.length === 1
          ? { title: `נוסף לשבועי${where}`, body: `${WEEKLY_KIND_LABELS[items[0].kind]}: ${items[0].title}`, tone: 'green', link: `/weekly/${weekId}` }
          : { title: `נוספו ${items.length} לשבועי${where}`, body: counts.map((c) => kindCount(c.kind, c.n)).join(' · '), tone: 'green', link: `/weekly/${weekId}` },
      );
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  /** Enter: on to the next row (a new one when this is the last); Enter on an empty row saves what
   *  is written; Ctrl/Cmd+Enter saves; Backspace on an empty row takes it away */
  const onTitleKey = (k: WeeklyKind, e: Entry, ev: KeyboardEvent<HTMLInputElement>) => {
    if (ev.nativeEvent.isComposing) return;
    if (ev.key === 'Enter') {
      ev.preventDefault();
      if (ev.metaKey || ev.ctrlKey || !e.title.trim()) return void save();
      const list = entries[k];
      const next = list[list.findIndex((x) => x.key === e.key) + 1];
      if (next) return focusEntry(next.key);
      addRow(k, e.key);
    } else if (ev.key === 'Backspace' && !ev.repeat && !e.title && !e.details && entries[k].length > 1) {
      ev.preventDefault();
      removeRow(k, e.key);
    }
  };

  const others = counts.filter((c) => c.kind !== kind);

  return (
    <Modal
      title="הוספה לשבועי"
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-primary" onClick={() => void save()} disabled={busy || !weekId}>
            <Icon name="plus" /> {total > 1 ? `הוספת ${total} לשבועי` : 'הוספה לשבועי'}
          </button>
          <button className="btn btn-ghost" onClick={onClose}>
            ביטול
          </button>
        </>
      }
    >
      {!target && !error ? (
        <Loading rows={2} />
      ) : target && !target.weeks.length ? (
        <p className="small muted">אין עדיין שבועות בקורס. השבועי שייך לשבוע בקורס - מוסיפים שבועות במסך "שבועות הקורס".</p>
      ) : (
        <form
          ref={form}
          className="col gap-12"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          {initial.context && (
            <div className="weekly-add-context small">
              <Icon name="calendar" size={15} /> {initial.context}
            </div>
          )}
          {kinds.length > 1 && (
            <div className="col gap-6">
              <span className="label-caps">מה להעלות</span>
              <Seg
                value={kind}
                onChange={setKind}
                wrap
                options={kinds.map((k) => {
                  const n = filled(k).length;
                  return {
                    value: k,
                    label: (
                      <>
                        {WEEKLY_KIND_LABELS[k]}
                        {n > 0 && (
                          <span className="seg-n" aria-label={`${n} כתובים`}>
                            {n}
                          </span>
                        )}
                      </>
                    ),
                  };
                })}
              />
              <span className="tiny muted">{KIND_HINTS[kind]}</span>
            </div>
          )}
          {/* every kind's rows stay in the page while another kind is shown: what was typed in them
              is kept, and closing the dialog still asks first */}
          {kinds.map((k) => (
            <div key={k} className={`weekly-entries${entries[k].length > 1 ? ' is-many' : ''}`} hidden={k !== kind} role="group" aria-label={`${WEEKLY_KIND_LABELS[k]} - על מה מדובר`}>
              <span className="weekly-entries-label">
                על מה מדובר<span className="req"> *</span>
              </span>
              {entries[k].map((e, i) => {
                const many = entries[k].length > 1;
                return (
                  <div key={e.key} className="weekly-entry">
                    <div className="weekly-entry-line">
                      {many && (
                        <span className="weekly-entry-n" aria-hidden="true">
                          {i + 1}
                        </span>
                      )}
                      <input
                        className="input"
                        value={e.title}
                        onChange={(ev) => edit(k, e.key, { title: ev.target.value })}
                        onKeyDown={(ev) => onTitleKey(k, e, ev)}
                        maxLength={300}
                        enterKeyHint="next"
                        placeholder={i === 0 ? EXAMPLES[k] : NEXT[k]}
                        aria-label={many ? `על מה מדובר - ${i + 1}` : 'על מה מדובר'}
                        data-entry={e.key}
                        data-field="title"
                        data-autofocus={k === kind && i === 0 ? true : undefined}
                      />
                      {(many || e.title || e.details) && (
                        <button type="button" className="icon-btn weekly-entry-x" onClick={() => removeRow(k, e.key)} aria-label={many ? `הסרת שורה ${i + 1}` : 'ניקוי השורה'} title={many ? 'הסרה' : 'ניקוי'}>
                          <Icon name="x" size={15} />
                        </button>
                      )}
                    </div>
                    <div className="weekly-entry-extra">
                      <button
                        type="button"
                        className={`btn btn-sm btn-ghost weekly-entry-more${e.details.trim() ? ' has' : ''}`}
                        aria-expanded={e.more}
                        onClick={() => {
                          edit(k, e.key, { more: !e.more });
                          if (!e.more) focusAfter.current = { key: e.key, field: 'details' };
                        }}
                      >
                        <Icon name={e.more ? 'x' : 'plus'} size={13} /> פירוט
                      </button>
                      {k === 'closure' && (
                        <span className="weekly-entry-pick">
                          <span className="tiny muted">מי סוגר</span>
                          <Select fit value={e.ownerId} onChange={(ev) => edit(k, e.key, { ownerId: ev.target.value })} aria-label={`מי סוגר${many ? ` - ${i + 1}` : ''}`}>
                            <option value="">עוד לא נקבע</option>
                            {users.map((u) => (
                              <option key={u.id} value={u.id}>
                                {u.displayName}
                              </option>
                            ))}
                          </Select>
                        </span>
                      )}
                      {k === 'schedule' && !initial.eventRef && days.length > 0 && (
                        <span className="weekly-entry-pick">
                          <span className="tiny muted">איזה יום</span>
                          <Select fit value={e.day} onChange={(ev) => edit(k, e.key, { day: ev.target.value })} aria-label={`איזה יום${many ? ` - ${i + 1}` : ''}`}>
                            <option value="">כל השבוע</option>
                            {days.map((d) => (
                              <option key={d} value={d}>
                                {`יום ${weekdayName(d)} ${shortDate(d)}`}
                              </option>
                            ))}
                          </Select>
                        </span>
                      )}
                    </div>
                    {e.more && (
                      <textarea
                        className="textarea weekly-entry-details"
                        value={e.details}
                        onChange={(ev) => edit(k, e.key, { details: ev.target.value })}
                        maxLength={4000}
                        placeholder="פירוט - לא חובה"
                        aria-label={`פירוט${many ? ` - ${i + 1}` : ''}`}
                        data-entry={e.key}
                        data-field="details"
                      />
                    )}
                  </div>
                );
              })}
              {entries[k].length < MAX_PER_KIND && (
                <div className="weekly-entries-more">
                  <button type="button" className="btn btn-sm btn-ghost" onClick={() => addRow(k)}>
                    <Icon name="plus" /> {MORE[k]}
                  </button>
                  <span className="tiny muted weekly-entries-keys">או Enter בסוף שורה</span>
                </div>
              )}
            </div>
          ))}
          {others.length > 0 && (
            <div className="weekly-add-also small" role="status">
              <Icon name="check" size={14} />
              <span>
                יתווספו יחד: {counts.map((c) => kindCount(c.kind, c.n)).join(' · ')}
              </span>
            </div>
          )}
          <Field label="לשבועי של">
            <Select value={weekId ?? ''} onChange={(e) => setWeekId(Number(e.target.value) || null)}>
              {weeks.map((w) => (
                <option key={w.id} value={w.id}>
                  {`שבוע ${w.number} - ${w.name}${w.heldAt ? ' (התקיים)' : ''}${w.id === target?.weekId ? ' · הקרוב' : ''}`}
                </option>
              ))}
            </Select>
          </Field>
          <ErrorBox error={error} />
        </form>
      )}
      {error && !target && <ErrorBox error={error} />}
    </Modal>
  );
}
