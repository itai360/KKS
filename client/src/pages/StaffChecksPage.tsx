// The staff's checklist for each cadet (server/src/staffChecks.ts): a table for each team - its cadets down the side,
// what the staff does with each across the top. A square is tapped once it happened; the assignment's asks for its
// grade, which goes into the cadet's evaluation file and the course's grade sheet in Google.

import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';
import { STAFF_CHECK_ITEMS, type StaffCheckItem } from '@shared/staffChecks';
import type { GradeSheetStatus, StaffCheckMark, StaffChecksBoard, StaffChecksTeam } from '@shared/types';
import { ask } from '../components/Confirm';
import { Icon } from '../components/Icon';
import { useToast } from '../components/Toasts';
import { Empty, ErrorBox, Field, Loading, Modal, PageHead } from '../components/ui';
import { api } from '../lib/api';
import { fmtDateTime } from '../lib/format';
import { emitLocalChange } from '../lib/realtime';
import { useApi } from '../lib/useApi';

const SHEET_RESULT: Record<string, { title: string; tone: 'green' | 'red' }> = {
  ok: { title: 'גליון הציונים חובר', tone: 'green' },
  scope: { title: 'לא ניתנה הרשאה ל-Drive - צריך לסמן אותה בחלון של Google', tone: 'red' },
  failed: { title: 'החיבור ל-Google לא הצליח - נסו שוב', tone: 'red' },
  denied: { title: 'החיבור התחיל בחשבון אחר - נסו שוב מכאן', tone: 'red' },
  cancelled: { title: 'החיבור בוטל', tone: 'red' },
};

export function StaffChecksPage() {
  const { data, error, loading, reload } = useApi<StaffChecksBoard>('/api/staff-checks', ['cadets']);
  const [params, setParams] = useSearchParams();
  const toast = useToast();
  const [board, setBoard] = useState<StaffChecksBoard | null>(null);
  const [grading, setGrading] = useState<{ team: StaffChecksTeam; cadet: StaffChecksTeam['cadets'][number]; item: StaffCheckItem } | null>(null);
  const shown = board ?? data ?? null;
  useEffect(() => {
    setBoard(null);
  }, [data]);

  // back from Google's sign-in: how it went
  useEffect(() => {
    const r = params.get('sheet');
    if (!r) return;
    const m = SHEET_RESULT[r];
    if (m) toast({ title: m.title, tone: m.tone });
    setParams(
      (p) => {
        p.delete('sheet');
        return p;
      },
      { replace: true },
    );
  }, [params, setParams, toast]);

  /** one square, as the server keeps it now */
  const put = (cadetId: number, key: string, mark: StaffCheckMark | null) =>
    setBoard((b) => {
      const base = b ?? data;
      if (!base) return b;
      return {
        ...base,
        teams: base.teams.map((t) => ({
          ...t,
          cadets: t.cadets.map((c) => {
            if (c.id !== cadetId) return c;
            const marks = { ...c.marks };
            if (mark) marks[key] = mark;
            else delete marks[key];
            return { ...c, marks };
          }),
        })),
      };
    });

  const save = async (cadetId: number, key: string, body: { done: boolean; grade?: number | null }) => {
    const r = await api.put<{ mark: StaffCheckMark | null }>(`/api/staff-checks/${cadetId}/${key}`, body);
    put(cadetId, key, r.mark);
    emitLocalChange('cadets');
    return r.mark;
  };

  const tap = async (team: StaffChecksTeam, cadet: StaffChecksTeam['cadets'][number], item: StaffCheckItem) => {
    if (!team.canMark) return;
    const mark = cadet.marks[item.key];
    if (!mark) {
      if (item.grade) return setGrading({ team, cadet, item });
      // shown marked at once; back as it was if the server says no
      put(cadet.id, item.key, { at: new Date().toISOString(), byName: '', grade: null, sheet: '', sheetNote: '' });
      try {
        await save(cadet.id, item.key, { done: true });
      } catch (e) {
        put(cadet.id, item.key, null);
        toast({ title: (e as Error).message, tone: 'red' });
      }
      return;
    }
    if (item.grade && !(await ask({ title: `לבטל את הסימון של ${cadet.name}?`, body: `הציון (${mark.grade}) נשאר בתיק ההערכה ובגליון.`, confirm: 'ביטול הסימון' }))) return;
    put(cadet.id, item.key, null);
    try {
      await save(cadet.id, item.key, { done: false });
    } catch (e) {
      put(cadet.id, item.key, mark);
      toast({ title: (e as Error).message, tone: 'red' });
    }
  };

  const retry = async (cadetId: number, key: string) => {
    try {
      const r = await api.post<{ mark: StaffCheckMark | null }>(`/api/staff-checks/${cadetId}/${key}/sheet`);
      put(cadetId, key, r.mark);
      toast(r.mark?.sheet === 'written' ? { title: 'הציון נכתב בגליון', tone: 'green' } : { title: r.mark?.sheetNote || 'הציון עוד לא נכתב בגליון', tone: 'red' });
    } catch (e) {
      toast({ title: (e as Error).message, tone: 'red' });
    }
  };

  return (
    <div className="page">
      <PageHead title="מעקב סגל" sub="לכל צוער - מה הסגל כבר עשה איתו. לוחצים על ריבוע כשהמשימה קרתה." />
      <ErrorBox error={error} />
      {loading && !shown ? (
        <Loading rows={4} />
      ) : !shown ? null : (
        <>
          <GradeSheetCard sheet={shown.sheet} onChanged={() => void reload()} />
          {!shown.teams.length ? (
            <Empty icon="users" title="אין עדיין צוערים" text="אחרי שמוסיפים צוערים לצוותים, הטבלה של כל צוות מופיעה כאן." />
          ) : (
            shown.teams.map((t) => <TeamTable key={t.id ?? 'none'} team={t} onTap={(c, i) => void tap(t, c, i)} onRetry={(c, k) => void retry(c, k)} />)
          )}
        </>
      )}
      {grading && (
        <GradeDialog
          cadetName={grading.cadet.name}
          item={grading.item}
          onClose={() => setGrading(null)}
          onSave={async (grade) => {
            const mark = await save(grading.cadet.id, grading.item.key, { done: true, grade });
            setGrading(null);
            if (mark?.sheet === 'written') toast({ title: `הציון ${grade} נשמר ונכתב בגליון`, tone: 'green' });
            else if (mark?.sheet === 'error') toast({ title: `הציון נשמר - בגליון לא נכתב: ${mark.sheetNote}`, tone: 'red' });
            else toast({ title: `הציון ${grade} נשמר בתיק ההערכה`, tone: 'green' });
          }}
        />
      )}
    </div>
  );
}

function TeamTable({ team, onTap, onRetry }: { team: StaffChecksTeam; onTap: (c: StaffChecksTeam['cadets'][number], i: StaffCheckItem) => void; onRetry: (cadetId: number, key: string) => void }) {
  return (
    <section className="card staff-checks-card" aria-labelledby={`team-${team.id ?? 'none'}`}>
      <div className="card-head">
        <Icon name="users" />
        <h2 className="grow" id={`team-${team.id ?? 'none'}`}>
          {team.name}
          {team.commanderName && <span className="small muted"> · {team.commanderName}</span>}
        </h2>
        {team.mine && <span className="badge t-blue">הצוות שלי</span>}
      </div>
      {!team.cadets.length ? (
        <div className="card-body small muted">אין צוערים בצוות.</div>
      ) : (
        <div className="staff-checks-scroll">
          <table className="staff-checks">
            <thead>
              <tr>
                <th scope="col" className="sc-name">
                  שם הצוער
                </th>
                {STAFF_CHECK_ITEMS.map((i) => (
                  <th key={i.key} scope="col">
                    {i.label}
                    {i.grade && <span className="sc-grade-tag">+ ציון</span>}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {team.cadets.map((c) => (
                <tr key={c.id}>
                  <th scope="row" className="sc-name">
                    {c.name}
                  </th>
                  {STAFF_CHECK_ITEMS.map((i) => {
                    const m = c.marks[i.key];
                    const label = `${i.label} - ${c.name}`;
                    return (
                      <td key={i.key}>
                        <button
                          type="button"
                          className={`sc-box${m ? ' on' : ''}`}
                          aria-pressed={!!m}
                          aria-label={label}
                          disabled={!team.canMark}
                          title={m ? `${m.byName ? `${m.byName} · ` : ''}${fmtDateTime(m.at)}` : team.canMark ? (i.grade ? 'סימון - עם הציון' : 'סימון') : 'רק מפקד הצוות מסמן'}
                          onClick={() => onTap(c, i)}
                        >
                          {m && <Icon name="check" size={14} />}
                        </button>
                        {m && m.grade !== null && (
                          <span className="sc-grade">
                            {m.grade}
                            {m.sheet === 'written' && (
                              <span className="sc-sheet ok" title={`נכתב בגליון${m.sheetNote ? ` (${m.sheetNote})` : ''}`}>
                                <Icon name="checks" size={11} />
                              </span>
                            )}
                            {m.sheet === 'error' && (
                              <button type="button" className="sc-sheet err" title={`לא נכתב בגליון: ${m.sheetNote} - לחיצה לניסיון חוזר`} aria-label={`ניסיון חוזר לכתוב בגליון את הציון של ${c.name}`} onClick={() => onRetry(c.id, i.key)}>
                                !
                              </button>
                            )}
                          </span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <th scope="row" className="sc-name tiny muted">
                  בוצע
                </th>
                {STAFF_CHECK_ITEMS.map((i) => (
                  <td key={i.key} className="tiny muted mono">
                    {team.cadets.filter((c) => c.marks[i.key]).length}/{team.cadets.length}
                  </td>
                ))}
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </section>
  );
}

function GradeDialog({ cadetName, item, onClose, onSave }: { cadetName: string; item: StaffCheckItem; onClose: () => void; onSave: (grade: number) => Promise<void> }) {
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const n = Number(value);
  const valid = value.trim() !== '' && Number.isFinite(n) && n >= 0 && n <= 100;
  const submit = async () => {
    if (!valid) return;
    setBusy(true);
    setError(null);
    try {
      await onSave(n);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };
  return (
    <Modal
      narrow
      title={`${item.label} - ${cadetName}`}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose} disabled={busy}>
            ביטול
          </button>
          <button className="btn btn-primary" onClick={() => void submit()} disabled={busy || !valid}>
            {busy ? 'שומר ורושם בגליון...' : 'סימון ושמירת הציון'}
          </button>
        </>
      }
    >
      <form
        className="col gap-12"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <p className="small muted">כדי לסמן צריך לרשום את הציון. הוא נשמר בתיק ההערכה של הצוער, ונכתב בגליון הציונים בעמודה "{item.grade?.column}".</p>
        <Field label="הציון (0-100)" required>
          <input className="input mono" inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} data-autofocus aria-invalid={value !== '' && !valid} />
        </Field>
        <ErrorBox error={error} />
      </form>
    </Modal>
  );
}

/** the course's grade sheet: its link, and the Google account that writes into it */
function GradeSheetCard({ sheet, onChanged }: { sheet: GradeSheetStatus; onChanged: () => void }) {
  const toast = useToast();
  const [url, setUrl] = useState(sheet.url);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setUrl(sheet.url);
  }, [sheet.url]);
  const run = async (fn: () => Promise<unknown>, ok?: string) => {
    setBusy(true);
    try {
      await fn();
      if (ok) toast({ title: ok, tone: 'green' });
      onChanged();
    } catch (e) {
      toast({ title: (e as Error).message, tone: 'red' });
    }
    setBusy(false);
  };
  const connect = () =>
    run(async () => {
      const r = await api.post<{ url: string }>('/api/grade-sheet/connect');
      window.location.href = r.url;
    });
  const state = !sheet.url ? 'לא הוגדר גליון ציונים' : !sheet.connected ? 'הגליון עוד לא מחובר - הציונים נשמרים בתיקי ההערכה' : sheet.lastError ? sheet.lastError : `הציונים נכתבים בגליון${sheet.fileName ? ` "${sheet.fileName}"` : ''}`;
  if (!sheet.canManage)
    return (
      <div className={`card grade-sheet-card small${sheet.connected && !sheet.lastError ? '' : ' muted'}`} role="status">
        <Icon name="file" size={16} /> {state}
      </div>
    );
  return (
    <section className="card grade-sheet-card" aria-labelledby="grade-sheet-h">
      <div className="row wrap gap-6">
        <Icon name="file" size={18} />
        <b className="grow" id="grade-sheet-h">
          גליון הציונים ב-Google
        </b>
        {sheet.connected && <span className={`badge ${sheet.lastError ? 't-red' : 't-green'}`}>{sheet.lastError ? 'יש בעיה' : `מחובר${sheet.email ? ` · ${sheet.email}` : ''}`}</span>}
      </div>
      <p className="small muted">{state}</p>
      <div className="row wrap gap-6">
        <input className="input grow" dir="ltr" placeholder="קישור לגליון (Google Sheets או Excel ב-Drive)" value={url} onChange={(e) => setUrl(e.target.value)} aria-label="קישור לגליון הציונים" />
        <button className="btn" disabled={busy || url.trim() === sheet.url} onClick={() => void run(() => api.put('/api/grade-sheet', { url }), 'הקישור נשמר')}>
          שמירה
        </button>
      </div>
      {sheet.url && (
        <div className="row wrap gap-6">
          {!sheet.available ? (
            <span className="small muted">החיבור ל-Google עוד לא הוגדר בשרת.</span>
          ) : (
            <button className="btn btn-primary btn-sm" disabled={busy} onClick={() => void connect()}>
              <Icon name="link" size={15} /> {sheet.connected ? 'חיבור מחדש / חשבון אחר' : 'חיבור חשבון Google שיכול לערוך את הגליון'}
            </button>
          )}
          {sheet.connected && (
            <>
              <button className="btn btn-sm" disabled={busy} onClick={() => void run(async () => {
                const r = await api.post<{ written: number; failed: number }>('/api/staff-checks/sheet/retry');
                toast({ title: r.written || r.failed ? `נכתבו ${r.written} ציונים${r.failed ? `, ${r.failed} לא` : ''}` : 'כל הציונים כבר בגליון', tone: r.failed ? 'red' : 'green' });
              })}>
                כתיבת הציונים שעוד לא נכתבו
              </button>
              <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => void run(() => api.del('/api/grade-sheet'), 'החיבור נותק')}>
                ניתוק
              </button>
            </>
          )}
        </div>
      )}
      <p className="tiny muted">החשבון שמתחברים איתו צריך הרשאת עריכה לגליון. הציון נכתב בשורה של הצוער (לפי מספר אישי או שם), בעמודה "ציון ספרא סייפא".</p>
    </section>
  );
}
