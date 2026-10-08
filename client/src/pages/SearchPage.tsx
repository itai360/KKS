// Section 19 - search by task, staff member, week, domain or keyword.

import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { shortDate } from '@shared/dates';
import type { SearchResults } from '@shared/types';
import { Highlight } from '../components/Highlight';
import { Icon } from '../components/Icon';
import { GroupTitle, TaskList } from '../components/TaskRow';
import { Empty, Loading, PageHead } from '../components/ui';
import { useSession } from '../lib/session';
import { matchesSearch } from '@shared/search';
import { useApi } from '../lib/useApi';
import { safeUrl } from '../lib/safeUrl';

const RECENT_MAX = 8;
const recentKey = (userId: number) => `kks.search.recent.${userId}`;

function readRecent(userId: number): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(recentKey(userId)) ?? '[]');
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').slice(0, RECENT_MAX) : [];
  } catch {
    return [];
  }
}

function writeRecent(userId: number, list: string[]): void {
  try {
    localStorage.setItem(recentKey(userId), JSON.stringify(list.slice(0, RECENT_MAX)));
  } catch {
    /* this visit only */
  }
}

export function SearchPage() {
  const [params, setParams] = useSearchParams();
  const q = params.get('q') ?? '';
  const [text, setText] = useState(q);
  const { settings, isCommander, user } = useSession();
  // what this person looked for lately, on this device: one tap brings it back
  const [recent, setRecent] = useState(() => readRecent(user.id));
  const results = useRef<HTMLDivElement>(null);
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
  // a search that found something, once the typing has settled, is remembered
  useEffect(() => {
    const t = q.trim();
    if (t.length < 2 || !total) return;
    const timer = setTimeout(() => {
      setRecent((r) => {
        const next = [t, ...r.filter((x) => x !== t)].slice(0, RECENT_MAX);
        writeRecent(user.id, next);
        return next;
      });
    }, 1200);
    return () => clearTimeout(timer);
  }, [q, total, user.id]);
  const forget = () => {
    writeRecent(user.id, []);
    setRecent([]);
  };
  const groups = data
    ? ([
        ['תחומים', domainHits.length],
        ['אנשי סגל', data.users.length],
        ['שבועות', data.weeks.length],
        ['אירועים', data.events.length],
        ['צוערים', data.cadets.length],
        ['תחקירים', data.debriefs.length],
        ['מסמכים', data.documents.length],
        ['משימות', data.tasks.length],
      ] as const).filter(([, n]) => n > 0)
    : [];
  const jump = (i: number) => results.current?.querySelectorAll<HTMLElement>('.group-title')[i]?.scrollIntoView({ behavior: 'smooth', block: 'start' });

  return (
    <div className="page narrow">
      <PageHead title="חיפוש" />
      <form
        className="nl-box mb-12"
        role="search"
        onSubmit={(e) => {
          // Enter opens the first result
          e.preventDefault();
          results.current?.querySelector<HTMLAnchorElement>('a[href]')?.click();
        }}
      >
        <input className="input" type="search" value={text} onChange={(e) => setText(e.target.value)} placeholder="משימה, איש סגל, צוער, שבוע, תחקיר, מסמך או מילת מפתח" autoFocus aria-label="חיפוש" enterKeyHint="go" />
        <span className="btn btn-sm btn-ghost" style={{ pointerEvents: 'none' }}>
          <Icon name="search" />
        </span>
      </form>
      {q.trim().length < 2 ? (
        recent.length ? (
          <section className="card card-pad search-recent" aria-label="חיפושים אחרונים">
            <div className="row mb-12">
              <span className="label-caps grow">חיפושים אחרונים</span>
              <button type="button" className="btn btn-ghost btn-sm" onClick={forget}>
                ניקוי
              </button>
            </div>
            <div className="chips">
              {recent.map((r) => (
                <button key={r} type="button" className="chip" onClick={() => setText(r)}>
                  <Icon name="history" size={14} /> {r}
                </button>
              ))}
            </div>
          </section>
        ) : (
          <Empty icon="search" title="מה מחפשים?" text="לדוגמה: מטווח · מפק״צ 2 · שבוע הגנה · לוגיסטיקה" />
        )
      ) : loading && !data ? (
        <Loading rows={3} />
      ) : !total && !domainHits.length ? (
        <Empty icon="search" title="לא נמצאו תוצאות" />
      ) : (
        data && (
          <div className="fade-in search-results" ref={results}>
            <div className="row wrap gap-6 search-summary" role="status">
              <span className="small strong">{total + domainHits.length === 1 ? 'תוצאה אחת' : `${total + domainHits.length} תוצאות`}</span>
              {groups.length > 1 &&
                groups.map(([label, n], i) => (
                  <button key={label} type="button" className="chip chip-sm" onClick={() => jump(i)}>
                    {label} <span className="muted">{n}</span>
                  </button>
                ))}
              <span className="grow" />
              <span className="tiny muted hide-mobile">Enter - פתיחת הראשונה</span>
            </div>
            {domainHits.length > 0 && (
              <>
                <GroupTitle title="תחומים" count={domainHits.length} />
                <div className="chips">
                  {domainHits.map((d) => (
                    <Link key={d} to={`/tasks?domain=${encodeURIComponent(d)}`} className="chip">
                      <Highlight text={d} q={q} />
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
                      <Icon name="my" size={14} /> <Highlight text={u.displayName} q={q} />
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
                      <Icon name="layers" size={14} /> <Highlight text={w.name} q={q} /> · {w.readiness}%
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
                      <Icon name="calendar" size={14} /> <Highlight text={e.title} q={q} /> · {shortDate(e.date)} {e.startTime}
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
                      <Icon name="shield" size={14} /> <Highlight text={c.fullName} q={q} />
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
                      <Icon name="lightbulb" size={14} /> <Highlight text={d.title} q={q} /> · {shortDate(d.occurredOn)}
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
                    <a key={d.id} href={safeUrl(d.url)} target="_blank" rel="noreferrer noopener" className="chip">
                      <Icon name={d.kind === 'file' ? 'file' : 'link'} size={14} /> <Highlight text={d.title} q={q} />
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
