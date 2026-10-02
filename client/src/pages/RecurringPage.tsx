// Section 15 - recurring tasks: every day, every Sunday, every evening, end of week.

import { useState } from 'react';
import { useSearchParams } from 'react-router';
import { PRIORITIES, PRIORITY_LABELS, WEEKDAY_NAMES, type Priority } from '@shared/constants';
import type { RecurringRule } from '@shared/types';
import { BulkCheck, BulkRow, BulkScope, BulkToggle } from '../components/Bulk';
import { Icon } from '../components/Icon';
import { useToast } from '../components/Toasts';
import { Empty, ErrorBox, Field, Loading, Modal, PageHead, Seg } from '../components/ui';
import { api } from '../lib/api';
import { emitLocalChange } from '../lib/realtime';
import { useSession } from '../lib/session';
import { useApi } from '../lib/useApi';
import { ask } from '../components/Confirm';

function describe(r: Pick<RecurringRule, 'frequency' | 'weekdays' | 'time'>): string {
  if (r.frequency === 'daily') return `כל יום · ${r.time}`;
  if (r.weekdays.length === 7) return `כל יום · ${r.time}`;
  return `כל ${r.weekdays.map((d) => `יום ${WEEKDAY_NAMES[d]}`).join(', ')} · ${r.time}`;
}

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
  const [editing, setEditing] = useState<RecurringRule | 'new' | null>(params.get('new') === '1' && isCommander ? 'new' : null);

  const toggle = async (r: RecurringRule) => {
    await api.put(`/api/recurring/${r.id}`, { ...r, active: !r.active });
    emitLocalChange('recurring');
  };

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
              <button className="btn btn-primary" onClick={() => setEditing('new')}>
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
        <div className="card">
          {data.map((r) => (
            <BulkRow key={r.id} itemId={r.id} className="health" style={{ opacity: r.active ? 1 : 0.55, cursor: isCommander ? 'pointer' : 'default' }} onOpen={() => isCommander && setEditing(r)}>
              <BulkCheck id={r.id} />
              <Icon name="repeat" className="muted" size={18} />
              <div className="grow">
                <div className="strong">{r.title}</div>
                <div className="tiny muted">
                  {describe(r)} · {r.assigneeLabel}
                  {r.domain && ` · ${r.domain}`}
                </div>
              </div>
              {r.priority !== 'normal' && <span className="badge">{PRIORITY_LABELS[r.priority]}</span>}
              {isCommander && (
                <label className="check small" onClick={(e) => e.stopPropagation()}>
                  <input type="checkbox" checked={r.active} onChange={() => void toggle(r)} />
                  פעילה
                </label>
              )}
            </BulkRow>
          ))}
        </div>
      )}
      {editing && (
        <RuleEditor
          rule={editing === 'new' ? null : editing}
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

function RuleEditor({ rule, onClose }: { rule: RecurringRule | null; onClose: () => void }) {
  const { users, settings } = useSession();
  const toast = useToast();
  const [title, setTitle] = useState(rule?.title ?? '');
  const [description, setDescription] = useState(rule?.description ?? '');
  const [frequency, setFrequency] = useState<'daily' | 'weekly'>(rule?.frequency ?? 'daily');
  const [weekdays, setWeekdays] = useState<number[]>(rule?.weekdays ?? [0]);
  const [time, setTime] = useState(rule?.time ?? '20:00');
  const [assignee, setAssignee] = useState(rule?.assignee ?? 'week_lead');
  const [priority, setPriority] = useState<Priority>(rule?.priority ?? 'normal');
  const [domain, setDomain] = useState(rule?.domain ?? '');
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
      title={rule ? 'עריכת משימה חוזרת' : 'משימה חוזרת חדשה'}
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
        {!rule && (
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
            <input className="input" type="time" value={time} onChange={(e) => setTime(e.target.value)} />
          </Field>
          <Field label="אחראי">
            <select className="select" value={assignee} onChange={(e) => setAssignee(e.target.value)}>
              <option value="week_lead">מפק"צ השבוע</option>
              <option value="all">כל הסגל (עותק לכל אחד)</option>
              {users.map((u) => (
                <option key={u.id} value={String(u.id)}>
                  {u.displayName}
                </option>
              ))}
            </select>
          </Field>
          <Field label="עדיפות">
            <select className="select" value={priority} onChange={(e) => setPriority(e.target.value as Priority)}>
              {PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {PRIORITY_LABELS[p]}
                </option>
              ))}
            </select>
          </Field>
          <Field label="תחום">
            <select className="select" value={domain} onChange={(e) => setDomain(e.target.value)}>
              <option value="">ללא</option>
              {settings.domains.map((d) => (
                <option key={d}>{d}</option>
              ))}
            </select>
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
