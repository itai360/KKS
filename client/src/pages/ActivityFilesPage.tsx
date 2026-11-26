// The activity files (תיקי פעילות): every week of the course with its activity file and where it stands - built,
// waiting for the company commander's approval, sent on to headquarters, approved. Filled in by the people who
// look after the activity files (the commander chooses them here) with each week's lead.

import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { ACTIVITY_FILE_STATUS_LABELS, ACTIVITY_FILE_STATUSES, type ActivityFileStatus } from '@shared/activityFiles';
import { shortDate } from '@shared/dates';
import type { ActivityFilesWeek } from '@shared/types';
import { ActivityFileItem, NewActivityFile } from '../components/ActivityFiles';
import { Icon } from '../components/Icon';
import { useToast } from '../components/Toasts';
import { Empty, ErrorBox, Loading, Modal, PageHead } from '../components/ui';
import { api } from '../lib/api';
import { emitLocalChange } from '../lib/realtime';
import { useSession } from '../lib/session';
import { useApi } from '../lib/useApi';

type Filter = 'all' | 'none' | ActivityFileStatus;

export function ActivityFilesPage() {
  const { data, error, loading } = useApi<ActivityFilesWeek[]>('/api/activity-files', ['weeks', 'settings', 'users']);
  const [filter, setFilter] = useState<Filter>('all');
  const weeks = data ?? [];
  const count = useMemo(() => {
    const files = weeks.flatMap((w) => w.files);
    return {
      all: weeks.length,
      none: weeks.filter((w) => !w.files.length).length,
      ...Object.fromEntries(ACTIVITY_FILE_STATUSES.map((s) => [s, files.filter((f) => f.status === s).length])),
    } as Record<Filter, number>;
  }, [weeks]);
  const shown = weeks.filter((w) => (filter === 'all' ? true : filter === 'none' ? !w.files.length : w.files.some((f) => f.status === filter)));

  return (
    <div className="page">
      <PageHead title="תיקי פעילות" sub="לכל שבוע - תיק הפעילות שלו ואיפה הוא עומד: בבנייה, ממתין לאישור מ״פ, נשלח למטה, אושר." />
      <KeepersLine />
      <div className="row wrap gap-6 af-filters" role="group" aria-label="סינון לפי סטטוס">
        {(['all', ...ACTIVITY_FILE_STATUSES, 'none'] as Filter[]).map((f) => (
          <button key={f} type="button" className={`chip${filter === f ? ' on' : ''}`} aria-pressed={filter === f} onClick={() => setFilter(f)}>
            {f === 'all' ? 'כל השבועות' : f === 'none' ? 'ללא תיק' : ACTIVITY_FILE_STATUS_LABELS[f]} <span className="mono">{count[f] ?? 0}</span>
          </button>
        ))}
      </div>
      <ErrorBox error={error} />
      {loading && !data ? (
        <Loading rows={4} />
      ) : !weeks.length ? (
        <Empty icon="layers" title="אין עדיין שבועות בקורס" text="תיק פעילות שייך לשבוע - פותחים קודם את שבועות הקורס." />
      ) : !shown.length ? (
        <Empty icon="folder" title="אין שבועות כאלה" />
      ) : (
        <div className="col gap-12">
          {shown.map((w) => (
            <section key={w.id} className="card" aria-labelledby={`af-week-${w.id}`}>
              <div className="card-head">
                <Icon name="layers" />
                <h2 className="grow af-week-title" id={`af-week-${w.id}`}>
                  <Link to={`/weeks/${w.id}`}>{w.name}</Link>
                  <span className="small muted">
                    {' '}
                    · {shortDate(w.startDate)}-{shortDate(w.endDate)}
                    {w.leadName && ` · אחראי שבוע: ${w.leadName}`}
                  </span>
                </h2>
                {w.files.length > 0 && w.canAdd && <NewActivityFile weekId={w.id} more />}
              </div>
              {w.files.map((f) => (
                <ActivityFileItem key={f.id} file={f} />
              ))}
              {!w.files.length && (
                <div className="card-body row wrap gap-8">
                  <span className="small muted grow">עוד לא נפתח תיק פעילות.</span>
                  {w.canAdd && <NewActivityFile weekId={w.id} />}
                </div>
              )}
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

/** who looks after the activity files - the commander chooses */
function KeepersLine() {
  const { users, settings, isCommander } = useSession();
  const [editing, setEditing] = useState(false);
  const names = (settings.activityFileOwners ?? []).map((id) => users.find((u) => u.id === id)?.displayName).filter(Boolean);
  return (
    <div className="track-access small">
      <Icon name="users" size={15} />
      <span className="grow">
        {names.length ? `אחראים על תיקי הפעילות: ${names.join(', ')} - יחד עם אחראי כל שבוע` : 'עוד לא נבחר מי אחראי על תיקי הפעילות. בינתיים ממלא אחראי השבוע.'}
      </span>
      {isCommander && (
        <button type="button" className="link-btn tiny" onClick={() => setEditing(true)}>
          {names.length ? 'שינוי' : 'בחירה'}
        </button>
      )}
      {editing && <KeepersDialog onClose={() => setEditing(false)} />}
    </div>
  );
}

function KeepersDialog({ onClose }: { onClose: () => void }) {
  const { users, settings } = useSession();
  const toast = useToast();
  const [chosen, setChosen] = useState<Set<number>>(() => new Set(settings.activityFileOwners ?? []));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const staff = users.filter((u) => u.active);
  const toggle = (id: number) =>
    setChosen((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.patch('/api/settings', { activityFileOwners: [...chosen] });
      emitLocalChange('settings', 'weeks');
      toast({ title: 'נשמר', tone: 'green' });
      onClose();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };
  return (
    <Modal
      title="מי אחראי על תיקי הפעילות"
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-primary" onClick={() => void submit()} disabled={busy}>
            <Icon name="check" /> שמירה
          </button>
          <button className="btn btn-ghost" onClick={onClose}>
            ביטול
          </button>
        </>
      }
    >
      <p className="small muted">מי שנבחר ממלא את תיקי הפעילות של כל השבועות, יחד עם אחראי השבוע, ומעדכן את הסטטוס שלהם.</p>
      <div className="col gap-6 mt-12">
        {staff.map((u) => (
          <label key={u.id} className="check track-pick">
            <input type="checkbox" checked={chosen.has(u.id)} onChange={() => toggle(u.id)} />
            <span>
              {u.displayName}
              {u.title && <span className="muted"> · {u.title}</span>}
            </span>
          </label>
        ))}
      </div>
      <ErrorBox error={error} />
    </Modal>
  );
}
