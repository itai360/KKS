// A team's sociometric sheet - or several, one per team - into a round (server/src/sociometric.ts):
// the round, the team each sheet is of, the cadets its names are, then import.

import { useState } from 'react';
import type { SocioImportResult, SocioPreview, SocioRound } from '@shared/sociometric';
import { api } from '../lib/api';
import { emitLocalChange } from '../lib/realtime';
import { todayKey } from '../lib/format';
import { Icon } from './Icon';
import { useToast } from './Toasts';
import { DateInput, ErrorBox, Field, Modal, Seg, Select } from './ui';

type Sheet = { name: string; rows: string[][] };
interface Source {
  file: string;
  sheets: Sheet[];
  sheet: number;
  status: 'pending' | 'done' | 'skipped' | 'failed';
  result?: SocioImportResult;
}

export function SocioImport({ rounds, onClose, onDone }: { rounds: SocioRound[]; onClose: () => void; onDone: (roundId: number) => void }) {
  const toast = useToast();
  const [sources, setSources] = useState<Source[]>([]);
  const [at, setAt] = useState(0);
  const [link, setLink] = useState('');
  const [mode, setMode] = useState<'new' | 'existing'>(rounds.length ? 'existing' : 'new');
  const [roundId, setRoundId] = useState(rounds.length ? String(rounds[rounds.length - 1].id) : '');
  const [name, setName] = useState(rounds.length ? '' : 'סוציומטרי אמצע');
  const [heldOn, setHeldOn] = useState(todayKey());
  const [teamId, setTeamId] = useState<number | null | undefined>(undefined);
  const [mapping, setMapping] = useState<Record<string, number>>({});
  const [preview, setPreview] = useState<SocioPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // a round opened by the first sheet takes the next ones too
  const [madeRound, setMadeRound] = useState<number | null>(null);

  const source = sources[at] as Source | undefined;
  const pending = sources.filter((s) => s.status === 'pending');
  // done once every sheet was handled and at least one went in (a sheet that could not be read leaves the upload open)
  const finished = sources.some((s) => s.status === 'done') && pending.length === 0;
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
  const body = (s: Source, team: number | null | undefined, map: Record<string, number>) => ({
    rows: s.sheets[s.sheet].rows,
    source: `${s.file} ${s.sheets[s.sheet].name}`,
    ...(team !== undefined ? { teamId: team } : {}),
    mapping: map,
  });
  const look = async (s: Source, team: number | null | undefined, map: Record<string, number>) => {
    setPreview(await api.post<SocioPreview>('/api/sociometric/preview', body(s, team, map)));
  };
  /** a sheet on screen; one that cannot be read is marked so, and the next one waiting comes up */
  const show = async (list: Source[], i: number): Promise<void> => {
    setAt(i);
    setTeamId(undefined);
    setMapping({});
    setPreview(null);
    try {
      await look(list[i], undefined, {});
    } catch (e) {
      const why = `${list[i].file}: ${(e as Error).message}`;
      const next = list.map((s, j) => (j === i ? { ...s, status: 'failed' as const } : s));
      setSources(next);
      const n = next.findIndex((s) => s.status === 'pending');
      if (n < 0) throw new Error(why);
      await show(next, n);
      setError(why);
    }
  };
  const enqueue = async (read: Source[]) => {
    const next = [...sources, ...read];
    setSources(next);
    if (source?.status === 'pending' && preview) return;
    await show(next, next.findIndex((s) => s.status === 'pending'));
  };
  const readFiles = (files: File[]) =>
    run(async () => {
      const read: Source[] = [];
      for (const f of files) {
        try {
          read.push({ file: f.name.replace(/\.(xlsx|csv)$/i, ''), sheets: await api.upload<Sheet[]>('/api/sociometric/file', f), sheet: 0, status: 'pending' });
        } catch (e) {
          throw new Error(`${f.name}: ${(e as Error).message}`);
        }
      }
      await enqueue(read);
    });
  const readLink = () =>
    run(async () => {
      const r = await api.post<{ name: string; sheets: Sheet[] }>('/api/sociometric/link', { url: link });
      setLink('');
      await enqueue([{ file: r.name || 'Google Sheets', sheets: r.sheets, sheet: 0, status: 'pending' }]);
    });
  const changeTeam = (v: string) => {
    const t = v ? Number(v) : null;
    setTeamId(t);
    setMapping({});
    if (source) void run(() => look(source, t, {}));
  };
  const assign = (line: number, cadet: string) => {
    const map = { ...mapping, [String(line)]: Number(cadet) || 0 };
    setMapping(map);
    if (source) void run(() => look(source, teamId, map));
  };
  const target = () => {
    if (madeRound) return { roundId: madeRound };
    if (mode === 'existing' && roundId) return { roundId: Number(roundId) };
    return { newRound: { name: name.trim(), heldOn: heldOn || null } };
  };
  const go = () =>
    run(async () => {
      const r = await api.post<SocioImportResult>('/api/sociometric/import', { ...body(source!, teamId, mapping), ...target() });
      setMadeRound(r.roundId);
      const next = sources.map((s, j) => (j === at ? { ...s, status: 'done' as const, result: r } : s));
      setSources(next);
      emitLocalChange('cadets');
      toast({ title: `נכנסו ${r.set} צוערים`, body: r.teamName ?? source!.file, tone: 'green' });
      const n = next.findIndex((s) => s.status === 'pending');
      if (n >= 0) await show(next, n);
      else {
        setPreview(null);
        onDone(r.roundId);
      }
    });
  const skip = () =>
    run(async () => {
      const next = sources.map((s, j) => (j === at ? { ...s, status: 'skipped' as const } : s));
      setSources(next);
      const n = next.findIndex((s) => s.status === 'pending');
      if (n >= 0) await show(next, n);
      else setPreview(null);
    });

  const found = preview?.rows.filter((r) => r.cadetId).length ?? 0;
  const missing = preview?.rows.filter((r) => !r.cadetId) ?? [];
  const roundReady = madeRound || (mode === 'existing' ? !!roundId : name.trim().length > 0);
  const totals = sources.reduce((n, s) => n + (s.result?.set ?? 0), 0);

  return (
    <Modal
      title="ייבוא סוציומטרי"
      wide
      onClose={onClose}
      footer={
        finished ? (
          <button className="btn btn-primary" onClick={onClose}>
            סגירה
          </button>
        ) : (
          <>
            <button className="btn btn-primary" disabled={busy || !preview || !found || !roundReady} onClick={() => void go()}>
              <Icon name="upload" /> ייבוא {found} צוערים{pending.length > 1 ? ' והמשך' : ''}
            </button>
            {many && source?.status === 'pending' && (
              <button className="btn btn-ghost" disabled={busy} onClick={() => void skip()}>
                דילוג על הקובץ
              </button>
            )}
            <button className="btn btn-ghost" onClick={onClose}>
              {totals ? 'סגירה' : 'ביטול'}
            </button>
          </>
        )
      }
    >
      <div className="col gap-12">
        {finished ? (
          <div className="info-box">
            נכנסו <b>{totals}</b> צוערים{many ? ` מ-${sources.filter((s) => s.status === 'done').length} גליונות` : ''}. התוצאות, המיקומים והחריגים מחושבים מחדש לכל הסבב.
          </div>
        ) : (
          <>
            <p className="small muted" style={{ margin: 0 }}>
              מעלים את גליון הסוציומטרי של כל צוות - אחד או כמה יחד. הצוות מזוהה לפי שם הקובץ ("צוות 2") או לפי השמות שבו, והצוערים לפי השם הפרטי (ואות של שם המשפחה כשיש שניים). שורת הממוצע של הצוות ורשימת השמות שמתחת לטבלה לא נכנסות.
            </p>
            <div className="socio-round-pick">
              {madeRound ? (
                <div className="small">
                  הגליונות נכנסים ל<b>{rounds.find((r) => r.id === madeRound)?.name ?? name}</b>
                </div>
              ) : (
                <>
                  {rounds.length > 0 && (
                    <Seg
                      value={mode}
                      onChange={setMode}
                      options={[
                        { value: 'existing', label: 'לסבב קיים' },
                        { value: 'new', label: 'סבב חדש' },
                      ]}
                    />
                  )}
                  {mode === 'existing' && rounds.length > 0 ? (
                    <Select value={roundId} onChange={(e) => setRoundId(e.target.value)} aria-label="הסבב" style={{ maxWidth: 260 }}>
                      {[...rounds].reverse().map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.name}
                        </option>
                      ))}
                    </Select>
                  ) : (
                    <div className="form-grid">
                      <Field label="שם הסבב" required>
                        <input className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} placeholder="לדוגמה: סוציומטרי אמצע" />
                      </Field>
                      <Field label="תאריך">
                        <DateInput value={heldOn} onChange={setHeldOn} />
                      </Field>
                    </div>
                  )}
                </>
              )}
            </div>
            <div className="row wrap gap-6">
              <label className="btn">
                <Icon name="file" /> {sources.length ? 'הוספת גליונות' : 'בחירת קבצי אקסל'}
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
              <input className="input grow" dir={link ? 'ltr' : undefined} placeholder="או קישור ל-Google Sheets" aria-label="קישור לגליון הסוציומטרי" value={link} onChange={(e) => setLink(e.target.value)} style={{ minWidth: 220 }} />
              <button className="btn" disabled={busy || link.trim().length < 10} onClick={() => void readLink()}>
                קריאה מהקישור
              </button>
            </div>
          </>
        )}
        {many && (
          <ol className="grade-queue" aria-label="הגליונות לייבוא">
            {sources.map((s, i) => {
              const current = i === at && !finished;
              return (
                <li key={i} className={`grade-queue-item is-${s.status}${current ? ' is-current' : ''}`} aria-current={current ? 'step' : undefined}>
                  <Icon name={s.status === 'done' ? 'check' : s.status === 'skipped' || s.status === 'failed' ? 'x' : 'file'} size={14} />
                  <span className="clip-text">{s.file}</span>
                  <span className="tiny muted">{s.status === 'done' ? `${s.result!.set} צוערים` : s.status === 'skipped' ? 'דולג' : s.status === 'failed' ? 'לא נקרא' : current ? 'על המסך' : 'ממתין'}</span>
                </li>
              );
            })}
          </ol>
        )}
        <ErrorBox error={error} />
        {!finished && preview && source && (
          <>
            <div className="row wrap gap-12">
              <Field label={`הצוות של ${source.file}`}>
                <Select value={preview.teamId ?? ''} onChange={(e) => changeTeam(e.target.value)} aria-label="הצוות של הגליון" style={{ minWidth: 220 }}>
                  <option value="">לא ידוע - חיפוש בכל הצוערים</option>
                  {preview.teams.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <div className="info-box grow">
                זוהו <b>{found}</b> מתוך {preview.rows.length} שורות
                {preview.teamBy === 'title' && ' · הצוות לפי שם הקובץ'}
                {preview.teamBy === 'names' && ' · הצוות לפי השמות'}
                {preview.criteria.length > 0 && ` · ${preview.criteria.length} תבחינים`}
              </div>
            </div>
            {missing.length > 0 && (
              <div className="col gap-6">
                <div className="small strong">שמות שלא זוהו - בחרו את הצוער או השאירו מחוץ לייבוא:</div>
                {missing.map((r) => (
                  <div key={r.line} className="row gap-12 socio-missing">
                    <span className="grow small">
                      שורה {r.line}: <b>{r.name}</b>
                      {r.ambiguous && <span className="muted"> - כמה צוערים בשם הזה</span>}
                    </span>
                    <Select value={mapping[String(r.line)] ?? 0} onChange={(e) => assign(r.line, e.target.value)} aria-label={`הצוער של "${r.name}"`} style={{ maxWidth: 240 }}>
                      <option value={0}>לא לייבא</option>
                      {preview.candidates.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                          {preview.teamId ? '' : c.teamName ? ` (${c.teamName})` : ''}
                        </option>
                      ))}
                    </Select>
                  </div>
                ))}
              </div>
            )}
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th scope="col">בגליון</th>
                    <th scope="col">צוער</th>
                    <th scope="col">דירוג</th>
                    <th scope="col">ממוצע</th>
                    <th scope="col">תבחינים</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.rows.map((r) => (
                    <tr key={r.line} className={r.cadetId ? '' : 'muted'}>
                      <th scope="row">{r.name}</th>
                      <td>{r.cadetName ?? <span className="text-orange">לא זוהה</span>}</td>
                      <td className="mono">{r.rank ?? '-'}</td>
                      <td className="mono">{r.average ?? '-'}</td>
                      <td className="mono">{Object.keys(r.scores).length || '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
