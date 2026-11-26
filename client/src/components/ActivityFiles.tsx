// A week's activity file (תיק פעילות, server/src/activityFiles.ts): where it stands - built, waiting for the company
// commander's approval, sent on to headquarters, approved - its link, and what is still missing. Its people (the
// activity files' and the week's lead) and the commander move it on; everyone else sees where it is.

import { useState } from 'react';
import { Link } from 'react-router';
import { ACTIVITY_FILE_STATUS_LABELS, ACTIVITY_FILE_STATUS_TONES, ACTIVITY_FILE_STATUSES, type ActivityFileStatus } from '@shared/activityFiles';
import type { ActivityFile, ActivityFilesWeek } from '@shared/types';
import { api } from '../lib/api';
import { fmtDateTime } from '../lib/format';
import { emitLocalChange } from '../lib/realtime';
import { useApi } from '../lib/useApi';
import { ask } from './Confirm';
import { Icon } from './Icon';
import { useToast } from './Toasts';
import { ErrorBox, Loading } from './ui';
import { safeUrl } from '../lib/safeUrl';

const save = async (id: number, patch: Partial<Pick<ActivityFile, 'status' | 'link' | 'note' | 'title'>>) => {
  await api.patch(`/api/activity-files/${id}`, patch);
  emitLocalChange('weeks');
};

export function ActivityStatusBadge({ status }: { status: ActivityFileStatus }) {
  return <span className={`badge ${ACTIVITY_FILE_STATUS_TONES[status]}`}>{ACTIVITY_FILE_STATUS_LABELS[status]}</span>;
}

/** one activity file: its steps to tap (or where it stands), its link, what is missing, who fills it in */
export function ActivityFileItem({ file }: { file: ActivityFile }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<void>, done?: string) => {
    setBusy(true);
    try {
      await fn();
      if (done) toast({ title: done, tone: 'green' });
    } catch (e) {
      toast({ title: (e as Error).message, tone: 'red' });
    }
    setBusy(false);
  };
  const remove = async () => {
    if (await ask({ title: `למחוק את ${file.title}?`, body: 'הקישור והסטטוס שלו יימחקו.', confirm: 'מחיקה', danger: true })) {
      await run(async () => {
        await api.del(`/api/activity-files/${file.id}`);
        emitLocalChange('weeks');
      });
    }
  };
  // its name, link and note are saved as they are left - the floating "שמירה" is in sight meanwhile (FloatingSave)
  return (
    <div className="af-item" data-autosave>
      <div className="af-top">
        <Icon name="folder" size={16} />
        {file.canEdit ? (
          <input
            key={file.title}
            className="af-title"
            defaultValue={file.title}
            aria-label="שם התיק"
            onBlur={(e) => e.target.value.trim() && e.target.value.trim() !== file.title && void run(() => save(file.id, { title: e.target.value.trim() }))}
          />
        ) : (
          <b className="grow small">{file.title}</b>
        )}
        {!file.canEdit && <ActivityStatusBadge status={file.status} />}
        {file.link && (
          <a className="btn btn-ghost btn-sm" href={safeUrl(file.link)} target="_blank" rel="noreferrer">
            <Icon name="external" size={14} /> לתיק
          </a>
        )}
        {file.canEdit && (
          <button type="button" className="icon-btn" aria-label={`מחיקת ${file.title}`} title="מחיקה" onClick={() => void remove()}>
            <Icon name="trash" size={15} />
          </button>
        )}
      </div>
      {file.canEdit && (
        <div className="af-steps" role="radiogroup" aria-label={`הסטטוס של ${file.title}`}>
          {ACTIVITY_FILE_STATUSES.map((s) => (
            <button
              key={s}
              type="button"
              role="radio"
              aria-checked={file.status === s}
              className={`chip af-step${file.status === s ? ' on' : ''}`}
              disabled={busy}
              onClick={() => file.status !== s && void run(() => save(file.id, { status: s }), s === 'awaiting' ? 'נשלח לאישור המ"פ' : `סומן: ${ACTIVITY_FILE_STATUS_LABELS[s]}`)}
            >
              {s === 'approved' && file.status === s && <Icon name="check" size={14} />}
              {ACTIVITY_FILE_STATUS_LABELS[s]}
            </button>
          ))}
        </div>
      )}
      {file.canEdit ? (
        <div className="af-fields">
          <input
            key={`l${file.link}`}
            className="input"
            type="url"
            inputMode="url"
            dir="ltr"
            defaultValue={file.link}
            placeholder="קישור לתיק (Drive)"
            aria-label="קישור לתיק"
            onBlur={(e) => e.target.value.trim() !== file.link && void run(() => save(file.id, { link: e.target.value.trim() }))}
          />
          <input
            key={`n${file.note}`}
            className="input"
            defaultValue={file.note}
            placeholder="מה עוד חסר, הערה"
            aria-label="הערה"
            maxLength={500}
            onBlur={(e) => e.target.value.trim() !== file.note && void run(() => save(file.id, { note: e.target.value.trim() }))}
          />
        </div>
      ) : (
        file.note && <p className="small af-note">{file.note}</p>
      )}
      <div className="tiny muted af-meta">
        {file.owners.length ? `באחריות: ${file.owners.map((o) => o.name).join(', ')}` : 'עוד לא נבחר מי אחראי על תיקי הפעילות'}
        {file.statusAt && ` · ${ACTIVITY_FILE_STATUS_LABELS[file.status]}${file.statusByName ? ` (${file.statusByName})` : ''} ${fmtDateTime(file.statusAt)}`}
      </div>
    </div>
  );
}

/** opens an activity file for a week */
export function NewActivityFile({ weekId, more }: { weekId: number; more?: boolean }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      className={more ? 'btn btn-ghost btn-sm' : 'btn btn-sm'}
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          await api.post('/api/activity-files', { weekId, title: more ? 'תיק פעילות נוסף' : undefined });
          emitLocalChange('weeks');
        } catch (e) {
          toast({ title: (e as Error).message, tone: 'red' });
        }
        setBusy(false);
      }}
    >
      <Icon name="plus" size={14} /> {more ? 'תיק נוסף' : 'פתיחת תיק פעילות'}
    </button>
  );
}

/** the week's activity file, in the week's page */
export function WeekActivityFiles({ weekId }: { weekId: number }) {
  const { data, error, loading } = useApi<ActivityFilesWeek[]>(`/api/activity-files?week=${weekId}`, ['weeks', 'settings', 'users']);
  const week = data?.[0];
  return (
    <section className="card" aria-label="תיקי פעילות לשבוע">
      <div className="card-head">
        <Icon name="folder" />
        <h3 className="grow">תיקי פעילות</h3>
        <Link to="/activity-files" className="btn btn-ghost btn-sm">
          כל התיקים
        </Link>
      </div>
      {loading && !week && <div className="card-body"><Loading rows={2} /></div>}
      {error && <div className="card-body"><ErrorBox error={error} /></div>}
      {week?.files.map((f) => (
        <ActivityFileItem key={f.id} file={f} />
      ))}
      {week && !week.files.length && (
        <div className="card-body col gap-8">
          <span className="small muted">עוד לא נפתח תיק פעילות לשבוע הזה.</span>
          {week.canAdd && (
            <div>
              <NewActivityFile weekId={week.id} />
            </div>
          )}
        </div>
      )}
      {week && week.files.length > 0 && week.canAdd && (
        <div className="af-more">
          <NewActivityFile weekId={week.id} more />
        </div>
      )}
    </section>
  );
}
