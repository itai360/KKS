// The sociometric (סוציומטרי) - each round's results: where every cadet stands in the team and in the
// company, the average and the criteria, and what stands out first (server/src/sociometric.ts).

import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import type { SocioRoundView, SocioRow } from '@shared/sociometric';
import { searchKey } from '@shared/search';
import { shortDate } from '@shared/dates';
import { ask } from '../components/Confirm';
import { Icon } from '../components/Icon';
import { SocioImport } from '../components/SocioImport';
import { useToast } from '../components/Toasts';
import { CountUp, Empty, Loading, openable, PageError, PageHead, Seg, Select } from '../components/ui';
import { api } from '../lib/api';
import { emitLocalChange } from '../lib/realtime';
import { useSession } from '../lib/session';
import { useApi } from '../lib/useApi';

type View = 'summary' | 'criteria';
type Sort = 'outliers' | 'team' | 'company';

export function SociometricPage() {
  const { isCommander } = useSession();
  const [params, setParams] = useSearchParams();
  const roundParam = params.get('round');
  const { data, error, loading, status } = useApi<SocioRoundView>(`/api/sociometric${roundParam ? `?round=${roundParam}` : ''}`, ['cadets']);
  const navigate = useNavigate();
  const toast = useToast();
  const [view, setView] = useState<View>('summary');
  const [sort, setSort] = useState<Sort>('outliers');
  const [team, setTeam] = useState('');
  const [onlyOut, setOnlyOut] = useState(false);
  const [q, setQ] = useState('');
  const importing = params.get('import') === '1';
  const set = (k: string, v: string) => {
    const next = new URLSearchParams(params);
    if (v) next.set(k, v);
    else next.delete(k);
    setParams(next, { replace: true });
  };

  const rows = useMemo(() => {
    let list = data?.rows ?? [];
    if (team) list = list.filter((r) => String(r.teamId ?? '') === team);
    if (onlyOut) list = list.filter((r) => r.outlier);
    if (q.trim()) list = list.filter((r) => searchKey(r.cadetName).includes(searchKey(q)));
    const sev = (r: SocioRow) => (r.flags.some((f) => f.tone === 'red') ? 0 : r.flags.some((f) => f.tone === 'orange') ? 1 : 2);
    const byTeam = (a: SocioRow, b: SocioRow) => (a.teamName ?? '').localeCompare(b.teamName ?? '', 'he') || (a.rankInTeam ?? 99) - (b.rankInTeam ?? 99);
    const byCompany = (a: SocioRow, b: SocioRow) => (a.companyRank ?? 999) - (b.companyRank ?? 999) || byTeam(a, b);
    return [...list].sort(sort === 'team' ? byTeam : sort === 'company' ? byCompany : (a, b) => sev(a) - sev(b) || byCompany(a, b));
  }, [data, team, onlyOut, q, sort]);

  if (loading && !data)
    return (
      <div className="page">
        <Loading rows={4} />
      </div>
    );
  if (!data)
    return (
      <div className="page">
        <PageError error={error} status={status} what="הסוציומטרי" back="/cadets" backLabel="לצוערים" />
      </div>
    );

  const round = data.round;
  const all = data.rows;
  const outliers = all.filter((r) => r.outlier).length;
  const teams = [...new Map(all.filter((r) => r.teamId !== null).map((r) => [r.teamId!, r.teamName ?? ''])).entries()].sort((a, b) => a[1].localeCompare(b[1], 'he'));
  const criteria = round?.criteria ?? [];
  const scale = data.scale;

  const removeRound = async () => {
    if (!round) return;
    if (!(await ask({ title: `למחוק את "${round.name}"?`, body: `התוצאות של ${round.cadets} צוערים בסבב יימחקו.`, confirm: 'מחיקה', danger: true }))) return;
    try {
      await api.del(`/api/sociometric/rounds/${round.id}`);
      emitLocalChange('cadets');
      set('round', '');
      toast({ title: `"${round.name}" נמחק`, tone: 'green' });
    } catch (e) {
      toast({ title: (e as Error).message, tone: 'red' });
    }
  };

  return (
    <div className="page">
      <PageHead
        title="סוציומטרי"
        sub={
          data.scope === 'team'
            ? 'הצוערים של הצוות שלך בכל סבב: מיקום בצוות ובפלוגה, ממוצע ותבחינים - והחריגים קודם.'
            : 'תוצאות הסוציומטרי לפי סבבים: מיקום בצוות ובפלוגה, ממוצע ותבחינים - והחריגים קודם.'
        }
        actions={
          isCommander && (
            <>
              {round && (
                <button className="btn btn-ghost" onClick={() => void removeRound()}>
                  <Icon name="trash" /> מחיקת הסבב
                </button>
              )}
              <button className="btn btn-primary" onClick={() => set('import', '1')}>
                <Icon name="upload" /> ייבוא סוציומטרי
              </button>
            </>
          )
        }
      />
      {data.scope === 'none' ? (
        <Empty icon="socio" title="אין צוות שבאחריותך" text="הסוציומטרי פתוח למפקד הקורס ולכל מפקד צוות - לצוערים של הצוות שלו." />
      ) : !round ? (
        <Empty
          icon="socio"
          title="עדיין אין סוציומטרי"
          text={isCommander ? 'מעלים את גליון הסוציומטרי של כל צוות (אקסל או קישור ל-Google Sheets), והתוצאות נכנסות לכל צוער - עם המיקום בצוות ובפלוגה והחריגים.' : 'מפקד הקורס עדיין לא ייבא סוציומטרי.'}
        />
      ) : (
        <>
          {data.rounds.length > 1 && (
            <div className="mb-12">
              <Seg
                value={String(round.id)}
                onChange={(v) => set('round', v)}
                options={data.rounds.map((r) => ({ value: String(r.id), label: r.name }))}
              />
            </div>
          )}
          <div className="grid-3 fade-in socio-summary">
            <div className="card card-pad">
              <div className="label-caps">{round.name}</div>
              <div className="strong" style={{ fontSize: 22 }}>
                <CountUp value={all.length} /> צוערים
              </div>
              <div className="tiny muted">
                {round.teams === 1 ? 'צוות אחד' : `${round.teams} צוותים`}
                {round.heldOn && ` · ${shortDate(round.heldOn)}`}
              </div>
            </div>
            <button type="button" className={`card card-pad socio-outliers${onlyOut ? ' on' : ''}`} onClick={() => setOnlyOut(!onlyOut)} aria-pressed={onlyOut}>
              <div className="label-caps">חריגים</div>
              <div className={`strong${outliers ? ' text-red' : ''}`} style={{ fontSize: 22 }}>
                <CountUp value={outliers} />
              </div>
              <div className="tiny muted">{onlyOut ? 'מוצגים רק החריגים - לחיצה להצגת כולם' : 'לחיצה להצגת החריגים בלבד'}</div>
            </button>
            <div className="card card-pad">
              <div className="label-caps">ממוצע הפלוגה</div>
              <div className="strong mono" style={{ fontSize: 22 }}>
                {data.means[''] ?? '-'}
              </div>
              <div className="tiny muted">בסולם 1-{scale}</div>
            </div>
          </div>

          <div className="row wrap gap-6 mt-16 socio-filters">
            <Seg
              value={view}
              onChange={setView}
              options={[
                { value: 'summary', label: 'מיקומים' },
                { value: 'criteria', label: 'תבחינים' },
              ]}
            />
            <Seg
              value={sort}
              onChange={setSort}
              options={[
                { value: 'outliers', label: 'חריגים קודם' },
                { value: 'company', label: 'לפי הפלוגה' },
                { value: 'team', label: 'לפי צוות' },
              ]}
            />
            {teams.length > 1 && (
              <Select value={team} onChange={(e) => setTeam(e.target.value)} aria-label="צוות" style={{ maxWidth: 200 }}>
                <option value="">כל הצוותים</option>
                {teams.map(([id, name]) => (
                  <option key={id} value={id}>
                    {name}
                  </option>
                ))}
              </Select>
            )}
            <input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="חיפוש צוער" aria-label="חיפוש צוער" style={{ maxWidth: 200 }} />
          </div>

          {rows.length === 0 ? (
            <Empty icon="socio" title="אין צוערים להצגה" text={onlyOut ? 'אין חריגים בסינון הזה.' : 'נסו סינון אחר.'} />
          ) : view === 'summary' ? (
            <div className="card table-wrap mt-12">
              <table className="table socio-table">
                <thead>
                  <tr>
                    <th scope="col">צוער</th>
                    <th scope="col">מיקום בצוות</th>
                    <th scope="col">מיקום בפלוגה</th>
                    <th scope="col">ממוצע</th>
                    <th scope="col">מה בולט</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.cadetId} className={`click socio-${r.flags.some((f) => f.tone === 'red') ? 'red' : r.flags.some((f) => f.tone === 'orange') ? 'orange' : 'ok'}`} {...openable(() => navigate(`/cadets/${r.cadetId}#socio`), { role: false })}>
                      <th scope="row">
                        <div className="strong">{r.cadetName}</div>
                        <div className="tiny muted">{r.teamName ?? 'ללא צוות'}</div>
                      </th>
                      <td className="nowrap">
                        <Standing rank={r.rankInTeam} count={r.teamCount} value={r.teamStanding} />
                      </td>
                      <td className="nowrap">
                        <Standing rank={r.companyRank} count={r.companyCount} value={r.companyStanding} />
                      </td>
                      <td className="mono">{r.avg ?? '-'}</td>
                      <td>
                        <Flags row={r} max={3} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <CriteriaTable rows={rows} criteria={criteria} means={data.means} onOpen={(id) => navigate(`/cadets/${id}#socio`)} />
          )}
          <p className="tiny muted mt-12">
            מיקום בפלוגה לפי הממוצע (או ממוצע התבחינים כשאין ממוצע בגליון). בולט לרעה: תחתית הצוות, עשירון תחתון בפלוגה, תבחין רחוק מתחת לממוצע של הצוער או של הפלוגה, וירידה של 3 מקומות ומעלה מהסבב הקודם.
          </p>
        </>
      )}
      {importing && isCommander && <SocioImport rounds={data.rounds} onClose={() => set('import', '')} onDone={(id) => set('round', String(id))} />}
    </div>
  );
}

/** "3 מתוך 12" with a little bar of where that is (full: the top) */
export function Standing({ rank, count, value }: { rank: number | null; count: number | null; value: number | null }) {
  if (!rank || !count) return <span className="faint">-</span>;
  const tone = value === null ? '' : value <= 15 ? ' t-red' : value >= 85 ? ' t-green' : '';
  return (
    <span className="socio-standing">
      <span className="mono">
        {rank}
        <span className="muted"> / {count}</span>
      </span>
      {value !== null && (
        <span className={`socio-meter${tone}`} aria-hidden="true">
          <span style={{ width: `${Math.max(4, value)}%` }} />
        </span>
      )}
    </span>
  );
}

export function Flags({ row, max }: { row: SocioRow; max?: number }) {
  const shown = max ? row.flags.slice(0, max) : row.flags;
  if (!row.flags.length) return <span className="tiny muted">-</span>;
  return (
    <span className="row wrap gap-4">
      {shown.map((f) => (
        <span key={f.text} className={`badge t-${f.tone}`}>
          {f.text}
        </span>
      ))}
      {max && row.flags.length > max && <span className="tiny muted">+{row.flags.length - max}</span>}
    </span>
  );
}

/** the criteria at a glance: far below the company in red, far above in green, below the cadet's own average outlined */
function CriteriaTable({ rows, criteria, means, onOpen }: { rows: SocioRow[]; criteria: string[]; means: Record<string, number>; onOpen: (id: number) => void }) {
  if (!criteria.length) return <Empty icon="socio" title="אין תבחינים בסבב הזה" text="הגליונות של הסבב כוללים רק דירוג או ממוצע." />;
  const cls = (r: SocioRow, c: string) => {
    const v = r.scores[c];
    if (!Number.isFinite(v)) return '';
    const z = r.z[c];
    let out = z === undefined ? '' : z <= -1.5 ? ' z-low2' : z <= -1 ? ' z-low1' : z >= 1.5 ? ' z-high2' : z >= 1 ? ' z-high1' : '';
    if (r.avg !== null && r.avg - v >= 1) out += ' z-weak';
    return out;
  };
  return (
    <div className="card table-wrap mt-12">
      <table className="table socio-criteria">
        <thead>
          <tr>
            <th scope="col">צוער</th>
            <th scope="col">ממוצע</th>
            {criteria.map((c) => (
              <th key={c} scope="col" title={c}>
                {c.trim()}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.cadetId} className="click" {...openable(() => onOpen(r.cadetId), { role: false })}>
              <th scope="row">
                <div className="strong">{r.cadetName}</div>
                <div className="tiny muted">{r.teamName ?? ''}</div>
              </th>
              <td className="mono strong">{r.avg ?? '-'}</td>
              {criteria.map((c) => (
                <td key={c} className={`mono socio-cell${cls(r, c)}`} title={Number.isFinite(r.scores[c]) && r.z[c] !== undefined ? `${c.trim()}: ${r.scores[c]} (בפלוגה ${means[c]})` : undefined}>
                  {Number.isFinite(r.scores[c]) ? r.scores[c] : <span className="faint">-</span>}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <th scope="row" className="small muted">
              ממוצע הפלוגה
            </th>
            <td className="mono small">{means[''] ?? '-'}</td>
            {criteria.map((c) => (
              <td key={c} className="mono small muted">
                {means[c] ?? '-'}
              </td>
            ))}
          </tr>
        </tfoot>
      </table>
      <div className="row wrap gap-12 tiny muted socio-legend">
        <span>
          <span className="socio-cell z-low2 legend-swatch" /> נמוך מאוד מהפלוגה
        </span>
        <span>
          <span className="socio-cell z-low1 legend-swatch" /> נמוך מהפלוגה
        </span>
        <span>
          <span className="socio-cell z-high1 legend-swatch" /> גבוה מהפלוגה
        </span>
        <span>
          <span className="socio-cell z-weak legend-swatch" /> נקודה ומעלה מתחת לממוצע של הצוער
        </span>
      </div>
    </div>
  );
}
