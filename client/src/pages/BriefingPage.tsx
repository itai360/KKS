// Section 50 - morning briefing: one screen to go over the day with the staff.

import { useRef } from 'react';
import { useNavigate } from 'react-router';
import { shortDate } from '@shared/dates';
import type { BriefingData } from '@shared/types';
import { Icon } from '../components/Icon';
import { TaskList } from '../components/TaskRow';
import { ErrorBox, Loading, openable } from '../components/ui';
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
            <div>
              <b>{data.events.length}</b>
              <span>אירועים</span>
            </div>
            <div>
              <b>{data.dueToday.length}</b>
              <span>דד-ליינים היום</span>
            </div>
            <div>
              <b style={{ color: data.overdue.length ? 'var(--red-ink)' : undefined }}>{data.overdue.length}</b>
              <span>באיחור</span>
            </div>
            <div>
              <b style={{ color: data.blocked.length ? 'var(--purple)' : undefined }}>{data.blocked.length}</b>
              <span>חסמים</span>
            </div>
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
            <Section title="משימות קריטיות" count={data.critical.length} tone="var(--red-ink)">
              <TaskList tasks={data.critical} empty={<p className="muted small">אין משימות קריטיות להיום ולמחר.</p>} />
            </Section>
            <Section title="דד-ליינים היום" count={data.dueToday.length}>
              <TaskList tasks={data.dueToday} empty={<p className="muted small">אין דד-ליינים נוספים היום.</p>} />
            </Section>
            <Section title="באיחור" count={data.overdue.length} tone="var(--red-ink)">
              <TaskList tasks={data.overdue} empty={<p className="muted small">אין משימות באיחור.</p>} />
            </Section>
            <Section title="חסמים" count={data.blocked.length} tone="var(--purple)">
              <TaskList tasks={data.blocked} empty={<p className="muted small">אין חסמים פתוחים.</p>} />
            </Section>
          </div>
          <div className="col gap-16">
            <div className="card">
              <div className="card-head">
                <h3>אירועים מרכזיים</h3>
              </div>
              {data.events.length === 0 && <div className="card-body muted small">אין אירועים בלו"ז היום.</div>}
              {data.events.map((e) => (
                <div key={e.id} className={`event-row${e.startTime <= now && (e.endTime ?? '') > now ? ' now' : ''}`} {...openable(() => navigate(`/schedule?date=${e.date}&event=${e.id}`))}>
                  <div className="event-time">{e.startTime}</div>
                  <div>
                    <div className="event-title">{e.title}</div>
                    <div className="small muted">{[e.location, e.ownerName].filter(Boolean).join(' · ')}</div>
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
                  <h3 className="grow">החרגות פעילות</h3>
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

function Section({ title, count, tone, children }: { title: string; count: number; tone?: string; children: React.ReactNode }) {
  return (
    <div>
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
