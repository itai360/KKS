// Sections 26-27: "פקודות שלי" - type an order, the system asks "למי?", press send.

import { useMemo, useRef, useState } from 'react';
import { PRIORITY_LABELS } from '@shared/constants';
import { parseTaskText } from '@shared/parser';
import type { Task } from '@shared/types';
import { Icon } from '../components/Icon';
import { DateTimeInputs, UserPicker, quickDeadlines } from '../components/NewTask';
import { TaskRow } from '../components/TaskRow';
import { useToast } from '../components/Toasts';
import { ErrorBox, Field, PageHead } from '../components/ui';
import { api } from '../lib/api';
import { fmtDeadline, getTz, isoAt } from '../lib/format';
import { emitLocalChange } from '../lib/realtime';
import { useSession } from '../lib/session';
import { useApi } from '../lib/useApi';

export function CommandPage() {
  const { users, weeks, settings, user, isCommander } = useSession();
  const toast = useToast();
  const [text, setText] = useState('');
  const [owners, setOwners] = useState<number[] | null>(null);
  const [all, setAll] = useState<boolean | null>(null);
  const [date, setDate] = useState<string | null>(null);
  const [time, setTime] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const recent = useApi<Task[]>(`/api/tasks?createdBy=${user.id}&recurring=0`, ['tasks']);

  const parsed = useMemo(
    () =>
      text.trim()
        ? parseTaskText(text, {
            users: users.map((u) => ({ id: u.id, displayName: u.displayName, title: u.title })),
            weeks: weeks.map((w) => ({ id: w.id, name: w.name })),
            domains: settings.domains,
            tz: getTz(),
            defaultTime: settings.defaultDeadlineTime,
          })
        : null,
    [text, users, weeks, settings],
  );

  const ownerIds = owners ?? parsed?.ownerIds ?? [];
  const allStaff = all ?? (!!parsed?.allStaff && isCommander);
  const dDate = date ?? parsed?.deadlineDate ?? '';
  const dTime = time ?? parsed?.deadlineTime ?? settings.defaultDeadlineTime;
  const ready = !!parsed?.title && (allStaff || ownerIds.length > 0) && !!dDate;

  const reset = () => {
    setText('');
    setOwners(null);
    setAll(null);
    setDate(null);
    setTime(null);
    inputRef.current?.focus();
  };

  const send = async () => {
    if (!parsed || !ready) return;
    setBusy(true);
    setError(null);
    try {
      const deadline = isoAt(dDate, dTime);
      const r = await api.post<{ ids: number[] }>('/api/tasks', {
        title: parsed.title,
        assignMode: allStaff ? 'all' : 'shared',
        ownerIds: allStaff ? [] : ownerIds,
        deadline,
        priority: parsed.priority ?? 'normal',
        domain: parsed.domain ?? '',
        weekId: parsed.weekId ?? undefined,
      });
      toast({ title: r.ids.length > 1 ? `נפתחו ${r.ids.length} משימות` : 'הפקודה נשלחה', body: `${parsed.title} · ${fmtDeadline(deadline)}`, tone: 'green' });
      emitLocalChange('tasks');
      reset();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page narrow">
      <PageHead title="פקודות שלי" sub="כותבים פקודה כמו בהודעה - המערכת מזהה משימה, אחראי, דד-ליין ועדיפות. מהיר יותר מוואטסאפ." />
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
        className="col gap-16"
      >
        <div className="nl-box">
          <input
            ref={inputRef}
            className="input"
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              setOwners(null);
              setAll(null);
              setDate(null);
              setTime(null);
            }}
            placeholder='לדוגמה: להכין מסמך לקראת שבוע הגנה עד מחר 12:00'
            autoFocus
            aria-label="פקודה"
          />
          <button className="btn btn-primary btn-sm" disabled={!ready || busy}>
            <Icon name="zap" /> שלח
          </button>
        </div>

        {parsed && (
          <div className="card card-pad col gap-16 fade-in">
            <div>
              <div className="label-caps">משימה</div>
              <div className="strong" style={{ fontSize: 20 }}>
                {parsed.title || <span className="text-red">לא זוהה שם משימה</span>}
              </div>
              <div className="row gap-6 wrap mt-8">
                {parsed.priority && <span className="badge t-orange">עדיפות: {PRIORITY_LABELS[parsed.priority]}</span>}
                {parsed.domain && <span className="badge">תחום: {parsed.domain}</span>}
                {parsed.weekId && <span className="badge t-blue">{weeks.find((w) => w.id === parsed.weekId)?.name}</span>}
              </div>
            </div>
            <Field label={ownerIds.length || allStaff ? 'אחראי' : 'למי?'} required>
              <UserPicker value={ownerIds} onChange={(v) => setOwners(v)} allowAll={isCommander} all={allStaff} onAll={(v) => setAll(v)} date={dDate || undefined} />
            </Field>
            <Field label="דד-ליין" required>
              <DateTimeInputs date={dDate} time={dTime} onDate={setDate} onTime={setTime} />
              <div className="chips mt-8">
                {quickDeadlines(settings.defaultDeadlineTime).map((q) => (
                  <button
                    type="button"
                    key={q.label}
                    className={`chip chip-sm${dDate === q.date && dTime === q.time ? ' on' : ''}`}
                    onClick={() => {
                      setDate(q.date);
                      setTime(q.time);
                    }}
                  >
                    {q.label}
                  </button>
                ))}
              </div>
            </Field>
            <div className="row">
              <button className="btn btn-primary btn-lg" disabled={!ready || busy}>
                <Icon name="check" /> שלח
              </button>
              <button type="button" className="btn btn-ghost" onClick={reset}>
                נקה
              </button>
            </div>
            <ErrorBox error={error} />
          </div>
        )}
      </form>

      <div className="section-title">
        <h2>פקודות אחרונות</h2>
      </div>
      <RecentOrders tasks={recent.data ?? []} />
    </div>
  );
}

/** Latest orders; the copies of an all-staff order collapse into one row with its progress. */
function RecentOrders({ tasks }: { tasks: Task[] }) {
  const sorted = [...tasks].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const rows: { task: Task; done?: number; total?: number }[] = [];
  const groups = new Map<string, { task: Task; done?: number; total?: number }>();
  for (const t of sorted) {
    if (!t.groupId) {
      rows.push({ task: t });
      continue;
    }
    let g = groups.get(t.groupId);
    if (!g) {
      g = { task: t, done: 0, total: 0 };
      groups.set(t.groupId, g);
      rows.push(g);
    }
    g.total! += t.status === 'cancelled' ? 0 : 1;
    g.done! += t.status === 'done' ? 1 : 0;
  }
  if (!rows.length) return <p className="small muted">משימות שתפתח יופיעו כאן עם הסטטוס שלהן.</p>;
  return (
    <div className="list">
      {rows.slice(0, 15).map(({ task, done, total }) => (
        <TaskRow
          key={task.id}
          task={total ? { ...task, ownerName: 'כל הסגל', status: done === total ? 'done' : 'todo', tone: done === total ? 'green' : task.tone, overdue: done !== total && task.overdue } : task}
          readOnly={!!total}
          extra={total ? <span className={`badge t-${done === total ? 'green' : 'blue'}`}>{done}/{total} השלימו</span> : undefined}
        />
      ))}
    </div>
  );
}
