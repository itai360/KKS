// Small debrief pieces other screens show: the kind of a debrief, and the lessons bank
// where it is needed - what an earlier cycle wrote for this week or this event.

import { Link } from 'react-router';
import { shortDate } from '@shared/dates';
import type { DebriefKind } from '@shared/debriefForms';
import type { BankLesson } from '@shared/types';
import { Icon } from './Icon';
import { useApi } from '../lib/useApi';

export function PriorLessons({ query, title, card = true, onOpen }: { query: string; title: string; card?: boolean; onOpen?: () => void }) {
  const { data } = useApi<BankLesson[]>(`/api/lessons?${query}`, ['debriefs']);
  // nothing kept for it yet: no empty box
  if (!data?.length) return null;
  const list = (
    <ul className="prior-lessons">
      {data.map((l) => (
        <li key={l.id}>
          <div className="small prewrap">{l.body}</div>
          <div className="tiny muted">
            <Link to={`/debriefs/${l.debriefId}`} onClick={onOpen}>
              {l.debriefTitle}
            </Link>
            {' · '}
            <span className="mono">{shortDate(l.occurredOn)}</span>
            {l.ownerName && ` · ${l.ownerName}`}
          </div>
        </li>
      ))}
    </ul>
  );
  if (!card)
    return (
      <div>
        <h3 className="mb-12 row gap-6">
          <Icon name="history" size={16} /> {title}
          <span className="mono tiny muted">{data.length}</span>
        </h3>
        {list}
      </div>
    );
  return (
    <div className="card prior-card">
      <div className="card-head">
        <Icon name="history" />
        <h3 className="grow">{title}</h3>
        <span className="mono tiny muted">{data.length}</span>
      </div>
      <div className="card-body">{list}</div>
    </div>
  );
}

export function KindBadge({ kind }: { kind: DebriefKind }) {
  if (kind === 'general') return null;
  return <span className={`badge ${kind === 'event' ? 't-purple' : 't-blue'}`}>{kind === 'event' ? 'מופע עצים' : 'שבועי'}</span>;
}
