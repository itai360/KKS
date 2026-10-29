// Smart entry (הזנה חכמה): write in your own words - a punishment, an entry approval, a cadet at home sick, a
// task, a meeting, several at once - and the app reads where each thing belongs and fills its form. Every
// item is shown as a card to check, change or leave out; nothing is filed until "הזנה", and then each goes
// through its own screen's rules (shared/smartEntry.ts, server/src/smartEntry.ts).

import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { useNavigate } from 'react-router';
import { ABSENCE_REASON_LABELS, ABSENCE_REASONS, PRIORITIES, PRIORITY_LABELS, type AbsenceReason, type Priority } from '@shared/constants';
import { addDays, localDateKey, shortDate, weekdayName } from '@shared/dates';
import { WEEK_NOTE_PART_LABELS, WEEK_NOTE_PARTS, type WeekNotePart } from '@shared/debriefForms';
import { VISITOR_KIND_LABELS } from '@shared/entry';
import { DRESS_ITEMS, PROCEDURE_KINDS, PROCEDURE_LABELS, type ProcedureKind } from '@shared/procedures';
import {
  CADET_KINDS,
  emptyEntry,
  SMART_KIND_ICONS,
  SMART_KIND_LABELS,
  SMART_KIND_PLACES,
  SMART_KINDS,
  smartMissing,
  smartSummary,
  type EntryDraft,
  type SmartAnalysis,
  type SmartFields,
  type SmartItem,
  type SmartKind,
  type SmartLadder,
  type SmartResult,
} from '@shared/smartEntry';
import type { Cadet, DisciplineGuide } from '@shared/types';
import { WEEKLY_KIND_LABELS, WEEKLY_KINDS, type WeeklyKind } from '@shared/weekly';
import { api } from '../lib/api';
import { emitLocalChange } from '../lib/realtime';
import { useSession } from '../lib/session';
import { useApi } from '../lib/useApi';
import { timeLabel } from './Discipline';
import { Icon } from './Icon';
import { timeTone } from './ProcedureReport';
import { DateInput, Select, TimeInput } from './pickers';
import { useToast } from './Toasts';
import { ErrorBox, Field, Modal, Seg } from './ui';

let openHost: ((text: string) => void) | null = null;
/** asked for before the host was up (the app just opened): it opens as the host mounts */
let asked: string | null = null;

/** Opens smart entry - with a text already written (the quick search), which it reads at once. */
export function openSmartEntry(text = ''): void {
  if (openHost) openHost(text);
  else asked = text;
}

export function SmartEntryHost() {
  const [open, setOpen] = useState<{ text: string; n: number } | null>(null);
  useEffect(() => {
    openHost = (text) => setOpen({ text, n: Date.now() });
    if (asked !== null) {
      setOpen({ text: asked, n: Date.now() });
      asked = null;
    }
    return () => {
      openHost = null;
    };
  }, []);
  return open ? <SmartEntryDialog key={open.n} initial={open.text} onClose={() => setOpen(null)} /> : null;
}

const CONFIDENCE: Record<SmartItem['confidence'], { label: string; hint: string }> = {
  high: { label: 'ודאי', hint: 'המקום והפרטים ברורים מהטקסט' },
  medium: { label: 'כמעט ודאי', hint: 'המקום ברור, חלק מהפרטים הושלמו - כדאי לעבור עליהם' },
  low: { label: 'לא בטוח', hint: 'לא ברור לאן זה שייך - בדקו את הסוג' },
};

/** what screens to refresh once an item of the kind is filed */
const TOPICS: Record<SmartKind, string[]> = {
  discipline: ['cadets'],
  procedure: ['cadets'],
  entry: ['entries'],
  exemption: ['cadets'],
  note: ['cadets'],
  absence: ['users'],
  task: ['tasks'],
  event: ['events', 'tasks'],
  weekly: ['weekly'],
  weekNote: ['debriefs'],
  announcement: ['announcements'],
};

/** the kinds whose server check (the ladder, the permissions) depends on what was changed */
const CHECKED: readonly SmartKind[] = ['discipline', 'procedure', 'exemption', 'absence', 'weekly', 'announcement'];

type Phase = 'write' | 'review' | 'done';

function SmartEntryDialog({ initial, onClose }: { initial: string; onClose: () => void }) {
  const toast = useToast();
  const navigate = useNavigate();
  const { users, user, isCommander } = useSession();
  const cadetsApi = useApi<Cadet[]>('/api/cadets', ['cadets']);
  const guide = useApi<DisciplineGuide>('/api/discipline/guide', ['settings']);
  const status = useApi<{ ai: boolean }>('/api/smart/status', []);
  const [phase, setPhase] = useState<Phase>('write');
  const [text, setText] = useState(initial);
  const [items, setItems] = useState<SmartItem[]>([]);
  /** the items the writer left out */
  const [off, setOff] = useState<Set<string>>(new Set());
  const [source, setSource] = useState<SmartAnalysis['source']>('local');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<SmartResult[]>([]);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const cadets = useMemo(() => (cadetsApi.data ?? []).filter((c) => c.status === 'active').sort((a, b) => a.fullName.localeCompare(b.fullName, 'he')), [cadetsApi.data]);
  const people = useMemo(() => users.filter((u) => u.active).sort((a, b) => a.displayName.localeCompare(b.displayName, 'he')), [users]);
  const offenses = guide.data?.offenses ?? [];
  const ai = !!status.data?.ai;

  const analyze = async () => {
    const t = text.trim();
    if (!t || busy) return;
    setBusy(true);
    setError(null);
    try {
      const a = await api.post<SmartAnalysis>('/api/smart/analyze', { text: t });
      setItems(a.items);
      setSource(a.source);
      setOff(new Set());
      setPhase('review');
      if (!a.items.length) setError('לא מצאתי בטקסט משהו להזין - נסו לכתוב מי, מה ומתי');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  // opened with a text (from the quick search): read it at once
  const opened = useRef(false);
  useEffect(() => {
    if (opened.current) return;
    opened.current = true;
    if (initial.trim()) void analyze();
    else textRef.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- the server's word again on what the writer changed (the ladder, the permissions) ----
  const pending = useRef(new Map<string, SmartItem>());
  const timer = useRef<number | undefined>(undefined);
  const recheck = (it: SmartItem) => {
    if (!CHECKED.includes(it.kind)) return;
    pending.current.set(it.key, it);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(async () => {
      const list = [...pending.current.values()];
      pending.current.clear();
      try {
        const r = await api.post<{ items: { key: string; ladder: SmartLadder | null; blocked: string | null }[] }>('/api/smart/check', {
          items: list.map((i) => ({ key: i.key, kind: i.kind, fields: i.fields })),
        });
        setItems((cur) =>
          cur.map((c) => {
            const hit = r.items.find((x) => x.key === c.key);
            return hit ? { ...c, ladder: hit.ladder, blocked: hit.blocked } : c;
          }),
        );
      } catch {
        // the last word stays
      }
    }, 350);
  };
  useEffect(() => {
    return () => window.clearTimeout(timer.current);
  }, []);

  const setFields = (key: string, patch: Partial<SmartFields>) => {
    const cur = items.find((i) => i.key === key);
    if (!cur) return;
    const next: SmartItem = { ...cur, fields: { ...cur.fields, ...patch } };
    setItems((all) => all.map((i) => (i.key === key ? next : i)));
    if ('cadetId' in patch || 'offense' in patch || 'procedure' in patch || 'other' in patch || 'userId' in patch || 'weeklyKind' in patch) recheck(next);
  };

  const setKind = (key: string, kind: SmartKind) => {
    const cur = items.find((i) => i.key === key);
    if (!cur || cur.kind === kind) return;
    const next: SmartItem = { ...cur, kind, confidence: 'high', ladder: null, blocked: null, fields: fieldsFor(kind, cur.fields, user.id) };
    setItems((all) => all.map((i) => (i.key === key ? next : i)));
    recheck(next);
  };

  const remove = (key: string) => setItems((all) => all.filter((i) => i.key !== key));
  const toggle = (key: string) =>
    setOff((s) => {
      const n = new Set(s);
      if (n.has(key)) n.delete(key);
      else n.add(key);
      return n;
    });

  const ready = (it: SmartItem) => !it.blocked && !off.has(it.key) && smartMissing(it).length === 0;
  const chosen = items.filter(ready);
  const waiting = items.filter((it) => !it.blocked && !off.has(it.key) && smartMissing(it).length > 0).length;

  const file = async () => {
    if (!chosen.length || busy) return;
    setBusy(true);
    setError(null);
    try {
      const r = await api.post<{ results: SmartResult[] }>('/api/smart/apply', { items: chosen.map((i) => ({ key: i.key, kind: i.kind, fields: i.fields })) });
      const done = new Set(r.results.filter((x) => x.ok).map((x) => x.key));
      const topics = new Set(chosen.filter((i) => done.has(i.key)).flatMap((i) => TOPICS[i.kind]));
      if (topics.size) emitLocalChange(...topics);
      setResults(r.results);
      // what was filed leaves; what failed stays, to fix and try again
      setItems((all) => all.filter((i) => !done.has(i.key)));
      setPhase('done');
      const ok = done.size;
      if (ok) toast({ title: ok === 1 ? 'פריט אחד הוזן' : `${ok} פריטים הוזנו`, tone: 'green' });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const onKey = (e: ReactKeyboardEvent) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      if (phase === 'write') void analyze();
      else if (phase === 'review') void file();
    }
  };

  const names = (it: SmartItem) => ({
    cadet: it.fields.cadetId ? (cadets.find((c) => c.id === it.fields.cadetId)?.fullName ?? null) : null,
    user: it.fields.userId ? (people.find((u) => u.id === it.fields.userId)?.displayName ?? null) : null,
  });

  const examples = useMemo(() => {
    const [c1, c2] = [cadets[0]?.fullName ?? 'דני כהן', cadets[1]?.fullName ?? 'נועה ברק'];
    const other = people.find((u) => u.id !== user.id)?.displayName ?? 'מפק"צ 2';
    const today = localDateKey(new Date());
    const day = (n: number) => addDays(today, n).split('-').reverse().slice(0, 2).map(Number).join('.');
    return [
      `${c1} איחר למסדר בוקר וקיבל שעה ביציאה`,
      `${c2} - כומתה ושרוך לא תקינים`,
      `פטור מריצות ל${c1} עד יום חמישי`,
      `${c2} בגימלים היום ומחר`,
      `אישור כניסה לישראל ישראלי מחר, 050-0000000, ת"ז 000000000, לצורך הרצאה`,
      `משימה ל${other} להכין מצגת לתדריך עד יום ראשון`,
      `אני בחופשה מ-${day(7)} עד ${day(9)}`,
      'לשבועי: לדבר על העומס בשבוע השטח',
    ];
  }, [cadets, people, user.id]);

  const addExample = (ex: string) => {
    setText((t) => (t.trim() ? `${t.replace(/\s+$/, '')}\n${ex}` : ex));
    textRef.current?.focus();
  };

  const title = (
    <span className="sm-title">
      <span className="sm-spark" aria-hidden="true">
        <Icon name="sparkle" />
      </span>
      הזנה חכמה
    </span>
  );

  const footer =
    phase === 'write' ? (
      <>
        <button type="button" className="btn g-text-btn" onClick={onClose}>
          ביטול
        </button>
        <button type="button" className="btn g-filled-btn sm-go" onClick={() => void analyze()} disabled={!text.trim() || busy}>
          {busy ? <span className="sm-dots" aria-hidden="true" /> : <Icon name="sparkle" />}
          {busy ? 'מנתח...' : 'ניתוח'}
        </button>
      </>
    ) : phase === 'review' ? (
      <>
        <button type="button" className="btn g-text-btn" onClick={() => setPhase('write')} disabled={busy}>
          עריכת הטקסט
        </button>
        <span className="grow sm-foot-note">{waiting > 0 && `${waiting === 1 ? 'פריט אחד צריך' : `${waiting} פריטים צריכים`} השלמה`}</span>
        <button type="button" className="btn g-filled-btn" onClick={() => void file()} disabled={!chosen.length || busy}>
          {busy ? 'מזין...' : chosen.length === 1 ? 'הזנת פריט אחד' : `הזנת ${chosen.length} פריטים`}
        </button>
      </>
    ) : (
      <>
        <button
          type="button"
          className="btn g-text-btn"
          onClick={() => {
            setText('');
            setItems([]);
            setResults([]);
            setError(null);
            setPhase('write');
            window.setTimeout(() => textRef.current?.focus(), 0);
          }}
        >
          הזנה נוספת
        </button>
        {items.length > 0 && (
          <button type="button" className="btn g-text-btn" onClick={() => setPhase('review')}>
            לתיקון {items.length === 1 ? 'הפריט שלא נשמר' : `${items.length} הפריטים שלא נשמרו`}
          </button>
        )}
        <span className="grow" />
        <button type="button" className="btn g-filled-btn" onClick={onClose}>
          סגירה
        </button>
      </>
    );

  return (
    <Modal title={title} onClose={onClose} wide className="sm-modal" footer={footer}>
      <div className="sm-body" onKeyDown={onKey}>
        <ErrorBox error={error} />
        {phase === 'write' && (
          <div className="sm-write">
            <p className="sm-lead">כתבו במילים שלכם מה קרה או מה צריך - כמה דברים יחד, כל אחד בשורה או במשפט. האפליקציה תבין לאן כל דבר שייך ותכין אותו לאישור שלכם.</p>
            <textarea
              ref={textRef}
              className="textarea sm-text"
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={'למשל:\nדני כהן איחר למסדר בוקר וקיבל שעה ביציאה\nאישור כניסה לישראל ישראלי מחר, טלפון ות"ז, לצורך הרצאה\nנועה ברק בגימלים היום'}
              rows={6}
              maxLength={6000}
              aria-label="מה להזין"
              data-autofocus
            />
            <div className="sm-meta">
              <span className={`sm-engine${ai ? ' is-ai' : ''}`}>
                <Icon name={ai ? 'sparkle' : 'zap'} size={14} />
                {ai ? 'ניתוח מעמיק עם Claude' : 'ניתוח בסיסי, בלי AI'}
              </span>
              <span className="tiny muted">Ctrl+Enter לניתוח</span>
            </div>
            {/* without Claude the reading goes by words and names: it says so, and how to turn the AI on */}
            {status.data && !ai && <AiOff commander={isCommander} />}
            <div className="sm-examples" aria-label="דוגמאות">
              <span className="sm-examples-head">דוגמאות - לחיצה מוסיפה לטקסט</span>
              <div className="sm-example-list">
                {examples.map((ex) => (
                  <button type="button" key={ex} className="sm-example" onClick={() => addExample(ex)}>
                    {ex}
                  </button>
                ))}
              </div>
            </div>
            <div className="sm-places">
              <span className="sm-examples-head">לאן אפשר להזין</span>
              <div className="sm-place-list">
                {SMART_KINDS.map((k) => (
                  <span key={k} className={`sm-place k-${k}`}>
                    <Icon name={SMART_KIND_ICONS[k]} size={14} />
                    {SMART_KIND_LABELS[k]}
                  </span>
                ))}
              </div>
            </div>
            {busy && <Skeleton />}
          </div>
        )}

        {phase === 'review' && (
          <div className="sm-review">
            <div className="sm-review-head">
              <span className="sm-found">{items.length === 0 ? 'לא נמצא מה להזין' : items.length === 1 ? 'מצאתי דבר אחד להזין' : `מצאתי ${items.length} דברים להזין`}</span>
              <span className={`sm-engine${source === 'ai' ? ' is-ai' : ''}`}>
                <Icon name={source === 'ai' ? 'sparkle' : 'zap'} size={14} />
                {source === 'ai' ? 'נותח עם Claude' : 'ניתוח בסיסי, בלי AI'}
              </span>
            </div>
            {source !== 'ai' && items.length > 0 && (
              <p className="sm-check-note">
                {ai ? 'Claude לא ענה הפעם, אז הטקסט נקרא בניתוח הבסיסי. ' : ''}כדאי לעבור על כל פריט: אם משהו לא במקום הנכון, אפשר להחליף לו מקום או להשלים פרטים לפני ההזנה.
              </p>
            )}
            <ul className="sm-cards">
              {items.map((it) => (
                <SmartCard
                  key={it.key}
                  item={it}
                  on={!off.has(it.key)}
                  names={names(it)}
                  cadets={cadets}
                  people={people}
                  offenses={offenses}
                  onToggle={() => toggle(it.key)}
                  onRemove={() => remove(it.key)}
                  onKind={(k) => setKind(it.key, k)}
                  onFields={(p) => setFields(it.key, p)}
                />
              ))}
            </ul>
          </div>
        )}

        {phase === 'done' && (
          <div className="sm-done">
            <ul className="sm-results">
              {results.map((r) => (
                <li key={r.key} className={r.ok ? 'is-ok' : 'is-bad'}>
                  <span className="sm-result-icon" aria-hidden="true">
                    <Icon name={r.ok ? 'check' : 'alert'} size={16} />
                  </span>
                  <span className="grow">{r.message}</span>
                  {r.ok && r.link && (
                    <button
                      type="button"
                      className="g-link-btn"
                      onClick={() => {
                        onClose();
                        navigate(r.link!);
                      }}
                    >
                      לצפייה
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </Modal>
  );
}

/** a kind's fields when the writer moves an item to it: what it shares with the old kind, and its defaults */
function fieldsFor(kind: SmartKind, f: SmartFields, me: number): SmartFields {
  const today = localDateKey(new Date());
  const next: SmartFields = { ...f };
  next.cadetId = CADET_KINDS.includes(kind) ? f.cadetId : null;
  switch (kind) {
    case 'discipline':
    case 'note':
      next.date = f.date && f.date <= today ? f.date : today;
      if (!next.title) next.title = f.details.split(/[,.]/)[0].slice(0, 60);
      break;
    case 'procedure':
      next.procedure = f.procedure ?? 'other';
      if (next.procedure === 'other' && !next.other) next.other = (f.title || f.details).slice(0, 80);
      break;
    case 'exemption':
      if (!next.subject) next.subject = f.title.slice(0, 80);
      break;
    case 'entry':
      next.entry = f.entry ?? { ...emptyEntry(), reason: f.details.slice(0, 300) };
      break;
    case 'absence':
      next.userId = f.userId ?? me;
      next.absenceReason = f.absenceReason ?? 'other';
      next.endDate = f.endDate ?? f.date;
      break;
    case 'task':
      if (!next.ownerIds.length) next.ownerIds = [me];
      if (!next.title) next.title = f.details.slice(0, 120);
      break;
    case 'event':
      if (!next.title) next.title = (f.details || f.subject).slice(0, 120);
      next.date = f.date ?? today;
      break;
    case 'weekly':
      next.weeklyKind = f.weeklyKind ?? 'topic';
      if (!next.title) next.title = f.details.slice(0, 300);
      break;
    case 'weekNote':
      next.part = f.part ?? 'improve';
      if (!next.details) next.details = f.title;
      break;
    case 'announcement':
      if (!next.title) next.title = f.details.slice(0, 160);
      break;
  }
  return next;
}

function Skeleton() {
  return (
    <ul className="sm-cards sm-skeleton" aria-hidden="true">
      {[0, 1].map((i) => (
        <li key={i} className="sm-card">
          <div className="sm-card-head">
            <span className="sm-kind-icon" />
            <span className="sm-bar w60" />
          </div>
          <span className="sm-bar w90" />
          <span className="sm-bar w40" />
        </li>
      ))}
    </ul>
  );
}

function LadderLine({ ladder, kind }: { ladder: SmartLadder; kind: SmartKind }) {
  return (
    <div className={`sm-ladder ${timeTone(ladder.occurrence)}`}>
      <strong>{timeLabel(ladder.occurrence)}</strong>
      {kind === 'procedure' ? <span> לסוג הזה אצל הצוער</span> : ladder.step ? <span> · לפי המדרג: {ladder.step}</span> : <span> · המדרג לא קובע לפעם הזו</span>}
      {ladder.note && <span className="sm-ladder-tag">הערת משמעת</span>}
      {ladder.committee && <span className="sm-ladder-tag">ועדה</span>}
    </div>
  );
}

/** a day in words: "היום", "מחר", "אתמול", or "יום ה׳ 5.11" */
function dayWords(key: string | null): string {
  if (!key) return '';
  const today = localDateKey(new Date());
  if (key === today) return 'היום';
  if (key === addDays(today, 1)) return 'מחר';
  if (key === addDays(today, -1)) return 'אתמול';
  return `${weekdayName(key)} ${shortDate(key)}`;
}
const range = (a: string | null, b: string | null) => (b && a && b > a ? `${dayWords(a)} - ${dayWords(b)}` : dayWords(a));

/** the few things the card shows closed: the day, the hours, who */
function facts(item: SmartItem, people: { id: number; displayName: string }[]): string[] {
  const f = item.fields;
  const who = (id: number | undefined) => people.find((u) => u.id === id)?.displayName ?? '';
  switch (item.kind) {
    case 'discipline':
    case 'note':
      return [dayWords(f.date), item.kind === 'discipline' && f.formal ? 'הערת משמעת' : ''].filter(Boolean);
    case 'entry': {
      const e = f.entry ?? emptyEntry();
      return [range(f.date, f.endDate), e.phone, e.idNumber && `${e.visitorKind === 'soldier' ? 'מ.א' : 'ת"ז'} ${e.idNumber}`, e.byCar ? (e.carMilitary ? 'ברכב צבאי' : 'ברכב') : '', e.reason].filter(Boolean);
    }
    case 'exemption':
      return [f.until ? `עד ${dayWords(f.until)}` : 'עד להודעה חדשה', f.details].filter(Boolean);
    case 'absence':
      return [range(f.date, f.endDate), f.details].filter(Boolean);
    case 'task':
      return [f.date ? `עד ${dayWords(f.date)}${f.time ? ` ${f.time}` : ''}` : '', who(f.ownerIds[0])].filter(Boolean);
    case 'event':
      return [dayWords(f.date), f.time ? (f.endTime ? `${f.time}-${f.endTime}` : f.time) : 'כל היום', f.location, who(f.ownerIds[0])].filter(Boolean);
    case 'procedure':
      return [f.procedure === 'dress' ? f.dress.join(', ') : f.procedure === 'phone' ? f.situation : ''].filter(Boolean);
    case 'weekly':
      return [f.weeklyKind === 'closure' ? who(f.ownerIds[0]) : ''].filter(Boolean);
    case 'weekNote':
      return [f.details.length > 60 ? `${f.details.slice(0, 60)}...` : f.details].filter(Boolean);
    case 'announcement':
      return [f.urgent ? 'דחוף' : '', f.details.length > 60 ? `${f.details.slice(0, 60)}...` : f.details].filter(Boolean);
  }
}

interface CardProps {
  item: SmartItem;
  on: boolean;
  names: { cadet: string | null; user: string | null };
  cadets: Cadet[];
  people: { id: number; displayName: string }[];
  offenses: DisciplineGuide['offenses'];
  onToggle: () => void;
  onRemove: () => void;
  onKind: (k: SmartKind) => void;
  onFields: (p: Partial<SmartFields>) => void;
}

function SmartCard({ item, on, names, cadets, people, offenses, onToggle, onRemove, onKind, onFields }: CardProps) {
  const missing = smartMissing(item);
  const summary = smartSummary(item, names);
  const blocked = !!item.blocked;
  const conf = CONFIDENCE[item.confidence];
  const kindOptions = [item.kind, ...item.alternatives.filter((k) => k !== item.kind), ...SMART_KINDS.filter((k) => k !== item.kind && !item.alternatives.includes(k))];
  // open where there is something to do: a field missing, or a reading not sure of itself
  const [open, setOpen] = useState(() => missing.length > 0 || item.confidence === 'low');
  const shown = open || (missing.length > 0 && !blocked);
  const glance = facts(item, people);
  return (
    <li className={`sm-card k-${item.kind}${on && !blocked ? '' : ' is-off'}${blocked ? ' is-blocked' : ''}${missing.length && !blocked ? ' is-missing' : ''}`}>
      <div className="sm-card-head">
        <label className="sm-check" title={blocked ? item.blocked! : on ? 'לא להזין את זה' : 'להזין גם את זה'}>
          <input type="checkbox" checked={on && !blocked} disabled={blocked} onChange={onToggle} aria-label={`להזין: ${SMART_KIND_LABELS[item.kind]} ${summary}`} />
        </label>
        <span className={`sm-kind-icon k-${item.kind}`} aria-hidden="true">
          <Icon name={SMART_KIND_ICONS[item.kind]} size={18} />
        </span>
        <div className="grow sm-card-title">
          <Select className="select sm-kind-select" value={item.kind} onChange={(e) => onKind(e.target.value as SmartKind)} aria-label="לאן להזין" fit searchable={false}>
            {kindOptions.map((k) => (
              <option key={k} value={k}>
                {SMART_KIND_LABELS[k]}
              </option>
            ))}
          </Select>
          {summary && <span className="sm-summary">{summary}</span>}
        </div>
        <span className={`sm-conf c-${item.confidence}`} title={conf.hint}>
          {conf.label}
        </span>
        <button type="button" className={`icon-btn sm-more${shown ? ' is-open' : ''}`} onClick={() => setOpen((o) => !o)} aria-expanded={shown} aria-label={shown ? 'סגירת הפרטים' : 'עריכת הפרטים'} title={shown ? 'סגירת הפרטים' : 'עריכת הפרטים'}>
          <Icon name="chevronDown" size={18} />
        </button>
        <button type="button" className="icon-btn sm-remove" onClick={onRemove} aria-label="הסרת הפריט" title="הסרה">
          <Icon name="x" size={18} />
        </button>
      </div>
      <div className="sm-where">{SMART_KIND_PLACES[item.kind]}</div>
      {glance.length > 0 && (
        <div className="sm-facts">
          {glance.map((g, i) => (
            <span key={i} className="sm-fact">
              {g}
            </span>
          ))}
        </div>
      )}
      {item.ladder && <LadderLine ladder={item.ladder} kind={item.kind} />}
      {blocked && (
        <div className="sm-blocked">
          <Icon name="lock" size={14} /> {item.blocked}
        </div>
      )}
      {shown && (
        <div className="sm-fields">
          {item.source && (
            <p className="sm-source">
              ״{item.source}״{item.why && <span className="sm-why"> · זוהה לפי: {item.why}</span>}
            </p>
          )}
          <Fields item={item} cadets={cadets} people={people} offenses={offenses} set={onFields} />
        </div>
      )}
      {missing.length > 0 && !blocked && (
        <div className="sm-missing">
          <Icon name="alert" size={14} /> חסר: {missing.join(', ')}
        </div>
      )}
    </li>
  );
}

// ---------------- each kind's fields ----------------

function CadetSelect({ value, cadets, onChange }: { value: number | null; cadets: Cadet[]; onChange: (id: number | null) => void }) {
  return (
    <Select value={value ? String(value) : ''} onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)} aria-label="צוער">
      <option value="">בחירת צוער</option>
      {cadets.map((c) => (
        <option key={c.id} value={c.id}>
          {c.fullName}
          {c.teamName ? ` · ${c.teamName}` : ''}
        </option>
      ))}
    </Select>
  );
}

function PersonSelect({ value, people, onChange, label, empty = 'בחירה' }: { value: number | null; people: { id: number; displayName: string }[]; onChange: (id: number | null) => void; label: string; empty?: string }) {
  return (
    <Select value={value ? String(value) : ''} onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)} aria-label={label}>
      <option value="">{empty}</option>
      {people.map((u) => (
        <option key={u.id} value={u.id}>
          {u.displayName}
        </option>
      ))}
    </Select>
  );
}

function Text({ value, onChange, label, max = 200, placeholder }: { value: string; onChange: (v: string) => void; label: string; max?: number; placeholder?: string }) {
  return <input className="input" value={value} onChange={(e) => onChange(e.target.value)} aria-label={label} maxLength={max} placeholder={placeholder} />;
}

function Area({ value, onChange, label, max = 2000, rows = 2 }: { value: string; onChange: (v: string) => void; label: string; max?: number; rows?: number }) {
  return <textarea className="textarea" value={value} onChange={(e) => onChange(e.target.value)} aria-label={label} maxLength={max} rows={rows} />;
}

function Check({ checked, onChange, children }: { checked: boolean; onChange: (v: boolean) => void; children: string }) {
  return (
    <label className="g-check sm-toggle">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} /> {children}
    </label>
  );
}

function Fields({ item, cadets, people, offenses, set }: { item: SmartItem; cadets: Cadet[]; people: { id: number; displayName: string }[]; offenses: DisciplineGuide['offenses']; set: (p: Partial<SmartFields>) => void }) {
  const f = item.fields;
  const cadet = (
    <Field label="צוער" required>
      <CadetSelect value={f.cadetId} cadets={cadets} onChange={(cadetId) => set({ cadetId })} />
    </Field>
  );
  const date = (label: string, required = true) => (
    <Field label={label} required={required}>
      <DateInput value={f.date ?? ''} onChange={(v) => set({ date: v || null })} aria-label={label} />
    </Field>
  );
  switch (item.kind) {
    case 'discipline':
      return (
        <div className="sm-grid">
          {cadet}
          {date('מתי')}
          <Field label="במדרג האכיפה" className="span-2">
            <Select value={f.offense} onChange={(e) => set({ offense: e.target.value, title: e.target.value ? (e.target.value.split(' · ').pop() ?? f.title) : f.title })} aria-label="עבירה במדרג">
              <option value="">{offenses.length ? 'לא מהמדרג - מקרה אחר' : 'המדרג עוד לא יובא'}</option>
              {offenses.map((o) => (
                <option key={o.key} value={o.key}>
                  {o.name} · {o.category}
                </option>
              ))}
            </Select>
          </Field>
          {!f.offense && (
            <Field label="מה קרה" className="span-2">
              <Text value={f.title} onChange={(title) => set({ title })} label="מה קרה" />
            </Field>
          )}
          <Field label="פירוט" className="span-2">
            <Area value={f.details} onChange={(details) => set({ details })} label="פירוט" />
          </Field>
          <Check checked={f.formal} onChange={(formal) => set({ formal })}>
            הערת משמעת (נספרת לשלוש)
          </Check>
        </div>
      );
    case 'procedure':
      return (
        <div className="sm-grid">
          {cadet}
          <Field label="מה לא נשמר" required className="span-2">
            <Seg<ProcedureKind> value={f.procedure ?? 'other'} options={PROCEDURE_KINDS.map((k) => ({ value: k, label: PROCEDURE_LABELS[k] }))} onChange={(procedure) => set({ procedure })} wrap />
          </Field>
          {f.procedure === 'dress' && (
            <Field label="מה בדיגום" required className="span-2">
              <div className="sm-chips">
                {DRESS_ITEMS.map((d) => (
                  <button
                    type="button"
                    key={d}
                    className={`sm-chip${f.dress.includes(d) ? ' on' : ''}`}
                    aria-pressed={f.dress.includes(d)}
                    onClick={() => set({ dress: f.dress.includes(d) ? f.dress.filter((x) => x !== d) : [...f.dress, d] })}
                  >
                    {d}
                  </button>
                ))}
              </div>
            </Field>
          )}
          {f.procedure === 'phone' && (
            <Field label="באיזו סיטואציה" className="span-2">
              <Text value={f.situation} onChange={(situation) => set({ situation })} label="סיטואציה" max={300} />
            </Field>
          )}
          {f.procedure === 'other' && (
            <Field label="מה לא נשמר" required className="span-2">
              <Text value={f.other} onChange={(other) => set({ other })} label="מה לא נשמר" max={80} />
            </Field>
          )}
          <Field label="פירוט" className="span-2">
            <Area value={f.details} onChange={(details) => set({ details })} label="פירוט" />
          </Field>
        </div>
      );
    case 'entry': {
      const e = f.entry ?? emptyEntry();
      const setE = (p: Partial<EntryDraft>) => set({ entry: { ...e, ...p } });
      return (
        <div className="sm-grid">
          <Field label="שם מלא" required>
            <Text value={e.fullName} onChange={(fullName) => setE({ fullName })} label="שם מלא" max={80} />
          </Field>
          {date('תאריך הביקור')}
          <Field label="עד (ביקור של כמה ימים)">
            <DateInput value={f.endDate ?? ''} onChange={(v) => set({ endDate: v || null })} min={f.date ?? undefined} aria-label="היום האחרון של הביקור" />
          </Field>
          <Field label="טלפון" required>
            <Text value={e.phone} onChange={(phone) => setE({ phone })} label="טלפון" max={20} />
          </Field>
          <Field label="אזרח / חייל" required>
            <Seg value={e.visitorKind} options={(['civilian', 'soldier'] as const).map((v) => ({ value: v, label: VISITOR_KIND_LABELS[v] }))} onChange={(visitorKind) => setE({ visitorKind })} />
          </Field>
          {e.visitorKind === 'soldier' && (
            <Field label="דרגה" required>
              <Text value={e.rank} onChange={(rank) => setE({ rank })} label="דרגה" max={30} />
            </Field>
          )}
          <Field label={e.visitorKind === 'soldier' ? 'מספר אישי' : 'ת"ז'} required>
            <Text value={e.idNumber} onChange={(idNumber) => setE({ idNumber })} label="מספר זהות" max={10} />
          </Field>
          <Field label="סיווג ביטחוני">
            <Text value={e.clearance} onChange={(clearance) => setE({ clearance })} label="סיווג" max={30} />
          </Field>
          <Field label="סיבת הגעה" required className="span-2">
            <Text value={e.reason} onChange={(reason) => setE({ reason })} label="סיבת הגעה" max={300} />
          </Field>
          <div className="sm-row span-2">
            <Check checked={e.escort} onChange={(escort) => setE({ escort })}>
              דרוש ליווי
            </Check>
            <Check checked={e.byCar} onChange={(byCar) => setE({ byCar })}>
              מגיע ברכב
            </Check>
          </div>
          {e.byCar && (
            <>
              <Field label="רכב" className="span-2">
                <Seg value={e.carMilitary ? 'military' : 'civil'} options={[{ value: 'civil', label: 'אזרחי' }, { value: 'military', label: 'צבאי' }]} onChange={(v) => setE({ carMilitary: v === 'military' })} />
              </Field>
              <Field label="מספר רכב" required>
                <Text value={e.carNumber} onChange={(carNumber) => setE({ carNumber })} label="מספר רכב" max={20} />
              </Field>
              <Field label="סוג וצבע רכב" required>
                <Text value={e.carKind} onChange={(carKind) => setE({ carKind })} label="סוג וצבע רכב" max={60} />
              </Field>
            </>
          )}
        </div>
      );
    }
    case 'exemption':
      return (
        <div className="sm-grid">
          {cadet}
          <Field label="פטור מ" required>
            <Text value={f.subject} onChange={(subject) => set({ subject })} label="ממה הפטור" max={80} placeholder="ריצות, נעליים צבאיות..." />
          </Field>
          <Field label="עד (ריק - עד להודעה חדשה)">
            <DateInput value={f.until ?? ''} onChange={(v) => set({ until: v || null })} aria-label="עד תאריך" />
          </Field>
          <Field label="סיבה / פירוט">
            <Text value={f.details} onChange={(details) => set({ details })} label="סיבה" max={300} />
          </Field>
        </div>
      );
    case 'note':
      return (
        <div className="sm-grid">
          {cadet}
          {date('מתי')}
          <Field label="כותרת" className="span-2">
            <Text value={f.title} onChange={(title) => set({ title })} label="כותרת" />
          </Field>
          <Field label="תוכן" required className="span-2">
            <Area value={f.details} onChange={(details) => set({ details })} label="תוכן" rows={3} />
          </Field>
        </div>
      );
    case 'absence':
      return (
        <div className="sm-grid">
          <Field label="איש הסגל" required>
            <PersonSelect value={f.userId} people={people} onChange={(userId) => set({ userId })} label="איש הסגל" />
          </Field>
          <Field label="סיבה">
            <Select value={f.absenceReason ?? 'other'} onChange={(e) => set({ absenceReason: e.target.value as AbsenceReason })} aria-label="סיבת ההיעדרות">
              {ABSENCE_REASONS.map((r) => (
                <option key={r} value={r}>
                  {ABSENCE_REASON_LABELS[r]}
                </option>
              ))}
            </Select>
          </Field>
          {date('מתאריך')}
          <Field label="עד תאריך">
            <DateInput value={f.endDate ?? ''} min={f.date ?? undefined} onChange={(v) => set({ endDate: v || null })} aria-label="עד תאריך" />
          </Field>
          <Field label="הערה" className="span-2">
            <Text value={f.details} onChange={(details) => set({ details })} label="הערה" max={300} />
          </Field>
        </div>
      );
    case 'task':
      return (
        <div className="sm-grid">
          <Field label="משימה" required className="span-2">
            <Text value={f.title} onChange={(title) => set({ title })} label="שם המשימה" />
          </Field>
          <Field label="אחראי" required>
            <PersonSelect value={f.ownerIds[0] ?? null} people={people} onChange={(id) => set({ ownerIds: id ? [id, ...f.ownerIds.slice(1).filter((x) => x !== id)] : f.ownerIds.slice(1) })} label="אחראי" />
          </Field>
          <Field label="עדיפות">
            <Select value={f.priority ?? 'normal'} onChange={(e) => set({ priority: e.target.value as Priority })} aria-label="עדיפות">
              {PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {PRIORITY_LABELS[p]}
                </option>
              ))}
            </Select>
          </Field>
          {date('דד-ליין')}
          <Field label="שעה">
            <TimeInput value={f.time ?? '18:00'} onChange={(v) => set({ time: v || null })} aria-label="שעת הדד-ליין" />
          </Field>
          {f.ownerIds.length > 1 && <p className="tiny muted span-2">ועוד {f.ownerIds.length - 1} אחראים נוספים מהטקסט</p>}
          <Field label="פירוט" className="span-2">
            <Area value={f.details} onChange={(details) => set({ details })} label="פירוט" />
          </Field>
        </div>
      );
    case 'event':
      return (
        <div className="sm-grid">
          <Field label="כותרת" required className="span-2">
            <Text value={f.title} onChange={(title) => set({ title })} label="כותרת האירוע" />
          </Field>
          {date('תאריך')}
          <div className="sm-times">
            <Field label="משעה">
              <TimeInput value={f.time ?? ''} onChange={(v) => set({ time: v || null })} aria-label="שעת התחלה" />
            </Field>
            <Field label="עד">
              <TimeInput value={f.endTime ?? ''} onChange={(v) => set({ endTime: v || null })} aria-label="שעת סיום" />
            </Field>
          </div>
          <Field label="מיקום">
            <Text value={f.location} onChange={(location) => set({ location })} label="מיקום" max={120} />
          </Field>
          <Field label="אחראי">
            <PersonSelect value={f.ownerIds[0] ?? null} people={people} onChange={(id) => set({ ownerIds: id ? [id] : [] })} label="אחראי" empty="ללא אחראי" />
          </Field>
          <Field label="תיאור" className="span-2">
            <Area value={f.details} onChange={(details) => set({ details })} label="תיאור" />
          </Field>
          {!f.time && <p className="tiny muted span-2">בלי שעה - האירוע יירשם לכל היום</p>}
        </div>
      );
    case 'weekly':
      return (
        <div className="sm-grid">
          <Field label="סוג" required>
            <Select value={f.weeklyKind ?? ''} onChange={(e) => set({ weeklyKind: (e.target.value || null) as WeeklyKind | null })} aria-label="סוג">
              <option value="">בחירה</option>
              {WEEKLY_KINDS.map((k) => (
                <option key={k} value={k}>
                  {WEEKLY_KIND_LABELS[k]}
                </option>
              ))}
            </Select>
          </Field>
          {f.weeklyKind === 'closure' && (
            <Field label="אחראי">
              <PersonSelect value={f.ownerIds[0] ?? null} people={people} onChange={(id) => set({ ownerIds: id ? [id] : [] })} label="אחראי" empty="ללא אחראי" />
            </Field>
          )}
          <Field label="על מה מדובר" required className="span-2">
            <Text value={f.title} onChange={(title) => set({ title })} label="על מה מדובר" max={300} />
          </Field>
          <Field label="פירוט" className="span-2">
            <Area value={f.details} onChange={(details) => set({ details })} label="פירוט" />
          </Field>
        </div>
      );
    case 'weekNote':
      return (
        <div className="sm-grid">
          <Field label="לאן בתחקיר" required className="span-2">
            <Seg<WeekNotePart> value={f.part ?? 'improve'} options={WEEK_NOTE_PARTS.map((p) => ({ value: p, label: WEEK_NOTE_PART_LABELS[p] }))} onChange={(part) => set({ part })} wrap />
          </Field>
          <Field label="מה להוסיף" required className="span-2">
            <Area value={f.details} onChange={(details) => set({ details })} label="מה להוסיף" rows={3} max={3000} />
          </Field>
          {f.part === 'now' && (
            <Field label="אחראי ליישום">
              <PersonSelect value={f.ownerIds[0] ?? null} people={people} onChange={(id) => set({ ownerIds: id ? [id] : [] })} label="אחראי" empty="ללא אחראי" />
            </Field>
          )}
        </div>
      );
    case 'announcement':
      return (
        <div className="sm-grid">
          <Field label="כותרת" required className="span-2">
            <Text value={f.title} onChange={(title) => set({ title })} label="כותרת ההודעה" max={160} />
          </Field>
          <Field label="תוכן" className="span-2">
            <Area value={f.details} onChange={(details) => set({ details })} label="תוכן ההודעה" rows={3} max={5000} />
          </Field>
          <Check checked={f.urgent} onChange={(urgent) => set({ urgent })}>
            דחוף
          </Check>
        </div>
      );
  }
}

/** said when the server has no Claude: the reading goes by words and names, and how the AI is turned on */
function AiOff({ commander }: { commander: boolean }) {
  return (
    <div className="sm-ai-off" role="note">
      <Icon name="sparkle" size={18} />
      <div className="col">
        <b>ההזנה עובדת עכשיו בלי בינה מלאכותית</b>
        <span>
          בלי AI האפליקציה מזהה את הטקסט לפי מילים ושמות, ולכן לפעמים לא מבינה לאן לשייך משפט חופשי.{' '}
          {commander ? (
            <>
              כדי שתבין כמו AI מקצועי (Claude) - כל ניסוח, כמה דברים במשפט אחד, שמות פרטיים - צריך להוסיף בהגדרות השרת (Vercel) את המפתח{' '}
              <code dir="ltr">ANTHROPIC_API_KEY</code>. זה אותו מפתח שמפעיל את סיכום השיחות האישיות מהקלטה.
            </>
          ) : (
            'כדי שתבין כמו AI מקצועי (Claude), מפקד הקורס צריך לחבר את Claude בהגדרות השרת.'
          )}
        </span>
      </div>
    </div>
  );
}
