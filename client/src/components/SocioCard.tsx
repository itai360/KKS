// A cadet's sociometric on the cadet's page: the latest round - place in the team and the company, the
// average against the company, what stands out, each criterion against the team and the company - and
// the rounds before it in a line (server/src/sociometric.ts). For the commander and the team commander.

import { useEffect, useRef } from 'react';
import { Link, useLocation } from 'react-router';
import type { SocioCadetRound } from '@shared/sociometric';
import { useApi } from '../lib/useApi';
import { Flags, Standing } from '../pages/SociometricPage';
import { Icon } from './Icon';

export function SocioCard({ cadetId }: { cadetId: number }) {
  const { data } = useApi<SocioCadetRound[]>(`/api/cadets/${cadetId}/sociometric`, ['cadets']);
  const ref = useRef<HTMLElement>(null);
  const location = useLocation();
  // opened from the sociometric page: straight to this card
  useEffect(() => {
    if (data?.length && location.hash === '#socio') ref.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [data, location.hash]);
  if (!data?.length) return null;
  const [latest, ...older] = data;
  const r = latest.row;
  const scale = latest.scale;
  const criteria = latest.round.criteria.filter((c) => Number.isFinite(r.scores[c]));
  return (
    <section className={`card socio-card${r.outlier ? ' is-outlier' : ''}`} id="socio" ref={ref} aria-labelledby="socio-h">
      <div className="card-head">
        <Icon name="socio" />
        <h3 className="grow" id="socio-h">
          סוציומטרי
        </h3>
        <Link to={`/sociometric?round=${latest.round.id}`} className="btn btn-ghost btn-sm">
          {latest.round.name}
          <Icon name="chevronLeft" size={15} />
        </Link>
      </div>
      <div className="card-body col gap-12">
        <div className="socio-card-stats">
          <div>
            <div className="label-caps">בצוות</div>
            <Standing rank={r.rankInTeam} count={r.teamCount} value={r.teamStanding} />
          </div>
          <div>
            <div className="label-caps">בפלוגה</div>
            <Standing rank={r.companyRank} count={r.companyCount} value={r.companyStanding} />
          </div>
          <div>
            <div className="label-caps">ממוצע</div>
            <span className="mono strong">{r.avg ?? '-'}</span>
            {latest.means[''] !== undefined && <span className="tiny muted"> / פלוגה {latest.means['']}</span>}
          </div>
        </div>
        {r.flags.length > 0 && <Flags row={r} />}
        {criteria.length > 0 && (
          <ul className="socio-bars" aria-label="התבחינים">
            {criteria.map((c) => {
              const v = r.scores[c];
              const z = r.z[c];
              const tone = z !== undefined && z <= -1.5 ? 't-red' : (r.avg !== null && r.avg - v >= 1) || (z !== undefined && z <= -1) ? 't-orange' : z !== undefined && z >= 1 ? 't-green' : '';
              const company = latest.means[c];
              const team = latest.teamMeans[c];
              return (
                <li key={c}>
                  <span className="small">{c.trim()}</span>
                  <span className={`socio-bar ${tone}`} aria-hidden="true">
                    <span className="fill" style={{ width: `${(v / scale) * 100}%` }} />
                    {company !== undefined && <span className="mark" style={{ insetInlineStart: `${(company / scale) * 100}%` }} title={`ממוצע הפלוגה ${company}`} />}
                  </span>
                  <span className="mono small" title={`צוות ${team ?? '-'} · פלוגה ${company ?? '-'}`}>
                    {v}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
        {criteria.length > 0 && <div className="tiny muted">הקו הדק בכל פס: ממוצע הפלוגה בתבחין.</div>}
        {older.length > 0 && (
          <div className="socio-history">
            <div className="label-caps">סבבים קודמים</div>
            {older.map((o) => (
              <Link key={o.round.id} to={`/sociometric?round=${o.round.id}`} className="row small socio-history-row">
                <span className="grow">{o.round.name}</span>
                <span className="mono">
                  צוות {o.row.rankInTeam ?? '-'}/{o.row.teamCount ?? '-'} · ממוצע {o.row.avg ?? '-'}
                </span>
              </Link>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
