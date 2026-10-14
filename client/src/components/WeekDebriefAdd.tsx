// Adding to the week's weekly debrief on the way - from the bottom bar's "+" and the command palette: a line to
// keep or to improve, or a lesson for the rest of the cycle or for this week in the next one. Anyone on the
// staff. While the week's debrief is not opened yet the note waits for it, and goes in once its lead opens it.

import { useEffect, useState } from 'react';
import { WEEK_NOTE_PART_LABELS, WEEK_NOTE_PARTS, type WeekNotePart } from '@shared/debriefForms';
import { shortDate } from '@shared/dates';
import type { WeekNoteWeek } from '@shared/types';
import { api } from '../lib/api';
import { emitLocalChange } from '../lib/realtime';
import { useSession } from '../lib/session';
import { Icon } from './Icon';
import { useToast } from './Toasts';
import { DateInput, ErrorBox, Field, Loading, Modal, Seg, Select } from './ui';

let openHost: (() => void) | null = null;
/** asked for before the host was up - the app just opened on its home-screen shortcut: it opens as the host mounts */
let asked = false;

/** Opens the dialog (the host is mounted once, beside the screens) */
export function addToWeekDebrief(): void {
  if (openHost) openHost();
  else asked = true;
}

export function WeekDebriefAddHost() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    openHost = () => setOpen(true);
    if (asked) {
      asked = false;
      setOpen(true);
    }
    return () => {
      openHost = null;
    };
  }, []);
  return open ? <WeekDebriefAddModal onClose={() => setOpen(false)} /> : null;
}

/** what each part is for, under the choice */
const PART_HINTS: Record<WeekNotePart, string> = {
  sustain: 'מה עבד טוב ושווה לעשות שוב בדיוק כך.',
  improve: 'מה לא עבד - עובדות, לא האשמות.',
  now: 'משהו לתקן עוד במחזור הזה: בסיכום התחקיר הוא נפתח כמשימה, עם אחראי ותאריך.',
  next: 'נשמר בבנק הלקחים ויוצג כשהשבוע הזה יגיע במחזור הבא.',
};

const PLACEHOLDERS: Record<WeekNotePart, string> = {
  sustain: 'למשל: תדריך בטיחות קצר לפני כל יציאה לשטח',
  improve: 'למשל: ההסעה לשטח הגיעה באיחור',
  now: 'למשל: לבדוק את מכשירי הקשר לפני תרגיל הלילה',
  next: 'למשל: לתת לצוערים את המפות יום מראש',
};

function WeekDebriefAddModal({ onClose }: { onClose: () => void }) {
  const { users } = useSession();
  const toast = useToast();
  const [target, setTarget] = useState<{ weekId: number | null; weeks: WeekNoteWeek[] } | null>(null);
  const [weekId, setWeekId] = useState<number | null>(null);
  const [part, setPart] = useState<WeekNotePart>('sustain');
  const [body, setBody] = useState('');
  const [ownerId, setOwnerId] = useState('');
  const [due, setDue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    api
      .get<{ weekId: number | null; weeks: WeekNoteWeek[] }>('/api/debriefs/week-notes')
      .then((t) => {
        if (!live) return;
        setTarget(t);
        setWeekId(t.weekId);
      })
      .catch((e: Error) => live && setError(e.message));
    return () => {
      live = false;
    };
  }, []);

  // a debrief summed up takes no more
  const weeks = (target?.weeks ?? []).filter((w) => !w.summedUp);
  const week = weeks.find((w) => w.id === weekId) ?? null;

  const save = async () => {
    if (!week) return;
    if (!body.trim()) {
      setError('כתבו מה להוסיף');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await api.post<{ debriefId: number | null; waiting: number }>('/api/debriefs/week-notes', {
        weekId: week.id,
        part,
        body: body.trim(),
        ownerId: part === 'now' && ownerId ? Number(ownerId) : null,
        dueDate: part === 'now' && due ? due : null,
      });
      emitLocalChange('debriefs', 'weeks');
      toast({
        title: `נוסף לתחקיר השבועי - ${week.name}`,
        body: `${WEEK_NOTE_PART_LABELS[part]}: ${body.trim()}${res.debriefId ? '' : ' · יחכה לתחקיר עד שייפתח'}`,
        tone: 'green',
        link: res.debriefId ? `/debriefs/${res.debriefId}` : `/weeks/${week.id}`,
      });
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title="לתחקיר השבועי"
      onClose={onClose}
      footer={
        week ? (
          <>
            <button className="btn btn-primary" onClick={() => void save()} disabled={busy || !body.trim()}>
              <Icon name="plus" /> הוספה לתחקיר
            </button>
            <button className="btn btn-ghost" onClick={onClose}>
              ביטול
            </button>
          </>
        ) : undefined
      }
    >
      {!target && !error ? (
        <Loading rows={2} />
      ) : target && !target.weeks.length ? (
        <p className="small muted">עוד אין שבוע שהתחיל. התחקיר השבועי שייך לשבוע בקורס - מוסיפים שבועות במסך "שבועות הקורס".</p>
      ) : target && !weeks.length ? (
        <p className="small muted">התחקיר השבועי של {target.weeks[0].name} כבר סוכם. אפשר לפתוח אותו מהתחקירים.</p>
      ) : (
        <form
          className="col gap-12"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <div className="col gap-6">
            <span className="label-caps">מה להוסיף</span>
            <Seg value={part} onChange={setPart} wrap options={WEEK_NOTE_PARTS.map((p) => ({ value: p, label: WEEK_NOTE_PART_LABELS[p] }))} />
            <span className="tiny muted">{PART_HINTS[part]}</span>
          </div>
          <Field label={part === 'now' || part === 'next' ? 'הלקח' : 'מה'} required>
            <textarea
              className="textarea"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              maxLength={3000}
              style={{ minHeight: 80 }}
              placeholder={PLACEHOLDERS[part]}
              data-autofocus
              onKeyDown={(e) => {
                // Enter adds; Shift+Enter breaks the line
                if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  void save();
                }
              }}
            />
          </Field>
          {part === 'now' && (
            <div className="form-grid">
              <Field label="אחראי" hint="לא חובה - אפשר לקבוע בתחקיר">
                <Select value={ownerId} onChange={(e) => setOwnerId(e.target.value)}>
                  <option value="">עוד לא נקבע</option>
                  {users.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.displayName}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="עד מתי" hint="לא חובה">
                <DateInput value={due} onChange={setDue} aria-label="עד מתי" />
              </Field>
            </div>
          )}
          {weeks.length > 1 && (
            <Field label="לתחקיר של">
              <Select value={weekId ?? ''} onChange={(e) => setWeekId(Number(e.target.value) || null)}>
                {weeks.map((w) => (
                  <option key={w.id} value={w.id}>
                    {`שבוע ${w.number} - ${w.name} (${shortDate(w.startDate)}-${shortDate(w.endDate)})${w.id === target?.weekId ? ' · השבוע' : ''}`}
                  </option>
                ))}
              </Select>
            </Field>
          )}
          {week && (
            <p className="tiny muted week-note-where">
              <Icon name="lightbulb" size={13} />{' '}
              {week.debriefId
                ? `ייכנס ישר לתחקיר השבועי של ${week.name}.`
                : `התחקיר של ${week.name} עוד לא נפתח - ${week.waiting ? `${week.waiting === 1 ? 'פריט אחד כבר מחכה' : `${week.waiting} פריטים כבר מחכים`} לו, ו` : ''}זה יחכה וייכנס אליו כשהוא ייפתח.`}
            </p>
          )}
          <ErrorBox error={error} />
        </form>
      )}
      {error && !target && <ErrorBox error={error} />}
    </Modal>
  );
}
