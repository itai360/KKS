// "When am I away": a person marks their leave, sick day, course or reserve duty (the
// commander can for anyone), so tasks are not given to someone who is not there and the
// tasks that fall on those days are moved in time.

import { useState } from 'react';
import { ABSENCE_REASON_LABELS, ABSENCE_REASONS, type AbsenceReason } from '@shared/constants';
import { addDays, shortDate } from '@shared/dates';
import type { Absence } from '@shared/types';
import { ask } from './Confirm';
import { Icon } from './Icon';
import { useToast } from './Toasts';
import { ErrorBox, Field } from './ui';
import { api } from '../lib/api';
import { todayKey } from '../lib/format';
import { emitLocalChange } from '../lib/realtime';
import { useApi } from '../lib/useApi';

const range = (a: Pick<Absence, 'startDate' | 'endDate'>) => (a.startDate === a.endDate ? shortDate(a.startDate) : `${shortDate(a.startDate)}-${shortDate(a.endDate)}`);

export function AbsencesCard({ userId, mine, canEdit }: { userId: number; mine: boolean; canEdit: boolean }) {
  const toast = useToast();
  const { data, setData, reload } = useApi<Absence[]>(`/api/absences?user=${userId}`, ['users', 'tasks']);
  const [adding, setAdding] = useState(false);
  const [start, setStart] = useState(addDays(todayKey(), 1));
  const [end, setEnd] = useState(addDays(todayKey(), 1));
  const [reason, setReason] = useState<AbsenceReason>('leave');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setError(null);
    setBusy(true);
    try {
      const a = await api.post<Absence>('/api/absences', { userId, startDate: start, endDate: end < start ? start : end, reason, note });
      setData([...(data ?? []), a].sort((x, y) => x.startDate.localeCompare(y.startDate)));
      toast({
        title: `סומן: ${ABSENCE_REASON_LABELS[a.reason]} ${range(a)}`,
        body: a.tasksDue ? `${a.tasksDue === 1 ? 'משימה פתוחה אחת נופלת' : `${a.tasksDue} משימות פתוחות נופלות`} על הימים האלה - כדאי להעביר או להקדים` : mine ? 'מפקד הקורס עודכן' : undefined,
        tone: a.tasksDue ? 'orange' : 'green',
      });
      emitLocalChange('users');
      setAdding(false);
      setNote('');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (a: Absence) => {
    if (!(await ask({ title: 'למחוק את ההיעדרות?', body: `${ABSENCE_REASON_LABELS[a.reason]} ${range(a)}`, confirm: 'מחיקה', danger: true }))) return;
    try {
      await api.del(`/api/absences/${a.id}`);
      emitLocalChange('users');
      void reload();
    } catch (e) {
      toast({ title: (e as Error).message, tone: 'red' });
    }
  };

  const list = data ?? [];
  return (
    <div className="card">
      <div className="card-head">
        <Icon name="calendar" />
        <h3 className="grow">{mine ? 'מתי אני לא כאן' : 'היעדרויות'}</h3>
        {canEdit && !adding && (
          <button className="btn btn-sm" onClick={() => setAdding(true)}>
            <Icon name="plus" /> היעדרות
          </button>
        )}
      </div>
      <div className="card-body col gap-6">
        {!list.length && !adding && <p className="small muted">{mine ? 'חופשה, מחלה, השתלמות או מילואים - סמנו מראש, וכך לא יקבלו עליכם משימות לימים האלה, ומה שכבר נופל עליהם יגיע בזמן למפקד.' : 'אין היעדרויות מתוכננות.'}</p>}
        {list.map((a) => (
          <div key={a.id} className="absence-row">
            <span className="badge t-purple">{ABSENCE_REASON_LABELS[a.reason]}</span>
            <span className="mono small strong">{range(a)}</span>
            <span className="grow small muted">{a.note}</span>
            {a.tasksDue > 0 && <span className="badge t-orange">{a.tasksDue === 1 ? 'משימה נופלת' : `${a.tasksDue} משימות נופלות`}</span>}
            {canEdit && (
              <button className="icon-btn" aria-label={`מחיקת ${ABSENCE_REASON_LABELS[a.reason]} ${range(a)}`} onClick={() => void remove(a)}>
                <Icon name="trash" size={14} />
              </button>
            )}
          </div>
        ))}
        {adding && (
          <form
            className="col gap-12 absence-new"
            onSubmit={(e) => {
              e.preventDefault();
              void save();
            }}
          >
            <div className="chips" role="group" aria-label="סיבת ההיעדרות">
              {ABSENCE_REASONS.map((r) => (
                <button key={r} type="button" className={`chip chip-sm${reason === r ? ' on' : ''}`} aria-pressed={reason === r} onClick={() => setReason(r)}>
                  {ABSENCE_REASON_LABELS[r]}
                </button>
              ))}
            </div>
            <div className="form-grid">
              <Field label="מתאריך" required>
                <input
                  className="input"
                  type="date"
                  value={start}
                  min={todayKey()}
                  onChange={(e) => {
                    setStart(e.target.value);
                    if (end < e.target.value) setEnd(e.target.value);
                  }}
                  data-autofocus
                />
              </Field>
              <Field label="עד תאריך (כולל)" required>
                <input className="input" type="date" value={end} min={start} onChange={(e) => setEnd(e.target.value)} />
              </Field>
              <Field label="הערה" className="span-2">
                <input className="input" value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} placeholder="לא חובה - לדוגמה: זמין בטלפון לדברים דחופים" />
              </Field>
            </div>
            <ErrorBox error={error} />
            <div className="row gap-6">
              <button className="btn btn-primary btn-sm" disabled={busy || !start}>
                שמירה
              </button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setAdding(false)}>
                ביטול
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
