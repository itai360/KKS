// Evaluation files (תיקי הערכה): a running assessment of each cadet, and the
// version of it a committee receives (see server/src/evaluations.ts).

import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import {
  CADET_STATUS_LABELS,
  CADET_STATUS_TONES,
  COMMITTEE_DECISION_LABELS,
  COMMITTEE_DECISIONS,
  COMMITTEE_KINDS,
  DISCIPLINE_NOTE_LIMIT,
  EVAL_CATEGORIES,
  EVAL_TONE_LABELS,
  EVAL_TONE_TONES,
  EVAL_TONES,
  STANDING_LABELS,
  STANDING_TONES,
  STANDINGS,
  type CommitteeDecision,
  type EvalTone,
  type Standing,
} from '@shared/constants';
import { shortDate } from '@shared/dates';
import type { Committee, CommitteeDetail, EvaluationEntry, EvaluationFile, EvaluationListItem, Team } from '@shared/types';
import { BulkCheck, BulkScope, BulkToggle } from '../components/Bulk';
import { NoteDots, NotesBadge, noteTone, timeLabel } from '../components/Discipline';
import { Icon } from '../components/Icon';
import { useToast } from '../components/Toasts';
import { Empty, ErrorBox, PageError, Field, Loading, Modal, PageHead, Seg, initials } from '../components/ui';
import { api } from '../lib/api';
import { saveCsv } from '../lib/csv';
import { fmtAgo, fmtDateTime, todayKey } from '../lib/format';
import { emitLocalChange } from '../lib/realtime';
import { useApi } from '../lib/useApi';
import { ask } from '../components/Confirm';

const dateLabel = (d: string) => shortDate(d);
/** "ל" before a name: "ועדת הדחה" becomes "לוועדת הדחה" */
const to = (name: string) => `ל${name.startsWith('ו') && !name.startsWith('וו') ? `ו${name}` : name}`;

// ---------------- the list ----------------

export function EvaluationsPage() {
  const [params, setParams] = useSearchParams();
  const team = params.get('team') ?? '';
  const view = params.get('view') ?? '';
  const [q, setQ] = useState('');
  const list = useApi<EvaluationListItem[]>('/api/evaluations', ['cadets']);
  const teams = useApi<Team[]>('/api/teams', ['cadets']);
  const navigate = useNavigate();

  const set = (k: string, v: string) => {
    const next = new URLSearchParams(params);
    if (v) next.set(k, v);
    else next.delete(k);
    setParams(next, { replace: true });
  };

  const shown = (list.data ?? []).filter(
    (c) =>
      (!team || String(c.teamId ?? '') === team) &&
      (!q || [c.fullName, c.personalNumber].some((f) => f.includes(q))) &&
      (view === 'watch' ? c.standing !== 'ok' : view === 'committee' ? !!c.committee && !c.committee.decision : view === 'unshown' ? c.notShown > 0 : true),
  );
  const grouped = useMemo(() => {
    const map = new Map<string, EvaluationListItem[]>();
    for (const c of shown) map.set(c.teamName ?? 'ללא צוות', [...(map.get(c.teamName ?? 'ללא צוות') ?? []), c]);
    return [...map.entries()];
  }, [shown]);
  const all = list.data ?? [];

  return (
    <div className="page">
      <PageHead
        title="תיקי הערכה"
        sub="תמונה מפורטת על כל צוער לאורך הקורס: מה טוב, מה לשפר, חריגים וחוות דעת. אם צוער עולה לוועדה - זה התיק שהוועדה מקבלת."
        actions={
          <button
            className="btn"
            title="ייצוא הרשימה המסוננת לאקסל"
            disabled={!shown.length}
            onClick={() =>
              void saveCsv(
                'תיקי-הערכה',
                ['שם מלא', 'מספר אישי', 'צוות', 'מצב', 'חיובי', 'לשיפור', 'חריג', 'לא הוצגו לצוער', 'הערות משמעת', 'רישום אחרון', 'ועדה'],
                shown.map((c) => [
                  c.fullName,
                  c.personalNumber,
                  c.teamName ?? '',
                  STANDING_LABELS[c.standing],
                  c.positive,
                  c.improve,
                  c.exception,
                  c.notShown,
                  c.disciplineNotes,
                  c.lastEntryAt ? fmtDateTime(c.lastEntryAt) : '',
                  c.committee ? (c.committee.decision ? COMMITTEE_DECISION_LABELS[c.committee.decision] : 'ממתינה') : '',
                ]),
              )
            }
          >
            <Icon name="download" /> ייצוא
          </button>
        }
      />
      <div className="chips chips-scroll mb-12">
        <button className={`chip${!team ? ' on' : ''}`} onClick={() => set('team', '')}>
          כל הצוותים
        </button>
        {(teams.data ?? []).map((t) => (
          <button key={t.id} className={`chip${team === String(t.id) ? ' on' : ''}`} onClick={() => set('team', String(t.id))}>
            {t.name}
          </button>
        ))}
      </div>
      <div className="filters">
        <input className="input" placeholder="חיפוש לפי שם או מספר אישי" value={q} onChange={(e) => setQ(e.target.value)} />
        <select className="select" value={view} onChange={(e) => set('view', e.target.value)} aria-label="תצוגה">
          <option value="">כל הצוערים</option>
          <option value="watch">במעקב ובסיכון ({all.filter((c) => c.standing !== 'ok').length})</option>
          <option value="committee">בדרך לוועדה ({all.filter((c) => c.committee && !c.committee.decision).length})</option>
          <option value="unshown">עם רישומים שלא הוצגו לצוער ({all.filter((c) => c.notShown > 0).length})</option>
        </select>
      </div>
      <ErrorBox error={list.error} />
      {list.loading && !list.data ? (
        <Loading rows={4} />
      ) : !shown.length ? (
        <Empty icon="file" title="אין צוערים להצגה" text="צוערים מופיעים כאן אחרי שמוסיפים אותם בעמוד הצוערים." />
      ) : (
        grouped.map(([teamName, rows]) => (
          <section key={teamName} className="mb-12">
            <div className="group-title">
              <span>{teamName}</span>
              <span className="n">{rows.length}</span>
              <span className="line" />
            </div>
            <div className="card">
              {rows.map((c) => (
                <div key={c.cadetId} className="health" onClick={() => navigate(`/evaluations/${c.cadetId}`)} role="link" tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && navigate(`/evaluations/${c.cadetId}`)}>
                  <div className="avatar">{initials(c.fullName)}</div>
                  <div className="grow">
                    <div className="strong">{c.fullName}</div>
                    <div className="tiny muted">
                      {c.personalNumber && <span className="mono">{c.personalNumber} · </span>}
                      {c.positive + c.improve + c.exception ? (
                        <>
                          {c.positive} לשבח · {c.improve} לשיפור · {c.exception} חריגים
                          {c.lastEntryAt && <span className="hide-mobile"> · עודכן {fmtAgo(c.lastEntryAt)}</span>}
                        </>
                      ) : c.full ? (
                        'אין רישומים עדיין'
                      ) : (
                        'אפשר להוסיף רישום'
                      )}
                    </div>
                  </div>
                  {c.status !== 'active' && <span className={`badge t-${CADET_STATUS_TONES[c.status]}`}>{CADET_STATUS_LABELS[c.status]}</span>}
                  <NotesBadge count={c.disciplineNotes} />
                  {c.notShown > 0 && <span className="badge t-orange hide-mobile">{c.notShown} לא הוצגו לצוער</span>}
                  {c.committee && (
                    <span className={`badge ${c.committee.decision ? 't-gray' : 't-purple'}`}>
                      {c.committee.kind}
                      {c.committee.decision ? `: ${COMMITTEE_DECISION_LABELS[c.committee.decision]}` : ''}
                    </span>
                  )}
                  {c.full && <span className={`badge t-${STANDING_TONES[c.standing]}`}>{STANDING_LABELS[c.standing]}</span>}
                  <Icon name="chevronLeft" size={16} className="faint" />
                </div>
              ))}
            </div>
          </section>
        ))
      )}
    </div>
  );
}

// ---------------- one cadet's file ----------------

export function EvaluationFilePage() {
  const { cadetId } = useParams();
  const { data, setData, error, loading, status } = useApi<EvaluationFile>(`/api/evaluations/${cadetId}`, ['cadets']);
  const [dialog, setDialog] = useState<null | 'refer' | { decide: Committee }>(null);
  const toast = useToast();
  const [actionError, setActionError] = useState<string | null>(null);

  if (loading && !data)
    return (
      <div className="page">
        <Loading rows={4} />
      </div>
    );
  if (!data)
    return (
      <div className="page">
        <PageError error={error} status={status} what="תיק ההערכה" back="/evaluations" backLabel="לתיקי ההערכה" />
      </div>
    );

  const c = data.cadet;
  const pending = data.committees.find((x) => !x.decision);
  const act = async (fn: () => Promise<EvaluationFile>, done?: string) => {
    setActionError(null);
    try {
      setData(await fn());
      emitLocalChange('cadets');
      if (done) toast({ title: done, tone: 'green' });
    } catch (e) {
      setActionError((e as Error).message);
    }
  };

  return (
    <div className="page">
      <PageHead
        eyebrow={
          <Link to={`/evaluations${c.teamId ? `?team=${c.teamId}` : ''}`} className="muted">
            תיקי הערכה · {c.teamName ?? 'ללא צוות'}
          </Link>
        }
        title={`תיק הערכה - ${c.fullName}`}
        sub={[c.personalNumber && `מ.א. ${c.personalNumber}`, data.teamCommanderName && `מפקד הצוות: ${data.teamCommanderName}`, CADET_STATUS_LABELS[c.status]].filter(Boolean).join(' · ')}
        actions={
          <>
            <Link className="btn" to={`/cadets/${c.id}`}>
              <Icon name="shield" /> תיק הצוער
            </Link>
            {data.full && (
              <button className="btn" onClick={() => window.print()}>
                <Icon name="print" /> הדפסה
              </button>
            )}
            {data.canRefer && !pending && (
              <button className="btn btn-primary" onClick={() => setDialog('refer')}>
                <Icon name="flag" /> העברה לוועדה
              </button>
            )}
          </>
        }
      />
      <ErrorBox error={actionError} />
      {pending && (
        <div className="info-box mb-12 row wrap gap-6 no-print">
          <Icon name="flag" />
          <div className="grow">
            <div className="strong">
              הועבר {to(pending.kind)}
              {pending.meetingDate && ` · מועד הוועדה ${dateLabel(pending.meetingDate)}`}
            </div>
            <div className="small muted">
              הוועדה תקבל את התיק כפי שנשמר ב-{fmtDateTime(pending.snapshotAt)}. מה שנוסף מאז ייכנס רק אם מעדכנים את הגרסה.
            </div>
          </div>
          <Link className="btn btn-sm" to={`/evaluations/committee/${pending.id}`}>
            הגרסה לוועדה
          </Link>
          {data.canRefer && (
            <>
              <button className="btn btn-sm" onClick={() => void act(() => api.post(`/api/evaluations/committees/${pending.id}/refresh`), 'הגרסה לוועדה עודכנה')}>
                עדכון הגרסה
              </button>
              <button className="btn btn-sm btn-primary" onClick={() => setDialog({ decide: pending })}>
                החלטת הוועדה
              </button>
              <button
                className="btn btn-sm btn-ghost"
                onClick={async () => (await ask({ title: 'לבטל את ההעברה לוועדה?', body: 'אפשר להעביר שוב בכל עת.', confirm: 'ביטול ההעברה', cancel: 'חזרה' })) && void act(() => api.del(`/api/evaluations/committees/${pending.id}`), 'ההעברה לוועדה בוטלה')}
              >
                ביטול
              </button>
            </>
          )}
        </div>
      )}
      <FileView file={data} onChange={setData} />
      {dialog === 'refer' && <ReferDialog cadetId={c.id} name={c.fullName} onClose={() => setDialog(null)} onDone={setData} />}
      {dialog && typeof dialog === 'object' && <DecisionDialog committee={dialog.decide} name={c.fullName} onClose={() => setDialog(null)} onDone={setData} />}
    </div>
  );
}

/** The file itself; read-only for the version a committee received. */
function FileView({ file, onChange, readOnly = false }: { file: EvaluationFile; onChange?: (f: EvaluationFile) => void; readOnly?: boolean }) {
  const [tone, setTone] = useState<EvalTone | 'all'>('all');
  const counts = Object.fromEntries(EVAL_TONES.map((t) => [t, file.entries.filter((e) => e.tone === t).length])) as Record<EvalTone, number>;
  const entries = file.entries.filter((e) => tone === 'all' || e.tone === tone);
  const editable = !readOnly && !!onChange;
  const unshown = file.entries.filter((e) => !e.shownOn && e.tone !== 'positive').length;

  return (
    <div className="split">
      <div className="col gap-16">
        {file.full && <Standing file={file} editable={editable && file.canEditStanding} onChange={onChange} />}
        {file.full && (
          <>
            <Opinion
              title="חוות דעת מפקד הצוות"
              field="teamOpinion"
              cadetId={file.cadet.id}
              opinion={file.teamOpinion}
              editable={editable && file.canEditStanding}
              onChange={onChange}
              placeholder="איך הצוער מתנהל בקורס: חוזקות, נקודות לשיפור, מגמה, ומה ההמלצה שלך."
            />
            <Opinion
              title="חוות דעת מפקד הקורס"
              field="commanderOpinion"
              cadetId={file.cadet.id}
              opinion={file.commanderOpinion}
              editable={editable && file.canEditCommanderOpinion}
              onChange={onChange}
              placeholder="הסיכום וההמלצה של מפקד הקורס."
            />
          </>
        )}
        {editable && <EntryForm cadetId={file.cadet.id} onChange={onChange!} />}
        <BulkScope
          entity="evaluationEntries"
          noun="רישומים"
          topics={['cadets']}
          ids={editable ? file.entries.filter((e) => e.canEdit || file.full).map((e) => e.id) : []}
          actions={[
            { key: 'shown', label: 'הוצגו לצוער היום', icon: 'check', value: true },
            { key: 'shown', label: 'ביטול סימון', value: null },
            { key: 'delete', label: 'מחיקה', icon: 'trash', danger: true, confirm: 'למחוק {n} רישומים מתיק ההערכה?' },
          ]}
        >
        <div>
          <div className="row wrap mb-12">
            <div className="section-title grow" style={{ margin: 0 }}>
              <h2 style={{ whiteSpace: 'nowrap' }}>{file.full ? 'רישומים' : 'הרישומים שלי'}</h2>
              <span className="count-pill">{file.entries.length}</span>
            </div>
            {editable && file.entries.length > 1 && (
              <span className="no-print">
                <BulkToggle />
              </span>
            )}
            <div className="chips no-print">
              <button className={`chip chip-sm${tone === 'all' ? ' on' : ''}`} onClick={() => setTone('all')}>
                הכל
              </button>
              {EVAL_TONES.filter((t) => counts[t]).map((t) => (
                <button key={t} className={`chip chip-sm${tone === t ? ' on' : ''}`} onClick={() => setTone(t)}>
                  {EVAL_TONE_LABELS[t]} {counts[t]}
                </button>
              ))}
            </div>
          </div>
          {entries.length === 0 ? (
            <Empty icon="file" title="אין רישומים" text={editable ? 'כל רישום מוסיף פירוט וצבע: מה הצוער עשה, איפה, ומה זה אומר עליו.' : undefined} />
          ) : (
            <div className="card">
              {entries.map((e) => (
                <EntryRow key={e.id} entry={e} file={file} editable={editable} onChange={onChange} />
              ))}
            </div>
          )}
        </div>
        </BulkScope>
      </div>
      {file.full && (
        <div className="col gap-16 sticky-side">
          <div className="card card-pad">
            <div className="label-caps">סיכום הרישומים</div>
            <div className="row gap-6 mt-8 wrap">
              {EVAL_TONES.map((t) => (
                <span key={t} className={`badge t-${EVAL_TONE_TONES[t]}`}>
                  {EVAL_TONE_LABELS[t]}: {counts[t]}
                </span>
              ))}
            </div>
            {unshown > 0 && (
              <p className="small text-orange mt-8">
                {unshown === 1 ? 'רישום אחד לשיפור / חריג עדיין לא סומן כמוצג לצוער.' : `${unshown} רישומים לשיפור / חריגים עדיין לא סומנו כמוצגים לצוער.`} בוועדה יש משקל לכך שהצוער ידע עליהם.
              </p>
            )}
          </div>
          <SideCard title="הערכות לפי קריטריון (מתיק הצוער)" empty="אין הערכות בציון בתיק הצוער." items={file.scores.map((s) => `${s.criterion}: ${s.average.toFixed(1)} (${s.count})`)} />
          <DisciplineCard file={file} />
          <SideCard title="שיחות אישיות (מתיק הצוער)" empty="אין שיחות מתועדות." items={file.talks.map((r) => `${dateLabel(r.occurredOn)} · ${r.title || 'שיחה'}${r.authorName ? ` (${r.authorName})` : ''}`)} />
          <SideCard
            title="התנסויות"
            empty="אין התנסויות שהסתיימו."
            items={file.experiences.map((x) => `${x.role} · ${dateLabel(x.startDate)}${x.score !== null ? ` · ציון ${x.score}` : ''}${x.strengths ? ` · חוזקות: ${x.strengths.slice(0, 60)}` : ''}`)}
          />
          {file.committees.length > 0 && (
            <div className="card">
              <div className="card-head">
                <Icon name="flag" />
                <h3 className="grow">ועדות</h3>
              </div>
              <div className="card-body col gap-6">
                {file.committees.map((x) => (
                  <div key={x.id} className="small">
                    {readOnly ? (
                      <span className="strong">{x.kind}</span>
                    ) : (
                      <Link to={`/evaluations/committee/${x.id}`} className="strong">
                        {x.kind}
                      </Link>
                    )}{' '}
                    · הועבר {dateLabel(x.referredAt.slice(0, 10))}
                    {x.decision ? ` · ${COMMITTEE_DECISION_LABELS[x.decision]}` : ' · ממתין להחלטה'}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Standing({ file, editable, onChange }: { file: EvaluationFile; editable: boolean; onChange?: (f: EvaluationFile) => void }) {
  const [error, setError] = useState<string | null>(null);
  const save = async (standing: Standing) => {
    setError(null);
    try {
      onChange?.(await api.patch<EvaluationFile>(`/api/evaluations/${file.cadet.id}`, { standing }));
      emitLocalChange('cadets');
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <div className="card card-pad">
      <div className="row wrap gap-6">
        <div style={{ flex: '1 1 220px', minWidth: 0 }}>
          <div className="label-caps">מצב כללי</div>
          <div className="small muted">תקין, במעקב או בסיכון - איך הצוער עומד כרגע בקורס.</div>
        </div>
        {editable ? (
          <Seg<Standing> value={file.standing} options={STANDINGS.map((s) => ({ value: s, label: STANDING_LABELS[s] }))} onChange={(s) => void save(s)} />
        ) : (
          <span className={`badge t-${STANDING_TONES[file.standing]}`}>{STANDING_LABELS[file.standing]}</span>
        )}
      </div>
      <ErrorBox error={error} />
    </div>
  );
}

function Opinion({
  title,
  field,
  cadetId,
  opinion,
  editable,
  onChange,
  placeholder,
}: {
  title: string;
  field: 'teamOpinion' | 'commanderOpinion';
  cadetId: number;
  opinion: EvaluationFile['teamOpinion'];
  editable: boolean;
  onChange?: (f: EvaluationFile) => void;
  placeholder: string;
}) {
  const toast = useToast();
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const editing = text !== null;
  const save = async () => {
    setError(null);
    try {
      onChange?.(await api.patch<EvaluationFile>(`/api/evaluations/${cadetId}`, { [field]: text }));
      setText(null);
      emitLocalChange('cadets');
      toast({ title: 'חוות הדעת נשמרה', tone: 'green' });
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <div className="card">
      <div className="card-head">
        <h3 className="grow">{title}</h3>
        {opinion.byName && opinion.at && (
          <span className="tiny muted">
            {opinion.byName} · {fmtDateTime(opinion.at)}
          </span>
        )}
        {editable && !editing && (
          <button className="btn btn-sm no-print" onClick={() => setText(opinion.text)}>
            <Icon name="edit" /> {opinion.text ? 'עריכה' : 'כתיבה'}
          </button>
        )}
      </div>
      <div className="card-body">
        {editing ? (
          <div className="col gap-6">
            <textarea className="textarea" style={{ minHeight: 140 }} value={text} onChange={(e) => setText(e.target.value)} placeholder={placeholder} data-autofocus />
            <div className="row gap-6">
              <button className="btn btn-primary btn-sm" onClick={() => void save()}>
                שמירה
              </button>
              <button className="btn btn-ghost btn-sm" onClick={() => setText(null)}>
                ביטול
              </button>
            </div>
            <ErrorBox error={error} />
          </div>
        ) : opinion.text ? (
          <p className="small" style={{ whiteSpace: 'pre-wrap', margin: 0 }}>
            {opinion.text}
          </p>
        ) : (
          <p className="small muted" style={{ margin: 0 }}>
            עדיין לא נכתבה.
          </p>
        )}
      </div>
    </div>
  );
}

function EntryForm({ cadetId, onChange }: { cadetId: number; onChange: (f: EvaluationFile) => void }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [tone, setTone] = useState<EvalTone>('positive');
  const [category, setCategory] = useState<string>(EVAL_CATEGORIES[0]);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [occurredOn, setOccurredOn] = useState(todayKey());
  const [shown, setShown] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // the form opens at the end of the file: bring it into view (on a phone it is a screen away)
  const formRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    formRef.current?.querySelector<HTMLInputElement>('[data-autofocus]')?.focus({ preventScroll: true });
  }, [open]);

  const save = async () => {
    setError(null);
    try {
      onChange(await api.post<EvaluationFile>(`/api/evaluations/${cadetId}/entries`, { tone, category, title, body, occurredOn, shownOn: shown ? todayKey() : null }));
      emitLocalChange('cadets');
      toast({ title: 'הרישום נוסף לתיק ההערכה', tone: 'green' });
      setTitle('');
      setBody('');
      setShown(false);
      setOpen(false);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  if (!open)
    return (
      <button className="btn btn-primary no-print" style={{ alignSelf: 'flex-start' }} onClick={() => setOpen(true)}>
        <Icon name="plus" /> רישום חדש
      </button>
    );
  return (
    <div ref={formRef} className="card card-pad col gap-12 no-print" style={{ scrollMarginTop: 'calc(var(--top-h) + 12px)' }}>
      <div className="row wrap gap-6">
        <Seg<EvalTone> value={tone} options={EVAL_TONES.map((t) => ({ value: t, label: EVAL_TONE_LABELS[t] }))} onChange={setTone} />
        <select className="select" value={category} onChange={(e) => setCategory(e.target.value)} aria-label="תחום" style={{ maxWidth: 220 }}>
          {EVAL_CATEGORIES.map((x) => (
            <option key={x}>{x}</option>
          ))}
        </select>
        <input className="input" type="date" value={occurredOn} onChange={(e) => setOccurredOn(e.target.value)} aria-label="תאריך" style={{ maxWidth: 170 }} />
      </div>
      <Field label="מה קרה, במשפט אחד" required>
        <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="לדוגמה: הוביל את הצוות בניווט הלילה" data-autofocus />
      </Field>
      <Field label="פירוט" hint="איפה ומתי, מה בדיוק עשה, ומה זה אומר על התנהלותו.">
        <textarea className="textarea" value={body} onChange={(e) => setBody(e.target.value)} />
      </Field>
      <label className="row gap-6 small">
        <input type="checkbox" checked={shown} onChange={(e) => setShown(e.target.checked)} />
        הרישום הוצג לצוער היום
      </label>
      <ErrorBox error={error} />
      <div className="row gap-6">
        <button className="btn btn-primary" disabled={!title.trim()} onClick={() => void save()}>
          הוספה לתיק
        </button>
        <button className="btn btn-ghost" onClick={() => setOpen(false)}>
          ביטול
        </button>
      </div>
    </div>
  );
}

function EntryRow({ entry: e, file, editable, onChange }: { entry: EvaluationEntry; file: EvaluationFile; editable: boolean; onChange?: (f: EvaluationFile) => void }) {
  const [error, setError] = useState<string | null>(null);
  const run = async (fn: () => Promise<EvaluationFile>) => {
    setError(null);
    try {
      onChange?.(await fn());
      emitLocalChange('cadets');
    } catch (err) {
      setError((err as Error).message);
    }
  };
  const canMarkShown = editable && (e.canEdit || file.full);
  return (
    <div className="eval-entry">
      <div className="row wrap gap-6">
        {(e.canEdit || file.full) && <BulkCheck id={e.id} />}
        <span className={`badge t-${EVAL_TONE_TONES[e.tone]}`}>{EVAL_TONE_LABELS[e.tone]}</span>
        <span className="tiny muted">{e.category}</span>
        <span className="grow" />
        <span className="tiny muted mono">{dateLabel(e.occurredOn)}</span>
      </div>
      <div className="strong mt-8">{e.title}</div>
      {e.body && (
        <p className="small" style={{ whiteSpace: 'pre-wrap', margin: '4px 0 0' }}>
          {e.body}
        </p>
      )}
      <div className="row wrap gap-6 mt-8 tiny muted">
        <span>{e.authorName}</span>
        {e.weekName && <span>· {e.weekName}</span>}
        <span>·</span>
        {e.shownOn ? (
          <span className="text-green">הוצג לצוער ב-{dateLabel(e.shownOn)}</span>
        ) : (
          <span className={e.tone === 'positive' ? '' : 'text-orange'}>טרם הוצג לצוער</span>
        )}
        <span className="grow" />
        {canMarkShown && (
          <button
            className="btn btn-ghost btn-sm no-print"
            onClick={() => void run(() => api.post(`/api/evaluations/entries/${e.id}/shown`, { shownOn: e.shownOn ? null : todayKey() }))}
          >
            {e.shownOn ? 'ביטול הסימון' : 'הוצג לצוער היום'}
          </button>
        )}
        {editable && e.canEdit && (
          <button className="btn btn-ghost btn-sm text-red no-print" onClick={async () => (await ask({ title: 'למחוק את הרישום מתיק ההערכה?', confirm: 'מחיקה', danger: true })) && void run(() => api.del(`/api/evaluations/entries/${e.id}`))}>
            מחיקה
          </button>
        )}
      </div>
      <ErrorBox error={error} />
    </div>
  );
}

/** Discipline from the cadet file, with the discipline notes counted toward dismissal. */
function DisciplineCard({ file }: { file: EvaluationFile }) {
  // a committee's copy from before discipline notes has no such field
  const notes = file.discipline.filter((r) => r.formal).length;
  return (
    <div className={`card${notes ? ` discipline-card ${noteTone(notes)}` : ''}`}>
      <div className="card-head">
        <h3 className="grow">משמעת (מתיק הצוער)</h3>
        {notes > 0 && <NoteDots count={notes} />}
        <span className="mono tiny muted">{file.discipline.length}</span>
      </div>
      <div className="card-body col gap-6">
        {notes > 0 && (
          <div className="small strong">
            הערות משמעת: {notes} מתוך {DISCIPLINE_NOTE_LIMIT}
          </div>
        )}
        {file.discipline.length === 0 ? (
          <p className="small muted" style={{ margin: 0 }}>
            אין רישומי משמעת.
          </p>
        ) : (
          file.discipline.map((r) => (
            <div key={r.id} className="small">
              {r.formal && <span className="badge t-red">הערת משמעת{r.noteNumber ? ` ${r.noteNumber}` : ''}</span>} {dateLabel(r.occurredOn)}
              {r.title || r.category ? ` · ${r.title || r.category}` : ''}
              {r.occurrence ? ` (${timeLabel(r.occurrence)})` : ''}
              {r.body ? ` - ${r.body.slice(0, 80)}` : ''}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function SideCard({ title, items, empty }: { title: string; items: string[]; empty: string }) {
  return (
    <div className="card">
      <div className="card-head">
        <h3 className="grow">{title}</h3>
        <span className="mono tiny muted">{items.length}</span>
      </div>
      <div className="card-body col gap-6">
        {items.length === 0 ? (
          <p className="small muted" style={{ margin: 0 }}>
            {empty}
          </p>
        ) : (
          items.map((t, i) => (
            <div key={i} className="small">
              {t}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function ReferDialog({ cadetId, name, onClose, onDone }: { cadetId: number; name: string; onClose: () => void; onDone: (f: EvaluationFile) => void }) {
  const toast = useToast();
  const [kind, setKind] = useState<string>(COMMITTEE_KINDS[0]);
  const [reason, setReason] = useState('');
  const [meetingDate, setMeetingDate] = useState('');
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    setError(null);
    try {
      onDone(await api.post<EvaluationFile>(`/api/evaluations/${cadetId}/committees`, { kind, reason, meetingDate: meetingDate || null }));
      emitLocalChange('cadets');
      toast({ title: `${name} הועבר לוועדה`, tone: 'green' });
      onClose();
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <Modal
      title={`העברת ${name} לוועדה`}
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-primary" onClick={() => void save()}>
            העברה לוועדה
          </button>
          <button className="btn btn-ghost" onClick={onClose}>
            ביטול
          </button>
        </>
      }
    >
      <div className="col gap-12">
        <div className="info-box">תיק ההערכה, כפי שהוא עכשיו, יישמר כגרסה שהוועדה מקבלת. עד שהוועדה מחליטה אפשר לעדכן את הגרסה. מפקד הצוות יקבל הודעה.</div>
        <Field label="סוג הוועדה">
          <select className="select" value={kind} onChange={(e) => setKind(e.target.value)}>
            {COMMITTEE_KINDS.map((k) => (
              <option key={k}>{k}</option>
            ))}
          </select>
        </Field>
        <Field label="סיבת ההעברה">
          <textarea className="textarea" value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
        <Field label="מועד הוועדה (לא חובה)">
          <input className="input" type="date" value={meetingDate} onChange={(e) => setMeetingDate(e.target.value)} style={{ maxWidth: 200 }} />
        </Field>
        <ErrorBox error={error} />
      </div>
    </Modal>
  );
}

function DecisionDialog({ committee, name, onClose, onDone }: { committee: Committee; name: string; onClose: () => void; onDone: (f: EvaluationFile) => void }) {
  const toast = useToast();
  const [decision, setDecision] = useState<CommitteeDecision>('continue');
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    setError(null);
    try {
      onDone(await api.post<EvaluationFile>(`/api/evaluations/committees/${committee.id}/decision`, { decision, text }));
      emitLocalChange('cadets');
      toast({ title: 'החלטת הוועדה נרשמה', tone: 'green' });
      onClose();
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <Modal
      title={`החלטת ${committee.kind} - ${name}`}
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-primary" onClick={() => void save()}>
            רישום ההחלטה
          </button>
          <button className="btn btn-ghost" onClick={onClose}>
            ביטול
          </button>
        </>
      }
    >
      <div className="col gap-12">
        <Field label="ההחלטה">
          <select className="select" value={decision} onChange={(e) => setDecision(e.target.value as CommitteeDecision)}>
            {COMMITTEE_DECISIONS.map((d) => (
              <option key={d} value={d}>
                {COMMITTEE_DECISION_LABELS[d]}
              </option>
            ))}
          </select>
        </Field>
        {decision === 'dismissed' && <div className="info-box">הסטטוס של הצוער ישתנה ל"הודח / פרש".</div>}
        <Field label="נימוקים ותנאים">
          <textarea className="textarea" value={text} onChange={(e) => setText(e.target.value)} />
        </Field>
        <ErrorBox error={error} />
      </div>
    </Modal>
  );
}

// ---------------- the version a committee received ----------------

export function CommitteePage() {
  const { id } = useParams();
  const { data, error, loading, status } = useApi<CommitteeDetail>(`/api/evaluations/committees/${id}`, ['cadets']);
  if (loading && !data)
    return (
      <div className="page">
        <Loading rows={4} />
      </div>
    );
  if (!data)
    return (
      <div className="page">
        <PageError error={error} status={status} what="הוועדה" feminine back="/evaluations" backLabel="לתיקי ההערכה" />
      </div>
    );
  const { committee: x, file } = data;
  return (
    <div className="page">
      <PageHead
        eyebrow={
          <Link to={`/evaluations/${file.cadet.id}`} className="muted">
            תיק הערכה · {file.cadet.fullName}
          </Link>
        }
        title={`${x.kind} - ${file.cadet.fullName}`}
        sub={[file.cadet.personalNumber && `מ.א. ${file.cadet.personalNumber}`, file.cadet.teamName, file.teamCommanderName && `מפקד הצוות: ${file.teamCommanderName}`].filter(Boolean).join(' · ')}
        actions={
          <button className="btn" onClick={() => window.print()}>
            <Icon name="print" /> הדפסה
          </button>
        }
      />
      <div className="card card-pad mb-12">
        <div className="row wrap gap-16">
          <div>
            <div className="label-caps">הועבר לוועדה</div>
            <div className="small">
              {fmtDateTime(x.referredAt)}
              {x.referredByName && ` · ${x.referredByName}`}
            </div>
          </div>
          {x.meetingDate && (
            <div>
              <div className="label-caps">מועד הוועדה</div>
              <div className="small">{dateLabel(x.meetingDate)}</div>
            </div>
          )}
          <div>
            <div className="label-caps">גרסת התיק</div>
            <div className="small">נכון ל-{fmtDateTime(x.snapshotAt)}</div>
          </div>
          <div>
            <div className="label-caps">החלטה</div>
            <div className="small strong">{x.decision ? COMMITTEE_DECISION_LABELS[x.decision] : 'טרם התקבלה'}</div>
          </div>
        </div>
        {x.reason && (
          <p className="small mt-12" style={{ whiteSpace: 'pre-wrap' }}>
            <span className="strong">סיבת ההעברה: </span>
            {x.reason}
          </p>
        )}
        {x.decisionText && (
          <p className="small" style={{ whiteSpace: 'pre-wrap' }}>
            <span className="strong">נימוקי ההחלטה: </span>
            {x.decisionText}
          </p>
        )}
      </div>
      <FileView file={file} readOnly />
    </div>
  );
}
