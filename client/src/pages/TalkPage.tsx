// A personal talk as a printed page: the cadet's details, then the parts of the talk in order -
// the way a commander keeps it in a folder. On screen the cadet's talks turn like pages (by name,
// the arrows, a swipe on a phone), with the way back to the file and the follow-up task at hand.

import { useRef } from 'react';
import { Link, useParams } from 'react-router';
import { TALK_TYPES } from '@shared/constants';
import { shortDate } from '@shared/dates';
import { numberedSections, type TalkType } from '@shared/talks';
import type { CadetDetail } from '@shared/types';
import { DocPager, ShareButton, useDocNav, type DocLink } from '../components/DocNav';
import { Icon } from '../components/Icon';
import { SectionRail } from '../components/SectionRail';
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

  // the cadet's talks, oldest first: the one before and the one after this one
  const page = useRef<HTMLDivElement>(null);
  const talks = (data?.records ?? []).filter((r) => r.kind === 'talk').sort((a, b) => a.occurredOn.localeCompare(b.occurredOn) || a.id - b.id);
  const at = talks.findIndex((r) => r.id === Number(recordId));
  const link = (i: number): DocLink | null => {
    const r = talks[i];
    return r ? { to: `/cadets/${id}/talks/${r.id}`, label: `${r.category} · ${shortDate(r.occurredOn)}` } : null;
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
  if (!data || !record)
    return (
      <div className="page" ref={page}>
        <PageError error={error} status={status ?? 404} what="השיחה" feminine back={`/cadets/${id}`} backLabel="לתיק הצוער" />
      </div>
    );

  const c = data.cadet;
  const type = ((TALK_TYPES as readonly string[]).includes(record.category) ? record.category : 'שיחה יזומה') as TalkType;
  const answers = record.talk ?? {};
  const sections = numberedSections(type).filter(({ section }) => section.fields.some((f) => answers[f.id]));

  return (
    <div className="page doc-page" ref={page}>
      <div className="doc-toolbar no-print">
        <DocPager prev={prev} next={next} noun="השיחות של הצוער" position={talks.length > 1 ? `שיחה ${at + 1} מתוך ${talks.length}` : undefined} />
        <span className="grow" />
        <Link className="btn btn-ghost" to={`/cadets/${c.id}`}>
          <Icon name="shield" /> תיק הצוער
        </Link>
        {record.taskId && (
          <Link className="btn btn-ghost" to={`/tasks/${record.taskId}`} title={record.taskTitle ?? undefined}>
            <Icon name="tasks" /> <span className="hide-mobile">משימת ההמשך</span>
            <span className="only-mobile">משימה</span>
          </Link>
        )}
        <ShareButton title={`${record.category} - ${c.fullName}`} />
        <button className="btn btn-primary" onClick={() => window.print()}>
          <Icon name="print" /> הדפסה / PDF
        </button>
      </div>
      <p className="tiny muted no-print doc-note">שיחה אישית - גלויה רק למפקדי הצוער.</p>
      {sections.length > 2 && <SectionRail label="חלקי השיחה" items={sections.map(({ section }, i) => ({ id: `talk-${section.id}`, n: i + 1, label: section.title }))} />}
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
            <section key={section.id} id={`talk-${section.id}`}>
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
