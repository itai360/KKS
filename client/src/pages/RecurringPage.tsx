// Section 15 - recurring tasks: every day, every Sunday, every evening, end of week.

import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';
import { PRIORITIES, PRIORITY_LABELS, WEEKDAY_NAMES, type Priority } from '@shared/constants';
import { weekdayOf } from '@shared/dates';
import type { RecurringRule } from '@shared/types';
import { BulkCheck, BulkRow, BulkScope, BulkToggle, useBulk } from '../components/Bulk';
import { ask } from '../components/Confirm';
import { Icon } from '../components/Icon';
import { unlessHeld, useRowMenu } from '../components/RowMenu';
import { useToast } from '../components/Toasts';
import { Empty, ErrorBox, Field, Loading, Modal, PageHead, Seg, Select, TimeInput } from '../components/ui';
import { api } from '../lib/api';
import { fmtTime, todayKey } from '../lib/format';
import { haptic } from '../lib/haptics';
import { quickDelete } from '../lib/quickDelete';
import { dayWord, nextRun } from '../lib/recurring';
import { emitLocalChange } from '../lib/realtime';
import { useSession } from '../lib/session';
import { useApi } from '../lib/useApi';

function describe(r: Pick<RecurringRule, 'frequency' | 'weekdays' | 'time'>): string {
  if (r.frequency === 'daily') return `כל יום · ${r.time}`;
  if (r.weekdays.length === 7) return `כל יום · ${r.time}`;
  return `כל ${r.weekdays.map((d) => `יום ${WEEKDAY_NAMES[d]}`).join(', ')} · ${r.time}`;
}

const DAY_LETTERS = ['א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ש'];

const PRESETS: Omit<RecurringRule, 'id' | 'createdAt' | 'lastGeneratedDate' | 'assigneeLabel' | 'active'>[] = [
  { title: 'מעבר על משימות היום', description: '', frequency: 'daily', weekdays: [], time: '08:00', assignee: 'all', priority: 'normal', domain: '' },
  { title: 'עדכון לו"ז למחר', description: '', frequency: 'daily', weekdays: [], time: '20:00', assignee: 'week_lead', priority: 'normal', domain: 'לו"ז' },
  { title: "ח' ערכים", description: '', frequency: 'daily', weekdays: [], time: '20:00', assignee: 'week_lead', priority: 'normal', domain: 'צוערים' },
  { title: 'פתיחת שבוע', description: '', frequency: 'weekly', weekdays: [0], time: '08:00', assignee: 'week_lead', priority: 'high', domain: 'לו"ז' },
  { title: 'אימון גופני', description: '', frequency: 'weekly', weekdays: [0], time: '06:30', assignee: 'week_lead', priority: 'normal', domain: 'הדרכה' },
  { title: 'סיכום שבוע ותחקיר', description: 'סיכום שבוע, תחקיר, לקחים והכנת השבוע הבא', frequency: 'weekly', weekdays: [4], time: '14:00', assignee: 'all', priority: 'high', domain: 'הערכה' },
];

export function RecurringPage() {
  const { isCommander } = useSession();
  const [params, setParams] = useSearchParams();
  const { data, error, loading } = useApi<RecurringRule[]>('/api/recurring', ['recurring']);
  const [editing, setEditing] = useState<{ rule: RecurringRule | null; from?: RecurringRule } | null>(params.get('new') === '1' && isCommander ? { rule: null } : null);
  const active = (data ?? []).filter((r) => r.active).length;
  // while the page is open each row keeps its place: one paused does not drop to the bottom from under the
  // finger (the active ones come first again on the next visit); a new one joins where the server puts it
  const order = useRef<number[]>([]);
  const rules = useMemo(() => {
    const list = data ?? [];
    const ids = new Set(list.map((r) => r.id));
    const known = new Set(order.current);
    order.current = [...order.current.filter((id) => ids.has(id)), ...list.filter((r) => !known.has(r.id)).map((r) => r.id)];
    const at = new Map(order.current.map((id, i) => [id, i]));
    return [...list].sort((a, b) => at.get(a.id)! - at.get(b.id)!);
  }, [data]);

  return (
    <BulkScope
      entity="recurring"
      noun="משימות חוזרות"
      topics={['recurring']}
      ids={isCommander ? (data ?? []).map((r) => r.id) : []}
      actions={[
        { key: 'active', label: 'השהיה', icon: 'pause', value: false },
        { key: 'active', label: 'הפעלה', icon: 'play', value: true },
        { key: 'delete', label: 'מחיקה', icon: 'trash', danger: true, confirm: 'למחוק {n} משימות חוזרות? משימות שכבר נפתחו יישארו.' },
      ]}
    >
    <div className="page narrow">
      <PageHead
        title="משימות חוזרות"
        sub="המערכת פותחת אותן לבד בכל יום מתאים. הן לא נספרות במדד המוכנות ולא מציפות התראות."
        actions={
          isCommander && (
            <>
              <BulkToggle />
              <button className="btn btn-primary" onClick={() => setEditing({ rule: null })}>
                <Icon name="plus" /> משימה חוזרת
              </button>
            </>
          )
        }
      />
      <ErrorBox error={error} />
      {loading && !data ? (
        <Loading rows={3} />
      ) : !data?.length ? (
        <Empty icon="repeat" title="אין משימות חוזרות" text="לדוגמה: כל יום - עדכון לו״ז למחר; כל יום ראשון - פתיחת שבוע; כל ערב - ח׳ ערכים." />
      ) : (
        <>
          <div className="tiny muted mb-12">
            {active === data.length ? `${active} פעילות` : `${active} פעילות · ${data.length - active} מושהות`}
            {isCommander && <span className="hide-mobile"> · לחיצה ארוכה או קליק ימני - פעולות מהירות</span>}
          </div>
          <div className="card">
            {rules.map((r) => (
              <RuleRow key={r.id} r={r} onEdit={() => setEditing({ rule: r })} onCopy={() => setEditing({ rule: null, from: r })} />
            ))}
          </div>
        </>
      )}
      {editing && (
        <RuleEditor
          rule={editing.rule}
          from={editing.from}
          onClose={() => {
            setEditing(null);
            if (params.get('new')) setParams({}, { replace: true });
          }}
        />
      )}
    </div>
    </BulkScope>
  );
}

/** one rule: when it opens next, on which days; paused or resumed at once; held or right-clicked, what is done with it */
function RuleRow({ r, onEdit, onCopy }: { r: RecurringRule; onEdit: () => void; onCopy: () => void }) {
  const { isCommander } = useSession();
  const toast = useToast();
  const bulk = useBulk();
  // switched at once; the server's answer takes over when it comes
  const [mine, setMine] = useState<boolean | null>(null);
  useEffect(() => {
    setMine(null);
  }, [r.active]);
  const on = mine ?? r.active;
  const toggle = async () => {
    const next = !on;
    setMine(next);
    haptic('tick');
    try {
      await api.put(`/api/recurring/${r.id}`, { ...r, active: next });
      emitLocalChange('recurring');
      toast({ title: next ? 'הופעלה - תיפתח שוב בימים שלה' : 'הושהתה - לא תיפתח עד שתופעל', body: r.title, tone: next ? 'green' : 'gray' });
    } catch (e) {
      setMine(null);
      toast({ title: (e as Error).message, tone: 'red' });
    }
  };
  const remove = () => quickDelete({ entity: 'recurring', id: r.id, label: r.title, topics: ['recurring'], toast });
  const menu = useRowMenu({
    title: r.title,
    disabled: !isCommander || bulk?.active,
    items: [
      { key: 'edit', label: 'עריכה', icon: 'edit', primary: true, run: onEdit },
      { key: 'toggle', label: on ? 'השהיה' : 'הפעלה', icon: on ? 'pause' : 'play', run: () => void toggle() },
      { key: 'copy', label: 'שכפול', icon: 'copy', run: onCopy },
      { key: 'delete', label: 'מחיקה', icon: 'trash', run: remove },
    ],
  });
  const today = todayKey();
  const next = on ? nextRun(r, today, fmtTime(new Date().toISOString())) : null;
  const days = r.frequency === 'daily' ? [0, 1, 2, 3, 4, 5, 6] : r.weekdays;
  return (
    <BulkRow
      itemId={r.id}
      label={r.title}
      className={`health rule-row${on ? '' : ' is-paused'}${isCommander ? ' holdable' : ''}${menu.lifted ? ' is-lifted' : ''}`}
      style={{ cursor: isCommander ? 'pointer' : 'default' }}
      onOpen={isCommander ? unlessHeld(menu, onEdit) : undefined}
      {...menu.bind}
    >
      <BulkCheck id={r.id} />
      <Icon name="repeat" className="muted" size={18} />
      <div className="grow" style={{ minWidth: 0 }}>
        <div className="strong">{r.title}</div>
        <div className="tiny muted">
          {describe(r)} · {r.assigneeLabel}
          {r.domain && ` · ${r.domain}`}
        </div>
        <div className="rule-when">
          <span className="rule-days" aria-label={r.frequency === 'daily' ? 'כל יום' : `בימים ${r.weekdays.map((d) => WEEKDAY_NAMES[d]).join(', ')}`}>
            {DAY_LETTERS.map((l, i) => (
              <i key={l} className={`${days.includes(i) ? 'on' : ''}${next && weekdayOf(next) === i ? ' next' : ''}`} aria-hidden="true">
                {l}
              </i>
            ))}
          </span>
          <span className="tiny">
            {!on ? (
              <span className="muted">מושהית</span>
            ) : (
              <>
                {r.lastGeneratedDate === today && <span className="text-green">נפתחה היום · </span>}
                {next && (
                  <span className="muted">
                    הבאה: <b>{dayWord(next, today)}</b> · {r.time}
                  </span>
                )}
              </>
            )}
          </span>
        </div>
      </div>
      {r.priority !== 'normal' && <span className="badge">{PRIORITY_LABELS[r.priority]}</span>}
      {isCommander && (
        <label className="switch small" onClick={(e) => e.stopPropagation()} title={on ? 'פעילה - לחיצה משהה' : 'מושהית - לחיצה מפעילה'}>
          <input type="checkbox" role="switch" checked={on} onChange={() => void toggle()} />
          <span className="switch-track" aria-hidden="true" />
          <span className="sr-only">פעילה: {r.title}</span>
        </label>
      )}
      {menu.menu}
    </BulkRow>
  );
}

function RuleEditor({ rule, from, onClose }: { rule: RecurringRule | null; from?: RecurringRule; onClose: () => void }) {
  const { users, settings } = useSession();
  const toast = useToast();
  // a copy starts from another rule's values, as a new one
  const base = rule ?? from;
  const [title, setTitle] = useState(rule?.title ?? (from ? `${from.title} (עותק)` : ''));
  const [description, setDescription] = useState(base?.description ?? '');
  const [frequency, setFrequency] = useState<'daily' | 'weekly'>(base?.frequency ?? 'daily');
  const [weekdays, setWeekdays] = useState<number[]>(base?.weekdays.length ? base.weekdays : [0]);
  const [time, setTime] = useState(base?.time ?? '20:00');
  const [assignee, setAssignee] = useState(base?.assignee ?? 'week_lead');
  const [priority, setPriority] = useState<Priority>(base?.priority ?? 'normal');
  const [domain, setDomain] = useState(base?.domain ?? '');
  const [error, setError] = useState<string | null>(null);

  const applyPreset = (p: (typeof PRESETS)[number]) => {
    setTitle(p.title);
    setDescription(p.description);
    setFrequency(p.frequency);
    setWeekdays(p.weekdays.length ? p.weekdays : [0]);
    setTime(p.time);
    setAssignee(p.assignee);
    setPriority(p.priority);
    setDomain(p.domain);
  };

  const save = async () => {
    setError(null);
    const body = { title, description, frequency, weekdays: frequency === 'weekly' ? weekdays : [], time, assignee, priority, domain, active: rule?.active ?? true };
    try {
      if (rule) await api.put(`/api/recurring/${rule.id}`, body);
      else await api.post('/api/recurring', body);
      toast({ title: 'המשימה החוזרת נשמרה', tone: 'green' });
      emitLocalChange('recurring', 'tasks');
      onClose();
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const remove = async () => {
    if (!rule || !(await ask({ title: `למחוק את "${rule.title}"?`, body: 'משימות שכבר נוצרו יישארו.', confirm: 'מחיקה', danger: true }))) return;
    await api.del(`/api/recurring/${rule.id}`);
    emitLocalChange('recurring');
    onClose();
  };

  return (
    <Modal
      title={rule ? 'עריכת משימה חוזרת' : from ? 'שכפול משימה חוזרת' : 'משימה חוזרת חדשה'}
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-primary" onClick={() => void save()} disabled={!title.trim()}>
            שמור
          </button>
          <button className="btn btn-ghost" onClick={onClose}>
            ביטול
          </button>
          {rule && (
            <button className="btn btn-danger" style={{ marginInlineStart: 'auto' }} onClick={() => void remove()}>
              מחיקה
            </button>
          )}
        </>
      }
    >
      <div className="col gap-16">
        {!rule && !from && (
          <div>
            <div className="label-caps mb-12">התחלה מהירה</div>
            <div className="chips">
              {PRESETS.map((p) => (
                <button key={p.title} className="chip chip-sm" onClick={() => applyPreset(p)}>
                  {p.title}
                </button>
              ))}
            </div>
          </div>
        )}
        <Field label="שם המשימה" required>
          <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} />
        </Field>
        <Field label="תדירות">
          <Seg value={frequency} onChange={setFrequency} options={[{ value: 'daily', label: 'כל יום' }, { value: 'weekly', label: 'בימים מסוימים' }]} />
        </Field>
        {frequency === 'weekly' && (
          <div className="chips">
            {WEEKDAY_NAMES.map((n, i) => (
              <button key={n} className={`chip${weekdays.includes(i) ? ' on' : ''}`} onClick={() => setWeekdays(weekdays.includes(i) ? weekdays.filter((d) => d !== i) : [...weekdays, i])}>
                {n}
              </button>
            ))}
          </div>
        )}
        <div className="form-grid">
          <Field label="שעת דד-ליין">
            <TimeInput value={time} onChange={setTime} />
          </Field>
          <Field label="אחראי">
            <Select className="select" value={assignee} onChange={(e) => setAssignee(e.target.value)}>
              <option value="week_lead">מפק"צ השבוע</option>
              <option value="all">כל הסגל (עותק לכל אחד)</option>
              {users.map((u) => (
                <option key={u.id} value={String(u.id)}>
                  {u.displayName}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="עדיפות">
            <Select className="select" value={priority} onChange={(e) => setPriority(e.target.value as Priority)}>
              {PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {PRIORITY_LABELS[p]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="תחום">
            <Select className="select" value={domain} onChange={(e) => setDomain(e.target.value)}>
              <option value="">ללא</option>
              {settings.domains.map((d) => (
                <option key={d}>{d}</option>
              ))}
            </Select>
          </Field>
        </div>
        <Field label="פירוט">
          <textarea className="textarea" value={description} onChange={(e) => setDescription(e.target.value)} style={{ minHeight: 60 }} />
        </Field>
        <ErrorBox error={error} />
      </div>
    </Modal>
  );
}
