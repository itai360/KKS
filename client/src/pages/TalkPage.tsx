// A personal talk as a printed page: the cadet's details, then the parts of the talk in order -
// the way a commander keeps it in a folder.

import { useParams } from 'react-router';
import { TALK_TYPES } from '@shared/constants';
import { shortDate } from '@shared/dates';
import { numberedSections, type TalkType } from '@shared/talks';
import type { CadetDetail } from '@shared/types';
import { Icon } from '../components/Icon';
import { Loading, PageError } from '../components/ui';
import { todayKey } from '../lib/format';
import { useSession } from '../lib/session';
import { usePageTitle } from '../lib/title';
import { useApi } from '../lib/useApi';

export function TalkPage() {
  const { id, recordId } = useParams();
  const { settings } = useSession();
  const { data, error, status, loading } = useApi<CadetDetail>(`/api/cadets/${id}`, ['cadets']);
  const record = data?.records.find((r) => r.id === Number(recordId) && r.kind === 'talk');
  usePageTitle(record && data ? `${record.category} - ${data.cadet.fullName}` : 'שיחה אישית');

  if (loading && !data)
    return (
      <div className="page">
        <Loading rows={6} />
      </div>
    );
  if (!data || !record)
    return (
      <div className="page">
        <PageError error={error} status={status ?? 404} what="השיחה" feminine back={`/cadets/${id}`} backLabel="לתיק הצוער" />
      </div>
    );

  const c = data.cadet;
  const type = ((TALK_TYPES as readonly string[]).includes(record.category) ? record.category : 'שיחה יזומה') as TalkType;
  const answers = record.talk ?? {};
  const sections = numberedSections(type).filter(({ section }) => section.fields.some((f) => answers[f.id]));

  return (
    <div className="page doc-page">
      <div className="doc-toolbar no-print">
        <span className="grow small muted">שיחה אישית - גלויה רק למפקדי הצוער. להדפסה או לשמירה כ-PDF:</span>
        <button className="btn btn-primary" onClick={() => window.print()}>
          <Icon name="print" /> הדפסה / PDF
        </button>
      </div>
      <article className="doc talk-doc" aria-label={`${record.category} - ${c.fullName}`}>
        <header className="doc-head">
          <div className="doc-kicker">{settings.courseName} · אישי - למפקדי הצוער בלבד</div>
          <h1>{record.category}</h1>
          <div className="doc-title">{c.fullName}</div>
          <table className="doc-meta">
            <tbody>
              <tr>
                <th>שם הצוער</th>
                <td>{c.fullName}</td>
                <th>צוות</th>
                <td>{c.teamName ?? '-'}</td>
              </tr>
              <tr>
                <th>תאריך</th>
                <td className="mono">{shortDate(record.occurredOn)}</td>
                <th>מנהל השיחה</th>
                <td>{record.authorName}</td>
              </tr>
            </tbody>
          </table>
        </header>
        {record.talk ? (
          sections.map(({ section, number }) => (
            <section key={section.id}>
              <h2>
                {number ? `${number}. ` : ''}
                {section.title}
              </h2>
              {section.fields.length === 1 ? (
                <p className="talk-answer">{answers[section.fields[0].id]}</p>
              ) : (
                <ul className="doc-list">
                  {section.fields
                    .filter((f) => answers[f.id])
                    .map((f) => (
                      <li key={f.id}>
                        <b>{f.label}:</b> <span className="talk-answer">{answers[f.id]}</span>
                      </li>
                    ))}
                </ul>
              )}
            </section>
          ))
        ) : (
          <section>
            <p className="talk-answer">{record.body}</p>
            {record.followUp && (
              <p>
                <b>סוכם:</b> {record.followUp}
              </p>
            )}
          </section>
        )}
        <footer className="doc-foot">
          <div className="tiny muted">
            הופק ב-{shortDate(todayKey())} ממערכת ניהול הקורס{record.taskTitle ? ` · משימת המשך: ${record.taskTitle}` : ''}
          </div>
        </footer>
      </article>
    </div>
  );
}
