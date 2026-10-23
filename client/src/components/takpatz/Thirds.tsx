// The mapping into thirds after the ODT: each cadet's third and their rank in the team, in order of the
// rank or of the thirds. A rank another cadet already holds is given only after asking. The third here
// is the same one the takpatz shows beside the name.

import { useMemo, useState } from 'react';
import { formatAgo } from '@shared/dates';
import { THIRD_LABELS, THIRDS, type TakpatzCadet, type TakpatzTeamView, type Third } from '@shared/takpatz';
import { ask } from '../Confirm';
import { Empty, Seg } from '../ui';
import { api, ApiError } from '../../lib/api';

type Mutate = (fn: () => Promise<unknown>) => Promise<boolean>;
type Order = 'rank' | 'third' | 'name';

function RankInput({ c, onSave }: { c: TakpatzCadet; onSave: (rank: number | null) => Promise<void> }) {
  const [v, setV] = useState(c.rank === null ? '' : String(c.rank));
  const [was, setWas] = useState(c.rank);
  if (was !== c.rank) {
    setWas(c.rank);
    setV(c.rank === null ? '' : String(c.rank));
  }
  const commit = () => {
    const n = v.trim() === '' ? null : Number(v);
    if (n !== null && (!Number.isInteger(n) || n < 1)) return setV(c.rank === null ? '' : String(c.rank));
    if (n !== c.rank) void onSave(n);
  };
  return (
    <input
      className="input tk-rank"
      inputMode="numeric"
      value={v}
      onChange={(e) => setV(e.target.value.replace(/[^\d]/g, '').slice(0, 3))}
      onBlur={commit}
      onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
      aria-label={`הדירוג של ${c.name}`}
      placeholder="-"
    />
  );
}

export function Thirds({ view, mutate }: { view: TakpatzTeamView; mutate: Mutate }) {
  const [order, setOrder] = useState<Order>('rank');
  const n = view.cadets.length;
  const rows = useMemo(() => {
    const thirdIndex = (t: Third | null) => (t ? THIRDS.indexOf(t) : 9);
    const byName = (a: TakpatzCadet, b: TakpatzCadet) => a.name.localeCompare(b.name, 'he');
    const byRank = (a: TakpatzCadet, b: TakpatzCadet) => (a.rank ?? 1e9) - (b.rank ?? 1e9) || byName(a, b);
    return [...view.cadets].sort(order === 'name' ? byName : order === 'third' ? (a, b) => thirdIndex(a.third) - thirdIndex(b.third) || byRank(a, b) : byRank);
  }, [view.cadets, order]);
  const ranks = new Map<number, number>();
  for (const c of view.cadets) if (c.rank) ranks.set(c.rank, (ranks.get(c.rank) ?? 0) + 1);
  const latest = view.cadets.filter((c) => c.thirdUpdatedAt).sort((a, b) => b.thirdUpdatedAt!.localeCompare(a.thirdUpdatedAt!))[0];

  const save = (c: TakpatzCadet, patch: Record<string, unknown>) => mutate(() => api.patch(`/api/takpatz/cadets/${c.id}`, patch));
  const saveRank = async (c: TakpatzCadet, rank: number | null) => {
    try {
      await api.patch(`/api/takpatz/cadets/${c.id}`, { rank });
      await mutate(async () => undefined);
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        if (await ask({ title: 'הדירוג כבר ניתן', body: `${e.message}. לתת את אותו דירוג גם ל${c.name}?`, confirm: 'לתת בכל זאת' })) await save(c, { rank, allowDuplicateRank: true });
        else await mutate(async () => undefined);
      } else await mutate(() => Promise.reject(e));
    }
  };

  if (!n) return <Empty icon="users" title="אין צוערים בצוות" />;
  const count = (t: Third) => view.cadets.filter((c) => c.third === t).length;
  return (
    <div className="tk-thirds">
      <div className="tk-toolbar-row">
        <Seg
          value={order}
          onChange={setOrder}
          options={[
            { value: 'rank', label: 'לפי דירוג' },
            { value: 'third', label: 'לפי שליש' },
            { value: 'name', label: 'לפי שם' },
          ]}
        />
        <span className="tk-third-counts">
          {THIRDS.map((t) => (
            <span key={t} className={`tk-third t-${t}`}>
              {THIRD_LABELS[t]} {count(t)}
            </span>
          ))}
          <span className="muted small">
            {view.metrics.mapped}/{n} ממופים
          </span>
        </span>
        {latest && (
          <span className="muted tiny">
            עודכן {formatAgo(latest.thirdUpdatedAt!)}
            {latest.thirdUpdatedByName && ` על ידי ${latest.thirdUpdatedByName}`}
          </span>
        )}
      </div>
      <div className="table-wrap">
        <table className="table tk-thirds-table">
          <thead>
            <tr>
              <th scope="col">שם</th>
              <th scope="col">שליש</th>
              <th scope="col">מספור (1-{n})</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => (
              <tr key={c.id}>
                <td className="strong">{c.name}</td>
                <td>
                  <div className="tk-third-pick" role="radiogroup" aria-label={`השליש של ${c.name}`}>
                    {THIRDS.map((t) => (
                      <button key={t} type="button" role="radio" aria-checked={c.third === t} className={`tk-third-btn t-${t}${c.third === t ? ' on' : ''}`} onClick={() => void save(c, { third: c.third === t ? null : t })}>
                        {THIRD_LABELS[t]}
                      </button>
                    ))}
                  </div>
                </td>
                <td>
                  <RankInput c={c} onSave={(r) => saveRank(c, r)} />
                  {c.rank && (ranks.get(c.rank) ?? 0) > 1 && <span className="tk-dup">דירוג כפול</span>}
                  {c.rank && c.rank > n && <span className="tk-dup">מעל מספר הצוערים</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
