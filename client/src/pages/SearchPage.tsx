// Section 19 - search by task, staff member, week, domain or keyword.

import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { shortDate } from '@shared/dates';
import type { SearchResults } from '@shared/types';
import { Icon } from '../components/Icon';
import { GroupTitle, TaskList } from '../components/TaskRow';
import { Empty, Loading, PageHead } from '../components/ui';
import { useSession } from '../lib/session';
import { useApi } from '../lib/useApi';

export function SearchPage() {
  const [params, setParams] = useSearchParams();
  const q = params.get('q') ?? '';
  const [text, setText] = useState(q);
  const { settings, isCommander } = useSession();
  useEffect(() => setText(q), [q]);
  useEffect(() => {
    const t = setTimeout(() => {
      if (text !== q) setParams(text ? { q: text } : {}, { replace: true });
    }, 250);
    return () => clearTimeout(t);
  }, [text, q, setParams]);
  const { data, loading } = useApi<SearchResults>(q.trim().length >= 2 ? `/api/search?q=${encodeURIComponent(q)}` : null, ['tasks', 'weeks', 'events']);
  const domainHits = q ? settings.domains.filter((d) => d.includes(q)) : [];
  const total = data ? data.tasks.length + data.users.length + data.weeks.length + data.events.length : 0;

  return (
    <div className="page narrow">
      <PageHead title="חיפוש" />
      <div className="nl-box mb-12">
        <input className="input" value={text} onChange={(e) => setText(e.target.value)} placeholder="משימה, איש סגל, שבוע, תחום או מילת מפתח" autoFocus aria-label="חיפוש" />
        <span className="btn btn-sm btn-ghost" style={{ pointerEvents: 'none' }}>
          <Icon name="search" />
        </span>
      </div>
      {q.trim().length < 2 ? (
        <Empty icon="search" title="מה מחפשים?" text="לדוגמה: מטווח · מפק״צ 2 · שבוע הגנה · לוגיסטיקה" />
      ) : loading && !data ? (
        <Loading rows={3} />
      ) : !total && !domainHits.length ? (
        <Empty icon="search" title="לא נמצאו תוצאות" />
      ) : (
        data && (
          <div className="fade-in">
            {domainHits.length > 0 && (
              <>
                <GroupTitle title="תחומים" count={domainHits.length} />
                <div className="chips">
                  {domainHits.map((d) => (
                    <Link key={d} to={`/tasks?domain=${encodeURIComponent(d)}`} className="chip">
                      {d}
                    </Link>
                  ))}
                </div>
              </>
            )}
            {data.users.length > 0 && (
              <>
                <GroupTitle title="אנשי סגל" count={data.users.length} />
                <div className="chips">
                  {data.users.map((u) => (
                    <Link key={u.id} to={isCommander ? `/team/${u.id}` : `/tasks?owner=${u.id}`} className="chip">
                      <Icon name="my" size={14} /> {u.displayName}
                      {u.title && <span className="muted"> · {u.title}</span>}
                    </Link>
                  ))}
                </div>
              </>
            )}
            {data.weeks.length > 0 && (
              <>
                <GroupTitle title="שבועות" count={data.weeks.length} />
                <div className="chips">
                  {data.weeks.map((w) => (
                    <Link key={w.id} to={`/weeks/${w.id}`} className="chip">
                      <Icon name="layers" size={14} /> {w.name} · {w.readiness}%
                    </Link>
                  ))}
                </div>
              </>
            )}
            {data.events.length > 0 && (
              <>
                <GroupTitle title='אירועים בלו"ז' count={data.events.length} />
                <div className="chips">
                  {data.events.map((e) => (
                    <Link key={e.id} to={`/schedule?date=${e.date}&event=${e.id}`} className="chip">
                      <Icon name="calendar" size={14} /> {e.title} · {shortDate(e.date)} {e.startTime}
                    </Link>
                  ))}
                </div>
              </>
            )}
            {data.tasks.length > 0 && (
              <>
                <GroupTitle title="משימות" count={data.tasks.length} />
                <TaskList tasks={data.tasks} />
              </>
            )}
          </div>
        )
      )}
    </div>
  );
}
