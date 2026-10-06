import { useRef, useState } from 'react';
import { Link } from 'react-router';
import { GRADE_COLUMN_LABELS, GRADE_IMPORT_LIMIT, type GradeColumn, type GradePreview, type GradeSource, type GradeUpload } from '@shared/gradeImport';
import { api, ApiError } from '../lib/api';
import { saveCsv } from '../lib/csv';
import { emitLocalChange } from '../lib/realtime';
import { ErrorBox, Modal } from './ui';
import { Icon } from './Icon';

const CELL_STATUS = { new: 'חדש', replace: 'יוחלף', keep: 'יישאר כפי שהוא', same: 'ללא שינוי' };
const PAGE_SIZE = 40;

export function GradeImport({ onClose }: { onClose: () => void }) {
  const [sources, setSources] = useState<GradeSource[]>([]);
  const [notices, setNotices] = useState<string[]>([]);
  const [overwrite, setOverwrite] = useState(false);
  const [preview, setPreview] = useState<GradePreview | null>(null);
  const [result, setResult] = useState<{ cadets: number; grades: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState('');
  const [filter, setFilter] = useState<'all' | 'issues' | 'changes'>('all');
  const [page, setPage] = useState(0);
  const busyRef = useRef(false);
  const heading = useRef<HTMLHeadingElement>(null);

  const upload = async (files: File[]) => {
    if (!files.length || busyRef.current) return;
    busyRef.current = true;
    setError(null);
    const added: GradeSource[] = [];
    const messages: string[] = [];
    try {
      if (files.length + sources.length > 50) throw new Error('אפשר לצרף עד 50 קבצים או גיליונות בכל סבב');
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        setBusy(`קורא קובץ ${i + 1} מתוך ${files.length}: ${file.name}`);
        try {
          if (!/\.(xlsx|csv|tsv)$/i.test(file.name)) throw new Error('הפורמטים הנתמכים הם XLSX, CSV ו-TSV');
          if (file.size > 4 * 1024 * 1024) throw new Error('הקובץ גדול מ-4MB. פצלו אותו לקבצים קטנים יותר');
          const data = await api.upload<GradeUpload>('/api/evaluations/import/file', file);
          added.push(...data.sheets.map((s) => ({ ...s, filename: file.name })));
          if (data.skippedSheets.length) messages.push(`${file.name}: הגיליונות ${data.skippedSheets.join(', ')} אינם טבלת ציונים ולא ייובאו`);
        } catch (e) {
          messages.push(`${file.name}: ${(e as Error).message}`);
        }
      }
      setSources((old) => [...old, ...added]);
      setNotices((old) => [...old, ...messages]);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      busyRef.current = false;
      setBusy('');
    }
  };

  const inspect = async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy('בודק שיוך לצוערים וציונים קיימים');
    setError(null);
    try {
      const body = { sources, overwrite };
      if (new Blob([JSON.stringify(body)]).size > 3 * 1024 * 1024) throw new Error('הנתונים גדולים מדי לסבב אחד. הסירו חלק מהקבצים וייבאו אותם בסבב הבא');
      setPreview(await api.post<GradePreview>('/api/evaluations/import/preview', body));
      setPage(0);
      setFilter('all');
      requestAnimationFrame(() => heading.current?.focus());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      busyRef.current = false;
      setBusy('');
    }
  };

  const save = async () => {
    if (!preview?.writes.length || busyRef.current) return;
    busyRef.current = true;
    setBusy('שומר ציונים בתיקי ההערכה');
    setError(null);
    try {
      const done = await api.post<{ cadets: number; grades: number }>('/api/evaluations/import/apply', { writes: preview.writes });
      setResult(done);
      setSources([]);
      emitLocalChange('cadets');
      requestAnimationFrame(() => heading.current?.focus());
    } catch (e) {
      setError((e as Error).message);
      if (e instanceof ApiError && e.status === 409) setPreview(null);
    } finally {
      busyRef.current = false;
      setBusy('');
    }
  };

  const rows =
    preview?.rows.filter((r) => (filter === 'issues' ? !!r.issue : filter === 'changes' ? !r.issue && r.cells.some((c) => c.status === 'new' || c.status === 'replace') : true)) ??
    [];
  const count = sources.reduce((n, s) => n + s.rows.length, 0);
  const issuesCsv = () =>
    void saveCsv(
      'שורות-לתיקון-ביבוא-ציונים',
      ['מקור', 'שורה', 'שם', 'מספר אישי', 'סיבה'],
      (preview?.rows ?? []).filter((r) => r.issue).map((r) => [r.source, r.line, r.name, r.personalNumber, r.issue ?? '']),
    );

  return (
    <Modal
      title="ייבוא ציונים מרוכז"
      onClose={onClose}
      wide
      closable={!busy}
      footer={
        result ? (
          <button className="btn btn-primary" onClick={onClose}>
            חזרה לתיקי ההערכה
          </button>
        ) : (
          <>
            {preview ? (
              <button
                className="btn"
                disabled={!!busy}
                onClick={() => {
                  setPreview(null);
                  setError(null);
                }}
              >
                חזרה לקבצים ולעמודות
              </button>
            ) : (
              <button className="btn" disabled={!!busy} onClick={onClose}>
                ביטול
              </button>
            )}
            <button
              className="btn btn-primary"
              disabled={!!busy || (preview ? !preview.writes.length : !sources.length || count > GRADE_IMPORT_LIMIT)}
              onClick={() => void (preview ? save() : inspect())}
            >
              {busy ? 'בתהליך…' : preview ? `שמירת ${preview.summary.grades} ציונים ל-${preview.summary.cadets} צוערים` : 'בדיקת הנתונים ותצוגה מקדימה'}
            </button>
          </>
        )
      }
    >
      <div className="grade-import" aria-busy={!!busy}>
        <ErrorBox error={error} />
        {busy && (
          <p role="status" className="grade-import-status">
            {busy}
          </p>
        )}
        {result ? (
          <div className="grade-import-success">
            <Icon name="check" size={32} />
            <h3 tabIndex={-1} ref={heading}>
              הציונים נשמרו
            </h3>
            <p>
              {result.grades} ציונים עודכנו ב-{result.cadets} תיקי הערכה. כל שינוי מופיע בהיסטוריה של הצוער.
            </p>
          </div>
        ) : preview ? (
          <>
            <h3 ref={heading} tabIndex={-1}>
              בדיקה לפני שמירה
            </h3>
            <div className="grade-import-summary" role="status">
              <div>
                <strong>{preview.summary.grades}</strong>
                <span>ציונים לשמירה</span>
              </div>
              <div>
                <strong>{preview.summary.cadets}</strong>
                <span>צוערים לעדכון</span>
              </div>
              <div className={preview.summary.issues ? 'grade-import-problem' : ''}>
                <strong>{preview.summary.issues}</strong>
                <span>שורות שלא ייובאו</span>
              </div>
            </div>
            <p className="small muted">
              {preview.summary.kept} ציונים קיימים יישמרו ללא החלפה · {preview.summary.unchanged} זהים לנתון השמור · {preview.summary.empty} שורות ללא ציון לא ייובאו.
            </p>
            {preview.summary.issues > 0 && (
              <div className="grade-import-notice">
                <span>שורות עם בעיה לא יישמרו. אפשר להוריד דוח, לתקן בקובץ ולייבא שוב.</span>
                <button className="btn" onClick={issuesCsv}>
                  <Icon name="download" /> הורדת דוח לתיקון
                </button>
              </div>
            )}
            <div className="grade-import-toolbar">
              <label>
                הצגת שורות{' '}
                <select
                  className="select"
                  value={filter}
                  onChange={(e) => {
                    setFilter(e.target.value as typeof filter);
                    setPage(0);
                  }}
                >
                  <option value="all">כל השורות ({preview.rows.length})</option>
                  <option value="changes">ציונים לשמירה</option>
                  <option value="issues">שורות לתיקון ({preview.summary.issues})</option>
                </select>
              </label>
            </div>
            {rows.length ? (
              <div className="grade-import-rows">
                {rows.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE).map((r, i) => (
                  <article className={`grade-import-row${r.issue ? ' has-issue' : ''}`} key={`${page}-${i}`}>
                    <div className="grade-import-row-head">
                      <strong>{r.name || 'שם חסר'}</strong>
                      <span className="mono">{r.personalNumber || 'ללא מספר אישי'}</span>
                      {r.teamName && <span>{r.teamName}</span>}
                      {r.matchedBy === 'name' && <span className="badge t-yellow">התאמה לפי שם בלבד</span>}
                    </div>
                    <div className="tiny muted">
                      {r.source} · שורה {r.line}
                    </div>
                    {r.issue ? (
                      <p className="grade-import-problem">{r.issue}</p>
                    ) : (
                      <ul className="grade-import-values">
                        {r.cells.map((c) => (
                          <li key={c.field}>
                            <span>{GRADE_COLUMN_LABELS[c.field]}</span>
                            <span className="grade-import-value">
                              <span className="muted">{c.before ?? 'טרם הוזן'}</span>
                              <span aria-label="ערך מהקובץ">
                                ← <b>{c.value}</b>
                              </span>
                              <span className={`badge ${c.status === 'new' ? 't-green' : c.status === 'replace' ? 't-yellow' : 't-gray'}`}>{CELL_STATUS[c.status]}</span>
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                    {r.cadetId && !r.issue && (
                      <Link className="small" to={`/evaluations/${r.cadetId}`} target="_blank" rel="noopener noreferrer">
                        פתיחת תיק הצוער בלשונית חדשה
                      </Link>
                    )}
                  </article>
                ))}
              </div>
            ) : (
              <p className="muted">אין שורות בתצוגה זו.</p>
            )}
            {rows.length > PAGE_SIZE && (
              <nav className="grade-import-pagination" aria-label="עמודי תצוגה מקדימה">
                <button className="btn" disabled={!page} onClick={() => setPage((p) => p - 1)}>
                  הקודם
                </button>
                <span role="status">
                  עמוד {page + 1} מתוך {Math.ceil(rows.length / PAGE_SIZE)}
                </span>
                <button className="btn" disabled={(page + 1) * PAGE_SIZE >= rows.length} onClick={() => setPage((p) => p + 1)}>
                  הבא
                </button>
              </nav>
            )}
          </>
        ) : (
          <>
            <p className="grade-import-intro">מעלים קובץ אחרי מבחן או כש״ג, בודקים למי שייך כל ציון ושומרים בתיקי ההערכה.</p>
            <fieldset disabled={!!busy} className="grade-import-controls">
              <label className="grade-import-upload">
                <Icon name="upload" size={28} />
                <strong>בחירת קובץ אחד או כמה קבצים</strong>
                <span>XLSX, CSV או TSV · עד 4MB לקובץ</span>
                <input
                  type="file"
                  multiple
                  accept=".xlsx,.csv,.tsv"
                  aria-label="קובצי ציונים לייבוא"
                  onChange={(e) => {
                    const files = Array.from(e.target.files ?? []);
                    e.target.value = '';
                    void upload(files);
                  }}
                />
              </label>
              <p className="small muted">התאמה לפי מספר אישי. כאשר הוא חסר, נבדק שם מלא וייחודי בתיקים שבאחריותך. תאים ריקים אינם מוחקים ציונים.</p>
              {notices.length > 0 && (
                <ul className="grade-import-notices">
                  {notices.map((n, i) => (
                    <li key={i}>{n}</li>
                  ))}
                </ul>
              )}
              {sources.length > 0 && (
                <>
                  <p role="status">
                    <strong>{sources.length} גיליונות</strong> · {count} שורות מתוך עד {GRADE_IMPORT_LIMIT} בסבב
                  </p>
                  {count > GRADE_IMPORT_LIMIT && <ErrorBox error="יש יותר מדי שורות לסבב אחד. הסירו חלק מהגיליונות וייבאו אותם בסבב הבא." />}
                  <div className="grade-import-notice">
                    <label>
                      <input type="checkbox" checked={overwrite} onChange={(e) => setOverwrite(e.target.checked)} /> החלפת ציונים קיימים בערכים מהקבצים
                    </label>
                    <span className="small muted">{overwrite ? 'כל החלפה תוצג לפני השמירה, עם הציון הקודם והחדש.' : 'ברירת המחדל היא מילוי ציונים חסרים בלבד.'}</span>
                  </div>
                  {sources.map((source, index) => (
                    <section className="grade-import-source" key={index}>
                      <div className="grade-import-source-head">
                        <div>
                          <strong>{source.filename}</strong>
                          <div className="small muted">
                            {source.name} · {source.rows.length} שורות
                          </div>
                        </div>
                        <button
                          type="button"
                          className="btn"
                          onClick={() => setSources((old) => old.filter((_, i) => i !== index))}
                          aria-label={`הסרת ${source.filename}, ${source.name}`}
                        >
                          הסרה
                        </button>
                      </div>
                      <details open={sources.length === 1 ? true : undefined}>
                        <summary>התאמת עמודות ({source.mapping.filter(Boolean).length} משויכות)</summary>
                        <p className="small muted">בדקו לאיזה שדה ייכנס כל ציון. עמודה שסומנה ״לא לייבא״ תידלג.</p>
                        <div className="grade-import-mapping">
                          {source.headers.map((header, c) => (
                            <label key={c}>
                              <span>{header || `עמודה ${c + 1}`}</span>
                              <select
                                className="select"
                                value={source.mapping[c] ?? ''}
                                onChange={(e) =>
                                  setSources((old) =>
                                    old.map((s, i) => (i === index ? { ...s, mapping: s.mapping.map((v, j) => (j === c ? (e.target.value as GradeColumn) : v)) } : s)),
                                  )
                                }
                              >
                                <option value="">לא לייבא</option>
                                {Object.entries(GRADE_COLUMN_LABELS).map(([key, label]) => (
                                  <option key={key} value={key}>
                                    {label}
                                  </option>
                                ))}
                              </select>
                            </label>
                          ))}
                        </div>
                      </details>
                    </section>
                  ))}
                </>
              )}
            </fieldset>
          </>
        )}
      </div>
    </Modal>
  );
}
