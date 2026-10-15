// What the plan documents share (pages/PlansPage.tsx - a week's plan; pages/ThreeWeekPage.tsx - four
// weeks at once): where a document is on its way, the kinds of activity, how ready an activity is,
// rewriting a part, and recording the approval of the commander above.

import { useState } from 'react';
import { shortDate, weekdayName } from '@shared/dates';
import type { PlanEvent, PlanEventKind, PlanStatus } from '@shared/types';
import { api } from '../lib/api';
import { todayKey } from '../lib/format';
import { Icon } from './Icon';
import { DateInput, ErrorBox, Field, Modal } from './ui';

export const PLAN_STATUS: Record<PlanStatus, { label: string; tone: string }> = {
  draft: { label: 'טיוטה', tone: 't-gray' },
  ready: { label: 'מוכן להצגה', tone: 't-blue' },
  approved: { label: 'אושר', tone: 't-green' },
};

export const KIND_LABELS: Record<PlanEventKind, string> = {
  exam: 'מבחן',
  ceremony: 'טקס',
  field: 'שטח',
  range: 'מטווח',
  navigation: 'ניווט',
  visit: 'חשיפה',
  evaluation: 'הערכה',
  learning: 'לימוד',
  values: 'ערכים',
  physical: 'כושר',
  staff: 'סגל',
  leave: 'חופשה',
  other: 'פעילות',
};

const APPROVER_KEY = 'kks.planApprover';

export const dateRange = (a: string, b: string) => (a === b ? shortDate(a) : `${shortDate(a)}-${shortDate(b)}`);
export const whenOf = (e: PlanEvent) => (e.endDate !== e.date ? dateRange(e.date, e.endDate) : `${weekdayName(e.date)} ${shortDate(e.date)}`);

export function EditButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button type="button" className="btn btn-ghost btn-sm no-print" onClick={onClick} aria-label={`עריכת ${label}`}>
      <Icon name="edit" size={14} /> עריכה
    </button>
  );
}

export function Wording({ edited }: { edited: boolean }) {
  return <span className={`badge no-print ${edited ? 't-blue' : ''}`}>{edited ? 'הנוסח שלך' : 'נוסח אוטומטי'}</span>;
}

/** one part of a document, rewritten as lines (or the bottom line, as one text) */
export function EditDialog({
  title,
  initial,
  edited,
  single,
  hint,
  onSave,
  onClose,
}: {
  title: string;
  initial: string;
  edited: boolean;
  single?: boolean;
  hint?: string;
  onSave: (value: string | null) => Promise<void>;
  onClose: () => void;
}) {
  const [text, setText] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const save = async (value: string | null) => {
    setBusy(true);
    setError(null);
    try {
      await onSave(value);
      onClose();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };
  return (
    <Modal
      title={`עריכה - ${title}`}
      onClose={onClose}
      footer={
        <>
          {edited && (
            <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => void save(null)}>
              חזרה לנוסח האוטומטי
            </button>
          )}
          <span className="grow" />
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            ביטול
          </button>
          <button type="button" className="btn btn-primary" disabled={busy || !text.trim()} onClick={() => void save(text)}>
            שמירה
          </button>
        </>
      }
    >
      <Field label={title} hint={hint ?? (single ? 'כמה משפטים שמסכמים את השבוע למי שיש לו שתי דקות.' : 'שורה לכל סעיף. הנוסח האוטומטי מתעדכן עם הלו"ז; נוסח שלך נשאר כפי שכתבת.')}>
        <textarea className="textarea" rows={single ? 5 : 10} value={text} onChange={(e) => setText(e.target.value)} data-autofocus />
      </Field>
      <ErrorBox error={error} />
    </Modal>
  );
}

/** the commander above approved: who, when, what they said. `scope` is what the key activities kept are of */
export function ApproveDialog<T>({
  name,
  approval,
  url,
  scope,
  onDone,
  onClose,
}: {
  name: string;
  approval: { by: string; on: string; notes: string } | null;
  url: string;
  scope: string;
  onDone: (d: T) => void;
  onClose: () => void;
}) {
  const remembered = (() => {
    try {
      return localStorage.getItem(APPROVER_KEY) ?? '';
    } catch {
      return '';
    }
  })();
  const [by, setBy] = useState(approval?.by ?? remembered);
  const [on, setOn] = useState(approval?.on ?? todayKey());
  const [notes, setNotes] = useState(approval?.notes ?? '');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const d = await api.post<T>(url, { by, on, notes });
      try {
        localStorage.setItem(APPROVER_KEY, by.trim());
      } catch {
        /* this time only */
      }
      onDone(d);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };
  return (
    <Modal title={`רישום אישור - ${name}`} onClose={onClose}>
      <form className="col gap-12" onSubmit={(e) => void submit(e)}>
        <Field label="מי אישר" required>
          <input className="input" value={by} onChange={(e) => setBy(e.target.value)} placeholder='דרגה, שם ותפקיד - לדוגמה: אל"ם ישראל ישראלי, מפקד הבה"ד' required data-autofocus />
        </Field>
        <Field label="תאריך האישור" required>
          <DateInput value={on} max={todayKey()} onChange={(v) => setOn(v)} required style={{ maxWidth: 200 }} />
        </Field>
        <Field label="הערות והנחיות המאשר" hint='מה ביקש לשנות, להדגיש או לעדכן אותו. יופיע במסמך המודפס.'>
          <textarea className="textarea" rows={4} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
        <div className="small muted">אירועי המפתח {scope} נשמרים כפי שהם עכשיו. אם ישתנו אחרי האישור, המסמך יראה מה השתנה.</div>
        <ErrorBox error={error} />
        <button className="btn btn-primary" disabled={busy || by.trim().length < 2 || !on}>
          {busy ? 'שומר...' : 'רישום האישור'}
        </button>
      </form>
    </Modal>
  );
}

const STEPS: PlanStatus[] = ['draft', 'ready', 'approved'];

/** where the document is on its way: draft, ready to present, approved - the steps behind it ticked */
export function StatusSteps({ status }: { status: PlanStatus }) {
  const at = STEPS.indexOf(status);
  return (
    <ol className="plan-steps" aria-label={`מצב המסמך: ${PLAN_STATUS[status].label}`}>
      {STEPS.map((st, i) => (
        <li key={st} className={i < at ? 'is-past' : i === at ? 'is-now' : ''} aria-current={i === at ? 'step' : undefined}>
          <span className="plan-step-dot" aria-hidden="true">
            {i < at || (i === at && st === 'approved') ? <Icon name="check" size={12} /> : i + 1}
          </span>
          <span className="plan-step-label">{PLAN_STATUS[st].label}</span>
        </li>
      ))}
    </ol>
  );
}

/** how far an activity's preparation tasks are */
export function Prep({ e }: { e: PlanEvent }) {
  if (!e.prep) return <span className="muted small">מהיומן</span>;
  if (!e.prep.total) return <span className="muted small">אין משימות הכנה</span>;
  const pct = Math.round((e.prep.done / e.prep.total) * 100);
  return (
    <span className="plan-prep" title={`${e.prep.done} מתוך ${e.prep.total} משימות הכנה`}>
      <span className="bar" aria-hidden="true">
        <span style={{ width: `${pct}%` }} className={pct === 100 ? 'ok' : pct < 50 ? 'low' : ''} />
      </span>
      <span className="mono small">
        {e.prep.done}/{e.prep.total}
      </span>
    </span>
  );
}
