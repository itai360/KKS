// The discipline card on the home screens, and the notes badge used across the
// cadet screens - kept apart from Discipline.tsx so the first download stays small.

import { lazy, Suspense, useState } from 'react';
import { Link } from 'react-router';
import { DISCIPLINE_NOTE_LIMIT } from '@shared/constants';
import type { DisciplineOverview } from '@shared/types';
import { useApi } from '../lib/useApi';
import { Icon } from './Icon';

export const noteTone = (n: number) => (n >= DISCIPLINE_NOTE_LIMIT - 1 ? 't-red' : 't-orange');

/** A badge with a cadet's discipline notes, when there are any. */
export function NotesBadge({ count }: { count: number }) {
  if (!count) return null;
  return (
    <span className={`badge ${noteTone(count)}`}>
      הערות משמעת {count}/{DISCIPLINE_NOTE_LIMIT}
    </span>
  );
}

// the dialog lives with the cadet screens and loads when first opened
const QuickDiscipline = lazy(() => import('../pages/CadetsPage').then((m) => ({ default: m.QuickDiscipline })));

/** The home screens: this week's discipline, who has notes, and recording without opening the cadet file. */
export function DisciplineCard() {
  const overview = useApi<DisciplineOverview>('/api/discipline/overview', ['cadets']);
  const [open, setOpen] = useState(false);
  const d = overview.data;
  if (!d?.managed) return null;
  return (
    <div className="card">
      <div className="card-head">
        <Icon name="shield" />
        <h3 className="grow">משמעת</h3>
        <button className="btn btn-sm" onClick={() => setOpen(true)}>
          <Icon name="plus" size={14} /> רישום
        </button>
      </div>
      <div className="card-body col gap-6">
        <div className="small">
          השבוע: <b>{d.week.events}</b> {d.week.events === 1 ? 'אירוע' : 'אירועים'} · <b>{d.week.notes}</b> {d.week.notes === 1 ? 'הערת משמעת' : 'הערות משמעת'}
        </div>
        {d.week.byCategory.length > 0 && (
          <div className="row wrap gap-4">
            {d.week.byCategory.map((c) => (
              <span key={c.category} className="badge">
                {c.category} {c.count}
              </span>
            ))}
          </div>
        )}
        {d.cadets.length === 0 ? (
          <p className="small muted" style={{ margin: 0 }}>
            אין צוערים עם הערות משמעת.
          </p>
        ) : (
          <div className="col gap-4">
            {d.cadets.slice(0, 6).map((c) => (
              <Link key={c.id} to={`/cadets/${c.id}`} className="row gap-6 small discipline-row">
                <span className="grow">
                  {c.fullName} <span className="tiny muted">{c.teamName}</span>
                </span>
                {c.committee && !c.committee.decision && <span className="badge t-purple">בוועדה</span>}
                <NotesBadge count={c.notes} />
              </Link>
            ))}
            {d.cadets.length > 6 && (
              <Link to="/cadets?notes=1" className="small">
                כל {d.cadets.length} הצוערים עם הערות
              </Link>
            )}
          </div>
        )}
      </div>
      {open && (
        <Suspense fallback={null}>
          <QuickDiscipline onClose={() => setOpen(false)} />
        </Suspense>
      )}
    </div>
  );
}
