// Personal talks filled in as forms (shared/talks.ts): the form, the talk as it shows in the
// cadet's file, and what to keep in mind about the cadet from the latest talks.

import { useState } from 'react';
import { Link } from 'react-router';
import { TALK_COURSE_ORDER, TALK_TYPES } from '@shared/constants';
import { addDays, shortDate } from '@shared/dates';
import { numberedSections, TALK_FORMS, TALK_HIGHLIGHTS, type TalkAnswers, type TalkType } from '@shared/talks';
import type { Cadet, CadetDetail, CadetRecord } from '@shared/types';
import { api } from '../lib/api';
import { useDraft } from '../lib/draft';
import { isoAt, todayKey } from '../lib/format';
import { emitLocalChange } from '../lib/realtime';
import { useSession } from '../lib/session';
import { Icon } from './Icon';
import { useToast } from './Toasts';
import { DateInput, ErrorBox, Field, Modal, Select } from './ui';

const asType = (s: string): TalkType => ((TALK_TYPES as readonly string[]).includes(s) ? (s as TalkType) : 'שיחה יזומה');
const byDate = (a: CadetRecord, b: CadetRecord) => b.occurredOn.localeCompare(a.occurredOn) || b.id - a.id;

/** the talks filled in as forms, newest first */
export const formTalks = (records: CadetRecord[]) => records.filter((r) => r.kind === 'talk' && r.talk).sort(byDate);

/** the newest answer to each of the things worth remembering */
function highlights(talks: CadetRecord[]): { label: string; value: string; from: CadetRecord }[] {
  const out: { label: string; value: string; from: CadetRecord }[] = [];
  for (const h of TALK_HIGHLIGHTS) {
    for (const t of talks) {
      const id = h.ids.find((i) => t.talk?.[i]);
      if (id) {
        out.push({ label: h.label, value: t.talk![id], from: t });
        break;
      }
    }
  }
  return out;
}

/** which talk comes next: the first meeting, then the mid-course one, then as needed */
function nextType(talks: CadetRecord[]): TalkType {
  const done = new Set(talks.map((t) => t.category));
  if (!done.has('שיחת היכרות')) return 'שיחת היכרות';
  if (!done.has('שיחת אמצע')) return 'שיחת אמצע';
  return 'שיחת משוב';
}

interface Draft {
  type: TalkType;
  date: string;
  answers: TalkAnswers;
}

export function TalkDialog({ cadet, records, record, onClose }: { cadet: Cadet; records: CadetRecord[]; record?: CadetRecord; onClose: () => void }) {
  const toast = useToast();
  const { user, settings } = useSession();
  const talks = formTalks(records).filter((t) => t.id !== record?.id);
  // a new talk is kept as typed until saved, in this tab only
  const [stored, setStored] = useDraft(`talk:${cadet.id}`);
  const initial: Draft = record
    ? { type: asType(record.category), date: record.occurredOn, answers: record.talk ?? {} }
    : (() => {
        try {
          const d = JSON.parse(stored) as Draft;
          if (d && d.answers) return { type: asType(d.type), date: d.date || todayKey(), answers: d.answers };
        } catch {
          /* nothing kept */
        }
        return { type: nextType(talks), date: todayKey(), answers: {} };
      })();
  const [draft, setDraftState] = useState<Draft>(initial);
  const [withTask, setWithTask] = useState(false);
  // a follow-up comes some days after the talk, not the same evening
  const [taskDate, setTaskDate] = useState(() => addDays(todayKey(), 7));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const update = (d: Draft) => {
    setDraftState(d);
    if (!record) setStored(Object.values(d.answers).some((v) => v.trim()) ? JSON.stringify(d) : '');
  };
  const answer = (id: string, value: string) => update({ ...draft, answers: { ...draft.answers, [id]: value } });
  const last = talks[0];
  const filled = Object.values(draft.answers).some((v) => v.trim());

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      if (record) await api.patch<CadetDetail>(`/api/records/${record.id}`, { category: draft.type, occurredOn: draft.date, answers: draft.answers });
      else
        await api.post<CadetDetail>(`/api/cadets/${cadet.id}/records`, {
            kind: 'talk',
            category: draft.type,
            occurredOn: draft.date,
            answers: draft.answers,
            followUpTask: withTask ? { title: (draft.answers.next?.trim() || `המשך ${draft.type}: ${cadet.fullName}`).slice(0, 200), deadline: isoAt(taskDate, settings.defaultDeadlineTime), ownerId: user.id } : undefined,
          });
      if (!record) setStored('');
      toast({ title: record ? 'השיחה עודכנה' : `${draft.type} נשמרה בתיק`, tone: 'green' });
      emitLocalChange('cadets', 'tasks');
      onClose();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <Modal
      wide
      title={`${record ? 'עריכת' : ''} ${draft.type} - ${cadet.fullName}`.trim()}
      onClose={onClose}
      footer={
        <>
          <span className="grow small muted">{record ? '' : 'מה שהוקלד נשמר עד השמירה, גם אם החלון נסגר.'}</span>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            ביטול
          </button>
          <button type="button" className="btn btn-primary" disabled={busy || !filled} onClick={() => void save()}>
            {busy ? 'שומר...' : 'שמירה בתיק'}
          </button>
        </>
      }
    >
      <div className="col gap-16 talk-form">
        <div className="row wrap gap-12">
          <Field label="סוג השיחה" className="grow">
            <Select className="input" value={draft.type} onChange={(e) => update({ ...draft, type: asType(e.target.value) })}>
              {TALK_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="תאריך השיחה">
            <DateInput value={draft.date} max={todayKey()} onChange={(v) => update({ ...draft, date: v })} />
          </Field>
        </div>
        <div className="talk-who small muted">
          <b>{cadet.fullName}</b> · {cadet.teamName ?? 'ללא צוות'} · השיחה גלויה רק לך, למפקד הצוות ולמפקד הקורס
        </div>

        {last && (last.talk?.focus || last.talk?.next) && (
          <div className="info-box small talk-last">
            <b>
              מהשיחה הקודמת ({last.category}, {shortDate(last.occurredOn)}):
            </b>
            {last.talk?.focus && <div>נושא למעקב: {last.talk.focus}</div>}
            {last.talk?.next && <div>פעולת המשך: {last.talk.next}</div>}
          </div>
        )}

        {numberedSections(draft.type).map(({ section, number }) => (
          <fieldset key={section.id} className={`talk-section${section.id === 'after' ? ' after' : ''}`}>
            <legend>
              {number ? `${number}. ` : ''}
              {section.title}
            </legend>
            {section.fields.length === 1 ? (
              <textarea className="textarea" rows={section.id === 'summary' ? 3 : 2} value={draft.answers[section.fields[0].id] ?? ''} placeholder={section.fields[0].hint} aria-label={section.title} onChange={(e) => answer(section.fields[0].id, e.target.value)} />
            ) : (
              section.fields.map((f) => (
                <Field key={f.id} label={f.label}>
                  <textarea className="textarea" rows={section.id === 'after' ? 1 : 2} value={draft.answers[f.id] ?? ''} placeholder={f.hint} onChange={(e) => answer(f.id, e.target.value)} />
                </Field>
              ))
            )}
          </fieldset>
        ))}

        {!record && (
          <div className="row wrap gap-12">
            <label className="check">
              <input type="checkbox" checked={withTask} onChange={(e) => setWithTask(e.target.checked)} />
              לפתוח לי משימת המשך
            </label>
            {withTask && <DateInput value={taskDate} min={todayKey()} onChange={(v) => setTaskDate(v)} aria-label="מועד משימת ההמשך" style={{ maxWidth: 180 }} />}
            {withTask && <span className="tiny muted">המשימה פרטית, כמו השיחה{draft.answers.next?.trim() ? `: "${draft.answers.next.trim().slice(0, 60)}"` : ''}</span>}
          </div>
        )}
        <ErrorBox error={error} />
      </div>
    </Modal>
  );
}

/** a talk in the cadet's file: the note written right after it, and the whole talk on request */
export function TalkView({ record, cadet, records }: { record: CadetRecord; cadet: Cadet; records: CadetRecord[] }) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const answers = record.talk ?? {};
  const type = asType(record.category);
  const quick = TALK_FORMS[type].find((s) => s.id === 'after')?.fields.filter((f) => answers[f.id]) ?? [];
  return (
    <div className="talk-view mt-8">
      {quick.length > 0 && (
        <dl className="talk-quick">
          {quick.map((f) => (
            <div key={f.id}>
              <dt>{f.label}</dt>
              <dd>{answers[f.id]}</dd>
            </div>
          ))}
        </dl>
      )}
      {open && (
        <div className="talk-full">
          {numberedSections(type)
            .filter(({ section }) => section.id !== 'after' && section.fields.some((f) => answers[f.id]))
            .map(({ section, number }) => (
              <div key={section.id}>
                <div className="strong small">
                  {number ? `${number}. ` : ''}
                  {section.title}
                </div>
                {section.fields.length === 1 ? (
                  <p>{answers[section.fields[0].id]}</p>
                ) : (
                  <ul>
                    {section.fields
                      .filter((f) => answers[f.id])
                      .map((f) => (
                        <li key={f.id}>
                          <b>{f.label}:</b> {answers[f.id]}
                        </li>
                      ))}
                  </ul>
                )}
              </div>
            ))}
        </div>
      )}
      <div className="row wrap gap-6 mt-8">
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setOpen(!open)} aria-expanded={open}>
          <Icon name={open ? 'chevronDown' : 'chevronLeft'} size={14} /> {open ? 'הסתרת השיחה המלאה' : 'השיחה המלאה'}
        </button>
        {record.canEdit && (
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditing(true)}>
            <Icon name="edit" size={14} /> השלמה ועריכה
          </button>
        )}
        <Link className="btn btn-ghost btn-sm" to={`/cadets/${cadet.id}/talks/${record.id}`}>
          <Icon name="print" size={14} /> להדפסה
        </Link>
      </div>
      {editing && <TalkDialog cadet={cadet} records={records} record={record} onClose={() => setEditing(false)} />}
    </div>
  );
}

/** what to keep in mind about the cadet before meeting them, and which talks were held */
export function TalkHighlights({ cadet, records, onNew }: { cadet: Cadet; records: CadetRecord[]; onNew?: () => void }) {
  const talks = formTalks(records);
  const all = records.filter((r) => r.kind === 'talk');
  const keep = highlights(talks);
  return (
    <div className="card talk-card">
      <div className="card-head">
        <Icon name="message" />
        <h3 className="grow">שיחות אישיות</h3>
        {onNew && (
          <button className="btn btn-sm btn-primary" onClick={onNew}>
            <Icon name="plus" size={14} /> שיחה
          </button>
        )}
      </div>
      <div className="card-body col gap-12">
        {keep.length > 0 ? (
          <dl className="talk-quick">
            {keep.map((h) => (
              <div key={h.label}>
                <dt>{h.label}</dt>
                <dd>{h.value}</dd>
              </div>
            ))}
          </dl>
        ) : (
          <p className="small muted" style={{ margin: 0 }}>
            עוד לא נרשמה שיחה אישית. אחרי השיחה, מה שחשוב לזכור על {cadet.firstName} יופיע כאן.
          </p>
        )}
        <div className="talk-done" aria-label="השיחות שנערכו">
          {TALK_COURSE_ORDER.map((t) => {
            const held = all.filter((r) => r.category === t).sort(byDate)[0];
            return (
              <span key={t} className={`badge${held ? ' t-green' : ''}`}>
                {held && <Icon name="check" size={11} />} {t}
                {held && <span className="mono"> {shortDate(held.occurredOn)}</span>}
              </span>
            );
          })}
        </div>
      </div>
    </div>
  );
}
