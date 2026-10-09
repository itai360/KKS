// The commander's home: the weekly (שבועי) coming up - which week, what is still open on it (what was
// settled meanwhile is counted apart, in one line) - and a point or a topic for it in one press.

import { Link } from 'react-router';
import type { WeeklyKind, WeeklyTarget } from '@shared/weekly';
import { useApi } from '../lib/useApi';
import { Icon } from './Icon';
import { CountUp } from './ui';
import { addToWeekly } from './WeeklyAdd';

export function WeeklyCard() {
  const { data } = useApi<WeeklyTarget & { name: string | null; heldAt: string | null; counts: Record<WeeklyKind, number> & { open: number; settled: number } }>('/api/weekly/target', [
    'weekly',
    'weeks',
  ]);
  if (!data?.weekId) return null;
  const c = data.counts;
  const parts: [number, string][] = [
    [c.topic, 'נושאים'],
    [c.closure, 'סגירות'],
    [c.schedule, 'הערות ללו"ז'],
    [c.point, 'דגשים שלך'],
  ];
  return (
    <section className="card" aria-label="השבועי הקרוב">
      <div className="card-head">
        <Icon name="weekly" />
        <h3 className="grow">השבועי הקרוב</h3>
        <Link className="btn btn-ghost btn-sm" to={`/weekly/${data.weekId}`}>
          {data.name}
          <Icon name="chevronLeft" size={15} />
        </Link>
      </div>
      <div className="card-body col gap-8">
        <div className="weekly-card-counts small">
          {parts.map(([n, label]) => (
            <span key={label} className={n ? undefined : 'is-zero'}>
              <b className="mono">
                <CountUp value={n} />
              </b>{' '}
              {label}
            </span>
          ))}
        </div>
        {c.settled > 0 && (
          <span className="tiny muted weekly-card-settled">
            <Icon name="check" size={12} /> {c.settled === 1 ? 'אחד כבר טופל' : `${c.settled} כבר טופלו`}
          </span>
        )}
        <div className="row wrap gap-8">
          <button className="btn btn-sm" onClick={() => addToWeekly({ weekId: data.weekId!, kind: 'point' })}>
            <Icon name="flag" /> דגש לשבועי
          </button>
          <button className="btn btn-sm btn-ghost" onClick={() => addToWeekly({ weekId: data.weekId! })}>
            <Icon name="plus" /> נושא
          </button>
        </div>
      </div>
    </section>
  );
}
