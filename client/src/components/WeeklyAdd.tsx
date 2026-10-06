// Adding to the weekly (שבועי) from anywhere - the bottom bar's "+", the command palette, the weekly
// itself: a topic to discuss, a professional closure, a note on the schedule, or (the commander) a point
// for the end. It goes to the weekly of the week on now until that one is held, then to the next.

import { useEffect, useState } from 'react';
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
  point: 'דגש שתאמר בסוף השבועי. עד הסיכום רק אתה רואה אותו.',
};

function WeeklyAddModal({ initial, onClose }: { initial: WeeklyAddInitial; onClose: () => void }) {
  const { isCommander, users } = useSession();
  const toast = useToast();
  const [target, setTarget] = useState<WeeklyTarget | null>(null);
  const [weekId, setWeekId] = useState<number | null>(initial.weekId ?? null);
  const [kind, setKind] = useState<WeeklyKind>(initial.kind ?? 'topic');
  const [title, setTitle] = useState('');
  const [details, setDetails] = useState('');
  const [ownerId, setOwnerId] = useState('');
  const [day, setDay] = useState(initial.eventDate ?? '');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    api
      .get<WeeklyTarget>('/api/weekly/target')
      .then((t) => {
        if (!live) return;
        setTarget(t);
        setWeekId((w) => w ?? t.weekId);
      })
      .catch((e: Error) => live && setError(e.message));
    return () => {
      live = false;
    };
  }, []);

  // a held weekly takes nothing more from the staff; the commander may still add to it
  const weeks = (target?.weeks ?? []).filter((w) => isCommander || !w.heldAt || w.id === weekId);
  const week = weeks.find((w) => w.id === weekId) ?? null;
  const kinds: WeeklyKind[] = isCommander ? ['topic', 'closure', 'schedule', 'point'] : ['topic', 'closure', 'schedule'];
  const days = week ? Array.from({ length: Math.max(1, Math.min(14, diffDays(week.endDate, week.startDate) + 1)) }, (_, i) => addDays(week.startDate, i)) : [];

  const save = async () => {
    if (!weekId) return;
    if (!title.trim()) {
      setError('כתבו על מה מדובר');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.post('/api/weekly/items', {
        weekId,
        kind,
        title: title.trim(),
        details: details.trim(),
        ownerId: kind === 'closure' && ownerId ? Number(ownerId) : null,
        eventRef: kind === 'schedule' ? (initial.eventRef ?? null) : null,
        eventDate: kind === 'schedule' && day ? day : null,
      });
      emitLocalChange('weekly');
      toast({ title: `נוסף לשבועי${week ? ` - ${week.name}` : ''}`, body: `${WEEKLY_KIND_LABELS[kind]}: ${title.trim()}`, tone: 'green', link: `/weekly/${weekId}` });
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title="הוספה לשבועי"
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-primary" onClick={() => void save()} disabled={busy || !weekId}>
            <Icon name="plus" /> הוספה לשבועי
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
          {!initial.eventRef && (
            <div className="col gap-6">
              <span className="label-caps">מה להעלות</span>
              <Seg value={kind} onChange={setKind} wrap options={kinds.map((k) => ({ value: k, label: WEEKLY_KIND_LABELS[k] }))} />
              <span className="tiny muted">{KIND_HINTS[kind]}</span>
            </div>
          )}
          <Field label="על מה מדובר" required>
            <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={300} data-autofocus placeholder={kind === 'closure' ? 'למשל: אישור שטח אש לתרגיל הצוותי' : kind === 'point' ? 'למשל: שמירה על שעות שינה בשבוע השטח' : kind === 'schedule' ? 'למשל: להקדים את ההסעה לשטח בשעה' : 'למשל: עומס השמירות על הצוערים'} />
          </Field>
          <Field label="פירוט" hint="לא חובה">
            <textarea className="textarea" value={details} onChange={(e) => setDetails(e.target.value)} maxLength={4000} style={{ minHeight: 70 }} />
          </Field>
          {kind === 'closure' && (
            <Field label="מי סוגר" hint="לא חובה - אפשר לקבוע בשבועי">
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
          {kind === 'schedule' && !initial.eventRef && days.length > 0 && (
            <Field label="איזה יום" hint="לא חובה">
              <Select value={day} onChange={(e) => setDay(e.target.value)}>
                <option value="">כל השבוע</option>
                {days.map((d) => (
                  <option key={d} value={d}>
                    {`יום ${weekdayName(d)} ${shortDate(d)}`}
                  </option>
                ))}
              </Select>
            </Field>
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
