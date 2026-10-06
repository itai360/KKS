// Previous courses (commander): every course that ended is kept here whole - opened for reading
// on every screen, one at a time. Ending the current course keeps it here and starts the next one
// with the people and the way the course works (server/src/courses.ts).

import { useState } from 'react';
import type { CourseArchive, CoursesOverview, CourseStats } from '@shared/types';
import { Icon } from '../components/Icon';
import { useToast } from '../components/Toasts';
import { DateInput, Empty, ErrorBox, Field, Loading, Modal, PageHead } from '../components/ui';
import { api } from '../lib/api';
import { switchCourse } from '../lib/courses';
import { fmtDateTime } from '../lib/format';
import { useSession } from '../lib/session';
import { useApi } from '../lib/useApi';

const dateY = (key: string) => {
  const [y, m, d] = key.split('-');
  return `${Number(d)}.${Number(m)}.${y}`;
};
const range = (a: { startDate: string | null; endDate: string | null }) =>
  a.startDate && a.endDate ? `${dateY(a.startDate)} - ${dateY(a.endDate)}` : a.startDate ? `מ-${dateY(a.startDate)}` : a.endDate ? `עד ${dateY(a.endDate)}` : 'בלי תאריכים';

/** "מחזור 52" -> "מחזור 53": the number in the name, one up */
export function nextCourseName(name: string): string {
  const m = /(\d+)(?!.*\d)/.exec(name);
  return m ? `${name.slice(0, m.index)}${Number(m[1]) + 1}${name.slice(m.index + m[1].length)}` : name;
}

function Stats({ s }: { s: CourseStats }) {
  const items = [
    [`${s.tasks} משימות`, s.tasks ? `${s.doneTasks} הושלמו` : ''],
    [`${s.weeks} שבועות`, ''],
    [`${s.events} אירועים בלו"ז`, ''],
    [`${s.cadets} צוערים`, ''],
    [`${s.debriefs} תחקירים`, ''],
    [`${s.lessons} לקחים למחזור הבא`, ''],
  ];
  return (
    <div className="course-stats">
      {items.map(([main, sub]) => (
        <span key={main} className="chip">
          {main}
          {sub && <span className="muted"> · {sub}</span>}
        </span>
      ))}
    </div>
  );
}

export function CoursesPage() {
  const { isCommander } = useSession();
  const { data, error, loading } = useApi<CoursesOverview>(isCommander ? '/api/courses' : null, ['settings']);
  const [ending, setEnding] = useState(false);
  const toast = useToast();

  if (!isCommander) return <Empty icon="lock" title="המסך שמור למפקד הקורס" />;

  const open = async (id: number | null) => {
    try {
      await switchCourse(id);
    } catch (e) {
      toast({ title: (e as Error).message, tone: 'red' });
    }
  };
  const viewing = data?.archives.find((a) => a.id === data.viewing) ?? null;

  return (
    <div className="page narrow">
      <PageHead title="קורסים קודמים" sub="כל קורס שהסתיים נשמר כאן במלואו. פותחים אותו לקריאה בכל המסכים, ועוברים בין קורס לקורס." />
      <ErrorBox error={error} />
      {loading && !data ? (
        <Loading rows={3} />
      ) : data ? (
        <div className="col gap-16">
          <section className={`card course-card${viewing ? '' : ' current'}`} aria-label="הקורס הנוכחי">
            <div className="card-head">
              <Icon name="flag" />
              <h3 className="grow">{data.current.name}</h3>
              <span className="badge t-green">הקורס הנוכחי</span>
            </div>
            <div className="card-body col gap-6">
              <div className="small muted">{range(data.current)}</div>
              <Stats s={data.current.stats} />
              <div className="row wrap gap-6">
                {viewing ? (
                  <button className="btn btn-primary" onClick={() => void open(null)}>
                    <Icon name="home" /> חזרה לקורס הנוכחי
                  </button>
                ) : (
                  <button className="btn" onClick={() => setEnding(true)}>
                    <Icon name="flag" /> סיום הקורס ופתיחת קורס חדש
                  </button>
                )}
              </div>
            </div>
          </section>

          <div className="section-title">
            <h2>קורסים שהסתיימו</h2>
          </div>
          {!data.archives.length ? (
            <Empty
              icon="history"
              title="עוד אין קורסים קודמים"
              text='בסוף הקורס, "סיום הקורס ופתיחת קורס חדש" שומר אותו כאן בשלמותו - ופותח את המחזור הבא עם הסגל, ההגדרות, התבניות, המשימות החוזרות ובנק הלקחים.'
            />
          ) : (
            data.archives.map((a) => <ArchiveCard key={a.id} a={a} open={a.id === data.viewing} onOpen={() => void open(a.id)} onBack={() => void open(null)} />)
          )}
        </div>
      ) : null}
      {ending && data && <EndCourse current={data.current.name} onClose={() => setEnding(false)} />}
    </div>
  );
}

function ArchiveCard({ a, open, onOpen, onBack }: { a: CourseArchive; open: boolean; onOpen: () => void; onBack: () => void }) {
  return (
    <section className={`card course-card${open ? ' current' : ''}`} aria-label={a.name}>
      <div className="card-head">
        <Icon name="history" />
        <h3 className="grow">{a.name}</h3>
        {open && <span className="badge t-blue">פתוח לקריאה</span>}
      </div>
      <div className="card-body col gap-6">
        <div className="small muted">
          {range(a)} · נשמר {fmtDateTime(a.archivedAt)}
          {a.archivedByName && ` על ידי ${a.archivedByName}`}
        </div>
        <Stats s={a.stats} />
        <div className="row wrap gap-6">
          {open ? (
            <button className="btn" onClick={onBack}>
              <Icon name="home" /> חזרה לקורס הנוכחי
            </button>
          ) : (
            <button className="btn btn-primary" onClick={onOpen}>
              <Icon name="eye" /> פתיחה לקריאה
            </button>
          )}
        </div>
      </div>
    </section>
  );
}

function EndCourse({ current, onClose }: { current: string; onClose: () => void }) {
  const [archiveName, setArchiveName] = useState(current);
  const [name, setName] = useState(nextCourseName(current));
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [sure, setSure] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.post('/api/courses/new', { archiveName, name, startDate: startDate || null, endDate: endDate || null });
      window.location.assign('/courses');
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <Modal
      title="סיום הקורס ופתיחת קורס חדש"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose} disabled={busy}>
            ביטול
          </button>
          <button className="btn btn-primary" onClick={() => void submit()} disabled={busy || !sure || !archiveName.trim() || !name.trim()}>
            {busy ? 'שומר את הקורס...' : 'סיום ופתיחת הקורס החדש'}
          </button>
        </>
      }
    >
      <div className="col gap-16">
        <div className="course-carry">
          <div>
            <div className="strong small">נשמר כאן במלואו, לקריאה</div>
            <p className="small muted">המשימות, השבועות, הלו״ז, הצוערים, המצבה, תיקי ההערכה, התחקירים, ההודעות ויומן הפעילות של הקורס הנוכחי.</p>
          </div>
          <div>
            <div className="strong small">עובר לקורס החדש</div>
            <p className="small muted">הסגל וההרשאות, ההגדרות, התבניות, המשימות החוזרות, הצוותים (בלי צוערים), מדרג האכיפה, ספריית המסמכים, יומני Google - ובנק הלקחים למחזור הבא.</p>
          </div>
        </div>
        <Field label="שם הקורס שמסתיים" required>
          <input className="input" value={archiveName} onChange={(e) => setArchiveName(e.target.value)} maxLength={120} />
        </Field>
        <Field label="שם הקורס החדש" required>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} />
        </Field>
        <div className="row wrap gap-16">
          <Field label="תאריך התחלה" className="grow">
            <DateInput value={startDate} onChange={(v) => setStartDate(v)} />
          </Field>
          <Field label="תאריך סיום" className="grow">
            <DateInput value={endDate} min={startDate || undefined} onChange={(v) => setEndDate(v)} />
          </Field>
        </div>
        <label className="check course-sure">
          <input type="checkbox" checked={sure} onChange={(e) => setSure(e.target.checked)} />
          <span className="small">הבנתי: הקורס הנוכחי נשמר כאן ואפשר לפתוח אותו לקריאה, והקורס החדש מתחיל בלי משימות, שבועות וצוערים.</span>
        </label>
        <ErrorBox error={error} />
      </div>
    </Modal>
  );
}
