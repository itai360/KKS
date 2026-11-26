import { useEffect, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router';
import { LESSON_HORIZON_LABELS, type DebriefAnswers, type DebriefSection } from '@shared/debriefForms';
import type { DebriefContributions as Contributions, DebriefContributionLesson, DebriefContributionPoint, DebriefDetail } from '@shared/types';
import { api } from '../lib/api';
import { useApi } from '../lib/useApi';
import { useDraft } from '../lib/draft';
import { fmtAgo } from '../lib/format';
import { emitLocalChange } from '../lib/realtime';
import { useSession } from '../lib/session';
import { DateInput, ErrorBox, Modal, Select } from './ui';
import { Icon } from './Icon';
import { useToast } from './Toasts';

interface Props {
  data: DebriefDetail;
  setData: (data: DebriefDetail) => void;
  beforeReview: () => Promise<boolean>;
  sections: DebriefSection[];
  renderSection: (section: DebriefSection, n: number, answers: DebriefAnswers, onChange: (key: string, value: unknown) => void) => ReactNode;
  renderPoint: (point: DebriefContributionPoint) => ReactNode;
}

export function DebriefContributions({ data, setData, beforeReview, sections, renderSection, renderPoint }: Props) {
  const url = `/api/debriefs/${data.debrief.id}/contributions`;
  const { data: collection, error: loadError, reload, setData: setCollection } = useApi<Contributions>(url, ['debriefs']);
  const [editing, setEditing] = useState(false);
  const [params, setParams] = useSearchParams();
  useEffect(() => {
    if (params.get('contribute') !== '1') return;
    setEditing(true);
    const next = new URLSearchParams(params);
    next.delete('contribute');
    setParams(next, { replace: true });
  }, [params, setParams]);
  const [selected, setSelected] = useState<number[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();
  const pending = collection?.contributions.flatMap((c) => c.points.filter((p) => p.status === 'pending')) ?? [];
  const selectedPending = pending.filter((p) => selected.includes(p.id)).map((p) => p.id);
  const canReview = collection?.canReview && data.debrief.status === 'draft';

  const review = async (pointIds: number[], decision: 'accepted' | 'rejected') => {
    setBusy(true);
    setError(null);
    try {
      if (!await beforeReview()) throw new Error('יש שינויים בטופס שטרם נשמרו. נסו שוב אחרי שמירתם.');
      const result = await api.post<DebriefDetail>(`${url}/review`, { pointIds, decision });
      setData(result);
      setSelected([]);
      await reload();
      emitLocalChange('debriefs');
      toast({ title: decision === 'accepted' ? 'התוספות שולבו בטיוטה. האישור הסופי נשאר אצל מפקד הקורס.' : 'התוספות סומנו כלא לשילוב', tone: 'green' });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card contribution-panel no-print" aria-labelledby="contribution-title">
      <div className="card-head wrap gap-8">
        <Icon name="users" />
        <h2 className="grow" id="contribution-title">תוספות הסגל</h2>
        <span className="badge">{pending.length} לבדיקה</span>
        {collection?.canContribute && data.debrief.status === 'draft' && <button className="btn btn-primary btn-sm" onClick={() => setEditing(true)}><Icon name="plus" /> הוספת התחקיר שלי</button>}
      </div>
      <div className="card-body col gap-12">
        <p className="small muted">מרגע פתיחת התחקיר אפשר להוסיף מהזווית שלך באותו טופס, גם לפני שליחתו לאישור המפקד. אחראי התחקיר בוחר מה לשלב, ולאחר מכן מפקד הקורס מאשר את התחקיר.</p>
        <ErrorBox error={loadError || error} />
        {loadError && <button className="btn btn-sm" onClick={() => void reload()}>ניסיון נוסף</button>}
        {!collection && !loadError && <p role="status" className="muted">טוען תוספות…</p>}
        {collection && !collection.contributions.length && <p className="muted small">עדיין לא נשלחו תוספות מהסגל.</p>}
        {canReview && pending.length > 0 && (
          <div className="contribution-actions col gap-8">
            <p className="small">יש לעבור על כל התוספות לפני שליחת התחקיר לאישור. הציון שכבר מולא יישמר; ציוני הסגל יתווספו כתצפיות בתמונה הכללית.</p>
            {data.debrief.submittedAt && <p className="small t-orange">שילוב תוספות יחזיר את התחקיר להכנה לשליחה מחדש למפקד הקורס.</p>}
            <div className="row wrap gap-8">
              <label className="check"><input type="checkbox" disabled={busy} checked={selectedPending.length === pending.length} onChange={(e) => setSelected(e.target.checked ? pending.map((p) => p.id) : [])} /> סימון הכול</label>
              <span className="small muted" role="status">{selectedPending.length} נבחרו</span>
              <button className="btn btn-primary btn-sm" disabled={busy || !selectedPending.length} onClick={() => void review(selectedPending, 'accepted')}>שילוב המסומנים</button>
              <button className="btn btn-sm" disabled={busy || !selectedPending.length} onClick={() => void review(selectedPending, 'rejected')}>לא לשלב מסומנים</button>
            </div>
          </div>
        )}
        {collection?.contributions.map((c) => {
          const waiting = c.points.filter((p) => p.status === 'pending').length;
          return <details key={c.id} className="contribution-group" open={waiting > 0 ? true : undefined}>
            <summary><strong>{c.authorName}</strong><span className="small muted"> · {fmtAgo(c.createdAt)} · {waiting ? `${waiting} לבדיקה` : 'נבדק'}</span></summary>
            <div className="col gap-12 mt-12">{c.points.map((p) => <article className="contribution-point col gap-8" key={p.id}>
              <div className="row wrap gap-8">
                {canReview && p.status === 'pending' && <input type="checkbox" aria-label={`סימון ${p.label} מאת ${c.authorName}`} disabled={busy} checked={selected.includes(p.id)} onChange={(e) => setSelected((old) => e.target.checked ? [...old, p.id] : old.filter((id) => id !== p.id))} />}
                <strong className="grow">{p.label}</strong>
                <span className={`badge ${p.status === 'accepted' ? 't-green' : p.status === 'rejected' ? 't-gray' : 't-orange'}`}>{p.status === 'accepted' ? 'שולב בטיוטה' : p.status === 'rejected' ? 'לא לשילוב' : 'ממתין לבדיקה'}</span>
              </div>
              {p.lesson ? <LessonPreview lesson={p.lesson} /> : renderPoint(p)}
              {p.reviewedAt && <p className="tiny muted">נבדק על ידי {p.reviewedByName} · {fmtAgo(p.reviewedAt)}</p>}
              {canReview && p.status === 'pending' && <div className="row wrap gap-8">
                <button className="btn btn-sm" disabled={busy} onClick={() => void review([p.id], 'accepted')}>שילוב בטיוטה</button>
                <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => void review([p.id], 'rejected')}>לא לשלב</button>
              </div>}
            </article>)}</div>
          </details>;
        })}
      </div>
      {editing && collection?.canContribute && data.debrief.status === 'draft' && <ContributionEditor key={data.debrief.id} data={data} sections={sections} renderSection={renderSection} onClose={() => setEditing(false)} onSubmitted={(result) => {
        setCollection(result);
        setEditing(false);
        emitLocalChange('debriefs');
        toast({ title: 'התוספות נשלחו לבדיקת אחראי התחקיר', tone: 'green' });
      }} />}
    </section>
  );
}

function LessonPreview({ lesson }: { lesson: DebriefContributionLesson }) {
  const { users, tracks } = useSession();
  return <><p className="prewrap">{lesson.body}</p><p className="small muted">{lesson.horizon === 'now' ? 'להמשך המחזור' : 'למחזור הבא'}{lesson.ownerId ? ` · ${users.find((u) => u.id === lesson.ownerId)?.displayName ?? 'אחראי שנבחר'}` : ''}{lesson.dueDate ? ` · עד ${lesson.dueDate}` : ''}{lesson.trackId ? ` · ציר ${tracks.find((t) => t.id === lesson.trackId)?.name ?? 'שנבחר'}` : ''}</p></>;
}

function ContributionEditor({ data, sections, renderSection, onClose, onSubmitted }: Pick<Props, 'data' | 'sections' | 'renderSection'> & { onClose: () => void; onSubmitted: (data: Contributions) => void }) {
  const { users, tracks } = useSession();
  const [draft, setDraft] = useDraft(`debrief-contribution:${data.debrief.id}`);
  let stored: { answers?: DebriefAnswers; lessons?: DebriefContributionLesson[] } = {};
  try { stored = JSON.parse(draft || '{}'); } catch { /* an old draft starts empty */ }
  const answers = stored.answers ?? {};
  const lessons = stored.lessons ?? [];
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = (patch: Partial<typeof stored>) => setDraft(JSON.stringify({ answers, lessons, ...patch }));
  const patchLesson = (index: number, patch: Partial<DebriefContributionLesson>) => save({ lessons: lessons.map((l, i) => i === index ? { ...l, ...patch } : l) });
  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await api.post<Contributions>(`/api/debriefs/${data.debrief.id}/contributions`, { answers, lessons });
      setDraft('');
      onSubmitted(result);
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  };
  return <Modal title={`התחקיר שלי — תוספות לאחראי ${data.debrief.kind === 'track' ? 'הציר' : 'השבוע'}`} wide onClose={onClose} closable={!busy} footer={<div className="col gap-8"><ErrorBox error={error} /><div className="row wrap gap-8"><span className="small muted grow">יישלח לבדיקה לפני שילוב בתחקיר</span><button className="btn btn-primary" disabled={busy} onClick={() => void submit()}>{busy ? 'שולח…' : 'שליחה לאחראי התחקיר'}</button></div></div>}>
    <div className="col gap-16">
      <p className="info-box small">{data.debrief.title} — ממלאים רק את הסעיפים שרוצים להוסיף. הטיוטה נשמרת בלשונית הזאת עד השליחה.</p>
      <fieldset className="contribution-fields col gap-16" disabled={busy}>
        {sections.map((section, n) => renderSection(section, n, answers, (key, value) => save({ answers: { ...answers, [key]: value } })))}
        {(['now', 'next'] as const).map((horizon) => <section className="card" key={horizon}>
          <div className="card-head"><h2>{LESSON_HORIZON_LABELS[data.debrief.kind][horizon].title}</h2></div>
          <div className="card-body col gap-12">
            <p className="small muted">{LESSON_HORIZON_LABELS[data.debrief.kind][horizon].hint}</p>
            {lessons.map((lesson, i) => lesson.horizon !== horizon ? null : <div className="contribution-point col gap-8" key={i}>
              <label className="field"><span>הלקח</span><textarea className="textarea" value={lesson.body} maxLength={3000} onChange={(e) => patchLesson(i, { body: e.target.value })} /></label>
              <label className="field"><span>אחראי ללקח</span><Select className="select" value={lesson.ownerId ?? ''} onChange={(e) => patchLesson(i, { ownerId: e.target.value ? Number(e.target.value) : null })}><option value="">בחירת אחראי</option>{users.map((u) => <option key={u.id} value={u.id}>{u.displayName}</option>)}</Select></label>
              {tracks.length > 0 && <label className="field"><span>ציר הכשרה</span><Select className="select lesson-track" value={lesson.trackId ?? ''} onChange={(e) => patchLesson(i, { trackId: e.target.value ? Number(e.target.value) : null })}><option value="">ציר הכשרה...</option>{tracks.map((t) => <option key={t.id} value={t.id}>ציר {t.name}</option>)}</Select></label>}
              {horizon === 'now' && <label className="field"><span>עד מתי</span><DateInput value={lesson.dueDate ?? ''} onChange={(date) => patchLesson(i, { dueDate: date || null })} /></label>}
              <button className="btn btn-ghost btn-sm" onClick={() => save({ lessons: lessons.filter((_, index) => index !== i) })}>הסרת הלקח</button>
            </div>)}
            <button className="btn btn-sm" onClick={() => save({ lessons: [...lessons, { body: '', horizon, ownerId: null, dueDate: null, trackId: data.debrief.trackId }] })}><Icon name="plus" /> הוספת לקח</button>
          </div>
        </section>)}
      </fieldset>
    </div>
  </Modal>;
}
