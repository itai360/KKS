// What a click on something in the calendar opens, as Google Calendar's event card: its colour and
// title, when, where and whose, and what can be done with it from here - each by what the server lets
// this person do. A course event: edit, duplicate, delete, call it off, and its whole page (preparation
// tasks, debrief, files). A deadline: done in one press, and the task's page. A week, an experience, a
// debrief or an absence: its few facts and the way to its own screen. A Google event: read only.

import { Link } from 'react-router';
import { ABSENCE_REASON_LABELS } from '@shared/constants';
import { MONTH_NAMES } from '@shared/calendarGrid';
import type { CalItem } from '@shared/calendarLayers';
import { DEBRIEF_KIND_LABELS } from '@shared/debriefForms';
import { parseDateKey, shortDate, weekdayName } from '@shared/dates';
import type { ScheduleEvent } from '@shared/types';
import { useSession } from '../lib/session';
import { PriorityBadge, StatusBadge } from './Badges';
import { Icon } from './Icon';
import { TaskCheck, useTaskTick } from './TaskRow';
import { DeadlineText } from './Badges';
import { GuestAvatar, reminderText } from './EventDialogs';

/** "יום שני, 26 באוקטובר" */
export function longDay(d: string): string {
  const { month, day } = parseDateKey(d);
  return `יום ${weekdayName(d)}, ${day} ב${MONTH_NAMES[month - 1]}`;
}

/** when a thing is, in words: its day and hours, the days it lasts, or all day */
export function whenText(i: Pick<CalItem, 'date' | 'endDate' | 'start' | 'end'>): string {
  if (i.endDate !== i.date) return `${weekdayName(i.date)} ${shortDate(i.date)} - ${weekdayName(i.endDate)} ${shortDate(i.endDate)}`;
  if (!i.start) return `${longDay(i.date)} · כל היום`;
  return `${longDay(i.date)} · ${i.start}${i.end ? ` - ${i.end}` : ''}`;
}

function Row({ icon, children }: { icon: string; children: React.ReactNode }) {
  return (
    <div className="ic-row">
      <Icon name={icon} size={18} />
      <div className="grow">{children}</div>
    </div>
  );
}

export interface EventActions {
  canManage: (e: ScheduleEvent) => boolean;
  onEdit: (e: ScheduleEvent) => void;
  onDetails: (e: ScheduleEvent) => void;
  onDuplicate: (e: ScheduleEvent) => void;
  onCancel: (e: ScheduleEvent) => void;
  onRestore: (e: ScheduleEvent) => void;
  onDelete: (e: ScheduleEvent) => void;
  /** a guest's answer: yes, no or maybe */
  onRespond?: (e: ScheduleEvent, response: 'accepted' | 'declined' | 'tentative') => void;
}

function TaskBody({ item, onClose }: { item: CalItem & { src: { kind: 'task' } }; onClose: () => void }) {
  const t = item.src.e;
  const tick = useTaskTick(t);
  return (
    <>
      <div className="ic-title-row">
        <TaskCheck task={t} tick={tick} />
        <h2 className={`ic-title${tick.done ? ' is-done' : ''}`}>{t.title}</h2>
      </div>
      <div className="ic-when">
        דד-ליין: <DeadlineText task={t} />
      </div>
      <div className="row wrap gap-6 ic-badges">
        <StatusBadge status={tick.ticked ? 'done' : t.status} overdue={t.overdue && !tick.ticked} />
        <PriorityBadge priority={t.priority} />
      </div>
      <Row icon="my">{t.ownerName}</Row>
      {(t.domain || t.weekName || t.trackName) && <Row icon="layers">{[t.domain, t.weekName, t.trackName].filter(Boolean).join(' · ')}</Row>}
      {t.eventTitle && <Row icon="calendar">משימת הכנה: {t.eventTitle}</Row>}
      {t.subtaskTotal > 0 && (
        <Row icon="tasks">
          משימות משנה: {t.subtaskDone}/{t.subtaskTotal}
        </Row>
      )}
      {t.openDependencies > 0 && <Row icon="dependency">ממתינה ל-{t.openDependencies === 1 ? 'משימה אחת' : `${t.openDependencies} משימות`}</Row>}
      {t.blockReason && <Row icon="alert">חסום: {t.blockReason}</Row>}
      <div className="ic-foot">
        <Link to={`/tasks/${t.id}`} className="btn btn-sm btn-primary" onClick={onClose}>
          פתיחת המשימה
        </Link>
      </div>
    </>
  );
}

/** what a thing is, for the head of its sheet on a phone (its name is already in the card) */
export function kindLabel(item: CalItem): string {
  switch (item.src.kind) {
    case 'event':
      return 'אירוע בלו"ז';
    case 'external':
      return item.src.e.sourceName || 'יומן Google';
    case 'task':
      return 'משימה';
    case 'week':
      return 'שבוע בקורס';
    case 'experience':
      return 'התנסות';
    case 'debrief':
      return 'תחקיר';
    case 'absence':
      return 'היעדרות';
  }
}

export function ItemCard({ item, onClose, actions }: { item: CalItem; onClose: () => void; actions: EventActions }) {
  const { isCommander, user } = useSession();
  const src = item.src;
  const head = (tools?: React.ReactNode) => (
    <div className="ic-tools">
      {tools}
      <button type="button" className="icon-btn" onClick={onClose} aria-label="סגירה" title="סגירה">
        <Icon name="x" />
      </button>
    </div>
  );
  const title = (
    <div className="ic-title-row">
      <span className={`ic-swatch c-${item.color}`} aria-hidden="true" />
      <h2 className={`ic-title${item.faded && src.kind === 'event' ? ' is-cancelled' : ''}`}>{item.title}</h2>
    </div>
  );

  if (src.kind === 'task') {
    return (
      <div className="item-card">
        {head()}
        <TaskBody item={item as CalItem & { src: { kind: 'task' } }} onClose={onClose} />
      </div>
    );
  }

  if (src.kind === 'event') {
    const e = src.e;
    const may = (e.canEdit ?? actions.canManage(e)) && !e.hidden;
    const guests = e.guests ?? [];
    const counts = { accepted: 0, declined: 0, tentative: 0, needsAction: 0 };
    for (const g of guests) counts[g.response]++;
    const answer = e.myResponse;
    return (
      <div className="item-card g-card">
        {head(
          may && (
            <>
              <button type="button" className="icon-btn" onClick={() => actions.onEdit(e)} aria-label="עריכת האירוע" title="עריכה">
                <Icon name="edit" />
              </button>
              <button type="button" className="icon-btn" onClick={() => actions.onDelete(e)} aria-label="מחיקת האירוע" title="מחיקה">
                <Icon name="trash" />
              </button>
              <button type="button" className="icon-btn" onClick={() => actions.onDuplicate(e)} aria-label="שכפול האירוע" title="שכפול">
                <Icon name="copy" />
              </button>
            </>
          ),
        )}
        {title}
        <div className="ic-when">
          {whenText(item)}
          {e.recurrenceText && <div className="ic-recur">{e.recurrenceText}</div>}
        </div>
        {e.cancelled && <span className="badge t-red">הפעילות בוטלה</span>}
        {e.location && <Row icon="pin">{e.location}</Row>}
        {guests.length > 0 && (
          <Row icon="users">
            <div className="ic-guests-sum">
              {guests.length} אורחים
              <span className="muted small">
                {[counts.accepted && `${counts.accepted} כן`, counts.declined && `${counts.declined} לא`, counts.tentative && `${counts.tentative} אולי`, counts.needsAction && `${counts.needsAction} ממתינים`].filter(Boolean).join(', ')}
              </span>
            </div>
            <ul className="ic-guests">
              {guests.slice(0, 8).map((g) => (
                <li key={g.userId}>
                  <GuestAvatar name={g.name} response={g.response} />
                  <span className="grow">
                    {g.name}
                    {g.userId === e.createdBy && <span className="tiny muted"> · מארגן</span>}
                    {g.optional && <span className="tiny muted"> · אופציונלי</span>}
                  </span>
                </li>
              ))}
              {guests.length > 8 && <li className="tiny muted">ועוד {guests.length - 8}</li>}
            </ul>
          </Row>
        )}
        {e.notes && (
          <Row icon="edit">
            <div className="ic-notes">{e.notes}</div>
          </Row>
        )}
        {!e.hidden && <Row icon="bell">{(e.reminders ?? (e.allDay ? [] : [{ minutes: 30 }])).map((r) => reminderText(r.minutes)).join(', ') || 'ללא התראות'}</Row>}
        <Row icon="calendar">
          {e.calendar === 'personal' ? 'היומן שלי' : 'יומן הקורס'}
          {e.createdByName && <span className="muted small"> · נוצר על ידי {e.createdByName}</span>}
          {e.visibility === 'private' && <span className="muted small"> · פרטי</span>}
          {e.transparency === 'transparent' && <span className="muted small"> · פנוי</span>}
        </Row>
        {e.ownerName && <Row icon="my">אחראי: {e.ownerName}</Row>}
        {e.taskTotal > 0 && (
          <Row icon="tasks">
            משימות הכנה:{' '}
            <span className={`badge t-${e.taskDone === e.taskTotal ? 'green' : 'orange'}`}>
              {e.taskDone}/{e.taskTotal} הושלמו
            </span>
          </Row>
        )}
        {answer && actions.onRespond && (
          <div className="g-rsvp" role="group" aria-label="מגיע/ה?">
            <span className="g-rsvp-q">מגיע/ה?</span>
            {(
              [
                ['accepted', 'כן'],
                ['declined', 'לא'],
                ['tentative', 'אולי'],
              ] as const
            ).map(([r, l]) => (
              <button key={r} type="button" className={`g-chip${answer === r ? ' on' : ''}`} aria-pressed={answer === r} onClick={() => actions.onRespond!(e, r)}>
                {answer === r && <Icon name="check" size={14} />}
                {l}
              </button>
            ))}
          </div>
        )}
        {!e.hidden && (
          <div className="ic-foot">
            <button type="button" className="btn btn-sm btn-primary" onClick={() => actions.onDetails(e)}>
              פרטים נוספים
            </button>
            {may &&
              (e.cancelled ? (
                <button type="button" className="btn btn-sm" onClick={() => actions.onRestore(e)}>
                  החזרה ללו"ז
                </button>
              ) : (
                <button type="button" className="btn btn-sm btn-ghost text-red" onClick={() => actions.onCancel(e)}>
                  ביטול פעילות
                </button>
              ))}
          </div>
        )}
      </div>
    );
  }

  if (src.kind === 'external') {
    const x = src.e;
    return (
      <div className="item-card">
        {head()}
        {title}
        <div className="ic-when">{whenText(item)}</div>
        {x.location && <Row icon="pin">{x.location}</Row>}
        <Row icon="calendar">
          {x.sourceName} <span className="badge t-blue">Google</span>
        </Row>
        <p className="tiny muted ic-note">מיומן Google מחובר, לקריאה בלבד - שינויים נעשים ב-Google Calendar.</p>
      </div>
    );
  }

  if (src.kind === 'week') {
    const w = src.e;
    return (
      <div className="item-card">
        {head()}
        {title}
        <div className="ic-when">{whenText(item)}</div>
        {w.leadName && <Row icon="my">מפק"צ מוביל: {w.leadName}</Row>}
        {w.topic && <Row icon="flag">{w.topic}</Row>}
        <Row icon="pulse">
          מוכנות: <b>{w.readiness}%</b>
          {w.totalTasks > 0 && (
            <span className="small muted">
              {' '}
              · {w.doneTasks}/{w.totalTasks} משימות{w.overdueTasks ? ` · ${w.overdueTasks} באיחור` : ''}
            </span>
          )}
        </Row>
        {w.goals && <div className="ic-notes">{w.goals}</div>}
        <div className="ic-foot">
          <Link to={`/weeks/${w.id}`} className="btn btn-sm btn-primary" onClick={onClose}>
            דף השבוע
          </Link>
          <Link to={`/weekly/${w.id}`} className="btn btn-sm" onClick={onClose}>
            שבועי
          </Link>
          <Link to={`/weeks/${w.id}/order`} className="btn btn-sm btn-ghost" onClick={onClose}>
            פקודת שבוע
          </Link>
        </div>
      </div>
    );
  }

  if (src.kind === 'experience') {
    const x = src.e;
    return (
      <div className="item-card">
        {head()}
        {title}
        <div className="ic-when">{whenText(item)}</div>
        {x.teamName && <Row icon="users">{x.teamName}</Row>}
        {x.mentorName && <Row icon="my">חונך: {x.mentorName}</Row>}
        {x.eventTitle && <Row icon="calendar">{x.eventTitle}</Row>}
        <div className="ic-foot">
          <Link to={`/cadets/${x.cadetId}`} className="btn btn-sm btn-primary" onClick={onClose}>
            תיק הצוער
          </Link>
          <Link to="/experiences" className="btn btn-sm" onClick={onClose}>
            התנסויות
          </Link>
        </div>
      </div>
    );
  }

  if (src.kind === 'debrief') {
    const d = src.e;
    return (
      <div className="item-card">
        {head()}
        {title}
        <div className="ic-when">{whenText(item)}</div>
        <div className="row wrap gap-6 ic-badges">
          <span className="badge">{DEBRIEF_KIND_LABELS[d.kind]}</span>
          <span className={`badge t-${d.status === 'final' ? 'green' : 'gray'}`}>{d.status === 'final' ? 'סוכם' : 'טיוטה'}</span>
        </div>
        {d.facilitatorName && <Row icon="my">מנחה: {d.facilitatorName}</Row>}
        {d.eventTitle && <Row icon="calendar">{d.eventTitle}</Row>}
        {d.openTasks > 0 && <Row icon="tasks">{d.openTasks === 1 ? 'משימה פתוחה אחת' : `${d.openTasks} משימות פתוחות`}</Row>}
        <div className="ic-foot">
          <Link to={`/debriefs/${d.id}`} className="btn btn-sm btn-primary" onClick={onClose}>
            פתיחת התחקיר
          </Link>
        </div>
      </div>
    );
  }

  // an absence: why, only to the person and the commander (as the calendar's own title says)
  const a = src.e;
  const own = isCommander || a.userId === user.id;
  return (
    <div className="item-card">
      {head()}
      {title}
      <div className="ic-when">{whenText(item)}</div>
      {own && <Row icon="flag">{ABSENCE_REASON_LABELS[a.reason]}</Row>}
      {own && a.note && <div className="ic-notes">{a.note}</div>}
      {own && a.tasksDue > 0 && <Row icon="alert">{a.tasksDue === 1 ? 'משימה פתוחה אחת בזמן ההיעדרות' : `${a.tasksDue} משימות פתוחות בזמן ההיעדרות`}</Row>}
      {isCommander && (
        <div className="ic-foot">
          <Link to={`/team/${a.userId}`} className="btn btn-sm" onClick={onClose}>
            {a.userName} - פרטים ועומס
          </Link>
        </div>
      )}
    </div>
  );
}
