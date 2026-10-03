// The week order (פקודת שבוע): one printable document of the week, built from what the
// system already knows - goals, the schedule day by day, who is responsible for what and
// by when, who on the staff is away, and what the previous cycle learned about this week.

import { Link, useParams } from 'react-router';
import { ABSENCE_REASON_LABELS, STATUS_LABELS, WEEK_STATUS_LABELS } from '@shared/constants';
import { addDays, shortDate, weekdayName } from '@shared/dates';
import { goalsFromText, LESSON_DECISION_LABELS } from '@shared/debriefForms';
import type { Absence, BankLesson, Task, WeekDetail } from '@shared/types';
import { Icon } from '../components/Icon';
import { Loading, PageError } from '../components/ui';
import { dateKeyOf, fmtTime, todayKey } from '../lib/format';
import { useSession } from '../lib/session';
import { usePageTitle } from '../lib/title';
import { useApi } from '../lib/useApi';

const range = (a: string, b: string) => (a === b ? shortDate(a) : `${shortDate(a)}-${shortDate(b)}`);

export function WeekOrderPage() {
  const { id } = useParams();
  const { settings } = useSession();
  const { data, error, status, loading } = useApi<WeekDetail>(`/api/weeks/${id}`, ['tasks', 'weeks', 'events']);
  const w = data?.week;
  const lessons = useApi<BankLesson[]>(w ? `/api/lessons?week=${w.id}` : null, ['debriefs']).data ?? [];
  const absences = useApi<Absence[]>(w ? `/api/absences?from=${w.startDate}&to=${w.endDate}` : null, ['users']).data ?? [];
  usePageTitle(w ? `פקודת שבוע - ${w.name}` : 'פקודת שבוע');

  if (loading && !data)
    return (
      <div className="page">
        <Loading rows={6} />
      </div>
    );
  if (!data || !w)
    return (
      <div className="page">
        <PageError error={error} status={status} what="השבוע" back="/weeks" backLabel="לשבועות הקורס" />
      </div>
    );

  const days: string[] = [];
  for (let d = w.startDate; d <= w.endDate && days.length < 14; d = addDays(d, 1)) days.push(d);
  const events = data.events.filter((e) => !e.cancelled);
  const goals = goalsFromText(w.goals);
  const tasks = data.tasks.filter((t) => t.status !== 'cancelled');
  const byOwner = new Map<string, Task[]>();
  for (const t of [...tasks].sort((a, b) => a.deadline.localeCompare(b.deadline))) byOwner.set(t.ownerName, [...(byOwner.get(t.ownerName) ?? []), t]);
  const weekly = data.debriefs.find((d) => d.kind === 'weekly');

  return (
    <div className="page doc-page">
      <div className="doc-toolbar no-print">
        <Link to={`/weeks/${w.id}`} className="btn btn-ghost">
          <Icon name="chevronRight" /> לשבוע
        </Link>
        <span className="grow small muted hide-mobile">המסמך נבנה מהנתונים במערכת ומתעדכן איתם. להדפסה או לשמירה כ-PDF:</span>
        <span className="grow only-mobile" />
        <button className="btn btn-primary" onClick={() => window.print()}>
          <Icon name="print" /> הדפסה / PDF
        </button>
      </div>

      <article className="doc" aria-label={`פקודת שבוע - ${w.name}`}>
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

        <section>
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

        <section>
          <h2>2. לו"ז השבוע</h2>
          {days.map((d) => {
            const today = events.filter((e) => e.date === d).sort((a, b) => a.startTime.localeCompare(b.startTime));
            // a day without activities: one line, not a table
            if (!today.length)
              return (
                <p key={d} className="doc-day-empty small">
                  <b>
                    יום {weekdayName(d)} <span className="mono">{shortDate(d)}</span>
                  </b>{' '}
                  <span className="muted">- אין פעילויות בלו"ז</span>
                </p>
              );
            return (
              <div key={d} className="doc-day">
                <h3>
                  יום {weekdayName(d)} <span className="mono">{shortDate(d)}</span>
                </h3>
                {(
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
                      {today.map((e) => (
                        <tr key={e.id}>
                          <td className="mono">
                            {e.startTime}
                            {e.endTime ? `-${e.endTime}` : ''}
                          </td>
                          <td>{e.title}</td>
                          <td>{e.location || '-'}</td>
                          <td>{e.ownerName ?? '-'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            );
          })}
        </section>

        <section>
          <h2>3. אחריות ומשימות</h2>
          {byOwner.size === 0 ? (
            <p className="muted">אין משימות לשבוע.</p>
          ) : (
            [...byOwner].map(([owner, list]) => (
              <div key={owner} className="doc-owner">
                <h3>
                  {owner} <span className="muted small">· {list.length} משימות</span>
                </h3>
                <table className="doc-table">
                  <tbody>
                    {list.map((t) => (
                      <tr key={t.id} className={t.status === 'done' ? 'done' : ''}>
                        <td className="doc-check" aria-hidden="true">
                          {t.status === 'done' ? '✓' : '☐'}
                        </td>
                        <td>{t.title}</td>
                        <td className="mono doc-when">
                          {weekdayName(dateKeyOf(t.deadline))} {shortDate(dateKeyOf(t.deadline))} {fmtTime(t.deadline)}
                        </td>
                        <td style={{ width: 90 }}>{t.overdue ? 'באיחור' : STATUS_LABELS[t.status]}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))
          )}
        </section>

        {absences.length > 0 && (
          <section>
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
          <section>
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
    </div>
  );
}
