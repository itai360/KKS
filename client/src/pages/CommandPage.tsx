// Sections 26-27: "פקודות שלי" - type an order, the system asks "למי?", press send.

import { useMemo, useRef, useState } from 'react';
import { isOpenStatus, PRIORITY_LABELS } from '@shared/constants';
import { parseTaskText } from '@shared/parser';
import type { Task } from '@shared/types';
import { DoneDrawer } from '../components/DoneDrawer';
import { Icon } from '../components/Icon';
import { DateTimeInputs, UserPicker, quickDeadlines } from '../components/NewTask';
import { TaskRow } from '../components/TaskRow';
import { foldTasks } from '../lib/taskGroups';
import { useToast } from '../components/Toasts';
import { ErrorBox, Field, PageHead } from '../components/ui';
import { api } from '../lib/api';
import { fmtDeadline, getTz, isoAt } from '../lib/format';
import { useFresh } from '../lib/fresh';
import { haptic } from '../lib/haptics';
import { useLeaving } from '../lib/leaving';
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
      haptic('success');
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
            {/* what is understood so far: each part turns green as it is found; the send waits for all three */}
            <div className="order-parts" aria-live="polite">
              <OrderPart ok={!!parsed.title} label="משימה" />
              <OrderPart ok={allStaff || ownerIds.length > 0} label="למי" />
              <OrderPart ok={!!dDate} label="עד מתי" />
            </div>
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
      <RecentOrders tasks={recent.data} />
    </div>
  );
}

function OrderPart({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span className={`order-part${ok ? ' is-ok' : ''}`}>
      <span className="order-part-mark" aria-hidden="true">
        {ok && <Icon name="check" size={12} />}
      </span>
      {label}
      <span className="sr-only">{ok ? ' - זוהה' : ' - חסר'}</span>
    </span>
  );
}

/**
 * Latest orders; the copies of an order given to a group collapse into one row, under the group's name, with
 * its progress. The ones still open on top; one carried out (here, or by its owner while this is open) goes -
 * a moment done, then folded - to "בוצעו" under them.
 */
function RecentOrders({ tasks }: { tasks: Task[] | undefined }) {
  const { user } = useSession();
  const rows = useMemo(() => foldTasks([...(tasks ?? [])].sort((a, b) => b.createdAt.localeCompare(a.createdAt)), user.id).slice(0, 15), [tasks, user.id]);
  const open = useMemo(() => rows.filter((r) => isOpenStatus(r.task.status)), [rows]);
  const done = useMemo(() => rows.filter((r) => !isOpenStatus(r.task.status)), [rows]);
  const leaving = useLeaving(open, (r) => r.task.id, (id) => done.find((r) => r.task.id === id));
  // the order just sent comes in at the top (once the list has loaded: what was there before is not new)
  const fresh = useFresh(tasks && rows.map((r) => r.task.id));
  if (!rows.length) return <p className="small muted">משימות שתפתח יופיעו כאן עם הסטטוס שלהן.</p>;
  return (
    <>
      {leaving.rows.length ? (
        <div className="list">
          {leaving.rows.map((r) => (
            <TaskRow key={r.task.id} task={r.task} folded={r.folded} arrived={fresh(r.task.id)} leaving={leaving.phaseOf(r.task.id)} />
          ))}
        </div>
      ) : (
        <p className="small all-done-line">
          <Icon name="check" size={15} /> כל הפקודות האחרונות בוצעו.
        </p>
      )}
      <DoneDrawer id="orders-done" count={done.length} label="בוצעו">
        <div className="list">
          {done.map((r) => (
            <TaskRow key={r.task.id} task={r.task} folded={r.folded} />
          ))}
        </div>
      </DoneDrawer>
    </>
  );
}
