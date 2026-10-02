// Section 31 - cadets: list by team, profile with notes, personal talks,
// discipline, evaluations, development tracking and experiences.

import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import {
  CADET_STATUS_LABELS,
  CADET_STATUS_TONES,
  CADET_STATUSES,
  committeeTo,
  DISCIPLINE_COMMITTEE_KIND,
  DISCIPLINE_NOTE_LIMIT,
  DISCIPLINE_SEVERITIES,
  EVALUATION_CRITERIA,
  RECORD_KIND_LABELS,
  RECORD_KINDS,
  RESTRICTED_RECORD_KINDS,
  TALK_TYPES,
  type CadetStatus,
  type RecordKind,
} from '@shared/constants';
import { shortDate } from '@shared/dates';
import type { Cadet, CadetDetail, CadetRecord, Exemption, Team } from '@shared/types';
import { BulkCheck, bulkClick, BulkScope, BulkToggle, useBulk } from '../components/Bulk';
import { DisciplineSummary, GuideModal, NotesBadge, timeLabel, useGuide } from '../components/Discipline';
import { Icon } from '../components/Icon';
import { DateTimeInputs, useNewTask } from '../components/NewTask';
import { TaskList } from '../components/TaskRow';
import { useToast } from '../components/Toasts';
import { Empty, ErrorBox, Field, initials, Loading, Modal, openable, PageError, PageHead, Seg } from '../components/ui';
import { api, changedFields, qs } from '../lib/api';
import { saveCsv } from '../lib/csv';
import { fmtAgo, fmtDateTime, isoAt, todayKey } from '../lib/format';
import { emitLocalChange } from '../lib/realtime';
import { useSession } from '../lib/session';
import { useApi } from '../lib/useApi';
import { ExperienceCard, ExperienceForm } from './ExperiencesPage';
import { useDraft } from '../lib/draft';
import { matchesSearch } from '@shared/search';
import { ask } from '../components/Confirm';

export function CadetsPage() {
  const { isCommander, user } = useSession();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const team = params.get('team') ?? '';
  const status = params.get('status') ?? 'active';
  const notesOnly = params.get('notes') === '1';
  const [q, setQ] = useState('');
  const teams = useApi<Team[]>('/api/teams', ['cadets']);
  const cadets = useApi<Cadet[]>(`/api/cadets${qs({ team, status })}`, ['cadets']);
  const [dialog, setDialog] = useState<null | 'cadet' | 'import' | 'teams' | 'guide' | 'discipline'>(null);
  const guide = useGuide();
  const myTeams = (teams.data ?? []).filter((t) => t.commanderId === user.id);
  const canAdd = isCommander || myTeams.length > 0;

  const shown = (cadets.data ?? []).filter((c) => matchesSearch(q, c.fullName, c.personalNumber) && (!notesOnly || c.disciplineNotes > 0));
  const grouped = useMemo(() => {
    const map = new Map<string, Cadet[]>();
    for (const c of shown) map.set(c.teamName ?? 'ללא צוות', [...(map.get(c.teamName ?? 'ללא צוות') ?? []), c]);
    return [...map.entries()];
  }, [shown]);

  const set = (k: string, v: string) => {
    const next = new URLSearchParams(params);
    if (v) next.set(k, v);
    else next.delete(k);
    setParams(next, { replace: true });
  };

  return (
    <BulkScope
      entity="cadets"
      noun="צוערים"
      topics={['cadets']}
      ids={shown.map((c) => c.id)}
      actions={[
        { key: 'team', label: 'העברה לצוות', icon: 'users', ask: { title: 'העברה לצוות', label: 'צוות', options: [...(isCommander ? (teams.data ?? []) : myTeams).map((t) => ({ value: String(t.id), label: t.name })), ...(isCommander ? [{ value: '', label: 'ללא צוות' }] : [])] } },
        { key: 'status', label: 'סטטוס', ask: { title: 'שינוי סטטוס', label: 'סטטוס', options: CADET_STATUSES.map((x) => ({ value: x, label: CADET_STATUS_LABELS[x] })) } },
        { key: 'delete', label: 'מחיקה', icon: 'trash', danger: true, show: isCommander, confirm: 'למחוק {n} צוערים וכל התיקים שלהם? לסיום קורס או הדחה עדיף לשנות סטטוס.' },
      ]}
    >
    <div className="page">
      <PageHead
        title="צוערים"
        sub="רשימת צוערים לפי צוותים, הערות, שיחות אישיות, משמעת, הערכות ומעקב התפתחות."
        actions={
          <>
            {canAdd && <BulkToggle />}
            <button
              className="btn"
              title="ייצוא הרשימה המסוננת לאקסל"
              disabled={!shown.length}
              onClick={() =>
                void saveCsv(
                  'צוערים',
                  ['שם מלא', 'מספר אישי', 'צוות', 'טלפון', 'סטטוס', 'רישומים', 'ציון ממוצע', 'משמעת', 'הערות משמעת', 'שיחות', 'רישום אחרון', 'הערות'],
                  shown.map((c) => [
                    c.fullName,
                    c.personalNumber,
                    c.teamName ?? '',
                    c.phone,
                    CADET_STATUS_LABELS[c.status],
                    c.recordCount,
                    c.avgScore === null ? '' : c.avgScore.toFixed(1),
                    c.disciplineCount,
                    c.disciplineNotes,
                    c.talkCount,
                    c.lastRecordAt ? fmtDateTime(c.lastRecordAt) : '',
                    c.notes,
                  ]),
                ).catch((e: Error) => toast({ title: e.message, tone: 'red' }))
              }
            >
              <Icon name="download" /> ייצוא
            </button>
            {canAdd && (
              <button className="btn" onClick={() => setDialog('discipline')} title="רישום משמעת לצוער, בלי לפתוח את התיק">
                <Icon name="shield" /> רישום משמעת
              </button>
            )}
            {!!guide.data?.offenses.length && (
              <button className="btn" onClick={() => setDialog('guide')} title="מה עושים בכל מקרה, לפי הפעם">
                <Icon name="shield" /> מדרג אכיפה
              </button>
            )}
            {isCommander && (
              <>
                <button className="btn" onClick={() => setDialog('teams')}>
                  <Icon name="users" /> צוותים
                </button>
                <button className="btn" onClick={() => setDialog('import')}>
                  <Icon name="upload" /> ייבוא רשימה
                </button>
              </>
            )}
            {canAdd && (
              <button className="btn btn-primary" onClick={() => setDialog('cadet')}>
                <Icon name="plus" /> צוער
              </button>
            )}
          </>
        }
      />
      <div className="chips chips-scroll mb-12">
        <button className={`chip${!team ? ' on' : ''}`} onClick={() => set('team', '')}>
          כל הצוותים
        </button>
        {(teams.data ?? []).map((t) => (
          <button key={t.id} className={`chip${team === String(t.id) ? ' on' : ''}`} onClick={() => set('team', String(t.id))}>
            {t.name} <span className="mono tiny">{t.cadetCount}</span>
          </button>
        ))}
      </div>
      <div className="filters">
        <input className="input" placeholder="חיפוש לפי שם או מספר אישי" value={q} onChange={(e) => setQ(e.target.value)} />
        <select className="select" value={status} onChange={(e) => set('status', e.target.value === 'active' ? '' : e.target.value)} aria-label="סטטוס">
          {CADET_STATUSES.map((s) => (
            <option key={s} value={s}>
              {CADET_STATUS_LABELS[s]}
            </option>
          ))}
          <option value="all">הכל</option>
        </select>
        <button type="button" className={`chip${notesOnly ? ' on' : ''}`} onClick={() => set('notes', notesOnly ? '' : '1')} aria-pressed={notesOnly}>
          עם הערות משמעת
        </button>
      </div>
      <ErrorBox error={cadets.error} />
      {cadets.loading && !cadets.data ? (
        <Loading rows={4} />
      ) : !shown.length ? (
        <Empty icon="users" title="אין צוערים" text={isCommander ? 'הוסיפו צוערים אחד-אחד או הדביקו רשימה מאקסל בעזרת "ייבוא רשימה".' : undefined} />
      ) : (
        grouped.map(([teamName, list]) => {
          const t = (teams.data ?? []).find((x) => x.name === teamName);
          return (
            <section key={teamName} className="mb-12">
              <div className="group-title">
                <span>{teamName}</span>
                {t?.commanderName && <span className="tiny muted">מפקד הצוות: {t.commanderName}</span>}
                <span className="n">{list.length}</span>
                <span className="line" />
              </div>
              <CadetRows list={list} />
            </section>
          );
        })
      )}
      {dialog === 'cadet' && <CadetForm teams={isCommander ? (teams.data ?? []) : myTeams} defaultTeam={team ? Number(team) : undefined} onClose={() => setDialog(null)} />}
      {dialog === 'import' && <ImportCadets teams={teams.data ?? []} onClose={() => setDialog(null)} />}
      {dialog === 'teams' && <TeamsDialog teams={teams.data ?? []} onClose={() => setDialog(null)} />}
      {dialog === 'guide' && guide.data && <GuideModal guide={guide.data} onClose={() => setDialog(null)} />}
      {dialog === 'discipline' && <QuickDiscipline onClose={() => setDialog(null)} />}
    </div>
    </BulkScope>
  );
}

function CadetRows({ list }: { list: Cadet[] }) {
  const navigate = useNavigate();
  const bulk = useBulk();
  return (
    <div className="card">
      {list.map((c) => (
        <div key={c.id} className={`health${bulk?.selected.has(c.id) ? ' selected' : ''}`} {...openable(bulkClick(bulk, c.id, () => navigate(`/cadets/${c.id}`)))}>
          <BulkCheck id={c.id} />
          <div className="avatar">{initials(c.fullName)}</div>
          <div className="grow">
            <div className="strong">{c.fullName}</div>
            <div className="tiny muted">
              {c.personalNumber && <span className="mono">{c.personalNumber} · </span>}
              {c.recordCount ? (
                <>
                  {c.recordCount} רישומים<span className="hide-mobile"> · עודכן {fmtAgo(c.lastRecordAt!)}</span>
                </>
              ) : (
                'אין רישומים עדיין'
              )}
            </div>
          </div>
          {c.status !== 'active' && <span className={`badge t-${CADET_STATUS_TONES[c.status]}`}>{CADET_STATUS_LABELS[c.status]}</span>}
          <NotesBadge count={c.disciplineNotes} />
          {c.exemptions.length > 0 && (
            <span className="badge t-blue clip" title={`מוחרג מ: ${c.exemptions.join(', ')}`}>
              <span className="clip-text">החרגה{c.exemptions.length === 1 ? `: ${c.exemptions[0]}` : ` (${c.exemptions.length})`}</span>
            </span>
          )}
          {c.disciplineCount > 0 && <span className="badge t-orange hide-mobile">{c.disciplineCount} משמעת</span>}
          {c.talkCount > 0 && <span className="badge t-blue">{c.talkCount} שיחות</span>}
          {c.avgScore !== null && (
            <span className="mono strong" title="ממוצע הערכות (1-5)">
              {c.avgScore.toFixed(1)}
            </span>
          )}
          <Icon name="chevronLeft" size={16} className="faint" />
        </div>
      ))}
    </div>
  );
}

function CadetForm({ cadet, teams, defaultTeam, onClose }: { cadet?: Cadet; teams: Team[]; defaultTeam?: number; onClose: () => void }) {
  const toast = useToast();
  const navigate = useNavigate();
  const { isCommander } = useSession();
  const [firstName, setFirstName] = useState(cadet?.firstName ?? '');
  const [lastName, setLastName] = useState(cadet?.lastName ?? '');
  const [personalNumber, setPersonalNumber] = useState(cadet?.personalNumber ?? '');
  const [phone, setPhone] = useState(cadet?.phone ?? '');
  const [teamId, setTeamId] = useState<string>(String(cadet?.teamId ?? defaultTeam ?? teams[0]?.id ?? ''));
  const [status, setStatus] = useState<CadetStatus>(cadet?.status ?? 'active');
  const [notes, setNotes] = useState(cadet?.notes ?? '');
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    setError(null);
    const body = { firstName, lastName, personalNumber, phone, notes, status, ...(isCommander || !cadet ? { teamId: teamId ? Number(teamId) : null } : {}) };
    try {
      if (cadet) {
        const patch = changedFields<typeof body>(cadet, body);
        if (Object.keys(patch).length) await api.patch(`/api/cadets/${cadet.id}`, patch);
      } else {
        const d = await api.post<CadetDetail>('/api/cadets', body);
        navigate(`/cadets/${d.cadet.id}`);
      }
      toast({ title: 'הצוער נשמר', tone: 'green' });
      emitLocalChange('cadets');
      onClose();
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <Modal
      title={cadet ? `עריכת ${cadet.fullName}` : 'צוער חדש'}
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-primary" onClick={() => void save()} disabled={!firstName.trim()}>
            שמור
          </button>
          <button className="btn btn-ghost" onClick={onClose}>
            ביטול
          </button>
        </>
      }
    >
      <div className="form-grid">
        <Field label="שם פרטי" required>
          <input className="input" value={firstName} onChange={(e) => setFirstName(e.target.value)} />
        </Field>
        <Field label="שם משפחה">
          <input className="input" value={lastName} onChange={(e) => setLastName(e.target.value)} />
        </Field>
        <Field label="מספר אישי">
          <input className="input" dir="ltr" value={personalNumber} onChange={(e) => setPersonalNumber(e.target.value)} />
        </Field>
        <Field label="טלפון">
          <input className="input" dir="ltr" value={phone} onChange={(e) => setPhone(e.target.value)} />
        </Field>
        <Field label="צוות">
          <select className="select" value={teamId} onChange={(e) => setTeamId(e.target.value)} disabled={!!cadet && !isCommander}>
            {isCommander && <option value="">ללא צוות</option>}
            {teams.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </Field>
        {cadet && (
          <Field label="סטטוס">
            <select className="select" value={status} onChange={(e) => setStatus(e.target.value as CadetStatus)}>
              {CADET_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {CADET_STATUS_LABELS[s]}
                </option>
              ))}
            </select>
          </Field>
        )}
        <Field label="הערות כלליות (גלויות למפקד הצוות ולמפקד הקורס)" className="span-2">
          <textarea className="textarea" value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
      </div>
      <div className="mt-12">
        <ErrorBox error={error} />
      </div>
    </Modal>
  );
}

function ImportCadets({ teams, onClose }: { teams: Team[]; onClose: () => void }) {
  const toast = useToast();
  const [text, setText] = useState('');
  const [teamId, setTeamId] = useState('');
  const [link, setLink] = useState('');
  const [found, setFound] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lines = text.split('\n').filter((l) => l.trim()).length;

  // a spreadsheet fills the box; nothing is saved until "ייבא"
  const read = async (fn: () => Promise<{ text: string; sheet: string; cadets: number; teams: string[] }>) => {
    setError(null);
    setBusy(true);
    try {
      const r = await fn();
      setText(r.text);
      setFound(`נמצאו ${r.cadets} צוערים${r.teams.length ? ` ב-${r.teams.length} צוותים (${r.teams.join(', ')})` : ''} בגיליון "${r.sheet}". בדקו את הרשימה ולחצו "ייבא".`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const submit = async () => {
    setError(null);
    try {
      const r = await api.post<{ imported: number; updated: number; skipped: number }>('/api/cadets/import', { text, teamId: teamId ? Number(teamId) : null });
      const parts = [`${r.imported} חדשים`, r.updated && `${r.updated} עודכנו (צוות / מספר אישי)`, r.skipped && `${r.skipped} כבר היו ברשימה`].filter(Boolean);
      toast({ title: `ייבוא הצוערים הסתיים: ${parts.join(', ')}`, tone: 'green' });
      emitLocalChange('cadets');
      onClose();
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <Modal
      title="ייבוא רשימת צוערים"
      onClose={onClose}
      wide
      footer={
        <>
          <button className="btn btn-primary" onClick={() => void submit()} disabled={!lines || busy}>
            ייבא {lines ? lines - (/שם/.test(text.split('\n')[0] ?? '') ? 1 : 0) : ''} שורות
          </button>
          <button className="btn btn-ghost" onClick={onClose}>
            ביטול
          </button>
        </>
      }
    >
      <div className="col gap-16">
        <div className="row wrap gap-6">
          <label className="btn">
            <Icon name="upload" /> קובץ אקסל / CSV
            <input
              type="file"
              accept=".xlsx,.csv,.tsv,.txt,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = '';
                if (f) void read(() => api.upload('/api/cadets/import/file', f));
              }}
            />
          </label>
          <input className="input grow" dir={link ? 'ltr' : undefined} placeholder="או קישור ל-Google Sheets / Drive" value={link} onChange={(e) => setLink(e.target.value)} style={{ minWidth: 220 }} />
          <button className="btn" disabled={busy || link.trim().length < 10} onClick={() => void read(() => api.post('/api/cadets/import/link', { url: link }))}>
            {busy ? 'קורא...' : 'קריאה מהקישור'}
          </button>
        </div>
        {found && <div className="info-box">{found}</div>}
        <div className="info-box">
          אפשר גם להדביק רשימה או לכתוב שורה לכל צוער: <b>שם מלא, מספר אישי, טלפון, צוות</b>. רק השם חובה. עם שורת כותרות (למשל "שם פרטי", "שם משפחה", "מספר אישי", "צוות") העמודות יזוהו לפי הכותרות. צוותים שלא קיימים ייווצרו. צוער שכבר ברשימה (לפי מספר אישי) לא ייווסף שוב - הוא יעבור לצוות שברשימה. קישור ל-Google צריך להיות משותף ל"כל מי שיש לו את הקישור".
        </div>
        <Field label="שיוך כל הרשימה לצוות (לא חובה)">
          <select className="select" value={teamId} onChange={(e) => setTeamId(e.target.value)} style={{ maxWidth: 260 }}>
            <option value="">לפי עמודת הצוות ברשימה</option>
            {teams.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </Field>
        <textarea className="textarea" style={{ minHeight: 220, fontFamily: 'var(--mono)' }} value={text} onChange={(e) => setText(e.target.value)} placeholder={'דניאל כהן, 8123456, 050-1234567, צוות 1\nמאיה לוי, 8123457, , צוות 2'} data-autofocus />
        <ErrorBox error={error} />
      </div>
    </Modal>
  );
}

function TeamsDialog({ teams, onClose }: { teams: Team[]; onClose: () => void }) {
  const { staff } = useSession();
  const toast = useToast();
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const run = async (fn: () => Promise<unknown>) => {
    setError(null);
    try {
      await fn();
      emitLocalChange('cadets');
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <BulkScope entity="teams" noun="צוותים" topics={['cadets']} ids={teams.map((t) => t.id)} actions={[{ key: 'delete', label: 'מחיקה', icon: 'trash', danger: true, confirm: 'למחוק {n} צוותים? הצוערים שלהם יישארו ללא צוות.' }]}>
    <Modal title="צוותים ומפקדי צוות" onClose={onClose}>
      <div className="col gap-6">
        {teams.length > 1 && (
          <div>
            <BulkToggle label="בחירת צוותים" />
          </div>
        )}
        {teams.map((t) => (
          <div key={t.id} className="row wrap">
            <BulkCheck id={t.id} />
            <input
              className="input grow"
              defaultValue={t.name}
              onBlur={(e) => e.target.value.trim() && e.target.value !== t.name && void run(() => api.put(`/api/teams/${t.id}`, { name: e.target.value.trim(), commanderId: t.commanderId }))}
              aria-label="שם הצוות"
            />
            <select
              className="select"
              style={{ width: 180 }}
              value={t.commanderId ?? ''}
              onChange={(e) => void run(() => api.put(`/api/teams/${t.id}`, { name: t.name, commanderId: e.target.value ? Number(e.target.value) : null }))}
              aria-label="מפקד הצוות"
            >
              <option value="">מפקד צוות...</option>
              {staff.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.displayName}
                </option>
              ))}
            </select>
            <span className="tiny muted mono">{t.cadetCount}</span>
            <button
              className="icon-btn"
              aria-label="מחיקת צוות"
              onClick={async () => (await ask({ title: `למחוק את ${t.name}?`, body: 'הצוערים שבו יישארו ללא צוות.', confirm: 'מחיקה', danger: true })) && void run(() => api.del(`/api/teams/${t.id}`))}
            >
              <Icon name="trash" size={16} />
            </button>
          </div>
        ))}
        <form
          className="row mt-12"
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim()) void run(() => api.post('/api/teams', { name: name.trim() })).then(() => {
              setName('');
              toast({ title: 'הצוות נוסף', tone: 'green' });
            });
          }}
        >
          <input className="input grow" value={name} onChange={(e) => setName(e.target.value)} placeholder="צוות חדש" />
          <button className="btn" disabled={!name.trim()}>
            <Icon name="plus" /> הוסף
          </button>
        </form>
        <p className="tiny muted">מפקד הצוות רואה ומנהל את הצוערים בצוות שלו, כולל שיחות אישיות ומשמעת.</p>
        <ErrorBox error={error} />
      </div>
    </Modal>
    </BulkScope>
  );
}

// ---------------- profile ----------------

export function CadetPage() {
  const { id } = useParams();
  const { data, error, loading, status } = useApi<CadetDetail>(`/api/cadets/${id}`, ['cadets', 'tasks']);
  const teams = useApi<Team[]>('/api/teams', ['cadets']);
  const { isCommander, user } = useSession();
  const newTask = useNewTask();
  const [kind, setKind] = useState<RecordKind | 'all'>('all');
  const [dialog, setDialog] = useState<null | 'edit' | 'experience'>(null);
  const navigate = useNavigate();

  if (loading && !data)
    return (
      <div className="page">
        <Loading rows={4} />
      </div>
    );
  if (!data)
    return (
      <div className="page">
        <PageError error={error} status={status} what="הצוער" back="/cadets" backLabel="לרשימת הצוערים" />
      </div>
    );
  const c = data.cadet;
  const records = data.records.filter((r) => kind === 'all' || r.kind === kind);

  return (
    <div className="page">
      <PageHead
        eyebrow={
          <Link to={`/cadets${c.teamId ? `?team=${c.teamId}` : ''}`} className="muted">
            צוערים · {c.teamName ?? 'ללא צוות'}
          </Link>
        }
        title={
          <>
            {c.fullName} <StatusPill cadet={c} /> <NotesBadge count={c.disciplineNotes} />
          </>
        }
        docTitle={c.fullName}
        sub={[c.personalNumber && `מ.א. ${c.personalNumber}`, c.phone].filter(Boolean).join(' · ')}
        actions={
          <>
            {c.canManage && (
              <button className="btn" onClick={() => setDialog('edit')}>
                <Icon name="edit" /> עריכה
              </button>
            )}
            <Link className="btn" to={`/evaluations/${c.id}`}>
              <Icon name="folder" /> תיק הערכה
            </Link>
            {c.canManage && (
              <button className="btn" onClick={() => setDialog('experience')}>
                <Icon name="target" /> שיבוץ להתנסות
              </button>
            )}
            <button className="btn btn-primary" onClick={() => newTask({ heading: `משימה בנושא ${c.fullName}`, ownerIds: [user.id], domain: 'צוערים', description: `בנושא הצוער ${c.fullName}` })}>
              <Icon name="plus" /> משימה
            </button>
          </>
        }
      />
      <div className="split">
        <div className="col gap-16">
          <RecordForm cadet={c} records={data.records} />
          <div>
            <div className="row wrap mb-12">
              <div className="section-title grow" style={{ margin: 0 }}>
                <h2 style={{ whiteSpace: 'nowrap' }}>תיק הצוער</h2>
                <span className="count-pill">{data.records.length}</span>
              </div>
              <div className="chips">
                <button className={`chip chip-sm${kind === 'all' ? ' on' : ''}`} onClick={() => setKind('all')}>
                  הכל
                </button>
                {RECORD_KINDS.filter((k) => data.records.some((r) => r.kind === k)).map((k) => (
                  <button key={k} className={`chip chip-sm${kind === k ? ' on' : ''}`} onClick={() => setKind(k)}>
                    {RECORD_KIND_LABELS[k]}
                  </button>
                ))}
              </div>
            </div>
            {records.length === 0 ? <Empty icon="file" title="אין רישומים" text="הערות, שיחות אישיות, משמעת והערכות יופיעו כאן לפי תאריך." /> : <Records records={records} />}
          </div>
        </div>
        <div className="col gap-16 sticky-side">
          {(c.canManage || c.disciplineNotes > 0) && (
            <DisciplineSummary count={c.disciplineNotes} committee={c.notesCommittee} notes={data.records.filter((r) => r.kind === 'discipline' && r.formal).sort((a, b) => (a.noteNumber ?? 0) - (b.noteNumber ?? 0))} />
          )}
          {(c.canManage || data.exemptions.length > 0) && <ExemptionsCard cadet={c} exemptions={data.exemptions} />}
          <Development detail={data} />
          {c.notes && (
            <div className="card card-pad">
              <div className="label-caps">הערות כלליות</div>
              <p className="small mt-8" style={{ whiteSpace: 'pre-wrap' }}>
                {c.notes}
              </p>
            </div>
          )}
          <div className="card">
            <div className="card-head">
              <Icon name="target" />
              <h3 className="grow">התנסויות</h3>
              <span className="mono tiny muted">{data.experiences.length}</span>
            </div>
            <div className="card-body col gap-6">
              {data.experiences.length === 0 ? <p className="small muted">לא שובץ להתנסויות.</p> : data.experiences.map((x) => <ExperienceCard key={x.id} x={x} compact />)}
            </div>
          </div>
          <div className="card">
            <div className="card-head">
              <h3 className="grow">משימות בנושא הצוער</h3>
            </div>
            <div className="card-body">
              <TaskList tasks={data.tasks} empty={<p className="small muted">אין משימות מקושרות.</p>} />
            </div>
          </div>
          {isCommander && (
            <button
              className="btn btn-ghost btn-sm text-red"
              style={{ alignSelf: 'flex-start' }}
              onClick={async () => {
                const ok = await ask({
                  title: `למחוק את ${c.fullName}?`,
                  body: 'כל התיק שלו יימחק: רישומים, הערכות, התנסויות ותיק ההערכה. לסיום קורס או הדחה עדיף לשנות את הסטטוס - אז התיק נשמר.',
                  confirm: 'מחיקה לצמיתות',
                  danger: true,
                });
                if (ok) void api.del(`/api/cadets/${c.id}`).then(() => navigate('/cadets'));
              }}
            >
              <Icon name="trash" /> מחיקת צוער
            </button>
          )}
        </div>
      </div>
      {dialog === 'edit' && <CadetForm cadet={c} teams={teams.data ?? []} onClose={() => setDialog(null)} />}
      {dialog === 'experience' && <ExperienceForm cadetId={c.id} onClose={() => setDialog(null)} />}
    </div>
  );
}

/** The cadet's status next to the name: green while active, red when dismissed or withdrew; managers change it right there. */
function StatusPill({ cadet }: { cadet: Cadet }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const tone = `status-pill t-${CADET_STATUS_TONES[cadet.status]}`;
  if (!cadet.canManage) return <span className={tone}>{CADET_STATUS_LABELS[cadet.status]}</span>;
  const change = async (status: CadetStatus) => {
    if (
      status === 'dropped' &&
      !(await ask({ title: `לסמן את ${cadet.fullName} כ"${CADET_STATUS_LABELS.dropped}"?`, body: 'הצוער יצא מרשימת הצוערים הפעילים. התיק נשמר, ואפשר להחזיר אותו בכל עת.', confirm: 'סימון' }))
    )
      return;
    setBusy(true);
    try {
      await api.patch(`/api/cadets/${cadet.id}`, { status });
      emitLocalChange('cadets');
      toast({ title: `${cadet.fullName}: ${CADET_STATUS_LABELS[status]}`, tone: CADET_STATUS_TONES[status] });
    } catch (e) {
      toast({ title: (e as Error).message, tone: 'red' });
    } finally {
      setBusy(false);
    }
  };
  return (
    <select className={tone} value={cadet.status} disabled={busy} onChange={(e) => void change(e.target.value as CadetStatus)} aria-label="סטטוס הצוער" title="שינוי סטטוס">
      {CADET_STATUSES.map((s) => (
        <option key={s} value={s}>
          {CADET_STATUS_LABELS[s]}
        </option>
      ))}
    </select>
  );
}

const KIND_TONE: Record<RecordKind, string> = { note: 'gray', talk: 'blue', discipline: 'orange', evaluation: 'green' };

const EXEMPTION_SUBJECTS = ['דיגום', 'נשק', 'טלפונים', 'זמנים', 'כושר גופני', 'שמירות', 'תורנויות', 'אוכל'];

/**
 * What the cadet is excused from - shaving, carrying a weapon - so nobody
 * remarks on what was allowed. Every staff member sees what and until when;
 * the reason stays with the team commander and the course commander.
 */
function ExemptionsCard({ cadet, exemptions }: { cadet: Cadet; exemptions: Exemption[] }) {
  const toast = useToast();
  const guide = useGuide(cadet.canManage);
  const [adding, setAdding] = useState(false);
  const [subject, setSubject] = useState('');
  const [details, setDetails] = useState('');
  const [reason, setReason] = useState('');
  const [until, setUntil] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showPast, setShowPast] = useState(false);
  const current = exemptions.filter((x) => x.active);
  const past = exemptions.filter((x) => !x.active);
  const subjects = [...new Set([...(guide.data?.offenses.map((o) => o.category).filter(Boolean) ?? []), ...EXEMPTION_SUBJECTS])];

  const add = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.post(`/api/cadets/${cadet.id}/exemptions`, { subject, details, reason, until: until || null });
      toast({ title: 'ההחרגה נרשמה', body: 'כל הסגל קיבל עדכון', tone: 'green' });
      setAdding(false);
      setSubject('');
      setDetails('');
      setReason('');
      setUntil('');
      emitLocalChange('cadets');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const remove = async (x: Exemption) => {
    if (!(await ask({ title: `להסיר את ההחרגה "${x.subject}"?`, body: `הסגל יפסיק לראות אותה אצל ${cadet.fullName}.`, confirm: 'הסרה', danger: true }))) return;
    await api.del(`/api/exemptions/${x.id}`);
    emitLocalChange('cadets');
  };
  const row = (x: Exemption) => (
    <div key={x.id} className="exemption-row">
      <div className="grow">
        <div className="small">
          <b>{x.subject}</b>
          {x.details && ` - ${x.details}`}
        </div>
        <div className="tiny muted">
          {x.until ? `עד ${shortDate(x.until)}` : 'עד להודעה חדשה'}
          {x.reason && ` · ${x.reason}`}
          {x.createdByName && ` · ${x.createdByName}`}
        </div>
      </div>
      {x.canDelete && (
        <button className="icon-btn" style={{ width: 28, height: 28 }} aria-label={`הסרת ההחרגה ${x.subject}`} onClick={() => void remove(x)}>
          <Icon name="trash" size={14} />
        </button>
      )}
    </div>
  );

  return (
    <div className={`card${current.length ? ' t-blue exemption-card' : ''}`}>
      <div className="card-head">
        <Icon name="flag" />
        <h3 className="grow">החרגות</h3>
        {cadet.canManage && !adding && (
          <button className="btn btn-sm" onClick={() => setAdding(true)}>
            <Icon name="plus" size={14} /> החרגה
          </button>
        )}
      </div>
      <div className="card-body col gap-6">
        {current.length === 0 && !adding && <p className="small muted" style={{ margin: 0 }}>אין החרגות פעילות.</p>}
        {current.map(row)}
        {adding && (
          <div className="col gap-6">
            <Field label="ממה הצוער מוחרג" required>
              <input className="input" list="exemption-subjects" value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="לדוגמה: דיגום" data-autofocus />
              <datalist id="exemption-subjects">
                {subjects.map((s) => (
                  <option key={s} value={s} />
                ))}
              </datalist>
            </Field>
            <Field label="פירוט (גלוי לכל הסגל)">
              <input className="input" value={details} onChange={(e) => setDetails(e.target.value)} placeholder="לדוגמה: פטור גילוח" />
            </Field>
            <Field label="סיבה (רק לך ולמפקד הקורס / מפקד הצוות)">
              <input className="input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="לדוגמה: אישור רפואי" />
            </Field>
            <Field label="עד תאריך" hint="ריק - עד להודעה חדשה">
              <input className="input" type="date" value={until} min={todayKey()} onChange={(e) => setUntil(e.target.value)} />
            </Field>
            <ErrorBox error={error} />
            <div className="row gap-6">
              <button className="btn btn-primary btn-sm" disabled={busy || !subject.trim()} onClick={() => void add()}>
                שמירה ועדכון הסגל
              </button>
              <button className="btn btn-ghost btn-sm" onClick={() => setAdding(false)}>
                ביטול
              </button>
            </div>
          </div>
        )}
        {past.length > 0 && (
          <button className="btn btn-ghost btn-sm" style={{ alignSelf: 'flex-start' }} onClick={() => setShowPast(!showPast)} aria-expanded={showPast}>
            {showPast ? 'הסתרת' : 'הצגת'} החרגות שהסתיימו ({past.length})
          </button>
        )}
        {showPast && <div className="col gap-6 muted">{past.map(row)}</div>}
      </div>
    </div>
  );
}

/** Discipline in one dialog, from anywhere: find the cadet, then the record with the enforcement ladder. */
export function QuickDiscipline({ onClose }: { onClose: () => void }) {
  const cadets = useApi<Cadet[]>('/api/cadets', ['cadets']);
  const [q, setQ] = useState('');
  const [picked, setPicked] = useState<number | null>(null);
  const detail = useApi<CadetDetail>(picked ? `/api/cadets/${picked}` : null, ['cadets', 'tasks']);
  const term = q.trim();
  const mine = (cadets.data ?? []).filter((c) => c.canManage);
  const matches = mine.filter((c) => matchesSearch(term, c.fullName, c.personalNumber, c.teamName));
  const d = picked && detail.data?.cadet.id === picked ? detail.data : undefined;
  return (
    <Modal title="רישום משמעת" onClose={onClose} wide>
      {!picked ? (
        <div className="col gap-6">
          <input
            className="input"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && matches[0]) setPicked(matches[0].id);
            }}
            placeholder="שם הצוער, מספר אישי או צוות"
            aria-label="חיפוש צוער"
            data-autofocus
            data-transient
          />
          <ErrorBox error={cadets.error} />
          {cadets.loading && !cadets.data && <Loading rows={3} />}
          {cadets.data && !mine.length && <p className="small muted">אין צוערים פעילים בצוותים שלך.</p>}
          {matches.length > 0 && (
            <div className="pick-list">
              {matches.slice(0, 40).map((c) => (
                <button key={c.id} type="button" className="pick-row" onClick={() => setPicked(c.id)}>
                  <span className="avatar">{initials(c.fullName)}</span>
                  <span className="grow">
                    <span className="strong">{c.fullName}</span> <span className="tiny muted">{c.teamName ?? 'ללא צוות'}</span>
                  </span>
                  <NotesBadge count={c.disciplineNotes} />
                </button>
              ))}
            </div>
          )}
          {matches.length > 40 && <div className="tiny muted">ועוד {matches.length - 40} - אפשר לחפש לפי שם.</div>}
          {cadets.data && mine.length > 0 && !matches.length && <p className="small muted">לא נמצא צוער כזה.</p>}
        </div>
      ) : !d ? (
        <Loading rows={3} />
      ) : (
        <div className="col gap-16">
          <div className="row wrap gap-6">
            <span className="strong">{d.cadet.fullName}</span>
            <span className="tiny muted">{d.cadet.teamName ?? 'ללא צוות'}</span>
            <NotesBadge count={d.cadet.disciplineNotes} />
            <span className="grow" />
            <Link to={`/cadets/${d.cadet.id}`} className="small" onClick={onClose}>
              לתיק הצוער
            </Link>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setPicked(null)}>
              צוער אחר
            </button>
          </div>
          <RecordForm cadet={d.cadet} records={d.records} only="discipline" onSaved={onClose} />
        </div>
      )}
    </Modal>
  );
}

/** Recording in the cadet file; `only` keeps it to one kind (the quick discipline dialog). */
function RecordForm({ cadet, records, only, onSaved }: { cadet: Cadet; records: CadetRecord[]; only?: RecordKind; onSaved?: (d: CadetDetail) => void }) {
  const toast = useToast();
  const { user, users, settings, isCommander } = useSession();
  const guide = useGuide(cadet.canManage);
  const kinds = only ? [only] : RECORD_KINDS.filter((k) => cadet.canManage || !RESTRICTED_RECORD_KINDS.includes(k));
  const [kind, setKind] = useState<RecordKind>(only ?? 'note');
  const [category, setCategory] = useState('');
  const [body, setBody] = useDraft(`record:${cadet.id}`);
  const [score, setScore] = useState<number | null>(null);
  const [followUp, setFollowUp] = useState('');
  const [priv, setPriv] = useState(false);
  const [date, setDate] = useState(todayKey());
  const [withTask, setWithTask] = useState(false);
  const [taskTitle, setTaskTitle] = useState('');
  const [taskOwner, setTaskOwner] = useState(user.id);
  const [taskDate, setTaskDate] = useState(todayKey());
  const [taskTime, setTaskTime] = useState(settings.defaultDeadlineTime);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // discipline: the offense on the enforcement ladder, and whether this is a discipline note
  const [offense, setOffense] = useState('');
  // what the user chose by hand; until then both follow the ladder for the current count
  const [formalSet, setFormalSet] = useState<boolean | null>(null);
  const [letterSet, setLetterSet] = useState<number | null | undefined>(undefined);
  const offenses = guide.data?.offenses ?? [];
  const letters = guide.data?.letters ?? [];
  const chosen = offenses.find((o) => o.key === offense) ?? null;
  const prior = offense ? records.filter((r) => r.kind === 'discipline' && r.offense === offense) : [];
  const occurrence = prior.length + 1;
  /** what the ladder says for this time; past its last step, the last step */
  const stepFor = (o: typeof chosen, n: number) => (o ? (o.steps[n - 1] ?? (n > o.steps.length ? ([...o.steps].reverse().find(Boolean) ?? null) : null)) : null);
  const step = stepFor(chosen, occurrence);
  // an exemption on this subject: maybe it is allowed
  const exempted = chosen ? cadet.exemptions.find((x) => x === chosen.category || x === chosen.name || chosen.name.includes(x) || (chosen.category && x.includes(chosen.category))) : undefined;
  const beyond = !!chosen && occurrence > chosen.steps.length;
  const formal = formalSet ?? !!step?.note;
  const letter = letterSet !== undefined ? letterSet : beyond ? null : (step?.letter ?? null);
  const pickOffense = (key: string) => {
    setOffense(key);
    setFormalSet(null);
    setLetterSet(undefined);
  };
  const insertLetter = () => {
    const l = letter === null ? null : letters[letter];
    if (l) setBody(`${body.trim() ? `${body.trim()}\n\n` : ''}${l.title}\n${l.body}`);
  };
  const categories = kind === 'evaluation' ? EVALUATION_CRITERIA : kind === 'discipline' ? DISCIPLINE_SEVERITIES : kind === 'talk' ? TALK_TYPES : [];

  const reset = () => {
    setBody('');
    setScore(null);
    setFollowUp('');
    setCategory('');
    setWithTask(false);
    setTaskTitle('');
    pickOffense('');
  };
  const submit = async () => {
    const note = kind === 'discipline' && formal;
    const refers = note && cadet.status === 'active' && cadet.disciplineNotes + 1 >= DISCIPLINE_NOTE_LIMIT && cadet.notesCommittee?.decision !== null;
    if (
      refers &&
      !(await ask({
        title: `זו הערת המשמעת ה-${cadet.disciplineNotes + 1} של ${cadet.fullName}`,
        body: `לפי הנוהל הוא עולה ${committeeTo(DISCIPLINE_COMMITTEE_KIND)}: הוועדה תיפתח בתיק ההערכה שלו, עם התיק כפי שהוא עכשיו, ומפקד הקורס יקבל התראה.\nאם ההערה תימחק לפני החלטת הוועדה, ההעברה תבוטל.`,
        confirm: `שמירה והעברה ${committeeTo(DISCIPLINE_COMMITTEE_KIND)}`,
      }))
    )
      return;
    setError(null);
    setBusy(true);
    try {
      const res = await api.post<CadetDetail>(`/api/cadets/${cadet.id}/records`, {
        kind,
        offense: kind === 'discipline' ? offense : '',
        formal: note,
        category,
        body: body.trim(),
        score: kind === 'evaluation' ? score : null,
        followUp,
        private: priv,
        occurredOn: date,
        followUpTask: withTask ? { title: taskTitle.trim() || `המשך: ${cadet.fullName}`, deadline: isoAt(taskDate, taskTime), ownerId: cadet.canManage ? taskOwner : user.id } : undefined,
      });
      const n = res.cadet.disciplineNotes;
      if (refers && res.cadet.notesCommittee?.decision === null) toast({ title: `${cadet.fullName} עלה ${committeeTo(DISCIPLINE_COMMITTEE_KIND)}`, body: `הערת משמעת ${n} מתוך ${DISCIPLINE_NOTE_LIMIT}`, tone: 'red' });
      else if (note) toast({ title: `הערת משמעת נשמרה בתיק (${n} מתוך ${DISCIPLINE_NOTE_LIMIT})`, tone: 'green' });
      else toast({ title: `${RECORD_KIND_LABELS[kind]} נשמרה בתיק`, tone: 'green' });
      reset();
      emitLocalChange('cadets', 'tasks');
      onSaved?.(res);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={only ? 'col gap-16' : 'card card-pad col gap-16'}>
      {!only && <Seg value={kind} onChange={(k) => (setKind(k), setCategory(''), pickOffense(''))} options={kinds.map((k) => ({ value: k, label: RECORD_KIND_LABELS[k] }))} />}
      {categories.length > 0 && (
        <div className="chips">
          {categories.map((x) => (
            <button key={x} type="button" className={`chip chip-sm${category === x ? ' on' : ''}`} onClick={() => setCategory(category === x ? '' : x)}>
              {x}
            </button>
          ))}
        </div>
      )}
      {kind === 'discipline' && offenses.length > 0 && (
        <Field label="המקרה לפי מדרג האכיפה">
          <select className="select" value={offense} onChange={(e) => pickOffense(e.target.value)}>
            <option value="">אחר / לא מהמדרג</option>
            {[...new Set(offenses.map((o) => o.category))].map((cat) => (
              <optgroup key={cat || '-'} label={cat || 'מקרים'}>
                {offenses
                  .filter((o) => o.category === cat)
                  .map((o) => (
                    <option key={o.key} value={o.key}>
                      {o.name}
                    </option>
                  ))}
              </optgroup>
            ))}
          </select>
        </Field>
      )}
      {kind === 'discipline' && offenses.length === 0 && isCommander && guide.data && (
        <div className="tiny muted">
          אפשר לטעון את מדרג האכיפה של הקורס ב<Link to="/settings">הגדרות</Link>, ואז המערכת תראה כאן איזו פעם זו ומה הצעד לפי המדרג.
        </div>
      )}
      {chosen && (
        <div className={`ladder-hint ${step?.note || step?.committee ? 't-red' : 't-orange'}`} role="status">
          <div className="strong">
            {timeLabel(occurrence)} של {cadet.firstName} · {chosen.name}
          </div>
          {step ? (
            <div style={{ whiteSpace: 'pre-wrap' }}>
              {beyond ? 'מעבר לשלבים שבמדרג. הצעד האחרון במדרג: ' : 'לפי המדרג: '}
              {step.text}
            </div>
          ) : (
            <div>אין במדרג צעד לפעם הזו.</div>
          )}
          {step?.committee && (
            <div>
              עולה לוועדת הערכה · <Link to={`/evaluations/${cadet.id}`}>לתיק ההערכה</Link>
            </div>
          )}
          {prior.length > 0 && <div className="tiny muted">קודם: {prior.map((r) => shortDate(r.occurredOn)).join(', ')}</div>}
          {exempted && (
            <div className="strong" style={{ color: 'var(--blue)' }}>
              שימו לב: ל{cadet.firstName} יש החרגה בנושא {exempted} - כדאי לבדוק בכרטיס ההחרגות לפני שרושמים.
            </div>
          )}
        </div>
      )}
      {kind === 'discipline' && (
        <label className="check">
          <input type="checkbox" checked={formal} onChange={(e) => setFormalSet(e.target.checked)} />
          <span>
            <b>הערת משמעת</b>{' '}
            <span className="small muted">
              · עד עכשיו {cadet.disciplineNotes} מתוך {DISCIPLINE_NOTE_LIMIT}
              {cadet.status === 'active' && cadet.disciplineNotes === DISCIPLINE_NOTE_LIMIT - 1 && ` - הערה נוספת תעלה אותו ${committeeTo(DISCIPLINE_COMMITTEE_KIND)}`}
            </span>
          </span>
        </label>
      )}
      {kind === 'discipline' && formal && letters.length > 0 && (
        <div className="row wrap gap-6">
          <select className="select grow" value={letter ?? ''} onChange={(e) => setLetterSet(e.target.value === '' ? null : Number(e.target.value))} aria-label="נוסח הערת המשמעת" style={{ minWidth: 200 }}>
            <option value="">נוסח הערת המשמעת מהמסמך...</option>
            {letters.map((l, i) => (
              <option key={i} value={i}>
                {l.title}
              </option>
            ))}
          </select>
          <button type="button" className="btn btn-sm" disabled={letter === null} onClick={insertLetter}>
            הוספת הנוסח
          </button>
        </div>
      )}
      {kind === 'evaluation' && (
        <Field label="ציון" required>
          <div className="chips">
            {[1, 2, 3, 4, 5].map((n) => (
              <button key={n} type="button" className={`chip${score === n ? ' on' : ''}`} onClick={() => setScore(n)} style={{ minWidth: 44, justifyContent: 'center' }}>
                {n}
              </button>
            ))}
            <span className="tiny muted" style={{ alignSelf: 'center' }}>
              1 - חלש · 5 - מצוין
            </span>
          </div>
        </Field>
      )}
      <textarea
        className="textarea"
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder={kind === 'talk' ? 'עיקרי השיחה...' : kind === 'discipline' ? 'מה קרה ומה הצעד שננקט...' : kind === 'evaluation' ? 'על מה מבוססת ההערכה...' : 'הערה...'}
        style={{ minHeight: 80 }}
      />
      {kind === 'talk' && <input className="input" value={followUp} onChange={(e) => setFollowUp(e.target.value)} placeholder="על מה סוכם / צעדי המשך" />}
      <div className="row wrap">
        <label className="field" style={{ width: 170 }}>
          <span>תאריך</span>
          <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
        {!RESTRICTED_RECORD_KINDS.includes(kind) && (
          <label className="check small">
            <input type="checkbox" checked={priv} onChange={(e) => setPriv(e.target.checked)} />
            פרטי (רק אני, מפקד הצוות ומפקד הקורס)
          </label>
        )}
        <label className="check small">
          <input type="checkbox" checked={withTask} onChange={(e) => setWithTask(e.target.checked)} />
          פתח משימת המשך
        </label>
      </div>
      {RESTRICTED_RECORD_KINDS.includes(kind) && <div className="tiny muted">שיחות אישיות ומשמעת גלויות רק לך, למפקד הצוות ולמפקד הקורס.</div>}
      {withTask && (
        <div className="form-grid">
          <Field label="משימת המשך" className="span-2">
            <input className="input" value={taskTitle} onChange={(e) => setTaskTitle(e.target.value)} placeholder={`לדוגמה: שיחה חוזרת עם ${cadet.firstName}`} />
          </Field>
          {cadet.canManage && (
            <Field label="אחראי">
              <select className="select" value={taskOwner} onChange={(e) => setTaskOwner(Number(e.target.value))}>
                {users.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.displayName}
                  </option>
                ))}
              </select>
            </Field>
          )}
          <Field label="דד-ליין">
            <DateTimeInputs date={taskDate} time={taskTime} onDate={setTaskDate} onTime={setTaskTime} />
          </Field>
        </div>
      )}
      <div className="row">
        <button className="btn btn-primary" disabled={busy || (!body.trim() && !(kind === 'discipline' && offense)) || (kind === 'evaluation' && !score)} onClick={() => void submit()}>
          שמור בתיק
        </button>
        <ErrorBox error={error} />
      </div>
    </div>
  );
}

function Records({ records }: { records: CadetRecord[] }) {
  const toast = useToast();
  return (
    <div className="list">
      {records.map((r) => (
        <div key={r.id} className={`card card-pad t-${r.formal ? 'red' : KIND_TONE[r.kind]}`} style={{ borderRight: '4px solid var(--tone)', padding: 14 }}>
          <div className="row wrap gap-6">
            <span className={`badge t-${KIND_TONE[r.kind]}`}>{RECORD_KIND_LABELS[r.kind]}</span>
            {r.formal && (
              <span className="badge t-red">
                הערת משמעת{r.noteNumber ? ` ${r.noteNumber}/${DISCIPLINE_NOTE_LIMIT}` : ''}
              </span>
            )}
            {r.occurrence && (
              <span className="badge" title={r.offense}>
                {timeLabel(r.occurrence)}
              </span>
            )}
            {r.category && <span className="badge">{r.category}</span>}
            {r.score !== null && <span className="badge t-gray mono">ציון {r.score}/5</span>}
            {r.private && (
              <span className="badge" title="גלוי רק לכותב, למפקד הצוות ולמפקד הקורס">
                <Icon name="lock" size={11} /> פרטי
              </span>
            )}
            <span className="grow" />
            <span className="tiny muted">
              {r.authorName} · <span className="mono">{shortDate(r.occurredOn)}</span>
              {r.weekName && ` · ${r.weekName}`}
            </span>
            {r.canDelete && (
              <button
                className="icon-btn"
                style={{ width: 28, height: 28 }}
                aria-label="מחיקת רישום"
                onClick={async () =>
                  (await ask({ title: 'למחוק את הרישום מהתיק?', confirm: 'מחיקה', danger: true })) &&
                  void api.del(`/api/records/${r.id}`).then(() => {
                    toast({ title: 'הרישום נמחק', tone: 'green' });
                    emitLocalChange('cadets');
                  })
                }
              >
                <Icon name="trash" size={14} />
              </button>
            )}
          </div>
          {r.title && <div className="strong mt-8">{r.title}</div>}
          {r.body && (
            <p className="mt-8" style={{ whiteSpace: 'pre-wrap', fontSize: 14.5 }}>
              {r.body}
            </p>
          )}
          {r.followUp && <p className="small mt-8"><b>סוכם:</b> {r.followUp}</p>}
          {r.taskId && (
            <Link to={`/tasks/${r.taskId}`} className="small mt-8" style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
              <Icon name="tasks" size={14} /> {r.taskTitle}
            </Link>
          )}
        </div>
      ))}
    </div>
  );
}

/**
 * Development tracking: average evaluation score per date (one series, 1-5 scale),
 * plus the average per criterion. The record list below is the table view.
 */
function Development({ detail }: { detail: CadetDetail }) {
  const [hover, setHover] = useState<number | null>(null);
  const points = useMemo(() => {
    const byDate = new Map<string, { sum: number; n: number; criteria: string[] }>();
    for (const s of detail.scores) {
      const e = byDate.get(s.date) ?? { sum: 0, n: 0, criteria: [] };
      e.sum += s.score;
      e.n++;
      e.criteria.push(`${s.criterion} ${s.score}`);
      byDate.set(s.date, e);
    }
    return [...byDate.entries()].map(([date, e]) => ({ date, avg: Math.round((e.sum / e.n) * 10) / 10, criteria: e.criteria }));
  }, [detail.scores]);
  const byCriterion = useMemo(() => {
    const m = new Map<string, number[]>();
    for (const s of detail.scores) m.set(s.criterion, [...(m.get(s.criterion) ?? []), s.score]);
    return [...m.entries()].map(([k, v]) => ({ criterion: k, avg: Math.round((v.reduce((a, b) => a + b, 0) / v.length) * 10) / 10, n: v.length })).sort((a, b) => b.avg - a.avg);
  }, [detail.scores]);

  // right-to-left: the first evaluation sits on the right, like the rest of the page
  const W = 320;
  const H = 150;
  const pad = { l: 22, r: 24, t: 16, b: 24 };
  // points sit inside the grid so the end markers never touch the axis labels
  const inset = 18;
  const plotW = W - pad.l - pad.r - inset * 2;
  const x = (i: number) => (points.length === 1 ? pad.l + inset + plotW / 2 : W - pad.r - inset - (i * plotW) / (points.length - 1));
  const y = (v: number) => pad.t + ((5 - v) * (H - pad.t - pad.b)) / 4;
  const path = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.avg).toFixed(1)}`).join(' ');
  const last = points[points.length - 1];
  const hp = hover !== null ? points[hover] : null;

  return (
    <div className="card">
      <div className="card-head">
        <Icon name="chart" />
        <h3 className="grow">מעקב התפתחות</h3>
        {detail.cadet.avgScore !== null && (
          <span className="tiny muted">
            ממוצע <b className="mono" style={{ color: 'var(--ink)' }}>{detail.cadet.avgScore.toFixed(1)}</b>
          </span>
        )}
      </div>
      <div className="card-body">
        {points.length === 0 ? (
          <p className="small muted">אין עדיין הערכות. הערכות מהתנסויות ומהסגל יופיעו כאן לאורך הקורס.</p>
        ) : (
          <>
            <div className="small muted mb-12">ציון ממוצע לפי תאריך הערכה (1-5)</div>
            <div style={{ position: 'relative' }}>
              <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="group" aria-label="ציוני הערכה לאורך הקורס" style={{ display: 'block', overflow: 'visible' }}>
                {[1, 2, 3, 4, 5].map((v) => (
                  <g key={v}>
                    <line x1={pad.l} x2={W - pad.r} y1={y(v)} y2={y(v)} stroke="var(--line)" strokeWidth={1} />
                    <text x={W - pad.r + 8} y={y(v) + 3.5} fontSize={10} fill="var(--muted)" fontFamily="var(--mono)" textAnchor="start">
                      {v}
                    </text>
                  </g>
                ))}
                {points.length > 1 && <path d={path} fill="none" stroke="var(--ink)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />}
                {points.map((p, i) => (
                  <g key={p.date} onPointerEnter={() => setHover(i)} onPointerLeave={() => setHover(null)} onFocus={() => setHover(i)} onBlur={() => setHover(null)} tabIndex={0} role="img" aria-label={`${shortDate(p.date)}: ציון ממוצע ${p.avg}`}>
                    <circle cx={x(i)} cy={y(p.avg)} r={12} fill="transparent" />
                    <circle cx={x(i)} cy={y(p.avg)} r={hover === i ? 6 : 4.5} fill="var(--ink)" stroke="var(--card)" strokeWidth={2} />
                  </g>
                ))}
                {points.map((p, i) =>
                  i === 0 || i === points.length - 1 ? (
                    <text key={`d${p.date}`} x={x(i)} y={H - 6} fontSize={10} fill="var(--muted)" textAnchor="middle" fontFamily="var(--mono)">
                      {shortDate(p.date)}
                    </text>
                  ) : null,
                )}
                {last && hover === null && (
                  <text x={x(points.length - 1)} y={y(last.avg) - 11} fontSize={11} fontWeight={700} fill="var(--ink)" textAnchor="middle" fontFamily="var(--mono)">
                    {last.avg.toFixed(1)}
                  </text>
                )}
              </svg>
              {hp && (
                <div className="chart-tip" style={{ left: `${(x(hover!) / W) * 100}%`, top: `${(y(hp.avg) / H) * 100}%` }}>
                  <b className="mono">{hp.avg.toFixed(1)}</b> · <span className="mono">{shortDate(hp.date)}</span>
                  <div className="tiny muted">{hp.criteria.join(' · ')}</div>
                </div>
              )}
            </div>
            {byCriterion.length > 0 && (
              <div className="col gap-6 mt-16">
                <div className="label-caps">לפי קריטריון</div>
                {byCriterion.map((cr) => (
                  <div key={cr.criterion} className="row small">
                    <span style={{ width: 120 }}>{cr.criterion}</span>
                    <div className="grow bar" style={{ height: 6 }}>
                      <div className="bar-fill" style={{ width: `${(cr.avg / 5) * 100}%`, background: 'var(--ink-2)' }} />
                    </div>
                    <span className="mono" style={{ width: 54, textAlign: 'left' }}>
                      {cr.avg.toFixed(1)} <span className="muted">({cr.n})</span>
                    </span>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
