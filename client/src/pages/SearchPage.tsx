// Section 19 - search by task, staff member, week, domain or keyword.

import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { shortDate } from '@shared/dates';
import type { SearchResults } from '@shared/types';
import { Icon } from '../components/Icon';
import { GroupTitle, TaskList } from '../components/TaskRow';
import { Empty, Loading, PageHead } from '../components/ui';
import { useSession } from '../lib/session';
import { matchesSearch } from '@shared/search';
import { useApi } from '../lib/useApi';

export function SearchPage() {
  const [params, setParams] = useSearchParams();
  const q = params.get('q') ?? '';
  const [text, setText] = useState(q);
  const { settings, isCommander } = useSession();
  useEffect(() => {
    setText(q);
  }, [q]);
  useEffect(() => {
    const t = setTimeout(() => {
      if (text !== q) setParams(text ? { q: text } : {}, { replace: true });
    }, 250);
    return () => clearTimeout(t);
  }, [text, q, setParams]);
  const { data, loading } = useApi<SearchResults>(q.trim().length >= 2 ? `/api/search?q=${encodeURIComponent(q)}` : null, ['tasks', 'weeks', 'events']);
  const domainHits = q ? settings.domains.filter((d) => matchesSearch(q, d)) : [];
  const total = data ? data.tasks.length + data.users.length + data.weeks.length + data.events.length + data.cadets.length + data.debriefs.length + data.documents.length : 0;

  return (
    <div className="page narrow">
      <PageHead title="חיפוש" />
      <div className="nl-box mb-12">
        <input className="input" value={text} onChange={(e) => setText(e.target.value)} placeholder="משימה, איש סגל, צוער, שבוע, תחקיר, מסמך או מילת מפתח" autoFocus aria-label="חיפוש" />
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
            {data.cadets.length > 0 && (
              <>
                <GroupTitle title="צוערים" count={data.cadets.length} />
                <div className="chips">
                  {data.cadets.map((c) => (
                    <Link key={c.id} to={`/cadets/${c.id}`} className="chip">
                      <Icon name="shield" size={14} /> {c.fullName}
                      {c.teamName && <span className="muted"> · {c.teamName}</span>}
                    </Link>
                  ))}
                </div>
              </>
            )}
            {data.debriefs.length > 0 && (
              <>
                <GroupTitle title="תחקירים" count={data.debriefs.length} />
                <div className="chips">
                  {data.debriefs.map((d) => (
                    <Link key={d.id} to={`/debriefs/${d.id}`} className="chip">
                      <Icon name="lightbulb" size={14} /> {d.title} · {shortDate(d.occurredOn)}
                    </Link>
                  ))}
                </div>
              </>
            )}
            {data.documents.length > 0 && (
              <>
                <GroupTitle title="מסמכים" count={data.documents.length} />
                <div className="chips">
                  {data.documents.map((d) => (
                    <a key={d.id} href={d.url} target="_blank" rel="noreferrer noopener" className="chip">
                      <Icon name={d.kind === 'file' ? 'file' : 'link'} size={14} /> {d.title}
                      <span className="muted"> · {d.category}</span>
                    </a>
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
