// Settings - the courses (commander): the next course opened now, beside the current one (server/src/parallel.ts).
// Each course has its own tasks, weeks, schedule and settings - nothing mixes; the staff and their accounts are
// one, and so is each person's list of notifications. The new course takes what was chosen from the current one
// as it opens, and more later, item by item; when the current course ends, it becomes the current course.

import { useState } from 'react';
import { Link } from 'react-router';
import type { CopyArea, CopySource, ParallelCourse } from '@shared/types';
import { api } from '../lib/api';
import { enterCourse, reloadAt } from '../lib/courses';
import { useSession } from '../lib/session';
import { useApi } from '../lib/useApi';
import { useHashScroll } from '../lib/hashScroll';
import { nextCourseName } from '../pages/CoursesPage';
import { ask } from './Confirm';
import { Icon } from './Icon';
import { useToast } from './Toasts';
import { DateInput, Empty, ErrorBox, Field, Loading, Modal, Select } from './ui';

/** what a new course can take from the current one - all of it by default */
const AREAS: { key: CopyArea; label: string; hint: string }[] = [
  { key: 'weeks', label: 'שבועות', hint: 'באותה נקודה בקורס החדש, לפי תאריך ההתחלה - לתכנון מחדש' },
  { key: 'tracks', label: 'צירים', hint: 'הצירים והאחראים עליהם' },
  { key: 'templates', label: 'תבניות', hint: 'תבניות המשימות' },
  { key: 'recurring', label: 'משימות חוזרות', hint: 'מתחילות לפעול כשהקורס החדש מתחיל' },
  { key: 'teams', label: 'צוותים', hint: 'בלי צוערים' },
  { key: 'documents', label: 'ספריית המסמכים', hint: '' },
  { key: 'guide', label: 'מדרג אכיפה', hint: '' },
  { key: 'lessons', label: 'בנק הלקחים', hint: 'הלקחים שנשמרו למחזור הבא' },
];
const areaLabel = (a: CopyArea) => AREAS.find((x) => x.key === a)?.label ?? a;

const dateY = (key: string) => {
  const [y, m, d] = key.split('-');
  return `${Number(d)}.${Number(m)}.${y}`;
};
const range = (a: { startDate: string | null; endDate: string | null }) =>
  a.startDate && a.endDate ? `${dateY(a.startDate)} - ${dateY(a.endDate)}` : a.startDate ? `מ-${dateY(a.startDate)}` : a.endDate ? `עד ${dateY(a.endDate)}` : 'בלי תאריכים';

interface Overview {
  courses: ParallelCourse[];
  in: number | null;
}

export function ParallelCoursesCard() {
  const { parallel, settings } = useSession();
  const { data, error, loading, reload } = useApi<Overview>('/api/courses/parallel', ['settings']);
  const toast = useToast();
  const [opening, setOpening] = useState(false);
  const [copying, setCopying] = useState<ParallelCourse | null>(null);
  const [promoting, setPromoting] = useState<ParallelCourse | null>(null);
  // the current course's name - while working in the one beside it, the settings shown are that one's
  const main = parallel?.main ?? settings.courseName;
  const here = data?.in ?? parallel?.slot?.id ?? null;
  // come back here after moving between the courses
  useHashScroll('part-courses');

  const go = (id: number | null) => enterCourse(id, '/settings#part-courses').catch((e: Error) => toast({ title: e.message, tone: 'red' }));
  const remove = async (c: ParallelCourse) => {
    const ok = await ask({
      title: `למחוק את ${c.name}?`,
      body: 'כל מה שנעשה בו - משימות, שבועות, לו"ז והגדרות - יימחק, וגם ההתראות שלו. הקורס הנוכחי לא ישתנה.',
      confirm: 'מחיקת הקורס',
      danger: true,
    });
    if (!ok) return;
    try {
      await api.del(`/api/courses/parallel/${c.id}`);
      if (here === c.id) reloadAt('/settings#part-courses');
      else {
        toast({ title: `${c.name} נמחק`, tone: 'green' });
        await reload();
      }
    } catch (e) {
      toast({ title: (e as Error).message, tone: 'red' });
    }
  };

  return (
    <section className="card" aria-labelledby="courses-head">
      <div className="card-head">
        <Icon name="layers" />
        <h3 className="grow" id="courses-head">
          קורסים
        </h3>
        <Link to="/courses" className="btn btn-ghost btn-sm">
          <Icon name="history" size={15} /> קורסים קודמים
        </Link>
      </div>
      <div className="card-body col gap-12">
        <p className="small muted">
          אפשר לפתוח את הקורס הבא כבר עכשיו, לצד הקורס הנוכחי - עם משימות, שבועות, לו״ז והגדרות משלו, בלי לערבב. הסגל והחשבונות משותפים, וכל ההתראות מגיעות לאותה רשימה (עם שם
          הקורס).
        </p>
        <ErrorBox error={error} />
        {loading && !data ? (
          <Loading rows={2} />
        ) : (
          <div className="pcourse-list">
            <div className={`pcourse${here === null ? ' is-here' : ''}`}>
              <Icon name="flag" />
              <div className="grow col">
                <b>{main}</b>
                <span className="tiny muted">הקורס הנוכחי</span>
              </div>
              {here === null ? (
                <span className="badge t-green">אתם כאן</span>
              ) : (
                <button className="btn btn-sm" onClick={() => void go(null)}>
                  מעבר
                </button>
              )}
            </div>
            {data?.courses.map((c) => (
              <div key={c.id} className={`pcourse${here === c.id ? ' is-here' : ''}`}>
                <Icon name="layers" />
                <div className="grow col">
                  <b>{c.name}</b>
                  <span className="tiny muted">
                    {range(c)} · {c.stats.tasks} משימות · {c.stats.weeks} שבועות · {c.stats.events} אירועים
                  </span>
                </div>
                <div className="row wrap gap-6 pcourse-actions">
                  {here === c.id ? (
                    <span className="badge t-blue">אתם כאן</span>
                  ) : (
                    <button className="btn btn-sm btn-primary" onClick={() => void go(c.id)}>
                      מעבר
                    </button>
                  )}
                  <button className="btn btn-sm" onClick={() => setCopying(c)}>
                    <Icon name="copy" size={15} /> העתקה מ{main}
                  </button>
                  <button className="btn btn-sm" onClick={() => setPromoting(c)}>
                    <Icon name="flag" size={15} /> הפיכה לקורס הנוכחי
                  </button>
                  <button className="icon-btn" aria-label={`מחיקת ${c.name}`} title="מחיקה" onClick={() => void remove(c)}>
                    <Icon name="trash" size={16} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
        {data && data.courses.length < 3 && (
          <div>
            <button className="btn btn-primary" onClick={() => setOpening(true)}>
              <Icon name="plus" /> פתיחת קורס חדש לצד הנוכחי
            </button>
          </div>
        )}
      </div>
      {opening && <OpenCourse main={main} onClose={() => setOpening(false)} onDone={() => void reload()} />}
      {copying && <CopyIntoCourse course={copying} main={main} onClose={() => setCopying(null)} onDone={() => void reload()} />}
      {promoting && <PromoteCourse course={promoting} main={main} onClose={() => setPromoting(null)} />}
    </section>
  );
}

function OpenCourse({ main, onClose, onDone }: { main: string; onClose: () => void; onDone: () => void }) {
  const [name, setName] = useState(nextCourseName(main));
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [take, setTake] = useState<Set<CopyArea>>(() => new Set(AREAS.map((a) => a.key)));
  const [moveIn, setMoveIn] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();

  const toggle = (a: CopyArea) =>
    setTake((t) => {
      const n = new Set(t);
      if (n.has(a)) n.delete(a);
      else n.add(a);
      return n;
    });

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const c = await api.post<ParallelCourse>('/api/courses/parallel', { name, startDate: startDate || null, endDate: endDate || null, take: [...take] });
      if (moveIn) await enterCourse(c.id);
      else {
        toast({ title: `${c.name} נפתח לצד ${main}`, tone: 'green' });
        onDone();
        onClose();
      }
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <Modal
      title="פתיחת קורס חדש לצד הנוכחי"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose} disabled={busy}>
            ביטול
          </button>
          <button className="btn btn-primary" onClick={() => void submit()} disabled={busy || !name.trim() || (take.has('weeks') && !startDate)}>
            {busy ? 'פותח...' : 'פתיחת הקורס'}
          </button>
        </>
      }
    >
      <div className="col gap-16">
        <p className="small muted">
          {main} ממשיך כרגיל. הקורס החדש מתחיל בלי משימות, לו״ז וצוערים - עם הסגל, ההרשאות וההגדרות (תחומים, קבוצות סגל), ומה שתבחרו כאן. אפשר להעתיק עוד מ{main} גם אחר כך.
        </p>
        <Field label="שם הקורס החדש" required>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} />
        </Field>
        <div className="row wrap gap-16">
          <Field label="תאריך התחלה" required={take.has('weeks')} className="grow" hint={take.has('weeks') ? 'נדרש כדי לשכפל את השבועות - הם יוזזו לפיו' : 'משימות חוזרות ותבניות מתחילות לפעול ממנו'}>
            <DateInput value={startDate} onChange={(v) => setStartDate(v)} />
          </Field>
          <Field label="תאריך סיום" className="grow">
            <DateInput value={endDate} min={startDate || undefined} onChange={(v) => setEndDate(v)} />
          </Field>
        </div>
        <fieldset className="pcourse-take">
          <legend className="strong small">מה לשכפל מ{main}</legend>
          {AREAS.map((a) => (
            <label key={a.key} className="check">
              <input type="checkbox" checked={take.has(a.key)} onChange={() => toggle(a.key)} />
              <span className="small">
                {a.label}
                {a.hint && <span className="muted"> · {a.hint}</span>}
              </span>
            </label>
          ))}
        </fieldset>
        <label className="check">
          <input type="checkbox" checked={moveIn} onChange={(e) => setMoveIn(e.target.checked)} />
          <span className="small">לעבור לקורס החדש מיד</span>
        </label>
        <ErrorBox error={error} />
      </div>
    </Modal>
  );
}

function CopyIntoCourse({ course, main, onClose, onDone }: { course: ParallelCourse; main: string; onClose: () => void; onDone: () => void }) {
  const [area, setArea] = useState<CopyArea>('templates');
  const { data, error, loading, reload } = useApi<CopySource>(`/api/courses/parallel/${course.id}/copy/${area}`, ['settings']);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const toast = useToast();
  const open = (data?.area === area ? data.items : []).filter((i) => !i.exists);

  const submit = async () => {
    setBusy(true);
    setErr(null);
    try {
      const r = await api.post<{ copied: number; skipped: number }>(`/api/courses/parallel/${course.id}/copy`, { area, ids: [...picked] });
      toast({ title: r.copied === 1 ? `הועתק פריט אחד ל${course.name}` : `הועתקו ${r.copied} פריטים ל${course.name}`, tone: 'green' });
      setPicked(new Set());
      onDone();
      await reload();
    } catch (e) {
      setErr((e as Error).message);
    }
    setBusy(false);
  };

  return (
    <Modal
      title={`העתקה מ${main} ל${course.name}`}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose} disabled={busy}>
            סגירה
          </button>
          <button className="btn btn-primary" onClick={() => void submit()} disabled={busy || !picked.size}>
            {busy ? 'מעתיק...' : picked.size ? `העתקה (${picked.size})` : 'העתקה'}
          </button>
        </>
      }
    >
      <div className="col gap-12">
        <Field label="מה להעתיק">
          <Select
            value={area}
            onChange={(e) => {
              setArea(e.target.value as CopyArea);
              setPicked(new Set());
            }}
          >
            {AREAS.map((a) => (
              <option key={a.key} value={a.key}>
                {a.label}
              </option>
            ))}
          </Select>
        </Field>
        <ErrorBox error={error ?? err} />
        {loading && data?.area !== area ? (
          <Loading rows={3} />
        ) : data && data.area === area && !data.items.length ? (
          <Empty icon="inbox" title={`אין ${areaLabel(area)} ב${main}`} />
        ) : data && data.area === area ? (
          <>
            <div className="row gap-6">
              <span className="grow tiny muted">{open.length ? `${open.length} שאין עדיין ב${course.name}` : `הכל כבר נמצא ב${course.name}`}</span>
              {open.length > 1 && (
                <button className="btn btn-ghost btn-sm" onClick={() => setPicked(picked.size === open.length ? new Set() : new Set(open.map((i) => i.id)))}>
                  {picked.size === open.length ? 'ניקוי הבחירה' : 'בחירת הכל'}
                </button>
              )}
            </div>
            <div className="pcourse-items" role="group" aria-label={areaLabel(area)}>
              {data.items.map((i) => (
                <label key={i.id} className={`check pcourse-item${i.exists ? ' is-there' : ''}`}>
                  <input
                    type="checkbox"
                    disabled={i.exists}
                    checked={i.exists || picked.has(i.id)}
                    onChange={() =>
                      setPicked((p) => {
                        const n = new Set(p);
                        if (n.has(i.id)) n.delete(i.id);
                        else n.add(i.id);
                        return n;
                      })
                    }
                  />
                  <span className="grow small">
                    {i.name}
                    {i.sub && <span className="muted"> · {i.sub}</span>}
                  </span>
                  {i.exists && <span className="tiny muted">כבר שם</span>}
                </label>
              ))}
            </div>
          </>
        ) : null}
      </div>
    </Modal>
  );
}

function PromoteCourse({ course, main, onClose }: { course: ParallelCourse; main: string; onClose: () => void }) {
  const [archiveName, setArchiveName] = useState(main);
  const [sure, setSure] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.post(`/api/courses/parallel/${course.id}/promote`, { archiveName });
      reloadAt('/overview');
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <Modal
      title={`${course.name} - הפיכה לקורס הנוכחי`}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose} disabled={busy}>
            ביטול
          </button>
          <button className="btn btn-primary" onClick={() => void submit()} disabled={busy || !sure || !archiveName.trim()}>
            {busy ? 'שומר את הקורס...' : 'סיום והחלפה'}
          </button>
        </>
      }
    >
      <div className="col gap-16">
        <div className="course-carry">
          <div>
            <div className="strong small">{main} מסתיים ונשמר במלואו</div>
            <p className="small muted">בקורסים הקודמים - אפשר לפתוח אותו לקריאה בכל המסכים.</p>
          </div>
          <div>
            <div className="strong small">{course.name} הופך לקורס הנוכחי</div>
            <p className="small muted">לכל הסגל, עם כל מה שנעשה בו עד עכשיו.</p>
          </div>
        </div>
        <Field label="השם שבו הקורס שמסתיים יישמר" required>
          <input className="input" value={archiveName} onChange={(e) => setArchiveName(e.target.value)} maxLength={120} />
        </Field>
        <label className="check course-sure">
          <input type="checkbox" checked={sure} onChange={(e) => setSure(e.target.checked)} />
          <span className="small">
            הבנתי: {main} מסתיים ונשמר לקריאה, ו{course.name} הופך לקורס הנוכחי.
          </span>
        </label>
        <ErrorBox error={error} />
      </div>
    </Modal>
  );
}
