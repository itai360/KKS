// The week order (פקודת שבוע): one printable document of the week, built from what the
// system already knows - goals, the schedule day by day, who is responsible for what and
// by when, who on the staff is away, and what the previous cycle learned about this week.
// On screen it is also a way in: turned week by week, today and the activity on now marked,
// each line opening what it stands for.

import { useRef } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { ABSENCE_REASON_LABELS, STATUS_LABELS, WEEK_STATUS_LABELS } from '@shared/constants';
import { addDays, shortDate, weekdayName } from '@shared/dates';
import { goalsFromText, LESSON_DECISION_LABELS } from '@shared/debriefForms';
import type { Absence, BankLesson, Task, WeekDetail } from '@shared/types';
import { DocPager, ShareButton, useDocNav, type DocLink } from '../components/DocNav';
import { Icon } from '../components/Icon';
import { SectionRail, type RailItem } from '../components/SectionRail';
import { Loading, PageError } from '../components/ui';
import { endMinutes } from '../lib/agenda';
import { dateKeyOf, fmtTime, todayKey } from '../lib/format';
import { useFresh } from '../lib/fresh';
import { useSession } from '../lib/session';
import { usePageTitle } from '../lib/title';
import { useApi, useTick } from '../lib/useApi';

const range = (a: string, b: string) => (a === b ? shortDate(a) : `${shortDate(a)}-${shortDate(b)}`);
const minutesOf = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
/** text being selected in the document (to copy it) is not a click on its line */
const selecting = () => !!window.getSelection()?.toString().trim();

export function WeekOrderPage() {
  const { id } = useParams();
  const { weeks } = useSession();
  const { data, error, status, loading } = useApi<WeekDetail>(`/api/weeks/${id}`, ['tasks', 'weeks', 'events']);
  const w = data?.week;
  const page = useRef<HTMLDivElement>(null);
  usePageTitle(w ? `פקודת שבוע - ${w.name}` : 'פקודת שבוע');

  // the week before and the week after: by name, the arrows, a swipe on a phone
  const at = weeks.findIndex((x) => x.id === Number(id));
  const link = (i: number): DocLink | null => {
    const x = weeks[i];
    return x ? { to: `/weeks/${x.id}/order`, label: `שבוע ${x.number} · ${x.name}`, api: `/api/weeks/${x.id}` } : null;
  };
  const prev = at > 0 ? link(at - 1) : null;
  const next = at >= 0 ? link(at + 1) : null;
  useDocNav({ prev, next, swipe: page });

  if (loading && !data)
    return (
      <div className="page" ref={page}>
        <Loading rows={6} />
      </div>
    );
  if (!data || !w)
    return (
      <div className="page" ref={page}>
        <PageError error={error} status={status} what="השבוע" back="/weeks" backLabel="לשבועות הקורס" />
      </div>
    );

  return (
    <div className="page doc-page" ref={page}>
      <div className="doc-toolbar no-print">
        <DocPager prev={prev} next={next} noun="פקודות השבוע" position={at >= 0 ? `${at + 1} מתוך ${weeks.length}` : undefined} />
        <span className="grow" />
        <Link className="btn btn-ghost" to={`/weeks/${w.id}`}>
          <Icon name="layers" /> <span className="hide-mobile">לדף השבוע</span>
          <span className="only-mobile">השבוע</span>
        </Link>
        <ShareButton title={`פקודת שבוע ${w.number} - ${w.name}`} />
        <button className="btn btn-primary" onClick={() => window.print()}>
          <Icon name="print" /> הדפסה / PDF
        </button>
      </div>
      {/* a new week, a new document: what "arrived while open" counts from starts over */}
      <WeekOrder key={w.id} data={data} />
    </div>
  );
}

function WeekOrder({ data }: { data: WeekDetail }) {
  const { settings } = useSession();
  const navigate = useNavigate();
  const w = data.week;
  const lessons = useApi<BankLesson[]>(`/api/lessons?week=${w.id}`, ['debriefs']).data ?? [];
  const absences = useApi<Absence[]>(`/api/absences?from=${w.startDate}&to=${w.endDate}`, ['users']).data ?? [];
  useTick(60_000);

  const days: string[] = [];
  for (let d = w.startDate; d <= w.endDate && days.length < 14; d = addDays(d, 1)) days.push(d);
  const events = data.events.filter((e) => !e.cancelled);
  const goals = goalsFromText(w.goals);
  const tasks = data.tasks.filter((t) => t.status !== 'cancelled');
  const byOwner = new Map<string, Task[]>();
  for (const t of [...tasks].sort((a, b) => a.deadline.localeCompare(b.deadline))) byOwner.set(t.ownerName, [...(byOwner.get(t.ownerName) ?? []), t]);
  const weekly = data.debriefs.find((d) => d.kind === 'weekly');
  // what was added while the document is open (here, or by someone else) comes in
  const freshEvent = useFresh(events.map((e) => e.id));
  const freshTask = useFresh(tasks.map((t) => t.id));
  const today = todayKey();
  const now = minutesOf(fmtTime(new Date().toISOString()));
  const inWeek = today >= w.startDate && today <= w.endDate;
  const doneAll = tasks.filter((t) => t.status === 'done').length;

  const parts: RailItem[] = [
    { id: 'wo-goals', n: 1, label: 'נושא ומטרות' },
    { id: 'wo-schedule', n: 2, label: 'לו"ז' },
    { id: 'wo-tasks', n: 3, label: 'משימות', count: `${doneAll}/${tasks.length}`, state: tasks.length && doneAll === tasks.length ? 'ok' : null },
    ...(absences.length ? [{ id: 'wo-away', n: 4, label: 'היעדרויות' }] : []),
    ...(lessons.length ? [{ id: 'wo-lessons', n: absences.length ? 5 : 4, label: 'לקחים' }] : []),
  ];

  return (
    <>
      <SectionRail label="חלקי פקודת השבוע" items={parts} />
      <article className="doc week-order" aria-label={`פקודת שבוע - ${w.name}`}>
        <header className="doc-head">
          <div className="doc-kicker">{settings.courseName}</div>
          <h1>פקודת שבוע {w.number}</h1>
          <div className="doc-title">{w.name}</div>
          <table className="doc-meta">
            <tbody>
              <tr>
                <th>תאריכים</th>
                <td className="mono">{range(w.startDate, w.endDate)}</td>
                <th>מפק"צ השבוע</th>
                <td>{w.leadName ?? '-'}</td>
              </tr>
              <tr>
                <th>מצב</th>
                <td>
                  {WEEK_STATUS_LABELS[w.status]}
                  {w.approvedAt && ` · אושר ע"י ${w.approvedByName}`}
                </td>
                <th>מוכנות</th>
                <td>
                  {w.readiness}% ({w.doneTasks}/{w.totalTasks} משימות)
                </td>
              </tr>
            </tbody>
          </table>
        </header>

        <section id="wo-goals">
          <h2>1. נושא ומטרות</h2>
          {w.topic && <p className="strong">{w.topic}</p>}
          {goals.length ? (
            <ol className="doc-list">
              {goals.map((g, i) => (
                <li key={i}>{g.goal}</li>
              ))}
            </ol>
          ) : (
            <p className="muted">לא הוגדרו מטרות לשבוע.</p>
          )}
        </section>

        <section id="wo-schedule">
          <h2>2. לו"ז השבוע</h2>
          {days.map((d) => {
            const list = events.filter((e) => e.date === d).sort((a, b) => a.startTime.localeCompare(b.startTime));
            const isToday = d === today;
            const dayHead = (
              <>
                יום {weekdayName(d)} <span className="mono">{shortDate(d)}</span>
                {isToday && <span className="badge t-orange no-print doc-today">היום</span>}
              </>
            );
            // a day without activities: one line, not a table
            if (!list.length)
              return (
                <p key={d} className={`doc-day-empty small${isToday ? ' is-today' : ''}`}>
                  <b>{dayHead}</b> <span className="muted">- אין פעילויות בלו"ז</span>
                </p>
              );
            return (
              <div key={d} className={`doc-day${isToday ? ' is-today' : ''}`}>
                <h3>{dayHead}</h3>
                <table className="doc-table">
                  <thead>
                    <tr>
                      <th style={{ width: 96 }}>שעה</th>
                      <th>פעילות</th>
                      <th style={{ width: '22%' }}>מקום</th>
                      <th style={{ width: '20%' }}>אחראי</th>
                    </tr>
                  </thead>
                  <tbody>
                    {list.map((e) => {
                      const live = isToday && minutesOf(e.startTime) <= now && endMinutes(e) > now;
                      const past = (inWeek && d < today) || (isToday && !live && endMinutes(e) <= now);
                      const open = `/schedule?date=${e.date}&event=${e.id}`;
                      return (
                        // the whole line opens the activity in the schedule; its name is the link for the keyboard
                        <tr key={e.id} className={`doc-row${live ? ' is-now' : ''}${past ? ' is-past' : ''}${freshEvent(e.id) ? ' is-arrived' : ''}`} onClick={() => !selecting() && navigate(open)}>
                          <td className="mono">
                            {e.startTime}
                            {e.endTime ? `-${e.endTime}` : ''}
                          </td>
                          <td>
                            <Link to={open} className="doc-link-inline" onClick={(ev) => ev.stopPropagation()}>
                              {e.title}
                            </Link>
                            {live && <span className="badge t-orange no-print doc-now">עכשיו</span>}
                          </td>
                          <td>{e.location || '-'}</td>
                          <td>{e.ownerName ?? '-'}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            );
          })}
        </section>

        <section id="wo-tasks">
          <h2>3. אחריות ומשימות</h2>
          {byOwner.size === 0 ? (
            <p className="muted">אין משימות לשבוע.</p>
          ) : (
            [...byOwner].map(([owner, list]) => {
              const done = list.filter((t) => t.status === 'done').length;
              return (
                <div key={owner} className="doc-owner">
                  <h3>
                    {owner} <span className="muted small">· {list.length} משימות</span>
                    <span className="no-print doc-owner-done" aria-label={`${done} מתוך ${list.length} הושלמו`}>
                      <span className="mini-bar" aria-hidden="true">
                        <i style={{ width: `${(done / list.length) * 100}%` }} />
                      </span>
                      <span className="tiny muted mono">
                        {done}/{list.length}
                      </span>
                    </span>
                  </h3>
                  <table className="doc-table">
                    <tbody>
                      {list.map((t) => (
                        <tr key={t.id} className={`doc-row${t.status === 'done' ? ' done' : ''}${t.overdue ? ' is-late' : ''}${freshTask(t.id) ? ' is-arrived' : ''}`} onClick={() => !selecting() && navigate(`/tasks/${t.id}`)}>
                          <td className="doc-check" aria-hidden="true">
                            {t.status === 'done' ? '✓' : '☐'}
                          </td>
                          <td>
                            <Link to={`/tasks/${t.id}`} className="doc-link-inline" onClick={(ev) => ev.stopPropagation()}>
                              {t.title}
                            </Link>
                          </td>
                          <td className="mono doc-when">
                            {weekdayName(dateKeyOf(t.deadline))} {shortDate(dateKeyOf(t.deadline))} {fmtTime(t.deadline)}
                          </td>
                          <td style={{ width: 90 }}>{t.overdue ? 'באיחור' : STATUS_LABELS[t.status]}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              );
            })
          )}
        </section>

        {absences.length > 0 && (
          <section id="wo-away">
            <h2>4. היעדרויות סגל בשבוע</h2>
            <ul className="doc-list">
              {absences.map((a) => (
                <li key={a.id}>
                  <b>{a.userName}</b> - {ABSENCE_REASON_LABELS[a.reason]} <span className="mono">{range(a.startDate, a.endDate)}</span>
                  {a.note && ` (${a.note})`}
                </li>
              ))}
            </ul>
          </section>
        )}

        {lessons.length > 0 && (
          <section id="wo-lessons">
            <h2>{absences.length > 0 ? 5 : 4}. לקחים מהמחזור הקודם</h2>
            <ul className="doc-list">
              {lessons.map((l) => (
                <li key={l.id}>
                  {l.body}
                  <span className="muted small"> · {l.review ? (l.review.decision === 'task' && l.review.taskTitle ? `משימה: ${l.review.taskTitle}` : LESSON_DECISION_LABELS[l.review.decision]) : 'ממתין להחלטה'}</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        <footer className="doc-foot">
          <div className="doc-sign">
            <div>
              <span>מפק"צ השבוע</span>
              <span className="line">{w.leadName ?? ''}</span>
            </div>
            <div>
              <span>אישור מפקד הקורס</span>
              <span className="line">{w.approvedByName ?? ''}</span>
            </div>
          </div>
          <div className="tiny muted">
            הופק ב-{shortDate(todayKey())} ממערכת ניהול הקורס{weekly ? ` · תחקיר שבועי: ${weekly.status === 'final' ? 'סוכם' : 'בטיוטה'}` : ''}
          </div>
        </footer>
      </article>
    </>
  );
}
