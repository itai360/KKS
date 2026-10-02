// Sections 4, 5, 32, 49 - the commander's home: understand the course in 10 seconds.

import { useState } from 'react';
import { useNavigate } from 'react-router';
import type { AttentionItem, AttentionKind, DashboardData } from '@shared/types';
import { staffHealthLabel } from '@shared/taskLogic';
import { DisciplineCard } from '../components/DisciplineCard';
import { Icon } from '../components/Icon';
import { useNewTask } from '../components/NewTask';
import { useToast } from '../components/Toasts';
import { Empty, ErrorBox, Loading, openable, PageHead, Ring } from '../components/ui';
import { api } from '../lib/api';
import { fmtDeadline, fmtLongDate, greetName, greeting, todayKey } from '../lib/format';
import { emitLocalChange } from '../lib/realtime';
import { useSession } from '../lib/session';
import { useApi, useTick } from '../lib/useApi';
import { shortDate } from '@shared/dates';

const KIND_LABEL: Record<AttentionKind, string> = {
  overdue: 'באיחור',
  due_soon: 'דד-ליין קרוב',
  stale: 'לא עודכן',
  blocked: 'חסם',
  approval: 'ממתין לאישורך',
  request: 'בקשה',
  decision: 'נדרשת החלטה',
  readiness: 'מוכנות נמוכה',
  overload: 'עומס',
};

export function DashboardPage() {
  const { user } = useSession();
  const { data, error, loading } = useApi<DashboardData>('/api/dashboard', ['tasks', 'weeks', 'events', 'requests']);
  const navigate = useNavigate();
  const newTask = useNewTask();
  const [cmd, setCmd] = useState('');
  useTick();

  return (
    <div className="page">
      <PageHead
        eyebrow={fmtLongDate(todayKey())}
        title={`${greeting()}, ${greetName(user.displayName)}`}
        docTitle="דף הבית"
        sub="מה חייב להסתיים היום, מה באיחור, מה נתקע ואיפה נדרשת החלטה שלך."
        actions={
          <>
            <button className="btn" onClick={() => navigate('/briefing')}>
              <Icon name="sun" /> תדריך בוקר
            </button>
            <button className="btn btn-primary" onClick={() => newTask()}>
              <Icon name="plus" /> משימה
            </button>
          </>
        }
      />
      <ErrorBox error={error} />
      {loading && !data ? (
        <Loading rows={4} />
      ) : data ? (
        <div className="fade-in col gap-16">
          <SetupNudge />
          <div className="stats">
            <Stat n={data.stats.today} label="לביצוע היום" hint="משימות שצריכות להסתיים היום" onClick={() => navigate('/tasks?scope=today')} />
            <Stat n={data.stats.overdue} label="באיחור" hint="עבר הדד-ליין ולא הושלמו" alert={data.stats.overdue > 0} onClick={() => navigate('/tasks?scope=overdue')} />
            <Stat n={data.stats.week} label="לביצוע השבוע" hint="פתוחות ב-7 הימים הקרובים" onClick={() => navigate('/tasks?scope=week')} />
            <Stat n={data.stats.doneThisWeek} label="הושלמו השבוע" hint="נסגרו מתחילת השבוע" onClick={() => navigate('/tasks?scope=done')} />
          </div>

          <form
            className="nl-box"
            onSubmit={(e) => {
              e.preventDefault();
              if (!cmd.trim()) return newTask();
              newTask({ text: cmd.trim(), heading: 'פקודה מהירה' }, () => setCmd(''));
            }}
          >
            <input className="input" value={cmd} onChange={(e) => setCmd(e.target.value)} placeholder='פקודה מהירה: "מפק"צ 4 להכין מסמך לקראת שבוע הגנה עד מחר 12:00"' aria-label="פקודה מהירה" />
            <button className="btn btn-primary btn-sm" type="submit">
              <Icon name="zap" /> פתח
            </button>
          </form>

          <div className="split">
            <Attention items={data.attention} />
            <div className="col gap-16 sticky-side">
              <WeekCard data={data} />
              <DisciplineCard />
              <StaffHealth data={data} />
              <TodayEvents data={data} />
              <QuickActions />
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function Stat({ n, label, hint, alert, onClick }: { n: number; label: string; hint: string; alert?: boolean; onClick: () => void }) {
  return (
    <button className={`card stat${alert ? ' alert' : ''}`} onClick={onClick} type="button" style={{ textAlign: 'start' }}>
      <span className="stat-label">{label}</span>
      <span className="stat-num">{n}</span>
      <span className="stat-hint">{hint}</span>
    </button>
  );
}

// Lanes follow the colour language of section 18: red first, then decisions,
// then what is about to slip, then quiet signals.
const LANES: { key: string; title: string; tone: string; kinds: AttentionKind[] }[] = [
  { key: 'red', title: 'באיחור, חסמים והחלטות', tone: 'red', kinds: ['decision', 'overdue'] },
  { key: 'approve', title: 'ממתין לאישורך', tone: 'blue', kinds: ['approval', 'request'] },
  { key: 'soon', title: 'דד-ליין ב-24 השעות הקרובות', tone: 'orange', kinds: ['due_soon'] },
  { key: 'risk', title: 'שבועות בסיכון', tone: 'orange', kinds: ['readiness'] },
  { key: 'quiet', title: 'חסמים, עומס ומשימות שלא עודכנו', tone: 'yellow', kinds: ['blocked', 'stale', 'overload'] },
];
const LANE_LIMIT = 4;

function Attention({ items }: { items: AttentionItem[] }) {
  const navigate = useNavigate();
  const toast = useToast();
  const [busy, setBusy] = useState<number | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  // a blocker the owner escalated to the commander belongs with the red items
  const laneOf = (i: AttentionItem) => (i.kind === 'blocked' && i.tone === 'red' ? 'red' : LANES.find((l) => l.kinds.includes(i.kind))?.key);
  const lanes = LANES.map((l) => ({ ...l, items: items.filter((i) => laneOf(i) === l.key) })).filter((l) => l.items.length);

  const open = (i: AttentionItem) => {
    if (i.taskId) navigate(`/tasks/${i.taskId}`);
    else if (i.weekId) navigate(`/weeks/${i.weekId}`);
    else if (i.userId) navigate(`/team/${i.userId}`);
  };

  const act = async (e: React.MouseEvent, i: AttentionItem, approve: boolean) => {
    e.stopPropagation();
    setBusy(i.requestId ?? i.taskId ?? 0);
    try {
      if (i.kind === 'approval' && i.taskId) await api.post(`/api/tasks/${i.taskId}/transition`, { action: 'approve' });
      else if (i.kind === 'request' && i.requestId) await api.post(`/api/requests/${i.requestId}/decide`, { approve });
      toast({ title: approve ? 'אושר' : 'נדחה', body: i.title, tone: 'green' });
      emitLocalChange('tasks', 'requests');
    } catch (err) {
      toast({ title: (err as Error).message, tone: 'red' });
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="card" aria-labelledby="attn-title">
      <div className="card-head">
        <Icon name="target" />
        <h2 id="attn-title" className="grow" style={{ fontFamily: 'var(--display)', fontSize: 28, lineHeight: 1 }}>
          דורש את תשומת לבי
        </h2>
        <div className="row gap-6 hide-mobile">
          {lanes.map((l) => (
            <a key={l.key} href={`#lane-${l.key}`} className={`badge t-${l.tone}`} title={l.title}>
              {l.items.length}
            </a>
          ))}
        </div>
      </div>
      {lanes.length === 0 ? (
        <Empty icon="check" title="הכל מתקדם כמתוכנן" text="אין חריגות שמחייבות את התערבותך כרגע." />
      ) : (
        lanes.map((l) => {
          const all = !!expanded[l.key];
          const list = all ? l.items : l.items.slice(0, LANE_LIMIT);
          return (
            <div key={l.key} id={`lane-${l.key}`} className="attn">
              <div className="group-title" style={{ margin: 0, padding: '12px 18px 6px' }}>
                <span className={`dot t-${l.tone}`} />
                <span>{l.title}</span>
                <span className="n">{l.items.length}</span>
                <span className="line" />
              </div>
              {list.map((i, idx) => (
                <div
                  key={`${i.kind}-${i.taskId ?? i.weekId ?? i.userId}-${i.requestId ?? idx}`}
                  className={`attn-item t-${i.tone}`}
                  {...openable(() => open(i))}
                >
                  <span className="attn-bar" />
                  <div style={{ minWidth: 0 }}>
                    <div className="attn-kind">
                      {KIND_LABEL[i.kind]}
                      {i.count && i.count > 1 ? ` · ${i.count} אנשי סגל` : ''}
                    </div>
                    <div className="attn-title">{i.title}</div>
                    <div className="attn-sub">
                      {[i.ownerName && (i.kind === 'readiness' ? `מפק"צ: ${i.ownerName}` : `אחראי: ${i.ownerName}`), i.deadline && `דד-ליין: ${fmtDeadline(i.deadline)}`, i.subtitle]
                        .filter(Boolean)
                        .join(' · ')}
                    </div>
                  </div>
                  <div className="row gap-6">
                    {(i.kind === 'approval' || i.kind === 'request') && (
                      <button className="btn btn-sm btn-primary" disabled={busy !== null} onClick={(e) => void act(e, i, true)}>
                        אשר
                      </button>
                    )}
                    {i.kind === 'request' && (
                      <button className="btn btn-sm" disabled={busy !== null} onClick={(e) => void act(e, i, false)}>
                        דחה
                      </button>
                    )}
                    <Icon name="chevronLeft" className="faint" size={18} />
                  </div>
                </div>
              ))}
              {l.items.length > LANE_LIMIT && (
                <button className="btn btn-ghost btn-sm" style={{ margin: '4px 14px 10px' }} onClick={() => setExpanded({ ...expanded, [l.key]: !all })}>
                  {all ? 'הצג פחות' : `הצג עוד ${l.items.length - LANE_LIMIT}`}
                </button>
              )}
            </div>
          );
        })
      )}
    </section>
  );
}

function WeekCard({ data }: { data: DashboardData }) {
  const navigate = useNavigate();
  const weeks = [data.currentWeek && { label: 'השבוע הנוכחי', w: data.currentWeek }, data.nextWeek && { label: 'השבוע הבא', w: data.nextWeek }].filter(Boolean) as {
    label: string;
    w: NonNullable<DashboardData['nextWeek']>;
  }[];
  if (!weeks.length) {
    return (
      <div className="card card-pad">
        <div className="label-caps">שבועות הקורס</div>
        <p className="small muted mt-8">עדיין לא הוגדרו שבועות.</p>
        <button className="btn btn-sm mt-12" onClick={() => navigate('/settings#weeks')}>
          הגדרת שבועות
        </button>
      </div>
    );
  }
  return (
    <div className="card">
      {weeks.map(({ label, w }, i) => (
        <div key={w.id} className="row" style={{ padding: '14px 18px', borderTop: i ? '1px solid var(--line)' : undefined, cursor: 'pointer' }} {...openable(() => navigate(`/weeks/${w.id}`))}>
          <div className="grow">
            <div className="label-caps">{label}</div>
            <div className="strong" style={{ fontSize: 17 }}>
              {w.name}
            </div>
            <div className="tiny muted">
              {shortDate(w.startDate)}-{shortDate(w.endDate)} · {w.leadName ? `מפק"צ: ${w.leadName}` : 'ללא מפק"צ אחראי'}
            </div>
            <div className="tiny muted">
              {w.doneTasks}/{w.totalTasks} משימות {w.approvedAt ? '· אושר' : ''}
            </div>
          </div>
          <Ring value={w.readiness} size={72} tone={w.totalTasks === 0 ? 'gray' : undefined} />
        </div>
      ))}
    </div>
  );
}

function StaffHealth({ data }: { data: DashboardData }) {
  const navigate = useNavigate();
  return (
    <div className="card">
      <div className="card-head">
        <h3 className="grow">הסגל</h3>
        <button className="btn btn-ghost btn-sm" onClick={() => navigate('/team')}>
          לכל הצוות
        </button>
      </div>
      {data.staff.length === 0 && <div className="card-body small muted">לא הוגדרו אנשי סגל.</div>}
      {data.staff.map((s) => (
        <div key={s.userId} className="health" {...openable(() => navigate(`/team/${s.userId}`))}>
          <span className={`dot t-${s.overdue > 1 ? 'red' : s.overdue === 1 ? 'orange' : 'green'}`} />
          <span className="strong grow">{s.name}</span>
          <span className={`small ${s.overdue ? 'text-red strong' : 'muted'}`}>{staffHealthLabel(s.overdue)}</span>
          <span className="tiny mono muted">{s.open} פתוחות</span>
        </div>
      ))}
    </div>
  );
}

function TodayEvents({ data }: { data: DashboardData }) {
  const navigate = useNavigate();
  return (
    <div className="card">
      <div className="card-head">
        <h3 className="grow">לו"ז היום</h3>
        <button className="btn btn-ghost btn-sm" onClick={() => navigate('/schedule')}>
          ללו"ז
        </button>
      </div>
      {data.todayEvents.length === 0 ? (
        <div className="card-body small muted">אין אירועים בלו"ז להיום.</div>
      ) : (
        data.todayEvents.map((e) => (
          <div key={e.id} className="health" {...openable(() => navigate(`/schedule?date=${e.date}&event=${e.id}`))}>
            <span className="mono strong" style={{ width: 48 }}>
              {e.startTime}
            </span>
            <span className="grow">{e.title}</span>
            {e.taskTotal > 0 && (
              <span className={`tiny mono ${e.taskDone < e.taskTotal ? 'text-orange' : 'text-green'}`}>
                {e.taskDone}/{e.taskTotal}
              </span>
            )}
          </div>
        ))
      )}
    </div>
  );
}

function QuickActions() {
  const newTask = useNewTask();
  const navigate = useNavigate();
  return (
    <div className="card card-pad">
      <div className="label-caps mb-12">פעולות מהירות</div>
      <div className="grid-2" style={{ gap: 8 }}>
        <button className="btn" onClick={() => newTask()}>
          <Icon name="plus" /> משימה
        </button>
        <button className="btn" onClick={() => newTask({ allStaff: true, heading: 'משימה לכל הסגל' })}>
          <Icon name="users" /> לכל הסגל
        </button>
        <button className="btn" onClick={() => navigate('/recurring?new=1')}>
          <Icon name="repeat" /> משימה חוזרת
        </button>
        <button className="btn" onClick={() => navigate('/schedule?new=1')}>
          <Icon name="calendar" /> עדכון לו"ז
        </button>
      </div>
    </div>
  );
}

/** A new course: the few steps that make the system useful, until they are done. */
function SetupNudge() {
  const { settings, weeks, staff } = useSession();
  const navigate = useNavigate();
  const steps = [
    { done: !!settings.startDate && !!settings.endDate, label: 'תאריכי הקורס' },
    { done: staff.length > 0, label: 'אנשי הסגל' },
    { done: weeks.length > 0, label: 'שבועות הקורס' },
  ];
  const next = steps.find((s) => !s.done);
  if (!next) return null;
  const done = steps.filter((s) => s.done).length;
  return (
    <div className="card card-pad row wrap setup-nudge">
      <Icon name="flag" />
      <div className="grow">
        <div className="strong">הקמת הקורס - {done} מתוך {steps.length}</div>
        <div className="small muted">הצעד הבא: {next.label}. אחרי ההקמה המערכת מתחילה לעבוד בשבילך - משימות, לו"ז ותמונת מצב.</div>
      </div>
      <button className="btn btn-primary" onClick={() => navigate('/settings')}>
        להמשך ההקמה
      </button>
    </div>
  );
}
