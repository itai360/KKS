// Section 50 - morning briefing: one screen to go over the day with the staff.

import { useRef } from 'react';
import { useNavigate } from 'react-router';
import { shortDate } from '@shared/dates';
import type { BriefingData } from '@shared/types';
import { Icon } from '../components/Icon';
import { TaskList } from '../components/TaskRow';
import { CountUp, ErrorBox, Loading, openable } from '../components/ui';
import { inMinutes, leftMinutes, nowAndNext } from '../lib/agenda';
import { fmtLongDate, fmtTime } from '../lib/format';
import { useSession } from '../lib/session';
import { usePageTitle } from '../lib/title';
import { useApi, useTick } from '../lib/useApi';

export function BriefingPage() {
  const { data, error, loading } = useApi<BriefingData>('/api/briefing', ['tasks', 'events', 'cadets']);
  const { settings } = useSession();
  const ref = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  useTick(30_000);
  usePageTitle('תדריך בוקר');
  const now = fmtTime(new Date().toISOString());
  const live = nowAndNext(data?.events ?? [], data?.date ?? '', now);

  const fullscreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void ref.current?.requestFullscreen?.();
  };

  return (
    <div className="briefing" ref={ref}>
      <div className="brief-head">
        <div>
          <div className="label-caps">
            {settings.courseName} · תדריך בוקר
          </div>
          <div className="brief-title">{data ? fmtLongDate(data.date) : 'תדריך בוקר'}</div>
        </div>
        {data && (
          <div className="brief-nums">
            <BriefNum n={data.events.length} label="אירועים" to="brief-events" />
            <BriefNum n={data.dueToday.length} label="דד-ליינים היום" to="brief-today" />
            <BriefNum n={data.overdue.length} label="באיחור" to="brief-overdue" color="var(--red-ink)" />
            <BriefNum n={data.blocked.length} label="חסמים" to="brief-blocked" color="var(--purple)" />
          </div>
        )}
        <div className="row gap-6">
          <button className="btn btn-sm" onClick={fullscreen}>
            <Icon name="external" /> מסך מלא
          </button>
          <button className="btn btn-sm btn-ghost" onClick={() => navigate('/')}>
            <Icon name="x" /> סגירה
          </button>
        </div>
      </div>
      <ErrorBox error={error} />
      {loading && !data ? (
        <Loading rows={4} />
      ) : data ? (
        <div className="split">
          <div className="col gap-16">
            <Section id="brief-critical" title="משימות קריטיות" count={data.critical.length} tone="var(--red-ink)">
              <TaskList tasks={data.critical} empty={<p className="muted small">אין משימות קריטיות להיום ולמחר.</p>} />
            </Section>
            <Section id="brief-today" title="דד-ליינים היום" count={data.dueToday.length}>
              <TaskList tasks={data.dueToday} empty={<p className="muted small">אין דד-ליינים נוספים היום.</p>} />
            </Section>
            <Section id="brief-overdue" title="באיחור" count={data.overdue.length} tone="var(--red-ink)">
              <TaskList tasks={data.overdue} empty={<p className="muted small">אין משימות באיחור.</p>} />
            </Section>
            <Section id="brief-blocked" title="חסמים" count={data.blocked.length} tone="var(--purple)">
              <TaskList tasks={data.blocked} empty={<p className="muted small">אין חסמים פתוחים.</p>} />
            </Section>
          </div>
          <div className="col gap-16">
            <div className="card brief-section" id="brief-events">
              <div className="card-head">
                <h3>אירועים מרכזיים</h3>
              </div>
              {data.events.length === 0 && <div className="card-body muted small">אין אירועים בלו"ז היום.</div>}
              {data.events.map((e) => (
                <div key={e.id} className={`event-row${live.now?.id === e.id ? ' now' : ''}`} {...openable(() => navigate(`/schedule?date=${e.date}&event=${e.id}`))}>
                  <div className="event-time">{e.startTime}</div>
                  <div>
                    <div className="event-title">
                      {e.title}
                      {live.now?.id === e.id && <span className="badge t-orange brief-when">עכשיו · {leftMinutes(live.left)}</span>}
                      {live.next?.id === e.id && <span className="badge t-blue brief-when">{inMinutes(live.until)}</span>}
                    </div>
                    <div className="small muted">{[e.location, e.ownerName].filter(Boolean).join(' · ')}</div>
                    {live.now?.id === e.id && (
                      <span className="un-bar dashboard-event-bar" aria-hidden="true">
                        <i style={{ inlineSize: `${Math.round(live.progress * 100)}%` }} />
                      </span>
                    )}
                  </div>
                  {e.taskTotal > 0 && (
                    <span className="small mono">
                      {e.taskDone}/{e.taskTotal}
                    </span>
                  )}
                </div>
              ))}
            </div>
            {data.exemptions.length > 0 && (
              <div className="card">
                <div className="card-head">
                  <h3 className="grow">פטורים פעילים</h3>
                  <span className="tiny mono muted">{data.exemptions.length}</span>
                </div>
                {data.exemptions.map((x) => (
                  <div key={x.id} className="health" style={{ cursor: 'pointer' }} {...openable(() => navigate(`/cadets/${x.cadetId}`))}>
                    <div className="grow">
                      <div className="strong">
                        {x.cadetName} <span className="small muted">{x.teamName}</span>
                      </div>
                      <div className="small">
                        {x.subject}
                        {x.details && ` - ${x.details}`}
                      </div>
                    </div>
                    <span className="small muted">{x.until ? `עד ${shortDate(x.until)}` : 'עד להודעה חדשה'}</span>
                  </div>
                ))}
              </div>
            )}
            <div className="card">
              <div className="card-head">
                <h3>אחראים</h3>
              </div>
              {data.byOwner.length === 0 && <div className="card-body muted small">אין פריטים פתוחים לאף איש סגל.</div>}
              {data.byOwner.map((o) => (
                <div key={o.userId} className="health">
                  <span className="strong grow">{o.name}</span>
                  {o.dueToday > 0 && <span className="small">{o.dueToday} היום</span>}
                  {o.overdue > 0 && <span className="small" style={{ color: 'var(--red-ink)' }}>{o.overdue} באיחור</span>}
                  {o.blocked > 0 && <span className="small" style={{ color: 'var(--purple)' }}>{o.blocked} חסמים</span>}
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** a number at the top: a tap brings its part into view */
function BriefNum({ n, label, to, color }: { n: number; label: string; to: string; color?: string }) {
  return (
    <button type="button" className="brief-num" disabled={!n} onClick={() => document.getElementById(to)?.scrollIntoView({ behavior: 'smooth', block: 'start' })} aria-label={`${label}: ${n}`}>
      <b style={{ color: n && color ? color : undefined }}>
        <CountUp value={n} />
      </b>
      <span>{label}</span>
    </button>
  );
}

function Section({ id, title, count, tone, children }: { id: string; title: string; count: number; tone?: string; children: React.ReactNode }) {
  return (
    <div id={id} className="brief-section">
      <div className="section-title" style={{ marginTop: 6 }}>
        <h2 style={{ color: count && tone ? tone : undefined }}>{title}</h2>
        <span className="count-pill">
          {count}
        </span>
      </div>
      {children}
    </div>
  );
}
