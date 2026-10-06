// The commander's home: the weekly (שבועי) coming up - which week, what is already on it - and a
// point or a topic for it in one press.

import { Link } from 'react-router';
import type { WeeklyKind, WeeklyTarget } from '@shared/weekly';
import { useApi } from '../lib/useApi';
import { Icon } from './Icon';
import { addToWeekly } from './WeeklyAdd';

export function WeeklyCard() {
  const { data } = useApi<WeeklyTarget & { name: string | null; heldAt: string | null; counts: Record<WeeklyKind, number> & { open: number } }>('/api/weekly/target', ['weekly', 'weeks']);
  if (!data?.weekId) return null;
  const c = data.counts;
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
          <span>
            <b className="mono">{c.topic}</b> נושאים
          </span>
          <span>
            <b className="mono">{c.closure}</b> סגירות
          </span>
          <span>
            <b className="mono">{c.schedule}</b> הערות ללו"ז
          </span>
          <span>
            <b className="mono">{c.point}</b> דגשים שלך
          </span>
        </div>
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
