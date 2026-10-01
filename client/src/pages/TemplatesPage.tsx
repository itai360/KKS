// Sections 16, 38, 58: templates - week opening checklists and activity workflows.

import { useState } from 'react';
import { PRIORITIES, PRIORITY_LABELS, type Priority } from '@shared/constants';
import { addDays, shortDate, weekdayName } from '@shared/dates';
import type { Template, TemplateItem } from '@shared/types';
import { Icon } from '../components/Icon';
import { useToast } from '../components/Toasts';
import { Empty, ErrorBox, Field, Loading, Modal, PageHead, Seg } from '../components/ui';
import { api } from '../lib/api';
import { todayKey } from '../lib/format';
import { emitLocalChange } from '../lib/realtime';
import { useSession } from '../lib/session';
import { useApi } from '../lib/useApi';

const KIND_LABELS: Record<Template['kind'], string> = { week: 'פתיחת שבוע', activity: 'הכנת פעילות', general: 'כללית' };

export function TemplatesPage() {
  const { isCommander, weeks, user } = useSession();
  const { data, error, loading } = useApi<Template[]>('/api/templates', ['templates']);
  const [editing, setEditing] = useState<Template | 'new' | null>(null);
  const [applying, setApplying] = useState<Template | null>(null);
  const leadsAWeek = weeks.some((w) => w.leadId === user.id);

  return (
    <div className="page">
      <PageHead
        title="תבניות"
        sub="רשימות קבועות שהופכות למשימות בלחיצה: פתיחת שבוע, הכנת פעילות, סיכום שבוע."
        actions={
          isCommander && (
            <button className="btn btn-primary" onClick={() => setEditing('new')}>
              <Icon name="plus" /> תבנית
            </button>
          )
        }
      />
      <ErrorBox error={error} />
      {loading && !data ? (
        <Loading rows={3} />
      ) : !data?.length ? (
        <Empty icon="template" title="אין תבניות" text={isCommander ? 'צרו תבנית "פתיחת שבוע" עם הסעיפים הקבועים.' : undefined} />
      ) : (
        <div className="grid-2 fade-in">
          {data.map((t) => (
            <div key={t.id} className="card">
              <div className="card-head">
                <div className="grow">
                  <h3>{t.name}</h3>
                  <div className="tiny muted">
                    {KIND_LABELS[t.kind]} · {t.items.length} סעיפים
                    {t.autoApplyDaysBefore !== null && ` · נפתחת אוטומטית ${t.autoApplyDaysBefore} ימים לפני כל שבוע`}
                  </div>
                </div>
                {(isCommander || leadsAWeek) && (
                  <button className="btn btn-sm btn-primary" onClick={() => setApplying(t)}>
                    צור משימות
                  </button>
                )}
                {isCommander && (
                  <button className="btn btn-sm btn-ghost" onClick={() => setEditing(t)} aria-label="עריכה">
                    <Icon name="edit" />
                  </button>
                )}
              </div>
              <div className="card-body">
                {t.description && <p className="small muted mb-12">{t.description}</p>}
                <div className="col gap-4">
                  {t.items.map((it, i) => (
                    <div key={i} className="row small">
                      <span className="dot t-gray" />
                      {it.stage && <span className="badge">{it.stage}</span>}
                      <span className="grow">{it.title}</span>
                      <span className="mono tiny muted">
                        {it.offsetDays === 0 ? 'ביום' : it.offsetDays < 0 ? `${-it.offsetDays} ימים לפני` : `${it.offsetDays} ימים אחרי`}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
      {editing && <TemplateEditor template={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
      {applying && <ApplyTemplate template={applying} onClose={() => setApplying(null)} />}
    </div>
  );
}

function TemplateEditor({ template, onClose }: { template: Template | null; onClose: () => void }) {
  const toast = useToast();
  const { settings, users } = useSession();
  const [name, setName] = useState(template?.name ?? '');
  const [description, setDescription] = useState(template?.description ?? '');
  const [kind, setKind] = useState<Template['kind']>(template?.kind ?? 'week');
  const [auto, setAuto] = useState<string>(template?.autoApplyDaysBefore != null ? String(template.autoApplyDaysBefore) : '');
  const [items, setItems] = useState<TemplateItem[]>(template?.items ?? [{ title: '', offsetDays: -3, owner: 'week_lead' }]);
  const [error, setError] = useState<string | null>(null);
  const upd = (i: number, patch: Partial<TemplateItem>) => setItems(items.map((x, j) => (j === i ? { ...x, ...patch } : x)));

  const save = async () => {
    setError(null);
    const body = {
      name,
      description,
      kind,
      autoApplyDaysBefore: kind === 'week' && auto !== '' ? Number(auto) : null,
      items: items.filter((i) => i.title.trim()).map((i) => ({ ...i, title: i.title.trim(), time: i.time || undefined })),
    };
    try {
      if (template) await api.put(`/api/templates/${template.id}`, body);
      else await api.post('/api/templates', body);
      toast({ title: 'התבנית נשמרה', tone: 'green' });
      emitLocalChange('templates');
      onClose();
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const remove = async () => {
    if (!template || !confirm(`למחוק את התבנית "${template.name}"?`)) return;
    await api.del(`/api/templates/${template.id}`);
    emitLocalChange('templates');
    onClose();
  };
  const anchorLabel = kind === 'activity' ? 'ימים ביחס לפעילות' : kind === 'week' ? 'ימים ביחס לתחילת השבוע' : 'ימים ביחס לתאריך';

  return (
    <Modal
      title={template ? `עריכת ${template.name}` : 'תבנית חדשה'}
      onClose={onClose}
      wide
      footer={
        <>
          <button className="btn btn-primary" onClick={() => void save()} disabled={!name.trim()}>
            שמור
          </button>
          <button className="btn btn-ghost" onClick={onClose}>
            ביטול
          </button>
          {template && (
            <button className="btn btn-danger" style={{ marginInlineStart: 'auto' }} onClick={() => void remove()}>
              מחיקה
            </button>
          )}
        </>
      }
    >
      <div className="col gap-16">
        <div className="form-grid">
          <Field label="שם התבנית" required>
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="לדוגמה: פתיחת שבוע" />
          </Field>
          <Field label="סוג">
            <Seg value={kind} onChange={setKind} options={(['week', 'activity', 'general'] as const).map((k) => ({ value: k, label: KIND_LABELS[k] }))} />
          </Field>
          <Field label="תיאור" className="span-2">
            <input className="input" value={description} onChange={(e) => setDescription(e.target.value)} />
          </Field>
          {kind === 'week' && (
            <Field label="פתיחה אוטומטית" hint="המערכת תיצור את המשימות לבד, X ימים לפני תחילת כל שבוע (השאירו ריק לפתיחה ידנית)">
              <input className="input" type="number" min={0} max={60} value={auto} onChange={(e) => setAuto(e.target.value)} placeholder="לדוגמה: 14" style={{ maxWidth: 160 }} />
            </Field>
          )}
        </div>
        <div>
          <div className="label-caps mb-12">סעיפים</div>
          <div className="col gap-6">
            {items.map((it, i) => (
              <div key={i} className="card" style={{ padding: 10 }}>
                <div className="row wrap gap-6">
                  <input className="input grow" style={{ minWidth: 200 }} value={it.title} onChange={(e) => upd(i, { title: e.target.value })} placeholder="שם הסעיף / המשימה" />
                  <input
                    className="input"
                    type="number"
                    style={{ width: 90 }}
                    value={it.offsetDays}
                    onChange={(e) => upd(i, { offsetDays: Number(e.target.value) })}
                    title={anchorLabel}
                    aria-label={anchorLabel}
                  />
                  <input className="input" type="time" style={{ width: 110 }} value={it.time ?? ''} onChange={(e) => upd(i, { time: e.target.value })} aria-label="שעה" />
                  <button className="icon-btn" aria-label="הסר סעיף" onClick={() => setItems(items.filter((_, j) => j !== i))}>
                    <Icon name="x" size={16} />
                  </button>
                </div>
                <div className="row wrap gap-6 mt-8">
                  <select className="select" style={{ width: 170, height: 34 }} value={it.owner ?? ''} onChange={(e) => upd(i, { owner: e.target.value })} aria-label="אחראי">
                    <option value="">אחראי: לבחירה בהפעלה</option>
                    {kind !== 'activity' && <option value="week_lead">מפק"צ השבוע</option>}
                    {kind === 'activity' && <option value="event_owner">אחראי הפעילות</option>}
                    {users.map((u) => (
                      <option key={u.id} value={String(u.id)}>
                        {u.displayName}
                      </option>
                    ))}
                  </select>
                  <select className="select" style={{ width: 130, height: 34 }} value={it.domain ?? ''} onChange={(e) => upd(i, { domain: e.target.value })} aria-label="תחום">
                    <option value="">תחום</option>
                    {settings.domains.map((d) => (
                      <option key={d}>{d}</option>
                    ))}
                  </select>
                  <select className="select" style={{ width: 120, height: 34 }} value={it.priority ?? 'normal'} onChange={(e) => upd(i, { priority: e.target.value as Priority })} aria-label="עדיפות">
                    {PRIORITIES.map((p) => (
                      <option key={p} value={p}>
                        {PRIORITY_LABELS[p]}
                      </option>
                    ))}
                  </select>
                  {kind === 'activity' && <input className="input" style={{ width: 130, height: 34 }} value={it.stage ?? ''} onChange={(e) => upd(i, { stage: e.target.value })} placeholder="שלב (תיאומים...)" />}
                  <span className="tiny muted">{it.offsetDays === 0 ? 'ביום עצמו' : it.offsetDays < 0 ? `${-it.offsetDays} ימים לפני` : `${it.offsetDays} ימים אחרי`}</span>
                </div>
              </div>
            ))}
            <button className="btn btn-sm" style={{ alignSelf: 'flex-start' }} onClick={() => setItems([...items, { title: '', offsetDays: items[items.length - 1]?.offsetDays ?? -1, owner: kind === 'activity' ? 'event_owner' : 'week_lead' }])}>
              <Icon name="plus" /> סעיף
            </button>
          </div>
        </div>
        <ErrorBox error={error} />
      </div>
    </Modal>
  );
}

function ApplyTemplate({ template, onClose }: { template: Template; onClose: () => void }) {
  const { weeks, isCommander, user } = useSession();
  const toast = useToast();
  const myWeeks = isCommander ? weeks : weeks.filter((w) => w.leadId === user.id);
  const upcoming = myWeeks.find((w) => w.endDate >= todayKey());
  const [weekId, setWeekId] = useState<string>(upcoming ? String(upcoming.id) : '');
  const [anchor, setAnchor] = useState(todayKey());
  const [error, setError] = useState<string | null>(null);
  const week = weeks.find((w) => String(w.id) === weekId);
  const base = week ? week.startDate : anchor;

  const apply = async () => {
    try {
      const r = await api.post<{ ids: number[] }>(`/api/templates/${template.id}/apply`, week ? { weekId: week.id } : { anchorDate: anchor });
      toast({ title: `נפתחו ${r.ids.length} משימות`, tone: 'green' });
      emitLocalChange('tasks', 'weeks');
      onClose();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <Modal
      title={`צור משימות: ${template.name}`}
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-primary" onClick={() => void apply()}>
            צור {template.items.length} משימות
          </button>
          <button className="btn btn-ghost" onClick={onClose}>
            ביטול
          </button>
        </>
      }
    >
      <div className="col gap-16">
        <Field label="לאיזה שבוע?">
          <select className="select" value={weekId} onChange={(e) => setWeekId(e.target.value)}>
            {isCommander && <option value="">ללא שבוע - לפי תאריך</option>}
            {myWeeks.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name} ({shortDate(w.startDate)})
              </option>
            ))}
          </select>
        </Field>
        {!week && (
          <Field label="תאריך עוגן">
            <input className="input" type="date" value={anchor} onChange={(e) => setAnchor(e.target.value)} style={{ maxWidth: 200 }} />
          </Field>
        )}
        <div className="col gap-4">
          {template.items.map((it, i) => (
            <div key={i} className="row small">
              <span className="grow">{it.title}</span>
              <span className="mono tiny muted">
                {weekdayName(addDays(base, it.offsetDays))} {shortDate(addDays(base, it.offsetDays))} {it.time ?? ''}
              </span>
            </div>
          ))}
        </div>
        <ErrorBox error={error} />
      </div>
    </Modal>
  );
}
