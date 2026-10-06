// The evaluation file on screen (server/src/evaluations.ts): the living file, saved as it is typed,
// field by field - with the save state always in view, a change someone else made meanwhile
// shown instead of written over, and every part's history. The same file read-only, for print and
// for the version a committee received.

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { STANDING_LABELS, STANDING_TONES, STANDINGS, EVAL_TONE_LABELS, type Standing } from '@shared/constants';
import { shortDate } from '@shared/dates';
import { EVALUATION_FIELDS, EVALUATION_SECTIONS, EVALUATION_TITLE, EXAM_FIELDS, EXAM_TESTS, EXAM_TEXT_FIELDS, NOT_ENTERED, shownTests, TEST_ORDER } from '@shared/evaluation';
import type { EvaluationChange, EvaluationExams, EvaluationField, EvaluationFile, EvaluationNote, EvaluationPoint, ExamTest } from '@shared/types';
import { api, ApiError } from '../lib/api';
import { useDraft } from '../lib/draft';
import { fmtAgo, fmtDateTime, todayKey } from '../lib/format';
import { emitLocalChange } from '../lib/realtime';
import { useSession } from '../lib/session';
import { ask } from './Confirm';
import { Icon } from './Icon';
import { useToast } from './Toasts';
import { ErrorBox, Field, Modal, Seg } from './ui';

type Value = string | number | null;
const NUMBER_FIELDS: EvaluationField[] = EXAM_FIELDS.filter((k) => !EXAM_TEXT_FIELDS.includes(k));

/** a field's value in the file as the server keeps it */
export function fieldValue(f: EvaluationFile, field: EvaluationField): Value {
  switch (field) {
    case 'companyCommander':
    case 'teamCommander':
      return f.general[field];
    case 'firstName':
    case 'lastName':
    case 'personalNumber':
    case 'unit':
    case 'city':
    case 'enlistedOn':
    case 'releaseOn':
      return f.details[field];
    case 'militaryPath':
      return f.militaryPath;
    case 'committeeReason':
      return f.committeeReason;
    case 'summary':
      return f.summary.text;
    case 'standing':
      return f.standing;
    default:
      return f.exams[field] ?? null;
  }
}

/** what the user typed, as the server takes it: an emptied number is "not entered" */
function toServer(field: EvaluationField, v: Value): Value {
  if (!NUMBER_FIELDS.includes(field)) return v;
  if (v === null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : (v as string);
}

const show = (v: Value) => (v === null || v === undefined || v === '' ? null : String(v));

// ---------------- saving as it is typed ----------------

interface Edit {
  value: Value;
  /** what the field held when the user started changing it */
  base: Value;
}
type SaveState =
  { state: 'idle' } | { state: 'pending' } | { state: 'saving' } | { state: 'saved'; at: string } | { state: 'failed'; error: string } | { state: 'conflict'; error: string };

export function useFileSaver(file: EvaluationFile, setFile: (f: EvaluationFile) => void) {
  const [edits, setEdits] = useState<Partial<Record<EvaluationField, Edit>>>({});
  const [conflicts, setConflicts] = useState<EvaluationField[]>([]);
  const [status, setStatus] = useState<SaveState>({ state: 'idle' });
  const editsRef = useRef(edits);
  editsRef.current = edits;
  const conflictsRef = useRef(conflicts);
  conflictsRef.current = conflicts;
  const fileRef = useRef(file);
  fileRef.current = file;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const busy = useRef(false);
  const cadetId = file.cadet.id;

  const flush = useCallback(async (): Promise<void> => {
    if (timer.current) clearTimeout(timer.current);
    if (busy.current) {
      timer.current = setTimeout(() => void flush(), 400);
      return;
    }
    const sending = (Object.entries(editsRef.current) as [EvaluationField, Edit][]).filter(([f]) => !conflictsRef.current.includes(f));
    if (!sending.length) return;
    busy.current = true;
    setStatus({ state: 'saving' });
    const changes: Record<string, Value> = {};
    const base: Record<string, Value> = {};
    for (const [f, e] of sending) {
      changes[f] = toServer(f, e.value);
      base[f] = toServer(f, e.base);
    }
    try {
      const next = await api.patch<EvaluationFile>(`/api/evaluations/${cadetId}`, { changes, base });
      setFile(next);
      // what was sent is saved; what was typed again meanwhile waits for the next save
      const sent = (f: EvaluationField, e: Edit) => sending.some(([sf, se]) => sf === f && se.value === e.value);
      const waiting = (Object.entries(editsRef.current) as [EvaluationField, Edit][]).some(([f, e]) => !sent(f, e) && !conflictsRef.current.includes(f));
      setEdits((cur) => {
        const out = { ...cur };
        for (const [f, e] of sending) if (out[f]?.value === e.value) delete out[f];
        return out;
      });
      setStatus(waiting ? { state: 'pending' } : { state: 'saved', at: new Date().toISOString() });
      emitLocalChange('cadets');
    } catch (err) {
      const e = err as ApiError;
      if (e.status === 409) {
        // someone else changed it meanwhile: their version is shown next to what was typed here
        const fresh = await api.get<EvaluationFile>(`/api/evaluations/${cadetId}`).catch(() => null);
        if (fresh) {
          setFile(fresh);
          const real = sending.filter(([f, ed]) => show(fieldValue(fresh, f)) !== show(toServer(f, ed.base))).map(([f]) => f);
          setConflicts((c) => [...new Set([...c, ...real])]);
          // a field sent along with the conflicting one, unchanged on the server, goes again
          setEdits((cur) => {
            const out = { ...cur };
            for (const [f] of sending) if (!real.includes(f) && out[f]) out[f] = { ...out[f]!, base: fieldValue(fresh, f) };
            return out;
          });
        }
        setStatus({ state: 'conflict', error: e.message });
      } else {
        setStatus({ state: 'failed', error: e.message });
      }
    } finally {
      busy.current = false;
    }
  }, [cadetId, setFile]);

  const change = useCallback(
    (field: EvaluationField, v: Value, now = false) => {
      setEdits((cur) => ({ ...cur, [field]: { value: v, base: cur[field] ? cur[field]!.base : fieldValue(fileRef.current, field) } }));
      setStatus({ state: 'pending' });
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => void flush(), now ? 0 : 1200);
    },
    [flush],
  );

  /** a conflict: write mine over the version now saved, knowingly */
  const keepMine = (field: EvaluationField) => {
    setEdits((cur) => (cur[field] ? { ...cur, [field]: { ...cur[field]!, base: fieldValue(fileRef.current, field) } } : cur));
    setConflicts((c) => c.filter((x) => x !== field));
    setTimeout(() => void flush(), 0);
  };
  /** a conflict: take the version now saved, drop what was typed here */
  const takeTheirs = (field: EvaluationField) => {
    setEdits((cur) => {
      const out = { ...cur };
      delete out[field];
      return out;
    });
    setConflicts((c) => c.filter((x) => x !== field));
    setStatus({ state: 'saved', at: new Date().toISOString() });
  };

  const unsaved = Object.keys(edits).length > 0 || status.state === 'saving';
  // leaving with something not yet saved: the browser asks first
  useEffect(() => {
    if (!unsaved) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [unsaved]);
  // leaving the screen: what is typed is sent right away
  useEffect(() => {
    return () => {
      void flush();
    };
  }, [flush]);

  const value = (field: EvaluationField): Value => (edits[field] ? edits[field]!.value : fieldValue(file, field));
  return { value, change, flush, status, conflicts, keepMine, takeTheirs, unsaved };
}

type Saver = ReturnType<typeof useFileSaver>;

export function SaveBar({ saver, file }: { saver: Saver; file: EvaluationFile }) {
  const s = saver.status;
  const last = file.updatedByName && file.updatedAt ? `עודכן לאחרונה ע"י ${file.updatedByName}, ${fmtAgo(file.updatedAt)}` : 'עוד לא עודכן';
  return (
    <div className={`eval-status ${s.state}`} role="status" aria-live="polite">
      {s.state === 'saving' ? (
        <>
          <span className="spinner" aria-hidden="true" /> שומר...
        </>
      ) : s.state === 'pending' ? (
        <>
          <Icon name="clock" size={15} /> שינויים ממתינים לשמירה
        </>
      ) : s.state === 'failed' ? (
        <>
          <Icon name="alert" size={15} /> השמירה נכשלה: {s.error}
          <button type="button" className="btn btn-sm" onClick={() => void saver.flush()}>
            ניסיון חוזר
          </button>
        </>
      ) : s.state === 'conflict' ? (
        <>
          <Icon name="alert" size={15} /> {s.error}
        </>
      ) : (
        <>
          <Icon name="check" size={15} /> {s.state === 'saved' ? 'כל השינויים נשמרו' : 'התיק שמור'}
        </>
      )}
      <span className="grow" />
      <span className="tiny muted">{last}</span>
    </div>
  );
}

/** a text area that grows with what is written in it */
function AutoText(props: React.TextareaHTMLAttributes<HTMLTextAreaElement> & { minRows?: number }) {
  const { minRows = 3, ...rest } = props;
  const ref = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight + 2}px`;
  }, [props.value]);
  return <textarea ref={ref} rows={minRows} {...rest} className={`textarea eval-text ${rest.className ?? ''}`} />;
}

/** the version saved meanwhile by someone else, next to what was typed here */
function ConflictBox({ field, saver, file }: { field: EvaluationField; saver: Saver; file: EvaluationFile }) {
  if (!saver.conflicts.includes(field)) return null;
  const saved = show(fieldValue(file, field));
  return (
    <div className="eval-conflict" role="alert">
      <div className="strong small">{EVALUATION_FIELDS[field].label} עודכן בינתיים. הנוסח השמור עכשיו:</div>
      <div className="eval-conflict-text">{saved ?? NOT_ENTERED}</div>
      <div className="row wrap gap-6">
        <button type="button" className="btn btn-sm btn-primary" onClick={() => saver.keepMine(field)}>
          שמירת הנוסח שלי במקומו
        </button>
        <button type="button" className="btn btn-sm" onClick={() => saver.takeTheirs(field)}>
          השארת הנוסח השמור
        </button>
      </div>
    </div>
  );
}

/** one field of the file, saved as it is typed */
function Input({
  field,
  saver,
  file,
  type = 'text',
  placeholder,
  min,
  max,
  step,
  long,
  minRows,
  label,
}: {
  field: EvaluationField;
  saver: Saver;
  file: EvaluationFile;
  type?: string;
  placeholder?: string;
  min?: number;
  max?: number;
  step?: number;
  long?: boolean;
  minRows?: number;
  label?: string;
}) {
  const v = saver.value(field);
  const text = v === null || v === undefined ? '' : String(v);
  const aria = label ?? EVALUATION_FIELDS[field].label;
  return (
    <>
      {long ? (
        <AutoText
          value={text}
          minRows={minRows}
          placeholder={placeholder}
          aria-label={aria}
          onChange={(e) => saver.change(field, e.target.value)}
          onBlur={() => void saver.flush()}
        />
      ) : (
        <input
          className={`input${type === 'number' ? ' mono' : ''}`}
          type={type}
          dir={type === 'date' || type === 'number' ? 'ltr' : undefined}
          inputMode={type === 'number' ? 'decimal' : undefined}
          value={text}
          min={min}
          max={max}
          step={step}
          placeholder={placeholder}
          aria-label={aria}
          onChange={(e) => saver.change(field, type === 'date' && !e.target.value ? null : e.target.value, type === 'date')}
          onBlur={() => void saver.flush()}
        />
      )}
      <ConflictBox field={field} saver={saver} file={file} />
    </>
  );
}

function Section({ n, title, children, className, hint, id }: { n?: number; title: string; children: ReactNode; className?: string; hint?: ReactNode; id?: string }) {
  return (
    <section className={`card eval-section ${className ?? ''}`} id={id} aria-labelledby={id ? `${id}-h` : undefined}>
      <div className="card-head">
        {n && <span className="eval-num">{n}</span>}
        <h3 className="grow" id={id ? `${id}-h` : undefined}>
          {title}
        </h3>
      </div>
      <div className="card-body col gap-12">
        {hint && (
          <p className="small muted" style={{ margin: 0 }}>
            {hint}
          </p>
        )}
        {children}
      </div>
    </section>
  );
}

// ---------------- the living file ----------------

export function LiveFile({ file, setFile, onHistory }: { file: EvaluationFile; setFile: (f: EvaluationFile) => void; onHistory: (itemId?: number) => void }) {
  const saver = useFileSaver(file, setFile);
  const { user } = useSession();
  return (
    <div className="col gap-16 eval-file">
      <SaveBar saver={saver} file={file} />

      <div className="card card-pad row wrap gap-6">
        <div style={{ flex: '1 1 220px', minWidth: 0 }}>
          <div className="label-caps">{EVALUATION_SECTIONS.standing}</div>
          <div className="small muted">תקין, במעקב או בסיכון - איך הצוער עומד כרגע בקורס.</div>
        </div>
        <Seg<Standing>
          value={saver.value('standing') as Standing}
          options={STANDINGS.map((s) => ({ value: s, label: STANDING_LABELS[s] }))}
          onChange={(s) => saver.change('standing', s, true)}
        />
      </div>

      <Section n={1} id="eval-1" title={EVALUATION_SECTIONS.general}>
        <table className="eval-table">
          <caption>{EVALUATION_TITLE}</caption>
          <tbody>
            <tr>
              <th scope="row">שם המ"פ</th>
              <td>
                <Input field="companyCommander" saver={saver} file={file} placeholder={file.general.companyCommanderAuto ?? 'שם המ"פ'} />
              </td>
            </tr>
            <tr>
              <th scope="row">שם המפק"צ</th>
              <td>
                <Input field="teamCommander" saver={saver} file={file} placeholder={file.general.teamCommanderAuto ?? 'שם המפק"צ'} />
              </td>
            </tr>
          </tbody>
        </table>
        {(!file.general.companyCommander || !file.general.teamCommander) && (
          <p className="tiny muted" style={{ margin: 0 }}>
            שדה ריק מציג את השם מהמערכת (מפקד הקורס ומפקד הצוות).
          </p>
        )}
      </Section>

      <Section n={2} id="eval-2" title={EVALUATION_SECTIONS.details} hint="שם ומספר אישי מכרטיס הצוער - שינוי כאן מעדכן גם את הכרטיס.">
        <table className="eval-table">
          <tbody>
            <tr>
              <th scope="row">שם מלא</th>
              <td>
                <div className="row gap-6 eval-pair">
                  <Input field="firstName" saver={saver} file={file} placeholder="שם פרטי" />
                  <Input field="lastName" saver={saver} file={file} placeholder="שם משפחה" />
                </div>
              </td>
            </tr>
            <tr>
              <th scope="row">מספר אישי</th>
              <td>
                <Input field="personalNumber" saver={saver} file={file} placeholder={NOT_ENTERED} />
              </td>
            </tr>
            <tr>
              <th scope="row">מערך</th>
              <td>
                <Input field="unit" saver={saver} file={file} placeholder={NOT_ENTERED} />
              </td>
            </tr>
            <tr>
              <th scope="row">עיר מגורים</th>
              <td>
                <Input field="city" saver={saver} file={file} placeholder={NOT_ENTERED} />
              </td>
            </tr>
            <tr>
              <th scope="row">תאריך גיוס</th>
              <td>
                <Input field="enlistedOn" saver={saver} file={file} type="date" />
              </td>
            </tr>
            <tr>
              <th scope="row">תאריך שחרור</th>
              <td>
                <Input field="releaseOn" saver={saver} file={file} type="date" />
              </td>
            </tr>
          </tbody>
        </table>
      </Section>

      <Section n={3} id="eval-3" title={EVALUATION_SECTIONS.path} hint="לפי סדר כרונולוגי: תפקידים, יחידות והכשרות קודמות.">
        <Input field="militaryPath" saver={saver} file={file} long minRows={4} placeholder="לדוגמה: 2023 - טירונות ... 2024-2025 - תפקיד ביחידה ... קורס ..." />
      </Section>

      <Section n={4} id="eval-4" title={EVALUATION_SECTIONS.exams} hint={`כל נתון נשמר בנפרד. שדה ריק הוא "${NOT_ENTERED}" - שונה מציון 0.`}>
        <ExamsSection file={file} setFile={setFile} saver={saver} />
      </Section>

      <Section n={5} id="eval-5" title={EVALUATION_SECTIONS.dynamics} hint="ציון 1-5 ומיקום ביחס לצוות 1-12. הערכה חדשה מתווספת לקודמות.">
        <DynamicsSection file={file} setFile={setFile} />
      </Section>

      <Section n={6} id="eval-6" title={EVALUATION_SECTIONS.reason} hint="ימולא כשרלוונטי: הפערים או האירועים שהובילו לכך, והסוגיה שהוועדה צריכה לבחון.">
        <Input field="committeeReason" saver={saver} file={file} long minRows={4} placeholder="לא חובה" />
      </Section>

      <Section n={7} id="eval-7" title={EVALUATION_SECTIONS.notes} hint="תיעוד מצטבר לאורך הקורס: תפקוד, חוזקות, פערים, אירועים, משוב שניתן לצוער והשינוי שנצפה בעקבותיו.">
        <NotesSection file={file} setFile={setFile} onHistory={onHistory} authorName={user.displayName} />
      </Section>

      <Section n={8} id="eval-8" className="eval-critical" title={EVALUATION_SECTIONS.points} hint="האירועים והממצאים המשמעותיים להערכת הצוער. כשנשקלת הדחה - הבסיס לכך.">
        <PointsSection file={file} setFile={setFile} onHistory={onHistory} />
      </Section>

      <Section n={9} id="eval-9" title={EVALUATION_SECTIONS.summary} hint="ההערכה הכוללת, הממצאים שעליהם היא נשענת וההמלצה להמשך דרכו. בהמלצה להדחה - הנימוק המלא.">
        {file.canEditSummary ? (
          <Input field="summary" saver={saver} file={file} long minRows={6} placeholder={EVALUATION_SECTIONS.summary} />
        ) : (
          <>
            <div className="eval-readonly">{file.summary.text || <span className="muted">טרם נכתב.</span>}</div>
            <p className="tiny muted" style={{ margin: 0 }}>
              <Icon name="lock" size={11} /> לצפייה בלבד - הסיכום נכתב בידי המ"פ.
            </p>
          </>
        )}
        {file.summary.byName && file.summary.at && (
          <div className="tiny muted">
            עודכן ע"י {file.summary.byName}, {fmtDateTime(file.summary.at)} ·{' '}
            <button type="button" className="link-btn" onClick={() => onHistory()}>
              היסטוריית השינויים
            </button>
          </div>
        )}
      </Section>
    </div>
  );
}

/** a number field of a test: a score 0-100, or repetitions */
function ExamInput({ field, saver, file }: { field: keyof EvaluationExams; saver: Saver; file: EvaluationFile }) {
  if (EXAM_TEXT_FIELDS.includes(field)) return <Input field={field} saver={saver} file={file} placeholder={NOT_ENTERED} />;
  const reps = field.toLowerCase().endsWith('pushups');
  return <Input field={field} saver={saver} file={file} type="number" min={0} max={reps ? 1000 : 100} step={reps ? 1 : 0.5} placeholder={NOT_ENTERED} />;
}

function ExamsSection({ file, setFile, saver }: { file: EvaluationFile; setFile: (f: EvaluationFile) => void; saver: Saver }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const addable = TEST_ORDER.filter((t) => !EXAM_TESTS[t].always && !file.tests.includes(t));
  const act = async (run: () => Promise<EvaluationFile>, done: string) => {
    setBusy(true);
    setError(null);
    try {
      setFile(await run());
      emitLocalChange('cadets');
      toast({ title: done, tone: 'green' });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const add = (t: ExamTest) =>
    void act(() => api.post<EvaluationFile>(`/api/evaluations/${file.cadet.id}/tests`, { test: t }), `"${EXAM_TESTS[t].label}" נוסף לתיקים של כל הצוערים`);
  const remove = async (t: ExamTest) => {
    const label = EXAM_TESTS[t].label;
    if (
      !(await ask({
        title: `להסיר את "${label}"?`,
        body: 'הוא יוסר מתיקי ההערכה של כל הצוערים. עדיין לא הוזנו בו נתונים, ואפשר להוסיף אותו שוב בכל שלב.',
        confirm: 'הסרה',
        danger: true,
      }))
    )
      return;
    void act(() => api.del<EvaluationFile>(`/api/evaluations/${file.cadet.id}/tests/${t}`), `"${label}" הוסר מהתיקים`);
  };
  const removeButton = (t: ExamTest) =>
    file.removableTests.includes(t) && (
      <button
        type="button"
        className="icon-btn eval-test-remove"
        disabled={busy}
        aria-label={`הסרת "${EXAM_TESTS[t].label}" מהתיקים`}
        title="הסרה מהתיקים"
        onClick={() => void remove(t)}
      >
        <Icon name="x" size={14} />
      </button>
    );
  return (
    <>
      <div className="table-wrap">
        <table className="eval-table eval-exams">
          <thead>
            <tr>
              <th scope="col">מבחן</th>
              <th scope="col" colSpan={2}>
                שדות למילוי
              </th>
            </tr>
          </thead>
          {file.tests.map((t) => {
            const test = EXAM_TESTS[t];
            if (test.kind === 'score')
              return (
                <tbody key={t}>
                  <tr>
                    <th scope="row">
                      <span className="eval-test-name">
                        {test.label}
                        {removeButton(t)}
                      </span>
                    </th>
                    <td colSpan={2}>
                      <span className="eval-cell-label">ציון 0-100</span>
                      <ExamInput field={test.fields[0]} saver={saver} file={file} />
                    </td>
                  </tr>
                </tbody>
              );
            if (test.kind === 'exam') {
              const [a, b] = test.fields;
              return (
                <tbody key={t}>
                  <tr>
                    <th scope="row">
                      <span className="eval-test-name">
                        {test.label}
                        {removeButton(t)}
                      </span>
                    </th>
                    <td>
                      <span className="eval-cell-label">ציון מועד א׳</span>
                      <ExamInput field={a} saver={saver} file={file} />
                    </td>
                    <td>
                      <span className="eval-cell-label">ציון מועד ב׳</span>
                      <ExamInput field={b} saver={saver} file={file} />
                    </td>
                  </tr>
                </tbody>
              );
            }
            const [run, runScore, pushups, pushupsScore] = test.fields;
            return (
              <tbody key={t} className="eval-test">
                <tr className="eval-test-head">
                  <th colSpan={3} scope="rowgroup">
                    <span className="eval-test-name">
                      {test.label}
                      {removeButton(t)}
                    </span>
                  </th>
                </tr>
                <tr>
                  <th scope="row" className="eval-sub">
                    ריצה
                  </th>
                  <td>
                    <span className="eval-cell-label">תוצאה</span>
                    <ExamInput field={run} saver={saver} file={file} />
                  </td>
                  <td>
                    <span className="eval-cell-label">ציון</span>
                    <ExamInput field={runScore} saver={saver} file={file} />
                  </td>
                </tr>
                <tr>
                  <th scope="row" className="eval-sub">
                    שכיבות סמיכה
                  </th>
                  <td>
                    <span className="eval-cell-label">מספר חזרות</span>
                    <ExamInput field={pushups} saver={saver} file={file} />
                  </td>
                  <td>
                    <span className="eval-cell-label">ציון</span>
                    <ExamInput field={pushupsScore} saver={saver} file={file} />
                  </td>
                </tr>
              </tbody>
            );
          })}
        </table>
      </div>
      {addable.length > 0 && (
        <div className="eval-add col gap-6">
          <div className="row wrap gap-6">
            {addable.map((t) => (
              <button key={t} type="button" className="btn btn-sm" disabled={busy} onClick={() => add(t)}>
                <Icon name="plus" size={14} /> {EXAM_TESTS[t].label}
              </button>
            ))}
          </div>
          <span className="tiny muted">מבחן שנוסף מופיע בתיקים של כל הצוערים בקורס.</span>
        </div>
      )}
      <ErrorBox error={error} />
    </>
  );
}

function DynamicsSection({ file, setFile }: { file: EvaluationFile; setFile: (f: EvaluationFile) => void }) {
  const toast = useToast();
  const [date, setDate] = useState(todayKey());
  const [score, setScore] = useState('');
  const [rank, setRank] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const add = async () => {
    setBusy(true);
    setError(null);
    try {
      setFile(await api.post<EvaluationFile>(`/api/evaluations/${file.cadet.id}/dynamics`, { occurredOn: date, score: Number(score), rank: Number(rank) }));
      emitLocalChange('cadets');
      setScore('');
      setRank('');
      toast({ title: 'ההערכה נוספה', tone: 'green' });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      {file.dynamics.length > 0 && (
        <div className="table-wrap">
          <table className="eval-table eval-list">
            <thead>
              <tr>
                <th scope="col">תאריך</th>
                <th scope="col">ציון (1-5)</th>
                <th scope="col">מיקום בצוות (1-12)</th>
                <th scope="col">הוזן ע"י</th>
                <th scope="col">
                  <span className="sr-only">פעולות</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {file.dynamics.map((d, i) => {
                const prev = file.dynamics[i - 1];
                return (
                  <tr key={d.id}>
                    <td className="mono">{shortDate(d.occurredOn)}</td>
                    <td className="mono">
                      {d.score}
                      {prev && d.score !== prev.score && <span className={d.score > prev.score ? 'text-green' : 'text-red'}> {d.score > prev.score ? '↑' : '↓'}</span>}
                    </td>
                    <td className="mono">
                      {d.rank}
                      {prev && d.rank !== prev.rank && <span className={d.rank < prev.rank ? 'text-green' : 'text-red'}> {d.rank < prev.rank ? '↑' : '↓'}</span>}
                    </td>
                    <td className="small">{d.authorName}</td>
                    <td>
                      {d.canDelete && (
                        <button
                          type="button"
                          className="icon-btn"
                          aria-label={`מחיקת ההערכה מ-${shortDate(d.occurredOn)}`}
                          onClick={async () => {
                            if (!(await ask({ title: 'למחוק את ההערכה?', body: 'המחיקה נרשמת בהיסטוריית השינויים של התיק.', confirm: 'מחיקה', danger: true }))) return;
                            setFile(await api.del<EvaluationFile>(`/api/evaluations/dynamics/${d.id}`));
                            emitLocalChange('cadets');
                          }}
                        >
                          <Icon name="trash" size={14} />
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <div className="row wrap gap-12 eval-add">
        <Field label="תאריך ההערכה">
          <input className="input" type="date" dir="ltr" value={date} max={todayKey()} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Field label="ציון">
          <select className="select" value={score} onChange={(e) => setScore(e.target.value)}>
            <option value="">בחירה</option>
            {[1, 2, 3, 4, 5].map((n) => (
              <option key={n}>{n}</option>
            ))}
          </select>
        </Field>
        <Field label="מיקום בצוות">
          <select className="select" value={rank} onChange={(e) => setRank(e.target.value)}>
            <option value="">בחירה</option>
            {Array.from({ length: 12 }, (_, i) => i + 1).map((n) => (
              <option key={n}>{n}</option>
            ))}
          </select>
        </Field>
        <button type="button" className="btn btn-primary" disabled={busy || !date || !score || !rank} onClick={() => void add()}>
          <Icon name="plus" /> הוספת הערכה
        </button>
      </div>
      <ErrorBox error={error} />
    </>
  );
}

const legacyTag = (n: EvaluationNote) => (n.legacy ? [n.legacy.tone ? EVAL_TONE_LABELS[n.legacy.tone] : '', n.legacy.category].filter(Boolean).join(' · ') : '');

function NotesSection({
  file,
  setFile,
  onHistory,
  authorName,
}: {
  file: EvaluationFile;
  setFile: (f: EvaluationFile) => void;
  onHistory: (itemId?: number) => void;
  authorName: string;
}) {
  const toast = useToast();
  const [date, setDate] = useState(todayKey());
  const [body, setBody] = useDraft(`evaluation-note:${file.cadet.id}`);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const add = async () => {
    setBusy(true);
    setError(null);
    try {
      setFile(await api.post<EvaluationFile>(`/api/evaluations/${file.cadet.id}/notes`, { occurredOn: date, body }));
      emitLocalChange('cadets');
      setBody('');
      toast({ title: 'ההתייחסות נוספה לתיק', tone: 'green' });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      {file.notes.length === 0 ? (
        <p className="small muted" style={{ margin: 0 }}>
          עוד אין התייחסויות.
        </p>
      ) : (
        <ol className="eval-timeline">
          {file.notes.map((n) => (
            <ItemEditor
              key={n.id}
              cadetId={file.cadet.id}
              kind="notes"
              id={n.id}
              version={n.version}
              canEdit={n.canEdit}
              setFile={setFile}
              values={{ occurredOn: n.occurredOn, body: n.body }}
              fresh={(f) => {
                const x = f.notes.find((y) => y.id === n.id);
                return x ? { occurredOn: x.occurredOn, body: x.body } : null;
              }}
              freshVersion={(f) => f.notes.find((y) => y.id === n.id)?.version ?? null}
              onHistory={() => onHistory(n.id)}
              view={
                <>
                  <div className="row wrap gap-6 small">
                    <b className="mono">{shortDate(n.occurredOn)}</b>
                    <span>{n.authorName}</span>
                    {legacyTag(n) && <span className="badge">{legacyTag(n)}</span>}
                    {n.legacy?.shownOn && <span className="badge t-green">הוצג לצוער {shortDate(n.legacy.shownOn)}</span>}
                    {n.edited && (
                      <span className="tiny muted">
                        נערך{n.updatedByName ? ` ע"י ${n.updatedByName}` : ''}, {fmtAgo(n.updatedAt)}
                      </span>
                    )}
                  </div>
                  <div className="eval-readonly mt-8">{n.body}</div>
                </>
              }
              fields={[
                { key: 'occurredOn', label: 'תאריך', type: 'date' },
                { key: 'body', label: 'תוכן ההתייחסות', long: true },
              ]}
            />
          ))}
        </ol>
      )}
      <div className="eval-add col gap-12">
        <div className="row wrap gap-12">
          <Field label="תאריך">
            <input className="input" type="date" dir="ltr" value={date} max={todayKey()} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <div className="small muted" style={{ alignSelf: 'flex-end', paddingBottom: 10 }}>
            ייכתב בשם: <b>{authorName}</b>
          </div>
        </div>
        <Field label="התייחסות חדשה">
          <AutoText value={body} minRows={4} onChange={(e) => setBody(e.target.value)} placeholder="תפקוד, חוזקות, פערים, אירועים, משוב שניתן לצוער והשינוי שנצפה בעקבותיו" />
        </Field>
        <div className="row">
          <button type="button" className="btn btn-primary" disabled={busy || !body.trim() || !date} onClick={() => void add()}>
            <Icon name="plus" /> הוספת התייחסות
          </button>
        </div>
        <ErrorBox error={error} />
      </div>
    </>
  );
}

function PointsSection({ file, setFile, onHistory }: { file: EvaluationFile; setFile: (f: EvaluationFile) => void; onHistory: (itemId?: number) => void }) {
  const toast = useToast();
  const [period, setPeriod] = useDraft(`evaluation-point-period:${file.cadet.id}`);
  const [description, setDescription] = useDraft(`evaluation-point:${file.cadet.id}`);
  const [significance, setSignificance] = useDraft(`evaluation-point-meaning:${file.cadet.id}`);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const add = async () => {
    setBusy(true);
    setError(null);
    try {
      setFile(await api.post<EvaluationFile>(`/api/evaluations/${file.cadet.id}/points`, { period, description, significance }));
      emitLocalChange('cadets');
      setPeriod('');
      setDescription('');
      setSignificance('');
      toast({ title: 'הנקודה נוספה לתיק', tone: 'green' });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      {file.points.length === 0 ? (
        <p className="small muted" style={{ margin: 0 }}>
          עוד אין נקודות.
        </p>
      ) : (
        <ol className="eval-points">
          {file.points.map((p) => (
            <ItemEditor
              key={p.id}
              cadetId={file.cadet.id}
              kind="points"
              id={p.id}
              version={p.version}
              canEdit={p.canEdit}
              setFile={setFile}
              values={{ period: p.period, description: p.description, significance: p.significance }}
              fresh={(f) => {
                const x = f.points.find((y) => y.id === p.id);
                return x ? { period: x.period, description: x.description, significance: x.significance } : null;
              }}
              freshVersion={(f) => f.points.find((y) => y.id === p.id)?.version ?? null}
              onHistory={() => onHistory(p.id)}
              view={<PointView p={p} />}
              fields={[
                { key: 'period', label: 'תאריך או תקופה' },
                { key: 'description', label: 'תיאור עובדתי של האירוע או הממצא', long: true },
                { key: 'significance', label: 'המשמעות הפיקודית והקשר להתאמה להמשך הקורס ולקצונה', long: true },
              ]}
            />
          ))}
        </ol>
      )}
      <div className="eval-add col gap-12">
        <Field label="תאריך או תקופה">
          <input className="input" value={period} onChange={(e) => setPeriod(e.target.value)} placeholder="לדוגמה: 12.10, או שבוע 4-5" style={{ maxWidth: 280 }} />
        </Field>
        <Field label="תיאור עובדתי של האירוע או הממצא">
          <AutoText value={description} minRows={3} onChange={(e) => setDescription(e.target.value)} />
        </Field>
        <Field label="המשמעות הפיקודית והקשר להתאמה להמשך הקורס ולקצונה">
          <AutoText value={significance} minRows={3} onChange={(e) => setSignificance(e.target.value)} />
        </Field>
        <div className="row">
          <button type="button" className="btn btn-primary" disabled={busy || !description.trim()} onClick={() => void add()}>
            <Icon name="plus" /> הוספת נקודה
          </button>
        </div>
        <ErrorBox error={error} />
      </div>
    </>
  );
}

function PointView({ p }: { p: EvaluationPoint }) {
  return (
    <>
      <div className="row wrap gap-6 small">
        {p.period && <b>{p.period}</b>}
        <span className="muted">{p.authorName}</span>
        {p.edited && (
          <span className="tiny muted">
            נערך{p.updatedByName ? ` ע"י ${p.updatedByName}` : ''}, {fmtAgo(p.updatedAt)}
          </span>
        )}
      </div>
      <div className="eval-point-part">
        <span className="label-caps">מה קרה</span>
        <div className="eval-readonly">{p.description}</div>
      </div>
      {p.significance && (
        <div className="eval-point-part">
          <span className="label-caps">המשמעות הפיקודית</span>
          <div className="eval-readonly">{p.significance}</div>
        </div>
      )}
    </>
  );
}

/** a remark or a point: shown, edited in place, its history one tap away; a version changed meanwhile is not written over */
function ItemEditor({
  cadetId,
  kind,
  id,
  version,
  canEdit,
  setFile,
  values,
  fresh,
  freshVersion,
  view,
  fields,
  onHistory,
}: {
  cadetId: number;
  kind: 'notes' | 'points';
  id: number;
  version: number;
  canEdit: boolean;
  setFile: (f: EvaluationFile) => void;
  values: Record<string, string>;
  fresh: (f: EvaluationFile) => Record<string, string> | null;
  freshVersion: (f: EvaluationFile) => number | null;
  view: ReactNode;
  fields: { key: string; label: string; type?: string; long?: boolean }[];
  onHistory: () => void;
}) {
  const toast = useToast();
  const [editing, setEditing] = useState<Record<string, string> | null>(null);
  const [base, setBase] = useState(version);
  const [conflict, setConflict] = useState<{ error: string; saved: Record<string, string> | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const noun = kind === 'notes' ? 'ההתייחסות' : 'הנקודה';

  const save = async (withVersion = base) => {
    if (!editing) return;
    setBusy(true);
    setError(null);
    try {
      setFile(await api.patch<EvaluationFile>(`/api/evaluations/${kind}/${id}`, { ...editing, version: withVersion }));
      emitLocalChange('cadets');
      setEditing(null);
      setConflict(null);
      toast({ title: `${noun} עודכנה`, tone: 'green' });
    } catch (err) {
      const e = err as ApiError;
      if (e.status === 409) {
        const f = await api.get<EvaluationFile>(`/api/evaluations/${cadetId}`).catch(() => null);
        if (f) setFile(f);
        setConflict({ error: e.message, saved: f ? fresh(f) : null });
        setBase(f ? (freshVersion(f) ?? base) : base);
      } else setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <li className="eval-item">
      {editing ? (
        <div className="col gap-12">
          {fields.map((f) => (
            <Field key={f.key} label={f.label}>
              {f.long ? (
                <AutoText value={editing[f.key] ?? ''} minRows={3} onChange={(e) => setEditing({ ...editing, [f.key]: e.target.value })} />
              ) : (
                <input
                  className="input"
                  type={f.type ?? 'text'}
                  dir={f.type === 'date' ? 'ltr' : undefined}
                  value={editing[f.key] ?? ''}
                  onChange={(e) => setEditing({ ...editing, [f.key]: e.target.value })}
                  style={{ maxWidth: 280 }}
                />
              )}
            </Field>
          ))}
          {conflict && (
            <div className="eval-conflict" role="alert">
              <div className="strong small">{conflict.error}</div>
              {conflict.saved ? (
                <div className="eval-conflict-text">
                  {fields
                    .map((f) => conflict.saved![f.key])
                    .filter(Boolean)
                    .join('\n\n')}
                </div>
              ) : (
                <div className="small">{noun} נמחקה בינתיים.</div>
              )}
              {conflict.saved && (
                <div className="row wrap gap-6">
                  <button type="button" className="btn btn-sm btn-primary" disabled={busy} onClick={() => void save(base)}>
                    שמירת הנוסח שלי במקומו
                  </button>
                  <button
                    type="button"
                    className="btn btn-sm"
                    onClick={() => {
                      setEditing(null);
                      setConflict(null);
                    }}
                  >
                    השארת הנוסח השמור
                  </button>
                </div>
              )}
            </div>
          )}
          <ErrorBox error={error} />
          {!conflict && (
            <div className="row gap-6">
              <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={() => void save()}>
                {busy ? 'שומר...' : 'שמירה'}
              </button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditing(null)}>
                ביטול
              </button>
            </div>
          )}
        </div>
      ) : (
        <>
          {view}
          <div className="row wrap gap-6 mt-8 no-print">
            {canEdit && (
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => {
                  setEditing({ ...values });
                  setBase(version);
                  setConflict(null);
                }}
              >
                <Icon name="edit" size={14} /> עדכון
              </button>
            )}
            <button type="button" className="btn btn-ghost btn-sm" onClick={onHistory}>
              <Icon name="history" size={14} /> היסטוריה
            </button>
            {canEdit && (
              <button
                type="button"
                className="btn btn-ghost btn-sm text-red"
                onClick={async () => {
                  if (!(await ask({ title: `למחוק את ${noun}?`, body: 'התוכן נשמר בהיסטוריית השינויים של התיק.', confirm: 'מחיקה', danger: true }))) return;
                  try {
                    setFile(await api.del<EvaluationFile>(`/api/evaluations/${kind}/${id}`));
                    emitLocalChange('cadets');
                  } catch (e) {
                    setError((e as Error).message);
                  }
                }}
              >
                <Icon name="trash" size={14} /> מחיקה
              </button>
            )}
          </div>
          <ErrorBox error={error} />
        </>
      )}
    </li>
  );
}

// ---------------- the history ----------------

export function HistoryDialog({ cadetId, itemId, onClose }: { cadetId: number; itemId?: number; onClose: () => void }) {
  const [list, setList] = useState<EvaluationChange[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [onlyItem, setOnlyItem] = useState(itemId !== undefined);
  useEffect(() => {
    api
      .get<EvaluationChange[]>(`/api/evaluations/${cadetId}/history`)
      .then(setList)
      .catch((e: Error) => setError(e.message));
  }, [cadetId]);
  const shown = (list ?? []).filter((h) => !onlyItem || h.itemId === itemId);
  return (
    <Modal title="היסטוריית השינויים בתיק" wide readOnly onClose={onClose}>
      <div className="col gap-12">
        {itemId !== undefined && (
          <label className="check">
            <input type="checkbox" checked={onlyItem} onChange={(e) => setOnlyItem(e.target.checked)} />
            רק הרשומה שנבחרה
          </label>
        )}
        <ErrorBox error={error} />
        {!list ? (
          <p className="small muted">טוען...</p>
        ) : shown.length === 0 ? (
          <p className="small muted">אין שינויים להצגה.</p>
        ) : (
          <ol className="eval-history">
            {shown.map((h) => (
              <li key={h.id}>
                <div className="row wrap gap-6 small">
                  <b>{h.label}</b>
                  <span className="muted">
                    {h.userName ?? 'משתמש שנמחק'} · {fmtDateTime(h.at)}
                  </span>
                </div>
                {h.action !== 'add' && (
                  <div className="eval-history-old">
                    <span className="label-caps">לפני</span>
                    <div>{h.oldValue ?? NOT_ENTERED}</div>
                  </div>
                )}
                {h.action !== 'delete' && (
                  <div className="eval-history-new">
                    <span className="label-caps">{h.action === 'add' ? 'נוסף' : 'אחרי'}</span>
                    <div>{h.newValue ?? NOT_ENTERED}</div>
                  </div>
                )}
              </li>
            ))}
          </ol>
        )}
      </div>
    </Modal>
  );
}

// ---------------- read-only: print, and the version a committee received ----------------

const valueOr = (v: Value) => show(v) ?? <span className="muted">{NOT_ENTERED}</span>;

export function FileDocument({ file }: { file: EvaluationFile }) {
  const g = file.general;
  const d = file.details;
  const e = file.exams;
  return (
    <div className="col gap-16 eval-file eval-document">
      <div className="card card-pad row wrap gap-6">
        <span className="label-caps grow">{EVALUATION_SECTIONS.standing}</span>
        <span className={`badge t-${STANDING_TONES[file.standing]}`}>{STANDING_LABELS[file.standing]}</span>
      </div>
      <Section n={1} title={EVALUATION_SECTIONS.general}>
        <table className="eval-table">
          <caption>{EVALUATION_TITLE}</caption>
          <tbody>
            <tr>
              <th scope="row">שם המ"פ</th>
              <td>{valueOr(g.companyCommander || g.companyCommanderAuto)}</td>
            </tr>
            <tr>
              <th scope="row">שם המפק"צ</th>
              <td>{valueOr(g.teamCommander || g.teamCommanderAuto)}</td>
            </tr>
          </tbody>
        </table>
      </Section>
      <Section n={2} title={EVALUATION_SECTIONS.details}>
        <table className="eval-table">
          <tbody>
            <tr>
              <th scope="row">שם מלא</th>
              <td>{`${d.firstName} ${d.lastName}`.trim()}</td>
            </tr>
            <tr>
              <th scope="row">מספר אישי</th>
              <td className="mono">{valueOr(d.personalNumber)}</td>
            </tr>
            <tr>
              <th scope="row">מערך</th>
              <td>{valueOr(d.unit)}</td>
            </tr>
            <tr>
              <th scope="row">עיר מגורים</th>
              <td>{valueOr(d.city)}</td>
            </tr>
            <tr>
              <th scope="row">תאריך גיוס</th>
              <td className="mono">{d.enlistedOn ? shortDate(d.enlistedOn) + '.' + d.enlistedOn.slice(0, 4) : valueOr(null)}</td>
            </tr>
            <tr>
              <th scope="row">תאריך שחרור</th>
              <td className="mono">{d.releaseOn ? shortDate(d.releaseOn) + '.' + d.releaseOn.slice(0, 4) : valueOr(null)}</td>
            </tr>
          </tbody>
        </table>
      </Section>
      <Section n={3} title={EVALUATION_SECTIONS.path}>
        <div className="eval-readonly">{valueOr(file.militaryPath)}</div>
      </Section>
      <Section n={4} title={EVALUATION_SECTIONS.exams}>
        <table className="eval-table">
          <tbody>
            {(file.tests ?? shownTests([], e)).flatMap((t) => {
              const test = EXAM_TESTS[t];
              const v = (k: keyof EvaluationExams) => valueOr(e[k] ?? null);
              if (test.kind === 'score')
                return [
                  <tr key={t}>
                    <th scope="row">{test.label}</th>
                    <td colSpan={2}>{v(test.fields[0])}</td>
                  </tr>,
                ];
              if (test.kind === 'exam')
                return [
                  <tr key={t}>
                    <th scope="row">{test.label}</th>
                    <td>מועד א׳: {v(test.fields[0])}</td>
                    <td>מועד ב׳: {v(test.fields[1])}</td>
                  </tr>,
                ];
              return [
                <tr key={`${t}-run`}>
                  <th scope="row">{test.label} - ריצה</th>
                  <td>תוצאה: {v(test.fields[0])}</td>
                  <td>ציון: {v(test.fields[1])}</td>
                </tr>,
                <tr key={`${t}-pushups`}>
                  <th scope="row">{test.label} - שכיבות סמיכה</th>
                  <td>חזרות: {v(test.fields[2])}</td>
                  <td>ציון: {v(test.fields[3])}</td>
                </tr>,
              ];
            })}
          </tbody>
        </table>
      </Section>
      <Section n={5} title={EVALUATION_SECTIONS.dynamics}>
        {file.dynamics.length ? (
          <table className="eval-table eval-list">
            <thead>
              <tr>
                <th scope="col">תאריך</th>
                <th scope="col">ציון (1-5)</th>
                <th scope="col">מיקום בצוות (1-12)</th>
              </tr>
            </thead>
            <tbody>
              {file.dynamics.map((x) => (
                <tr key={x.id}>
                  <td className="mono">{shortDate(x.occurredOn)}</td>
                  <td className="mono">{x.score}</td>
                  <td className="mono">{x.rank}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="small muted">{NOT_ENTERED}</p>
        )}
      </Section>
      <Section n={6} title={EVALUATION_SECTIONS.reason}>
        <div className="eval-readonly">{file.committeeReason || <span className="muted">לא רלוונטי / טרם נכתב</span>}</div>
      </Section>
      <Section n={7} title={EVALUATION_SECTIONS.notes}>
        {file.notes.length ? (
          <ol className="eval-timeline">
            {file.notes.map((n) => (
              <li key={`${n.id}-${n.occurredOn}`} className="eval-item">
                <div className="row wrap gap-6 small">
                  <b className="mono">{shortDate(n.occurredOn)}</b>
                  <span>{n.authorName}</span>
                  {legacyTag(n) && <span className="badge">{legacyTag(n)}</span>}
                </div>
                <div className="eval-readonly mt-8">{n.body}</div>
              </li>
            ))}
          </ol>
        ) : (
          <p className="small muted">אין התייחסויות.</p>
        )}
      </Section>
      <Section n={8} className="eval-critical" title={EVALUATION_SECTIONS.points}>
        {file.points.length ? (
          <ol className="eval-points">
            {file.points.map((p) => (
              <li key={p.id} className="eval-item">
                <PointView p={p} />
              </li>
            ))}
          </ol>
        ) : (
          <p className="small muted">אין נקודות.</p>
        )}
      </Section>
      <Section n={9} title={EVALUATION_SECTIONS.summary}>
        <div className="eval-readonly">{file.summary.text || <span className="muted">טרם נכתב.</span>}</div>
        {file.summary.byName && file.summary.at && (
          <div className="tiny muted">
            {file.summary.byName}, {fmtDateTime(file.summary.at)}
          </div>
        )}
      </Section>
    </div>
  );
}
