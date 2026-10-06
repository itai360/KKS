// The grade sheet (גליון הציונים) into every cadet's evaluation file (server/src/grades.ts): pick one
// file or several (or paste a link), see where each column goes and what it changes, then import -
// file by file, or all of them at once.

import { useState } from 'react';
import type { GradeColumn, GradeImportPreview, GradeImportResult, GradeTarget } from '@shared/types';
import { api } from '../lib/api';
import { emitLocalChange } from '../lib/realtime';
import { Icon } from './Icon';
import { useToast } from './Toasts';
import { ErrorBox, Modal } from './ui';

type Sheet = { name: string; rows: string[][] };
type Status = 'pending' | 'done' | 'skipped';
interface Source {
  file: string;
  sheets: Sheet[];
  sheet: number;
  status: Status;
  result?: GradeImportResult;
}
type Mapping = Record<string, GradeTarget>;
type Target = GradeImportPreview['targets'][number];

const EMPTY: GradeImportResult = { cadets: 0, set: 0, replaced: 0, kept: 0, unchanged: 0, unmatched: 0 };
const add = (a: GradeImportResult, b: GradeImportResult): GradeImportResult => ({
  cadets: a.cadets + b.cadets,
  set: a.set + b.set,
  replaced: a.replaced + b.replaced,
  kept: a.kept + b.kept,
  unchanged: a.unchanged + b.unchanged,
  unmatched: a.unmatched + b.unmatched,
});
const rowsOf = (s: Source) => s.sheets[s.sheet].rows;
const firstPending = (list: Source[]) => list.findIndex((s) => s.status === 'pending');

export function GradesImport({ onClose }: { onClose: () => void }) {
  const toast = useToast();
  const [sources, setSources] = useState<Source[]>([]);
  const [at, setAt] = useState(0);
  const [link, setLink] = useState('');
  const [mapping, setMapping] = useState<Mapping>({});
  const [preview, setPreview] = useState<GradeImportPreview | null>(null);
  const [overwrite, setOverwrite] = useState(true);
  const [showMissing, setShowMissing] = useState(false);
  const [open, setOpen] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const source = sources[at] as Source | undefined;
  const pending = sources.filter((s) => s.status === 'pending');
  const finished = sources.length > 0 && pending.length === 0;
  const totals = sources.reduce((t, s) => (s.result ? add(t, s.result) : t), EMPTY);
  const many = sources.length > 1;

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const look = async (s: Source, map: Mapping) => {
    setPreview(null);
    setShowMissing(false);
    setOpen(null);
    setPreview(await api.post<GradeImportPreview>('/api/evaluations/grades/preview', { rows: rowsOf(s), mapping: map }));
  };
  /** a file on screen, with the columns as suggested */
  const show = async (list: Source[], i: number) => {
    setAt(i);
    setMapping({});
    await look(list[i], {});
  };
  /** new files join the queue; the one on screen stays there */
  const enqueue = async (read: Source[]) => {
    const next = [...sources, ...read];
    setSources(next);
    if (source?.status === 'pending' && preview) return;
    await show(next, firstPending(next));
  };
  const readFiles = (files: File[]) =>
    run(async () => {
      const read: Source[] = [];
      for (const f of files) {
        try {
          read.push({ file: f.name, sheets: await api.upload<Sheet[]>('/api/evaluations/grades/file', f), sheet: 0, status: 'pending' });
        } catch (e) {
          throw new Error(`${f.name}: ${(e as Error).message}`);
        }
      }
      await enqueue(read);
    });
  const readLink = () =>
    run(async () => {
      const sheets = await api.post<Sheet[]>('/api/evaluations/grades/link', { url: link });
      setLink('');
      await enqueue([{ file: 'Google Sheets', sheets, sheet: 0, status: 'pending' }]);
    });

  const update = (i: number, patch: Partial<Source>) => {
    const next = sources.map((s, j) => (j === i ? { ...s, ...patch } : s));
    setSources(next);
    return next;
  };
  const pickSheet = (i: number) => {
    const next = update(at, { sheet: i });
    void run(() => show(next, at));
  };
  const route = (col: GradeColumn, target: GradeTarget) => {
    const map = { ...mapping, [String(col.index)]: target };
    setMapping(map);
    if (source) void run(() => look(source, map));
  };
  /** after a file: on to the next one waiting, or the summary */
  const onward = async (list: Source[]) => {
    const n = firstPending(list);
    if (n >= 0) await show(list, n);
    else setPreview(null);
  };
  const importOne = (s: Source, map: Mapping) => api.post<GradeImportResult>('/api/evaluations/grades/import', { rows: rowsOf(s), mapping: map, overwrite });

  const go = () =>
    run(async () => {
      const r = await importOne(source!, mapping);
      const next = update(at, { status: 'done', result: r });
      emitLocalChange('cadets');
      toast({ title: `נכנסו ${r.set} ציונים`, body: many ? source!.file : `${r.cadets} צוערים`, tone: 'green' });
      await onward(next);
    });
  /** the file on screen with the choices made, every other waiting file as suggested */
  const goAll = () =>
    run(async () => {
      let next = sources;
      const failed: string[] = [];
      for (let i = 0; i < next.length; i++) {
        if (next[i].status !== 'pending') continue;
        try {
          const r = await importOne(next[i], i === at ? mapping : {});
          next = next.map((s, j) => (j === i ? { ...s, status: 'done' as Status, result: r } : s));
        } catch (e) {
          failed.push(`${next[i].file}: ${(e as Error).message}`);
        }
      }
      setSources(next);
      emitLocalChange('cadets');
      await onward(next);
      if (failed.length) setError(`לא יובאו: ${failed.join(' · ')}`);
    });
  const skip = () => void run(() => onward(update(at, { status: 'skipped' })));

  const found = preview?.rows.filter((r) => r.cadetId) ?? [];
  const missing = preview?.rows.filter((r) => !r.cadetId) ?? [];
  const importing = preview?.columns.filter((c) => c.target !== 'skip') ?? [];
  // what the import would write: grades already in the file as they are in the sheet need nothing
  const changes = importing.reduce((n, c) => n + c.changes, 0);
  const total = importing.reduce((n, c) => n + c.values - c.same, 0) - (overwrite ? 0 : changes);
  const label = (col: GradeColumn, t: Target) => (t.value === 'new' ? `ציון חדש: ${col.header}` : t.label);

  return (
    <Modal
      title="ייבוא ציונים מגליון הציונים"
      wide
      onClose={onClose}
      footer={
        finished ? (
          <button className="btn btn-primary" onClick={onClose}>
            סגירה
          </button>
        ) : (
          <>
            <button className="btn btn-primary" disabled={busy || !preview || total === 0} onClick={() => void go()}>
              <Icon name="upload" /> {preview && total === 0 && importing.length > 0 ? 'אין ציונים חדשים' : `ייבוא ${total} ציונים${pending.length > 1 ? ' והמשך' : ''}`}
            </button>
            {pending.length > 1 && (
              <button className="btn" disabled={busy || !preview} onClick={() => void goAll()} title="הקובץ שעל המסך לפי הבחירות שלך, ושאר הקבצים לפי ההצעה">
                ייבוא כל {pending.length} הקבצים
              </button>
            )}
            {many && source?.status === 'pending' && (
              <button className="btn btn-ghost" disabled={busy} onClick={skip}>
                דילוג על הקובץ
              </button>
            )}
            <button className="btn btn-ghost" onClick={onClose}>
              {totals.set ? 'סגירה' : 'ביטול'}
            </button>
          </>
        )
      }
    >
      <div className="col gap-12">
        {!finished && (
          <>
            <p className="small muted" style={{ margin: 0 }}>
              אחרי כל מבחן או כש"ג: מעלים את גליון הציונים - קובץ אחד או כמה יחד - וכל ציון נכנס לתיק ההערכה של הצוער. הצוערים מזוהים לפי מספר אישי (או לפי השם). לפני הייבוא רואים מה ייכנס לאן, ותא ריק בגליון לא מוחק ציון שכבר בתיק.
            </p>
            <div className="row wrap gap-6">
              <label className="btn">
                <Icon name="file" /> {sources.length ? 'הוספת קבצים' : 'בחירת קבצי אקסל'}
                <input
                  type="file"
                  multiple
                  accept=".xlsx,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                  hidden
                  onChange={(e) => {
                    const files = [...(e.target.files ?? [])];
                    e.target.value = '';
                    if (files.length) void readFiles(files);
                  }}
                />
              </label>
              <input className="input grow" dir={link ? 'ltr' : undefined} placeholder="או קישור ל-Google Sheets / Drive" aria-label="קישור לגליון הציונים" value={link} onChange={(e) => setLink(e.target.value)} style={{ minWidth: 220 }} />
              <button className="btn" disabled={busy || link.trim().length < 10} onClick={() => void readLink()}>
                {busy && !sources.length ? 'קורא...' : 'קריאה מהקישור'}
              </button>
            </div>
          </>
        )}
        {many && (
          <ol className="grade-queue" aria-label="הקבצים לייבוא">
            {sources.map((s, i) => {
              const current = i === at && !finished;
              const state = s.status === 'done' ? `${s.result!.set} ציונים` : s.status === 'skipped' ? 'דולג' : current ? 'על המסך' : 'ממתין';
              const body = (
                <>
                  <Icon name={s.status === 'done' ? 'check' : s.status === 'skipped' ? 'x' : 'file'} size={14} />
                  <span className="clip-text">{s.file}</span>
                  <span className="tiny muted">{state}</span>
                </>
              );
              return (
                <li key={i} className={`grade-queue-item is-${s.status}${current ? ' is-current' : ''}`} aria-current={current ? 'step' : undefined}>
                  {s.status === 'pending' && !current ? (
                    <button type="button" disabled={busy} onClick={() => void run(() => show(sources, i))} aria-label={`מעבר לקובץ ${s.file}`}>
                      {body}
                    </button>
                  ) : (
                    body
                  )}
                </li>
              );
            })}
          </ol>
        )}
        <ErrorBox error={error} />
        {finished && (
          <>
            <div className="info-box">
              נכנסו <b>{totals.set}</b> ציונים
              {many ? ` מ-${sources.filter((s) => s.status === 'done').length} קבצים` : <> לתיקים של <b>{totals.cadets}</b> צוערים</>}
              {totals.replaced > 0 && ` (${totals.replaced} מהם עדכנו ציון קודם)`}.{totals.unchanged > 0 && ` ${totals.unchanged} ציונים כבר היו בתיקים כמו בגליון.`}
              {totals.kept > 0 && ` ${totals.kept} ציונים שכבר הוזנו נשארו כמו שהיו.`}
              {totals.unmatched > 0 && ` ${totals.unmatched} שורות לא זוהו ולא יובאו.`}
            </div>
            <p className="small muted" style={{ margin: 0 }}>
              כל שינוי נרשם בהיסטוריית השינויים של התיק.
            </p>
          </>
        )}
        {!finished && source && source.sheets.length > 1 && (
          <label className="row gap-6 small">
            גליון{many ? ` ב-${source.file}` : ''}:
            <select className="select" style={{ maxWidth: 240 }} value={source.sheet} onChange={(e) => pickSheet(Number(e.target.value))} disabled={busy}>
              {source.sheets.map((s, i) => (
                <option key={i} value={i}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
        )}
        {!finished && preview && (
          <>
            <div className="info-box">
              {many && <b>{source?.file}: </b>}
              זוהו <b>{found.length}</b> צוערים
              {missing.length > 0 && (
                <>
                  {' '}
                  ·{' '}
                  <button type="button" className="link-btn" onClick={() => setShowMissing(!showMissing)} aria-expanded={showMissing}>
                    {missing.length === 1 ? 'שורה אחת לא זוהתה' : `${missing.length} שורות לא זוהו`}
                  </button>
                </>
              )}
              <span className="muted"> · הכותרות בשורה {preview.headerRow}</span>
            </div>
            {showMissing && (
              <ul className="small grade-missing">
                {missing.map((r) => (
                  <li key={r.line}>
                    שורה {r.line}: {r.name || 'ללא שם'}
                    {r.personalNumber && <span className="mono"> ({r.personalNumber})</span>}
                  </li>
                ))}
              </ul>
            )}
            <div className="table-wrap">
              <table className="table grade-map">
                <thead>
                  <tr>
                    <th scope="col">עמודה בגליון</th>
                    <th scope="col">נכנס ל...</th>
                    <th scope="col">ציונים</th>
                    <th scope="col">הערות</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.columns.map((col) => (
                    <GradeRow
                      key={col.index}
                      col={col}
                      targets={preview.targets}
                      label={label}
                      busy={busy}
                      open={open === col.index}
                      onToggle={() => setOpen(open === col.index ? null : col.index)}
                      onRoute={(t) => route(col, t)}
                    />
                  ))}
                </tbody>
              </table>
            </div>
            {changes > 0 && (
              <label className="check">
                <input type="checkbox" checked={overwrite} onChange={(e) => setOverwrite(e.target.checked)} />
                לעדכן {changes} ציונים שכבר הוזנו ושונים בגליון
              </label>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}

/** a column of the sheet: where it goes, how many grades, and - opened - whose grade it changes */
function GradeRow({
  col,
  targets,
  label,
  busy,
  open,
  onToggle,
  onRoute,
}: {
  col: GradeColumn;
  targets: Target[];
  label: (col: GradeColumn, t: Target) => string;
  busy: boolean;
  open: boolean;
  onToggle: () => void;
  onRoute: (t: GradeTarget) => void;
}) {
  const skip = col.target === 'skip';
  const notes = [
    !skip && col.same > 0 && (col.same === col.values ? 'כולם כבר בתיק' : `${col.same} כבר בתיק`),
    col.other > 0 && `${col.other} תאים שאינם מספר`,
    col.outOfRange > 0 && `${col.outOfRange} מחוץ לטווח 0-100`,
    skip && col.values === 0 && col.other === 0 && 'אין עדיין ציונים',
  ].filter(Boolean) as string[];
  const showChanges = !skip && col.changes > 0;
  return (
    <>
      <tr className={skip ? 'muted' : ''}>
        <th scope="row">{col.header}</th>
        <td>
          <select className="select" value={col.target} aria-label={`לאן נכנסת העמודה ${col.header}`} onChange={(e) => onRoute(e.target.value as GradeTarget)} disabled={busy}>
            {targets.map((t) => (
              <option key={t.value} value={t.value}>
                {label(col, t)}
              </option>
            ))}
          </select>
        </td>
        <td className="mono">
          {skip ? (
            '-'
          ) : (
            <>
              {col.values}
              <span className="only-mobile small muted"> ציונים</span>
            </>
          )}
        </td>
        <td className="small">
          {showChanges && (
            <button type="button" className="link-btn" aria-expanded={open} onClick={onToggle}>
              {col.changes} שונים מהציון שבתיק
            </button>
          )}
          {showChanges && notes.length > 0 && ' · '}
          {notes.join(' · ')}
        </td>
      </tr>
      {showChanges && open && (
        <tr className="grade-changes">
          <td colSpan={4}>
            <ul aria-label={`ציונים שישתנו: ${col.header}`}>
              {col.changed.map((c) => (
                <li key={c.cadetId}>
                  <span>{c.name}</span>
                  <span className="mono">
                    <span className="muted">{c.before}</span> ← <b>{c.after}</b>
                  </span>
                </li>
              ))}
              {col.changes > col.changed.length && <li className="muted">ועוד {col.changes - col.changed.length}</li>}
            </ul>
          </td>
        </tr>
      )}
    </>
  );
}
