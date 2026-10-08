// Section 31 (debriefs) and 57: facts -> findings -> conclusions -> lessons -> tasks,
// and two debriefs filled in as forms: the weekly debrief and an intensive event's.

import { useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { DEBRIEF_ITEM_KINDS, DEBRIEF_ITEM_LABELS, PRIORITIES, PRIORITY_LABELS, STATUS_LABELS, WEEKDAY_NAMES, type DebriefItemKind, type Priority } from '@shared/constants';
import { sortHe } from '@shared/sort';
import { addDays, shortDate } from '@shared/dates';
import { answered, DEBRIEF_KIND_HINTS, DEBRIEF_KIND_LABELS, DEBRIEF_KINDS, formFor, isWeekDebrief, proposalRows, type DebriefKind } from '@shared/debriefForms';
import { matchesSearch } from '@shared/search';
import type { BankLesson, Cadet, Debrief, DebriefDetail, DebriefItem, EventDetail, ExternalEvent, ScheduleEvent, Template, Week } from '@shared/types';
import { BulkCheck, BulkRow, BulkScope, BulkToggle } from '../components/Bulk';
import { KIND_TONES, KindBadge } from '../components/DebriefBits';
import { DebriefFormView } from '../components/DebriefFormView';
import { Icon } from '../components/Icon';
import { DateTimeInputs, UserPicker } from '../components/NewTask';
import { TaskList } from '../components/TaskRow';
import { useToast } from '../components/Toasts';
import { DateInput, Empty, ErrorBox, Field, Loading, Modal, PageError, PageHead, Seg, Select, TimeInput } from '../components/ui';
import { api, changedFields } from '../lib/api';
import { saveCsv } from '../lib/csv';
import { isoAt, todayKey } from '../lib/format';
import { emitLocalChange } from '../lib/realtime';
import { useSession } from '../lib/session';
import { useApi } from '../lib/useApi';
import { ask } from '../components/Confirm';

const ADD_PLACEHOLDER: Record<DebriefItemKind, string> = {
  fact: 'הוספת עובדה...',
  finding: 'הוספת ממצא...',
  conclusion: 'הוספת מסקנה...',
  lesson: 'הוספת לקח...',
};

const KIND_HINT: Record<DebriefItemKind, string> = {
  fact: 'מה קרה - בלי פרשנות',
  finding: 'מה זיהינו',
  conclusion: 'למה זה קרה',
  lesson: 'מה עושים אחרת מעכשיו',
};

const KIND_ICONS: Record<DebriefKind, string> = { weekly: 'calendar', company: 'cap', event: 'zap', general: 'lightbulb' };
const isKind = (v: string | null): v is DebriefKind => DEBRIEF_KINDS.includes(v as DebriefKind);

const ITEM_ONE: Record<(typeof DEBRIEF_ITEM_KINDS)[number], string> = { fact: 'עובדה אחת', finding: 'ממצא אחד', conclusion: 'מסקנה אחת', lesson: 'לקח אחד' };

/** a debrief's contents in a few words: "2 עובדות · ממצא אחד · 2 לקחים" - or that there is nothing yet */
function contentsOf(d: Debrief): string {
  if (d.kind === 'company') {
    const n = companyPoints(d);
    return n ? (n === 1 ? 'נושא אחד' : `${n} נושאים`) : 'עוד אין נושאים';
  }
  const kinds = d.kind === 'general' ? DEBRIEF_ITEM_KINDS : (['lesson'] as const);
  const parts = kinds.filter((k) => d.itemCounts[k] > 0).map((k) => (d.itemCounts[k] === 1 ? ITEM_ONE[k] : `${d.itemCounts[k]} ${DEBRIEF_ITEM_LABELS[k]}`));
  // a form's debrief (weekly, an event) has its answers even before a lesson is drawn from it
  return parts.length ? parts.join(' · ') : d.kind === 'general' ? 'עוד לא נכתב בו דבר' : 'עוד בלי לקחים';
}

export function DebriefsPage() {
  const [params, setParams] = useSearchParams();
  const { data, error, loading } = useApi<Debrief[]>('/api/debriefs', ['debriefs', 'tasks']);
  const navigate = useNavigate();
  const fromEvent = params.get('event') ? Number(params.get('event')) : undefined;
  const fromWeek = params.get('week') ? Number(params.get('week')) : undefined;
  const asked = params.get('new');
  // ?new=weekly|event|general opens that form; ?new=1 or ?event= asks which kind first
  const [creating, setCreating] = useState<null | 'pick' | DebriefKind>(isKind(asked) ? asked : fromEvent || asked === '1' ? 'pick' : null);
  const tab = params.get('tab') === 'bank' ? 'bank' : 'list';
  const [kind, setKind] = useState<'all' | DebriefKind>('all');
  const shown = (data ?? []).filter((d) => kind === 'all' || d.kind === kind);
  const close = () => {
    setCreating(null);
    if (params.has('new') || params.has('event') || params.has('week')) setParams(tab === 'bank' ? { tab } : {}, { replace: true });
  };

  return (
    <BulkScope entity="debriefs" noun="תחקירים" topics={['debriefs', 'tasks']} ids={shown.map((d) => d.id)} actions={[{ key: 'delete', label: 'מחיקה', icon: 'trash', danger: true, confirm: 'למחוק {n} תחקירים? משימות שנפתחו מהם יישארו.' }]}>
    <div className="page">
      <PageHead
        title="תחקירים"
        sub="תחקיר שבועי, תחקיר מופע עצים ותחקיר פעילות - וכל לקח מקבל אחראי ותאריך והופך למשימה, או נשמר למחזור הבא."
        actions={
          <>
            {tab === 'list' && <BulkToggle />}
            <button className="btn btn-primary" onClick={() => setCreating('pick')}>
              <Icon name="plus" /> תחקיר
            </button>
          </>
        }
      />
      <div className="tabs" role="tablist">
        <button className={`tab${tab === 'list' ? ' on' : ''}`} role="tab" aria-selected={tab === 'list'} onClick={() => setParams({}, { replace: true })}>
          תחקירים<span className="n">{data?.length ?? ''}</span>
        </button>
        <button className={`tab${tab === 'bank' ? ' on' : ''}`} role="tab" aria-selected={tab === 'bank'} onClick={() => setParams({ tab: 'bank' }, { replace: true })}>
          בנק לקחים
        </button>
      </div>
      {tab === 'bank' ? (
        <LessonsBank />
      ) : (
        <>
          <ErrorBox error={error} />
          {(data ?? []).some((d) => d.kind !== 'general') && (
            <div className="mb-12">
              <Seg
                value={kind}
                onChange={setKind}
                options={[
                  { value: 'all', label: 'הכל' },
                  { value: 'weekly', label: 'שבועיים' },
                  { value: 'company', label: 'פלוגתיים' },
                  { value: 'event', label: 'מופעים עצימים' },
                  { value: 'general', label: 'פעילויות' },
                ]}
              />
            </div>
          )}
          {loading && !data ? (
            <Loading rows={3} />
          ) : !shown.length ? (
            <Empty icon="lightbulb" title="אין תחקירים" text="בסוף כל שבוע - תחקיר שבועי. אחרי מארס או תרגיל מסכם - תחקיר מופע עצים." />
          ) : (
            <div className="list">
              {shown.map((d) => (
                <BulkRow key={d.id} itemId={d.id} label={d.title} className="task-row t-gray" style={{ gridTemplateColumns: 'auto 1fr auto' }} onOpen={() => navigate(`/debriefs/${d.id}`)}>
                  <BulkCheck id={d.id} />
                  <div className="task-main">
                    <div className="task-title">{d.title}</div>
                    <div className="task-meta">
                      <span className="mono">{shortDate(d.occurredOn)}</span>
                      {!isWeekDebrief(d.kind) && d.eventTitle && <span className="sep">{d.eventTitle}</span>}
                      {d.weekName && <span className="sep">{d.weekName}</span>}
                      {d.presenterName && <span className="sep">מעביר: {d.presenterName}</span>}
                      {d.facilitatorName && <span className="sep">{d.kind === 'company' ? 'אחראי' : 'מנחה'}: {d.facilitatorName}</span>}
                    </div>
                    {/* what is in it, in one line - only what there is */}
                    <div className="task-meta debrief-counts">{contentsOf(d)}</div>
                  </div>
                  <div className="task-side">
                    <KindBadge kind={d.kind} />
                    {d.openTasks > 0 && <span className="badge t-orange">{d.openTasks === 1 ? 'משימה פתוחה' : `${d.openTasks} משימות פתוחות`}</span>}
                    <span className={`badge ${d.status === 'final' ? 't-green' : 't-yellow'}`}>{d.status === 'final' ? 'סוכם' : 'טיוטה'}</span>
                    <DraftFilled d={d} />
                  </div>
                </BulkRow>
              ))}
            </div>
          )}
        </>
      )}
      {creating === 'pick' && <KindPicker onPick={setCreating} onClose={close} />}
      {creating && creating !== 'pick' && <DebriefForm kind={creating} eventId={fromEvent} weekId={fromWeek} onClose={close} />}
    </div>
    </BulkScope>
  );
}

/** a form's draft: how much of it is filled in (the questions answered, of all of them) - an invitation to finish it */
function DraftFilled({ d }: { d: Debrief }) {
  if (d.kind === 'general' || d.status !== 'draft') return null;
  const questions = formFor(d.kind).flatMap((s) => s.questions);
  if (!questions.length) return null;
  const done = questions.filter((q) => answered(q, d.answers)).length;
  return (
    <span className="debrief-filled tiny muted" title={`${done} מתוך ${questions.length} שאלות מולאו`}>
      <span className="mini-bar" aria-hidden="true">
        <i style={{ width: `${(done / questions.length) * 100}%` }} />
      </span>
      <span className="mono">
        {done}/{questions.length}
      </span>
    </span>
  );
}

/** the topics a company debrief raised, before the staff, the broad staff and the company */
const companyPoints = (d: Debrief) =>
  formFor('company')
    .flatMap((s) => s.questions)
    .reduce((n, q) => n + proposalRows(d.answers[q.id]).filter((r) => r.topic.trim()).length, 0);

function KindPicker({ onPick, onClose }: { onPick: (k: DebriefKind) => void; onClose: () => void }) {
  return (
    <Modal title="איזה תחקיר?" onClose={onClose}>
      <div className="kind-cards">
        {(['weekly', 'company', 'event', 'general'] as const).map((k, i) => (
          <button key={k} type="button" className={`kind-card ${KIND_TONES[k]}`} onClick={() => onPick(k)} data-autofocus={i === 0 || undefined}>
            <span className="kind-icon">
              <Icon name={KIND_ICONS[k]} />
            </span>
            <span className="col gap-4">
              <span className="strong">{DEBRIEF_KIND_LABELS[k]}</span>
              <span className="small muted">{DEBRIEF_KIND_HINTS[k]}</span>
            </span>
          </button>
        ))}
      </div>
    </Modal>
  );
}

/** the lessons earlier debriefs kept for the next cycle, by the week or event they are for */
function LessonsBank() {
  const { data, error, loading } = useApi<BankLesson[]>('/api/lessons', ['debriefs']);
  const [q, setQ] = useState('');
  const [kind, setKind] = useState<'all' | 'weekly' | 'event'>('all');
  // the weeks: the weekly debriefs' lessons and the company debriefs'
  const list = (data ?? []).filter((l) => (kind === 'all' || (kind === 'weekly' ? isWeekDebrief(l.debriefKind) : l.debriefKind === kind)) && matchesSearch(q, l.body, l.target, l.debriefTitle, l.ownerName));
  const groups = new Map<string, BankLesson[]>();
  for (const l of [...list].sort((a, b) => (a.targetWeek ?? 999) - (b.targetWeek ?? 999) || a.target.localeCompare(b.target, 'he'))) groups.set(l.target, [...(groups.get(l.target) ?? []), l]);
  if (loading && !data) return <Loading rows={3} />;
  return (
    <>
      <ErrorBox error={error} />
      <p className="small muted mb-12">לקחים שתחקירים שמרו למחזור הבא. כל לקח מוצג גם במסך השבוע או בפעילות שהוא נכתב עליהם, כשהם מגיעים שוב.</p>
      {!data?.length ? (
        <Empty icon="history" title="בנק הלקחים ריק" text='בתחקיר שבועי או בתחקיר מופע - הוסיפו לקחים בסעיף "למחזור הבא".' />
      ) : (
        <>
          <div className="row wrap gap-6 mb-12">
            <input className="input grow" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="חיפוש לקח, שבוע או מופע..." aria-label="חיפוש בבנק הלקחים" style={{ maxWidth: 360 }} />
            <Seg
              value={kind}
              onChange={setKind}
              options={[
                { value: 'all', label: 'הכל' },
                { value: 'weekly', label: 'שבועות' },
                { value: 'event', label: 'מופעים' },
              ]}
            />
            <button
              className="btn"
              onClick={() =>
                void saveCsv(
                  'בנק-לקחים',
                  ['עבור', 'לקח', 'אחראי', 'תחקיר', 'תאריך', 'נכתב על ידי'],
                  list.map((l) => [l.target, l.body, l.ownerName, l.debriefTitle, l.occurredOn, l.createdByName]),
                )
              }
            >
              <Icon name="download" /> ייצוא
            </button>
          </div>
          {!list.length && <Empty icon="search" title="לא נמצאו לקחים" />}
          <div className="col gap-16">
            {[...groups].map(([target, items]) => (
              <div key={target} className="card">
                <div className="card-head">
                  <Icon name={isWeekDebrief(items[0].debriefKind) ? 'calendar' : 'zap'} />
                  <h3 className="grow">{target}</h3>
                  <span className="mono tiny muted">{items.length}</span>
                </div>
                <div className="card-body">
                <ul className="prior-lessons">
                  {items.map((l) => (
                    <li key={l.id}>
                      <div className="small prewrap">{l.body}</div>
                      <div className="tiny muted">
                        <Link to={`/debriefs/${l.debriefId}`}>{l.debriefTitle}</Link> · <span className="mono">{shortDate(l.occurredOn)}</span>
                        {l.ownerName && ` · ${l.ownerName}`}
                      </div>
                    </li>
                  ))}
                </ul>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </>
  );
}

/** the week a weekly debrief is about: the current one - or, in a week's first two days, the one that just ended */
function defaultWeek(weeks: Week[], today: string): Week | undefined {
  const sorted = [...weeks].sort((a, b) => a.startDate.localeCompare(b.startDate));
  const started = sorted.filter((w) => w.startDate <= today);
  const cur = started[started.length - 1];
  if (cur && started.length > 1 && cur.endDate >= today && today <= addDays(cur.startDate, 1)) return started[started.length - 2];
  return cur ?? sorted[0];
}

/** An activity to debrief: a schedule event (e:<id>), one from the synced Google calendar (x:<id>), or the name a debrief already keeps (a:<name>). */
interface Activity {
  key: string;
  time: string | null;
  title: string;
}

function DebriefForm({ debrief, kind: newKind = 'general', eventId, weekId, onClose }: { debrief?: Debrief; kind?: DebriefKind; eventId?: number; weekId?: number; onClose: () => void }) {
  const toast = useToast();
  const navigate = useNavigate();
  const { users, user } = useSession();
  const kind = debrief?.kind ?? newKind;
  // a weekly debrief (and the company's) is about a week - often held on the next week's first day
  const weekly = isWeekDebrief(kind);
  const company = kind === 'company';
  const weeks = useApi<Week[]>(weekly ? '/api/weeks' : null, ['weeks']).data;
  const [weekSet, setWeekSet] = useState<number | null>(debrief?.weekId ?? weekId ?? null);
  const week = weeks?.find((w) => w.id === weekSet) ?? (weekSet ? undefined : weeks && defaultWeek(weeks, todayKey()));
  const sameWeek = useApi<Debrief[]>(weekly && !debrief && week ? `/api/debriefs?week=${week.id}` : null, ['debriefs']).data?.find((x) => x.kind === kind);
  // opened from a schedule event: its day, until the date is changed here
  const preset = useApi<EventDetail>(!debrief && eventId ? `/api/events/${eventId}` : null, ['events']).data?.event;
  const [title, setTitle] = useState(debrief?.title ?? '');
  const [dateSet, setDateSet] = useState<string | null>(debrief?.occurredOn ?? null);
  const date = dateSet ?? preset?.date ?? todayKey();
  const [pick, setPick] = useState<string>(debrief?.eventId ? `e:${debrief.eventId}` : debrief?.eventTitle ? `a:${debrief.eventTitle}` : eventId ? `e:${eventId}` : '');
  // the company debrief: brought by the cadet in the broad experience of training officer that day
  const cadets = useApi<Cadet[]>(company ? '/api/cadets' : null, ['cadets']).data;
  const officer = useApi<{ cadetId: number; cadetName: string; mentorId: number | null } | null>(company && !debrief ? `/api/debriefs/presenter?date=${date}` : null, ['cadets']).data;
  const [presenterSet, setPresenter] = useState<string | null>(debrief ? String(debrief.presenterId ?? '') : null);
  const presenter = presenterSet ?? (officer ? String(officer.cadetId) : '');
  // ...and the staff member who mentors that experience looks after it, unless another is chosen
  const [facilitatorSet, setFacilitator] = useState<string | null>(debrief ? String(debrief.facilitatorId ?? user.id) : null);
  const facilitator = facilitatorSet ?? String((company && officer?.mentorId) || user.id);
  const [participants, setParticipants] = useState(debrief?.participants ?? '');
  const [summary, setSummary] = useState(debrief?.summary ?? '');
  const [error, setError] = useState<string | null>(null);

  // the activities of the chosen day: the course schedule and the synced Google calendar
  const dayEvents = useApi<ScheduleEvent[]>(weekly ? null : `/api/events?from=${date}&to=${date}`, ['events']);
  const dayExternal = useApi<ExternalEvent[]>(weekly ? null : `/api/calendar/external?from=${date}&to=${date}`, ['events']);
  const byTime = (a: Activity, b: Activity) => (a.time ?? '').localeCompare(b.time ?? '') || a.title.localeCompare(b.title, 'he');
  const schedule: Activity[] = (dayEvents.data ?? []).filter((e) => !e.cancelled).map((e) => ({ key: `e:${e.id}`, time: e.startTime, title: e.title })).sort(byTime);
  const calendar: Activity[] = (dayExternal.data ?? []).map((e) => ({ key: `x:${e.id}`, time: e.startTime, title: e.title })).sort(byTime);
  const known = [...schedule, ...calendar];
  // a calendar activity the debrief keeps by name is that day's activity of the same name, when there is one
  const current = pick.startsWith('a:') ? (calendar.find((a) => a.title === pick.slice(2))?.key ?? pick) : pick;
  // what the debrief already points at, when it is not among the day's activities
  const kept: Activity | null =
    current && !known.some((a) => a.key === current)
      ? current.startsWith('a:')
        ? { key: current, time: null, title: current.slice(2) }
        : current === `e:${debrief?.eventId}` && debrief?.eventTitle
          ? { key: current, time: null, title: debrief.eventTitle }
          : current === `e:${preset?.id}` && preset
            ? { key: current, time: preset.startTime, title: preset.title }
            : null
      : null;
  const chosen = known.find((a) => a.key === current) ?? kept;
  const loadingDay = (dayEvents.loading && !dayEvents.data) || (dayExternal.loading && !dayExternal.data);
  const effectiveTitle = title || (weekly ? (week ? `${company ? 'תחק"ש פלוגתי' : 'תחקיר שבועי'} - ${week.name}` : '') : chosen ? `תחקיר ${chosen.title}` : '');
  const label = (a: Activity) => (a.time ? `${a.time} · ${a.title}` : a.key.startsWith('x:') ? `כל היום · ${a.title}` : a.title);

  const save = async () => {
    setError(null);
    const body = {
      title: effectiveTitle,
      occurredOn: date,
      eventId: !weekly && chosen?.key.startsWith('e:') ? Number(chosen.key.slice(2)) : null,
      activity: !weekly && chosen && !chosen.key.startsWith('e:') ? chosen.title : '',
      facilitatorId: facilitator ? Number(facilitator) : null,
      participants,
      summary,
    };
    try {
      const presenterId = presenter ? Number(presenter) : null;
      const created = debrief
        ? null
        : await api.post<DebriefDetail>('/api/debriefs', { ...body, kind, weekId: weekly ? (week?.id ?? null) : null, ...(company ? { answers: { presenterId } } : {}) });
      if (debrief) {
        const { eventId, activity, ...rest } = body;
        const patch: Partial<typeof body> & { weekId?: number; answers?: { presenterId: number | null } } = changedFields<typeof rest>(debrief, rest);
        if (company && presenterId !== debrief.presenterId) patch.answers = { presenterId };
        // the activity is one choice - a schedule event or a calendar entry by name
        if (!weekly && (eventId !== debrief.eventId || activity !== (debrief.eventId ? '' : (debrief.eventTitle ?? '')))) Object.assign(patch, { eventId, activity });
        if (weekly && week && week.id !== debrief.weekId) patch.weekId = week.id;
        if (Object.keys(patch).length) await api.patch(`/api/debriefs/${debrief.id}`, patch);
      }
      toast({ title: 'התחקיר נשמר', tone: 'green' });
      emitLocalChange('debriefs');
      // close first: closing clears ?event= from the list URL, and the
      // navigation to the new debrief has to be the last one
      onClose();
      if (created) navigate(`/debriefs/${created.debrief.id}`);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <Modal
      title={debrief ? 'פרטי התחקיר' : kind === 'general' ? 'תחקיר פעילות' : `${DEBRIEF_KIND_LABELS[kind]} חדש`}
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-primary" onClick={() => void save()} disabled={!effectiveTitle.trim() || (weekly && !week)}>
            {debrief ? 'שמור' : 'פתח תחקיר'}
          </button>
          <button className="btn btn-ghost" onClick={onClose}>
            ביטול
          </button>
        </>
      }
    >
      {!debrief && kind !== 'general' && <div className="info-box mb-12">{DEBRIEF_KIND_HINTS[kind]}</div>}
      <div className="form-grid">
        {weekly && (
          <Field
            label="השבוע שהתחקיר עוסק בו"
            required
            className="span-2"
            hint={
              sameWeek ? (
                <>
                  כבר נפתח {DEBRIEF_KIND_LABELS[kind]} לשבוע הזה -{' '}
                  <Link to={`/debriefs/${sameWeek.id}`} onClick={onClose}>
                    {sameWeek.title}
                  </Link>
                </>
              ) : weeks && !weeks.length ? (
                'אין שבועות בקורס. הוסיפו שבוע במסך שבועות.'
              ) : undefined
            }
          >
            <Select className="select" value={week?.id ?? ''} onChange={(e) => (setWeekSet(Number(e.target.value)), setTitle(''))} data-autofocus>
              {!weeks && <option value="">טוען שבועות...</option>}
              {[...(weeks ?? [])]
                .sort((a, b) => a.startDate.localeCompare(b.startDate))
                .map((w) => (
                  <option key={w.id} value={w.id}>
                    שבוע {w.number} · {w.name} ({shortDate(w.startDate)}-{shortDate(w.endDate)})
                  </option>
                ))}
            </Select>
          </Field>
        )}
        <Field label="נושא התחקיר" required className="span-2">
          <input className="input" value={effectiveTitle} onChange={(e) => setTitle(e.target.value)} placeholder={kind === 'event' ? 'לדוגמה: תחקיר מארס טורקי' : 'לדוגמה: תחקיר מטווח הפעלת כוח'} data-autofocus={!weekly || undefined} />
        </Field>
        <Field label={weekly ? 'תאריך התחקיר' : 'תאריך האירוע'}>
          <DateInput
            value={date}
            onChange={(v) => {
              setDateSet(v);
              setPick(''); // the activities of the new day
            }}
          />
        </Field>
        {!weekly && (
        <Field label={kind === 'event' ? 'המופע בלו"ז' : 'פעילות בלו"ז'} hint={loadingDay ? 'טוען את הפעילויות של היום...' : !known.length ? `אין פעילויות ב-${shortDate(date)} בלו"ז וביומן` : undefined}>
          <Select className="select" value={chosen?.key ?? ''} onChange={(e) => setPick(e.target.value)}>
            <option value="">ללא</option>
            {kept && <option value={kept.key}>{label(kept)}</option>}
            {schedule.length > 0 && (
              <optgroup label='לו"ז הקורס'>
                {schedule.map((a) => (
                  <option key={a.key} value={a.key}>
                    {label(a)}
                  </option>
                ))}
              </optgroup>
            )}
            {calendar.length > 0 && (
              <optgroup label="יומן Google">
                {calendar.map((a) => (
                  <option key={a.key} value={a.key}>
                    {label(a)}
                  </option>
                ))}
              </optgroup>
            )}
          </Select>
        </Field>
        )}
        {company && (
          <Field
            label='מעביר התחקיר (קה"ד רוחבי)'
            className="span-2"
            hint={
              !debrief && officer === null ? (
                <>
                  אין צוער בהתנסות רוחב קה"ד ב-{shortDate(date)}. <Link to="/experiences" onClick={onClose}>לשיבוץ בהתנסויות</Link>, או בחירת צוער כאן.
                </>
              ) : !debrief && officer && presenter === String(officer.cadetId) ? (
                'הקה"ד הרוחבי לפי ההתנסויות בתאריך התחקיר'
              ) : undefined
            }
          >
            <Select className="select" value={presenter} onChange={(e) => setPresenter(e.target.value)}>
              <option value="">{cadets ? 'ללא' : 'טוען צוערים...'}</option>
              {debrief?.presenterId && !cadets?.some((c) => c.id === debrief.presenterId) && <option value={debrief.presenterId}>{debrief.presenterName}</option>}
              {sortHe(cadets ?? [], (c) => c.fullName).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.fullName}
                  {c.teamName ? ` · ${c.teamName}` : ''}
                </option>
              ))}
            </Select>
          </Field>
        )}
        <Field label={company ? 'אחראי מהסגל' : 'מנחה'} hint={company ? 'מלווה את הקה"ד, ויכול לערוך ולסכם את התחקיר' : undefined}>
          <Select className="select" value={facilitator} onChange={(e) => setFacilitator(e.target.value)}>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.displayName}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="משתתפים">
          <input className="input" value={participants} onChange={(e) => setParticipants(e.target.value)} placeholder={company ? 'לדוגמה: הפלוגה וסגל הקורס' : 'לדוגמה: סגל הצוות, מדריכי ירי'} />
        </Field>
        <Field label={kind === 'general' ? 'תיאור האירוע' : 'רקע קצר (לא חובה)'} className="span-2">
          <textarea className="textarea" value={summary} onChange={(e) => setSummary(e.target.value)} />
        </Field>
      </div>
      <div className="mt-12">
        <ErrorBox error={error} />
      </div>
    </Modal>
  );
}

type ItemDialog = null | { item: DebriefItem; to: 'task' | 'recurring' | 'template' };

export function DebriefPage() {
  const { id } = useParams();
  const { data, error, loading, setData, status } = useApi<DebriefDetail>(`/api/debriefs/${id}`, ['debriefs', 'tasks']);
  const { isCommander } = useSession();
  const toast = useToast();
  const navigate = useNavigate();
  const [editing, setEditing] = useState(false);
  const [dialog, setDialog] = useState<ItemDialog>(null);

  if (loading && !data)
    return (
      <div className="page">
        <Loading rows={4} />
      </div>
    );
  if (!data)
    return (
      <div className="page">
        <PageError error={error} status={status} what="התחקיר" back="/debriefs" backLabel="לרשימת התחקירים" />
      </div>
    );
  const d = data.debrief;
  if (d.kind !== 'general')
    return (
      <>
        <DebriefFormView key={d.id} data={data} setData={setData} onEdit={() => setEditing(true)} />
        {editing && <DebriefForm debrief={d} onClose={() => setEditing(false)} />}
      </>
    );

  const run = async (fn: () => Promise<DebriefDetail | void>, ok?: string) => {
    try {
      const res = await fn();
      if (res) setData(res);
      if (ok) toast({ title: ok, tone: 'green' });
      emitLocalChange('debriefs', 'tasks');
    } catch (e) {
      toast({ title: (e as Error).message, tone: 'red' });
    }
  };

  return (
    <div className="page">
      <PageHead
        eyebrow={
          <Link to="/debriefs" className="muted">
            תחקירים
          </Link>
        }
        title={d.title}
        sub={[shortDate(d.occurredOn), d.eventTitle, d.weekName, d.facilitatorName && `מנחה: ${d.facilitatorName}`, d.status === 'final' ? 'סוכם' : 'טיוטה'].filter(Boolean).join(' · ')}
        actions={
          d.canEdit && (
            <>
              <button className="btn" onClick={() => setEditing(true)}>
                <Icon name="edit" /> עריכה
              </button>
              {d.status === 'draft' ? (
                <button className="btn btn-primary" onClick={() => void run(() => api.patch<DebriefDetail>(`/api/debriefs/${d.id}`, { status: 'final' }), 'התחקיר סוכם')}>
                  <Icon name="check" /> סיכום התחקיר
                </button>
              ) : (
                <button className="btn" onClick={() => void run(() => api.patch<DebriefDetail>(`/api/debriefs/${d.id}`, { status: 'draft' }))}>
                  החזר לטיוטה
                </button>
              )}
              <button className="btn btn-ghost text-red" onClick={async () => (await ask({ title: 'למחוק את התחקיר?', body: 'הממצאים, המסקנות והלקחים שבו יימחקו. משימות ההמשך יישארו.', confirm: 'מחיקה', danger: true })) && void api.del(`/api/debriefs/${d.id}`).then(() => navigate('/debriefs'))} aria-label="מחיקה">
                <Icon name="trash" />
              </button>
            </>
          )
        }
      />
      {(d.summary || d.participants) && (
        <div className="card card-pad mb-12" style={{ marginBottom: 16 }}>
          {d.summary && <p style={{ whiteSpace: 'pre-wrap' }}>{d.summary}</p>}
          {d.participants && <div className="tiny muted mt-8">משתתפים: {d.participants}</div>}
        </div>
      )}
      <div className="grid-2">
        {DEBRIEF_ITEM_KINDS.map((k, idx) => (
          <ItemColumn
            key={k}
            kind={k}
            step={idx + 1}
            items={data.items.filter((i) => i.kind === k)}
            canEdit={d.canEdit}
            isCommander={isCommander}
            onAdd={(body) => run(() => api.post<DebriefDetail>(`/api/debriefs/${d.id}/items`, { kind: k, body }))}
            onEdit={(item, body) => run(() => api.patch<DebriefDetail>(`/api/debrief-items/${item.id}`, { body }))}
            onDelete={(item) => run(() => api.del<DebriefDetail>(`/api/debrief-items/${item.id}`))}
            onConvert={(item, to) => setDialog({ item, to })}
          />
        ))}
      </div>
      <div className="section-title">
        <h2>משימות בעקבות התחקיר</h2>
        <span className="count-pill">{data.tasks.length}</span>
      </div>
      <TaskList tasks={data.tasks} empty={<p className="small muted">הפכו לקח או מסקנה למשימה עם אחראי ודד-ליין - כך הלקח לא נשאר רק כטקסט.</p>} />
      {editing && <DebriefForm debrief={d} onClose={() => setEditing(false)} />}
      {dialog?.to === 'task' && <ItemToTask item={dialog.item} onClose={() => setDialog(null)} onDone={setData} />}
      {dialog?.to === 'recurring' && <ItemToRecurring item={dialog.item} onClose={() => setDialog(null)} onDone={setData} />}
      {dialog?.to === 'template' && <ItemToTemplate item={dialog.item} onClose={() => setDialog(null)} onDone={setData} />}
    </div>
  );
}

function ItemColumn({
  kind,
  step,
  items,
  canEdit,
  isCommander,
  onAdd,
  onEdit,
  onDelete,
  onConvert,
}: {
  kind: DebriefItemKind;
  step: number;
  items: DebriefItem[];
  canEdit: boolean;
  isCommander: boolean;
  onAdd: (body: string) => Promise<void>;
  onEdit: (item: DebriefItem, body: string) => Promise<void>;
  onDelete: (item: DebriefItem) => Promise<void>;
  onConvert: (item: DebriefItem, to: 'task' | 'recurring' | 'template') => void;
}) {
  const [text, setText] = useState('');
  const [editing, setEditing] = useState<number | null>(null);
  const [draft, setDraft] = useState('');
  const actionable = kind === 'conclusion' || kind === 'lesson';
  return (
    <div className="card">
      <div className="card-head">
        <span className="mono tiny muted">{step}</span>
        <h3 className="grow">{DEBRIEF_ITEM_LABELS[kind]}</h3>
        <span className="tiny muted">{KIND_HINT[kind]}</span>
      </div>
      <div className="card-body col gap-6">
        {items.length === 0 && !canEdit && <p className="small muted">-</p>}
        {items.map((i) => (
          <div key={i.id} className="update" style={{ padding: '10px 12px' }}>
            {editing === i.id ? (
              <div className="col gap-6">
                <textarea className="textarea" value={draft} onChange={(e) => setDraft(e.target.value)} style={{ minHeight: 60 }} />
                <div className="row gap-6">
                  <button className="btn btn-sm btn-primary" onClick={() => void onEdit(i, draft).then(() => setEditing(null))}>
                    שמור
                  </button>
                  <button className="btn btn-sm btn-ghost" onClick={() => setEditing(null)}>
                    ביטול
                  </button>
                </div>
              </div>
            ) : (
              <>
                <div className="update-body" style={{ fontSize: 14.5 }}>
                  {i.body}
                </div>
                {(i.taskId || i.recurringRuleId) && (
                  <div className="row wrap gap-6 mt-8">
                    {i.taskId && (
                      <Link to={`/tasks/${i.taskId}`} className="badge t-blue">
                        <Icon name="tasks" size={11} /> {i.taskTitle} · {i.taskStatus ? STATUS_LABELS[i.taskStatus] : ''}
                      </Link>
                    )}
                    {i.recurringRuleId && (
                      <Link to="/recurring" className="badge t-purple">
                        <Icon name="repeat" size={11} /> {i.recurringTitle}
                      </Link>
                    )}
                  </div>
                )}
                {canEdit && (
                  <div className="row wrap gap-6 mt-8">
                    {actionable && (
                      <button className="btn btn-sm" onClick={() => onConvert(i, 'task')}>
                        <Icon name="plus" /> משימה
                      </button>
                    )}
                    {actionable && isCommander && (
                      <>
                        <button className="btn btn-sm" onClick={() => onConvert(i, 'recurring')}>
                          <Icon name="repeat" /> משימה חוזרת
                        </button>
                        <button className="btn btn-sm" onClick={() => onConvert(i, 'template')}>
                          <Icon name="template" /> לתבנית
                        </button>
                      </>
                    )}
                    <span className="grow" />
                    <button
                      className="icon-btn"
                      style={{ width: 28, height: 28 }}
                      aria-label="עריכה"
                      onClick={() => {
                        setEditing(i.id);
                        setDraft(i.body);
                      }}
                    >
                      <Icon name="edit" size={14} />
                    </button>
                    <button className="icon-btn" style={{ width: 28, height: 28 }} aria-label="מחיקה" onClick={async () => (await ask({ title: 'למחוק את הפריט?', confirm: 'מחיקה', danger: true })) && void onDelete(i)}>
                      <Icon name="trash" size={14} />
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        ))}
        {canEdit && (
          <form
            className="row"
            onSubmit={(e) => {
              e.preventDefault();
              if (text.trim()) void onAdd(text.trim()).then(() => setText(''));
            }}
          >
            <input className="input grow" value={text} onChange={(e) => setText(e.target.value)} placeholder={ADD_PLACEHOLDER[kind]} />
            <button className="btn btn-sm" disabled={!text.trim()}>
              <Icon name="plus" />
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

function ItemToTask({ item, onClose, onDone }: { item: DebriefItem; onClose: () => void; onDone: (d: DebriefDetail) => void }) {
  const { isCommander, settings } = useSession();
  const toast = useToast();
  const [title, setTitle] = useState(item.body.length <= 80 ? item.body : '');
  const [owners, setOwners] = useState<number[]>([]);
  const [all, setAll] = useState(false);
  const [date, setDate] = useState(addDays(todayKey(), 7));
  const [time, setTime] = useState(settings.defaultDeadlineTime);
  const [priority, setPriority] = useState<Priority>('normal');
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    setError(null);
    try {
      const d = await api.post<DebriefDetail>(`/api/debrief-items/${item.id}/task`, { title, ownerIds: owners, allStaff: all, deadline: isoAt(date, time), priority });
      onDone(d);
      toast({ title: 'נפתחה משימה בעקבות התחקיר', tone: 'green' });
      emitLocalChange('tasks', 'debriefs');
      onClose();
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <Modal
      title="משימה בעקבות התחקיר"
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-primary" disabled={!title.trim() || (!all && !owners.length)} onClick={() => void save()}>
            שלח
          </button>
          <button className="btn btn-ghost" onClick={onClose}>
            ביטול
          </button>
        </>
      }
    >
      <div className="col gap-16">
        <div className="info-box">{item.body}</div>
        <Field label="שם המשימה" required>
          <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="לדוגמה: סגירת מדריכים עד יום שלישי" data-autofocus />
        </Field>
        <Field label="אחראי" required>
          <UserPicker value={owners} onChange={setOwners} allowAll={isCommander} all={all} onAll={setAll} date={date} />
        </Field>
        <Field label="דד-ליין" required>
          <DateTimeInputs date={date} time={time} onDate={setDate} onTime={setTime} />
        </Field>
        <Field label="עדיפות">
          <Seg value={priority} onChange={setPriority} options={PRIORITIES.map((p) => ({ value: p, label: PRIORITY_LABELS[p] }))} />
        </Field>
        <ErrorBox error={error} />
      </div>
    </Modal>
  );
}

function ItemToRecurring({ item, onClose, onDone }: { item: DebriefItem; onClose: () => void; onDone: (d: DebriefDetail) => void }) {
  const { users } = useSession();
  const toast = useToast();
  const [title, setTitle] = useState(item.body.length <= 80 ? item.body : '');
  const [frequency, setFrequency] = useState<'daily' | 'weekly'>('weekly');
  const [weekdays, setWeekdays] = useState<number[]>([0]);
  const [time, setTime] = useState('10:00');
  const [assignee, setAssignee] = useState('week_lead');
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    setError(null);
    try {
      const d = await api.post<DebriefDetail>(`/api/debrief-items/${item.id}/recurring`, { title, frequency, weekdays, time, assignee });
      onDone(d);
      toast({ title: 'נוצרה משימה חוזרת', tone: 'green' });
      emitLocalChange('recurring', 'debriefs', 'tasks');
      onClose();
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <Modal
      title="משימה חוזרת בעקבות לקח"
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-primary" disabled={!title.trim()} onClick={() => void save()}>
            צור משימה חוזרת
          </button>
          <button className="btn btn-ghost" onClick={onClose}>
            ביטול
          </button>
        </>
      }
    >
      <div className="col gap-16">
        <div className="info-box">{item.body}</div>
        <Field label="שם המשימה" required>
          <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} data-autofocus />
        </Field>
        <Seg value={frequency} onChange={setFrequency} options={[{ value: 'daily', label: 'כל יום' }, { value: 'weekly', label: 'בימים מסוימים' }]} />
        {frequency === 'weekly' && (
          <div className="chips">
            {WEEKDAY_NAMES.map((n, i) => (
              <button key={n} className={`chip${weekdays.includes(i) ? ' on' : ''}`} onClick={() => setWeekdays(weekdays.includes(i) ? weekdays.filter((x) => x !== i) : [...weekdays, i])}>
                {n}
              </button>
            ))}
          </div>
        )}
        <div className="form-grid">
          <Field label="שעה">
            <TimeInput value={time} onChange={setTime} />
          </Field>
          <Field label="אחראי">
            <Select className="select" value={assignee} onChange={(e) => setAssignee(e.target.value)}>
              <option value="week_lead">מפק"צ השבוע</option>
              <option value="all">כל הסגל</option>
              {users.map((u) => (
                <option key={u.id} value={String(u.id)}>
                  {u.displayName}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <ErrorBox error={error} />
      </div>
    </Modal>
  );
}

function ItemToTemplate({ item, onClose, onDone }: { item: DebriefItem; onClose: () => void; onDone: (d: DebriefDetail) => void }) {
  const toast = useToast();
  const { data } = useApi<Template[]>('/api/templates', ['templates']);
  const [templateId, setTemplateId] = useState<string>('');
  const [title, setTitle] = useState(item.body.length <= 80 ? item.body : '');
  const [offset, setOffset] = useState(-2);
  const [error, setError] = useState<string | null>(null);
  const list = sortHe(data ?? [], (t) => t.name);
  const chosen = templateId || (list.find((t) => t.kind === 'activity') ?? list[0])?.id?.toString() || '';
  const save = async () => {
    setError(null);
    try {
      const d = await api.post<DebriefDetail>(`/api/debrief-items/${item.id}/template`, { templateId: Number(chosen), title, offsetDays: offset });
      onDone(d);
      toast({ title: 'הלקח נוסף לתבנית', body: 'מעכשיו הוא ייפתח אוטומטית בכל הפעלה של התבנית', tone: 'green' });
      emitLocalChange('templates', 'debriefs');
      onClose();
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const tpl = list.find((t) => String(t.id) === chosen);
  return (
    <Modal
      title="הוספת הלקח כשלב קבוע בתבנית"
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-primary" disabled={!title.trim() || !chosen} onClick={() => void save()}>
            הוסף לתבנית
          </button>
          <button className="btn btn-ghost" onClick={onClose}>
            ביטול
          </button>
        </>
      }
    >
      <div className="col gap-16">
        <div className="info-box">
          לדוגמה: "שיחת תיאום עם מדריך - 48 שעות לפני כל פעילות". כל פעם שהתבנית מופעלת על פעילות או שבוע, המשימה תיפתח בזמן היחסי שתבחרו.
        </div>
        {!list.length ? (
          <p className="small muted">
            אין תבניות. צרו תבנית במסך <Link to="/templates">תבניות</Link>.
          </p>
        ) : (
          <>
            <Field label="תבנית">
              <Select className="select" value={chosen} onChange={(e) => setTemplateId(e.target.value)}>
                {list.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name} ({t.kind === 'activity' ? 'פעילות' : t.kind === 'week' ? 'שבוע' : 'כללית'})
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="שם השלב">
              <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} data-autofocus />
            </Field>
            <Field label={`מתי? (ימים ביחס ל${tpl?.kind === 'activity' ? 'פעילות' : 'תחילת השבוע'})`} hint={offset < 0 ? `${-offset} ימים לפני` : offset === 0 ? 'באותו יום' : `${offset} ימים אחרי`}>
              <input className="input" type="number" value={offset} min={-60} max={60} onChange={(e) => setOffset(Number(e.target.value))} style={{ maxWidth: 120 }} />
            </Field>
          </>
        )}
        <ErrorBox error={error} />
      </div>
    </Modal>
  );
}
