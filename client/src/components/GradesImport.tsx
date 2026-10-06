// The grade sheet (גליון הציונים) into every cadet's evaluation file (server/src/grades.ts): pick the
// file or paste its link, see where each column goes and what it changes, then import.

import { useState } from 'react';
import type { GradeColumn, GradeImportPreview, GradeImportResult, GradeTarget } from '@shared/types';
import { api } from '../lib/api';
import { emitLocalChange } from '../lib/realtime';
import { Icon } from './Icon';
import { useToast } from './Toasts';
import { ErrorBox, Modal } from './ui';

type Sheet = { name: string; rows: string[][] };

export function GradesImport({ onClose }: { onClose: () => void }) {
  const toast = useToast();
  const [sheets, setSheets] = useState<Sheet[] | null>(null);
  const [sheet, setSheet] = useState(0);
  const [link, setLink] = useState('');
  const [mapping, setMapping] = useState<Record<string, GradeTarget>>({});
  const [preview, setPreview] = useState<GradeImportPreview | null>(null);
  const [overwrite, setOverwrite] = useState(true);
  const [showMissing, setShowMissing] = useState(false);
  const [result, setResult] = useState<GradeImportResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
  const look = (rows: string[][], map: Record<string, GradeTarget>) =>
    run(async () => {
      setPreview(await api.post<GradeImportPreview>('/api/evaluations/grades/preview', { rows, mapping: map }));
    });
  const read = (get: () => Promise<Sheet[]>) =>
    run(async () => {
      const s = await get();
      setSheets(s);
      setSheet(0);
      setMapping({});
      setPreview(await api.post<GradeImportPreview>('/api/evaluations/grades/preview', { rows: s[0].rows }));
    });
  const pickSheet = (i: number) => {
    setSheet(i);
    setMapping({});
    setPreview(null);
    if (sheets) void look(sheets[i].rows, {});
  };
  const route = (col: GradeColumn, target: GradeTarget) => {
    const next = { ...mapping, [String(col.index)]: target };
    setMapping(next);
    if (sheets) void look(sheets[sheet].rows, next);
  };
  const go = () =>
    run(async () => {
      const r = await api.post<GradeImportResult>('/api/evaluations/grades/import', { rows: sheets![sheet].rows, mapping, overwrite });
      setResult(r);
      emitLocalChange('cadets');
      toast({ title: `נכנסו ${r.set} ציונים`, body: `${r.cadets} צוערים`, tone: 'green' });
    });

  const found = preview?.rows.filter((r) => r.cadetId) ?? [];
  const missing = preview?.rows.filter((r) => !r.cadetId) ?? [];
  const importing = preview?.columns.filter((c) => c.target !== 'skip') ?? [];
  const total = importing.reduce((n, c) => n + c.values, 0);
  const changes = importing.reduce((n, c) => n + c.changes, 0);
  const label = (col: GradeColumn, t: GradeImportPreview['targets'][number]) => (t.value === 'new' ? `ציון חדש: ${col.header}` : t.label);

  return (
    <Modal
      title="ייבוא ציונים מגליון הציונים"
      wide
      onClose={onClose}
      footer={
        result ? (
          <button className="btn btn-primary" onClick={onClose}>
            סגירה
          </button>
        ) : (
          <>
            <button className="btn btn-primary" disabled={busy || !preview || total === 0} onClick={() => void go()}>
              <Icon name="upload" /> ייבוא {total} ציונים
            </button>
            <button className="btn btn-ghost" onClick={onClose}>
              ביטול
            </button>
          </>
        )
      }
    >
      {result ? (
        <div className="col gap-12">
          <div className="info-box">
            נכנסו <b>{result.set}</b> ציונים לתיקים של <b>{result.cadets}</b> צוערים
            {result.replaced > 0 && ` (${result.replaced} מהם עדכנו ציון קודם)`}.
            {result.kept > 0 && ` ${result.kept} ציונים שכבר הוזנו נשארו כמו שהיו.`}
            {result.unmatched > 0 && ` ${result.unmatched} שורות לא זוהו ולא יובאו.`}
          </div>
          <p className="small muted" style={{ margin: 0 }}>
            כל שינוי נרשם בהיסטוריית השינויים של התיק.
          </p>
        </div>
      ) : (
        <div className="col gap-12">
          <p className="small muted" style={{ margin: 0 }}>
            אחרי כל מבחן או כש"ג: מעלים את גליון הציונים, וכל ציון נכנס לתיק ההערכה של הצוער. הצוערים מזוהים לפי מספר אישי (או לפי השם). לפני הייבוא רואים מה ייכנס לאן, ותא ריק בגליון לא מוחק ציון שכבר בתיק.
          </p>
          <div className="row wrap gap-6">
            <label className="btn">
              <Icon name="file" /> בחירת קובץ אקסל
              <input
                type="file"
                accept=".xlsx,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                hidden
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  e.target.value = '';
                  if (f) void read(() => api.upload<Sheet[]>('/api/evaluations/grades/file', f));
                }}
              />
            </label>
            <input className="input grow" dir={link ? 'ltr' : undefined} placeholder="או קישור ל-Google Sheets / Drive" aria-label="קישור לגליון הציונים" value={link} onChange={(e) => setLink(e.target.value)} style={{ minWidth: 220 }} />
            <button className="btn" disabled={busy || link.trim().length < 10} onClick={() => void read(() => api.post<Sheet[]>('/api/evaluations/grades/link', { url: link }))}>
              {busy && !sheets ? 'קורא...' : 'קריאה מהקישור'}
            </button>
          </div>
          {sheets && sheets.length > 1 && (
            <label className="row gap-6 small">
              גליון:
              <select className="select" style={{ maxWidth: 240 }} value={sheet} onChange={(e) => pickSheet(Number(e.target.value))}>
                {sheets.map((s, i) => (
                  <option key={i} value={i}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <ErrorBox error={error} />
          {preview && (
            <>
              <div className="info-box">
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
                      <tr key={col.index} className={col.target === 'skip' ? 'muted' : ''}>
                        <th scope="row">{col.header}</th>
                        <td>
                          <select className="select" value={col.target} aria-label={`לאן נכנסת העמודה ${col.header}`} onChange={(e) => route(col, e.target.value as GradeTarget)} disabled={busy}>
                            {preview.targets.map((t) => (
                              <option key={t.value} value={t.value}>
                                {label(col, t)}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="mono">
                          {col.target === 'skip' ? (
                            '-'
                          ) : (
                            <>
                              {col.values}
                              <span className="only-mobile small muted"> ציונים</span>
                            </>
                          )}
                        </td>
                        <td className="small">
                          {[
                            col.target !== 'skip' && col.changes > 0 && `${col.changes} שונים מהציון שבתיק`,
                            col.other > 0 && `${col.other} תאים שאינם מספר`,
                            col.outOfRange > 0 && `${col.outOfRange} מחוץ לטווח 0-100`,
                            col.target === 'skip' && col.values === 0 && col.other === 0 && 'אין עדיין ציונים',
                          ]
                            .filter(Boolean)
                            .join(' · ')}
                        </td>
                      </tr>
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
      )}
    </Modal>
  );
}
