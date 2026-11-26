import { Link } from 'react-router';
import { shortDate } from '@shared/dates';
import type { PlanDocument } from '@shared/types';
import type { WeeklyView } from '@shared/weekly';
import { useSession } from '../lib/session';
import { useApi } from '../lib/useApi';
import { WeekActivityFiles } from './ActivityFiles';
import { Icon } from './Icon';
import { PLAN_STATUS } from './PlanParts';
import { ErrorBox, Loading } from './ui';

/** The week's working documents stay together, with their current state and exact week links. */
export function WeekPlanningSections({ weekId, inCourse = true }: { weekId: number; inCourse?: boolean }) {
  const { can } = useSession();
  return (
    <section className="mt-24" aria-label="ניהול ותכנון השבוע">
      <div className="section-title mb-12"><h2>ניהול ותכנון השבוע</h2></div>
      <div className="grid-3 week-planning-sections">
        {inCourse && can('plans') ? <WeekPlanSummary weekId={weekId} /> : <section className="card card-pad"><h3>אישור תוכניות</h3><p className="small muted">{inCourse ? 'אישור התוכניות זמין לבעלי הרשאה.' : 'השבוע מחוץ לתקופת הקורס ולכן אינו נכלל באישור התוכניות.'}</p></section>}
        <WeekActivityFiles weekId={weekId} />
        <WeekMeetingSummary weekId={weekId} />
      </div>
    </section>
  );
}

function WeekPlanSummary({ weekId }: { weekId: number }) {
  const { data, error, loading } = useApi<PlanDocument>(`/api/plans/${weekId}`, ['plans', 'weeks', 'events', 'tasks', 'users', 'cadets', 'debriefs', 'settings']);
  const state = data ? PLAN_STATUS[data.status] : null;
  return (
    <section className="card" aria-label="אישור תוכניות לשבוע">
      <div className="card-head">
        <Icon name="check" />
        <h3 className="grow">אישור תוכניות</h3>
        {state && <span className={`badge ${state.tone}`}>{state.label}</span>}
      </div>
      <div className="card-body col gap-12">
        {loading && !data && <Loading rows={2} />}
        <ErrorBox error={error} />
        {data && (
          <>
            <p className="small week-document-summary">{data.bluf.text}</p>
            {data.approval && <div className="tiny muted">אושר ע״י {data.approval.by} · {shortDate(data.approval.on)}</div>}
            {data.changes.length > 0 && <div className="small text-orange">התוכנית השתנתה מאז האישור</div>}
          </>
        )}
        <Link to={`/plans/${weekId}`} className="btn btn-sm">
          <Icon name="file" size={14} /> פתיחת אישור התוכניות
        </Link>
      </div>
    </section>
  );
}

function WeekMeetingSummary({ weekId }: { weekId: number }) {
  const { data, error, loading } = useApi<WeeklyView>(`/api/weekly/${weekId}`, ['weekly', 'weeks', 'tasks', 'events', 'settings', 'users']);
  // The commander's personal points stay in the weekly itself, out of the shared preview.
  const items = data?.items.filter((item) => item.kind !== 'point') ?? [];
  const pending = items.filter((item) => !item.done);
  return (
    <section className="card" aria-label="שבועי לשבוע">
      <div className="card-head">
        <Icon name="weekly" />
        <h3 className="grow">שבועי</h3>
        {data && <span className={`badge ${data.heldAt ? 't-green' : 't-gray'}`}>{data.heldAt ? 'התקיים' : 'לקראת השבועי'}</span>}
      </div>
      <div className="card-body col gap-12">
        {loading && !data && <Loading rows={2} />}
        <ErrorBox error={error} />
        {data && (
          <>
            {data.heldAt && <div className="tiny muted">התקיים ב־{shortDate(data.heldAt)}{data.heldByName ? ` · ${data.heldByName}` : ''}</div>}
            <div className="small muted">{items.length ? `${pending.length} מתוך ${items.length} נושאים עדיין פתוחים` : 'עדיין לא נוספו נושאים לשבועי הזה.'}</div>
            {pending.length > 0 && (
              <ul className="week-meeting-preview small">
                {pending.slice(0, 3).map((item) => <li key={item.id}>{item.title}</li>)}
              </ul>
            )}
          </>
        )}
        <Link to={`/weekly/${weekId}`} className="btn btn-sm">
          <Icon name="weekly" size={14} /> פתיחת השבועי
        </Link>
      </div>
    </section>
  );
}
