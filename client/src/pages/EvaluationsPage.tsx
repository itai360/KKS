// Evaluation files (תיקי הערכה): a living file that goes with each cadet through the course, and the
// version of it a committee receives (see server/src/evaluations.ts). Only the company commander
// and the cadet's team commander open it.

import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import {
  CADET_STATUS_LABELS,
  CADET_STATUS_TONES,
  COMMITTEE_DECISION_LABELS,
  COMMITTEE_DECISIONS,
  COMMITTEE_KINDS,
  DISCIPLINE_NOTE_LIMIT,
  STANDING_LABELS,
  STANDING_TONES,
  type CommitteeDecision,
} from '@shared/constants';
import { shortDate } from '@shared/dates';
import type { Committee, CommitteeDetail, EvaluationFile, EvaluationListItem, Team } from '@shared/types';
import { NoteDots, NotesBadge, noteTone, timeLabel } from '../components/Discipline';
import { FileDocument, HistoryDialog, LiveFile } from '../components/EvaluationFile';
import { GradesImport } from '../components/GradesImport';
import { Icon } from '../components/Icon';
import { useToast } from '../components/Toasts';
import { DateInput, Empty, ErrorBox, Field, initials, Loading, Modal, PageError, PageHead } from '../components/ui';
import { api } from '../lib/api';
import { saveCsv } from '../lib/csv';
import { fmtAgo, fmtDateTime } from '../lib/format';
import { emitLocalChange } from '../lib/realtime';
import { useSession } from '../lib/session';
import { useApi } from '../lib/useApi';
import { matchesSearch } from '@shared/search';
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
  const { isCommander } = useSession();
  const list = useApi<EvaluationListItem[]>('/api/evaluations', ['cadets']);
  const teams = useApi<Team[]>('/api/teams', ['cadets']);
  const navigate = useNavigate();

  const set = (k: string, v: string) => {
    const next = new URLSearchParams(params);
    if (v) next.set(k, v);
    else next.delete(k);
    setParams(next, { replace: true });
  };

  const all = list.data ?? [];
  const shown = all.filter(
    (c) =>
      (!team || String(c.teamId ?? '') === team) &&
      matchesSearch(q, c.fullName, c.personalNumber) &&
      (view === 'watch' ? c.standing !== 'ok' : view === 'committee' ? !!c.committee && !c.committee.decision : view === 'reason' ? c.hasCommitteeReason : view === 'nosummary' ? !c.hasSummary : true),
  );
  const grouped = useMemo(() => {
    const map = new Map<string, EvaluationListItem[]>();
    for (const c of shown) map.set(c.teamName ?? 'ללא צוות', [...(map.get(c.teamName ?? 'ללא צוות') ?? []), c]);
    return [...map.entries()];
  }, [shown]);
  const myTeams = (teams.data ?? []).filter((t) => all.some((c) => c.teamId === t.id));

  return (
    <div className="page">
      <PageHead
        title="תיקי הערכה"
        sub={'תיק חי שמלווה כל צוער לאורך הקורס - פתוח למ"פ ולמפק"צ האחראי על הצוער בלבד. אפשר להשלים ולעדכן כל סעיף בכל שלב.'}
        actions={
          <>
          {isCommander && (
            <button className="btn btn-primary" onClick={() => set('import', '1')}>
              <Icon name="upload" /> ייבוא ציונים
            </button>
          )}
          <button
            className="btn"
            title="ייצוא הרשימה המסוננת לאקסל"
            disabled={!shown.length}
            onClick={() =>
              void saveCsv(
                'תיקי-הערכה',
                ['שם מלא', 'מספר אישי', 'צוות', 'מצב', 'התייחסויות', 'נקודות קריטיות', 'ציונים שהוזנו', 'דינמיקה אחרונה - ציון', 'דינמיקה אחרונה - מיקום', 'סיכום מ"פ', 'הערות משמעת', 'עודכן לאחרונה', 'ועדה'],
                shown.map((c) => [
                  c.fullName,
                  c.personalNumber,
                  c.teamName ?? '',
                  STANDING_LABELS[c.standing],
                  c.notes,
                  c.points,
                  `${c.exams}/${c.examsTotal}`,
                  c.lastDynamics?.score ?? '',
                  c.lastDynamics?.rank ?? '',
                  c.hasSummary ? 'נכתב' : '',
                  c.disciplineNotes,
                  c.updatedAt ? `${fmtDateTime(c.updatedAt)}${c.updatedByName ? ` (${c.updatedByName})` : ''}` : '',
                  c.committee ? (c.committee.decision ? COMMITTEE_DECISION_LABELS[c.committee.decision] : 'ממתינה') : '',
                ]),
              )
            }
          >
            <Icon name="download" /> ייצוא
          </button>
          </>
        }
      />
      {isCommander && params.get('import') === '1' && <GradesImport onClose={() => set('import', '')} />}
      {myTeams.length > 1 && (
        <div className="chips chips-scroll mb-12">
          <button className={`chip${!team ? ' on' : ''}`} onClick={() => set('team', '')}>
            כל הצוותים
          </button>
          {myTeams.map((t) => (
            <button key={t.id} className={`chip${team === String(t.id) ? ' on' : ''}`} onClick={() => set('team', String(t.id))}>
              {t.name}
            </button>
          ))}
        </div>
      )}
      <div className="filters">
        <input className="input" placeholder="חיפוש לפי שם או מספר אישי" value={q} onChange={(e) => setQ(e.target.value)} />
        <select className="select" value={view} onChange={(e) => set('view', e.target.value)} aria-label="תצוגה">
          <option value="">כל הצוערים</option>
          <option value="committee">בדרך לוועדה ({all.filter((c) => c.committee && !c.committee.decision).length})</option>
          <option value="nosummary">בלי סיכום מ"פ ({all.filter((c) => !c.hasSummary).length})</option>
          <option value="watch">במעקב ובסיכון ({all.filter((c) => c.standing !== 'ok').length})</option>
          <option value="reason">עם סיבת העלאה לוועדה ({all.filter((c) => c.hasCommitteeReason).length})</option>
        </select>
      </div>
      <ErrorBox error={list.error} />
      {list.loading && !list.data ? (
        <Loading rows={4} />
      ) : !all.length ? (
        <Empty icon="folder" title={isCommander ? 'אין צוערים עדיין' : 'אין צוערים באחריותך'} text={isCommander ? 'צוערים מופיעים כאן אחרי שמוסיפים אותם בעמוד הצוערים.' : 'תיק הערכה פתוח למ"פ ולמפק"צ האחראי על הצוער. כשצוות ישויך אליך, תיקי הצוערים שלו יופיעו כאן.'} />
      ) : !shown.length ? (
        <Empty icon="search" title="אין צוערים להצגה" text="נסו חיפוש או תצוגה אחרים." />
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
                      {c.notes} התייחסויות · {c.exams}/{c.examsTotal} ציונים
                      {c.lastDynamics && ` · דינמיקה ${c.lastDynamics.score}/5, מקום ${c.lastDynamics.rank}`}
                      {c.updatedAt && <span className="hide-mobile"> · עודכן {fmtAgo(c.updatedAt)}</span>}
                    </div>
                  </div>
                  {c.status !== 'active' && <span className={`badge t-${CADET_STATUS_TONES[c.status]}`}>{CADET_STATUS_LABELS[c.status]}</span>}
                  <NotesBadge count={c.disciplineNotes} />
                  {c.points > 0 && <span className="badge t-red hide-mobile">{c.points} נקודות קריטיות</span>}
                  {c.committee && (
                    <span className={`badge ${c.committee.decision ? 't-gray' : 't-purple'}`}>
                      {c.committee.kind}
                      {c.committee.decision ? `: ${COMMITTEE_DECISION_LABELS[c.committee.decision]}` : ''}
                    </span>
                  )}
                  <span className={`badge t-${STANDING_TONES[c.standing]}`}>{STANDING_LABELS[c.standing]}</span>
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
  const [dialog, setDialog] = useState<null | 'refer' | { decide: Committee } | { history: number | undefined }>(null);
  const [printing, setPrinting] = useState(false);
  const toast = useToast();
  const [actionError, setActionError] = useState<string | null>(null);

  // printing shows the file as a document, then goes back to the living one
  useEffect(() => {
    if (!printing) return;
    const done = () => setPrinting(false);
    window.addEventListener('afterprint', done, { once: true });
    const t = setTimeout(() => window.print(), 50);
    return () => {
      clearTimeout(t);
      window.removeEventListener('afterprint', done);
    };
  }, [printing]);

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
        sub={[c.personalNumber && `מ.א. ${c.personalNumber}`, data.teamCommanderName && `מפק"צ: ${data.teamCommanderName}`, CADET_STATUS_LABELS[c.status]].filter(Boolean).join(' · ')}
        actions={
          <>
            <Link className="btn" to={`/cadets/${c.id}`}>
              <Icon name="shield" /> תיק הצוער
            </Link>
            <button className="btn" onClick={() => setDialog({ history: undefined })}>
              <Icon name="history" /> היסטוריית שינויים
            </button>
            <button className="btn" onClick={() => setPrinting(true)}>
              <Icon name="print" /> הדפסה
            </button>
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
            <div className="small muted">הוועדה תקבל את התיק כפי שנשמר ב-{fmtDateTime(pending.snapshotAt)}. מה שנוסף מאז ייכנס רק אם מעדכנים את הגרסה.</div>
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
      <div className="split eval-split">
        {printing ? <FileDocument file={data} /> : <LiveFile file={data} setFile={setData} onHistory={(itemId) => setDialog({ history: itemId })} />}
        <ContextColumn file={data} />
      </div>
      {dialog === 'refer' && <ReferDialog cadetId={c.id} name={c.fullName} reasonInFile={data.committeeReason} onClose={() => setDialog(null)} onDone={setData} />}
      {dialog && typeof dialog === 'object' && 'decide' in dialog && <DecisionDialog committee={dialog.decide} name={c.fullName} onClose={() => setDialog(null)} onDone={setData} />}
      {dialog && typeof dialog === 'object' && 'history' in dialog && <HistoryDialog cadetId={c.id} itemId={dialog.history} onClose={() => setDialog(null)} />}
    </div>
  );
}

/** beside the file: what the cadet file already holds */
function ContextColumn({ file, readOnly = false }: { file: EvaluationFile; readOnly?: boolean }) {
  return (
    <div className="col gap-16 sticky-side eval-context">
      <div className="label-caps">מתיק הצוער</div>
      <DisciplineCard file={file} />
      <SideCard title="שיחות אישיות" empty="אין שיחות מתועדות." items={file.talks.map((r) => `${dateLabel(r.occurredOn)} · ${r.category || r.title || 'שיחה'}${r.authorName ? ` (${r.authorName})` : ''}`)} />
      <SideCard title="הערכות לפי קריטריון" empty="אין הערכות בציון בתיק הצוער." items={file.scores.map((s) => `${s.criterion}: ${s.average.toFixed(1)} (${s.count})`)} />
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
  );
}

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

function ReferDialog({ cadetId, name, reasonInFile, onClose, onDone }: { cadetId: number; name: string; reasonInFile: string; onClose: () => void; onDone: (f: EvaluationFile) => void }) {
  const toast = useToast();
  const [kind, setKind] = useState<string>(COMMITTEE_KINDS[0]);
  // the reason written in the file (section 6), to adjust if needed
  const [reason, setReason] = useState(reasonInFile.slice(0, 2000));
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
          <DateInput value={meetingDate} onChange={(v) => setMeetingDate(v)} style={{ maxWidth: 200 }} />
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
        sub={[file.cadet.personalNumber && `מ.א. ${file.cadet.personalNumber}`, file.cadet.teamName, file.teamCommanderName && `מפק"צ: ${file.teamCommanderName}`].filter(Boolean).join(' · ')}
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
      <div className="split eval-split">
        <FileDocument file={file} />
        <ContextColumn file={file} readOnly />
      </div>
    </div>
  );
}
