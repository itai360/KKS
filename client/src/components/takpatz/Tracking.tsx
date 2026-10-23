// The tracking of the experiences, by the spreadsheet's stages: handing it down, א.ת, doing it, writing
// the feedback and passing it on. Each experience of the main plan is a row by itself (nothing to enter
// twice); one given outside the plan is added here. A stage is tapped for its status, a date and a word.

import { useMemo, useState } from 'react';
import {
  CATEGORY_INFO,
  STAGE_STATUSES,
  STATUS_LABELS,
  TRACK_STAGES,
  weekRange,
  type StageKey,
  type StageStatus,
  type TakpatzTeamView,
  type TakpatzTrackRow,
} from '@shared/takpatz';
import { searchKey } from '@shared/search';
import { shortDate } from '@shared/dates';
import { ask } from '../Confirm';
import { Icon } from '../Icon';
import { DateInput, Empty, ErrorBox, Field, Modal, Seg, Select } from '../ui';
import { api } from '../../lib/api';
import { useMedia } from '../../lib/media';
import { BOTTOM_BAR_MEDIA } from '../../lib/bottomBar';
import { CategoryDot, StatusPill } from './common';

export type TrackFilter = 'all' | 'open' | 'write' | 'deliver' | 'done';
const FILTERS: { value: TrackFilter; label: string }[] = [
  { value: 'all', label: 'הכול' },
  { value: 'open', label: 'טרם בוצעו' },
  { value: 'write', label: 'משוב לכתיבה' },
  { value: 'deliver', label: 'משוב להעברה' },
  { value: 'done', label: 'הושלמו' },
];

const isDone = (r: TakpatzTrackRow, k: StageKey) => r.stages[k].status === 'done';
const matches = (r: TakpatzTrackRow, f: TrackFilter) =>
  f === 'all' ||
  (f === 'open' && !isDone(r, 'exec')) ||
  (f === 'write' && isDone(r, 'exec') && !isDone(r, 'write')) ||
  (f === 'deliver' && isDone(r, 'write') && !isDone(r, 'deliver')) ||
  (f === 'done' && isDone(r, 'deliver'));

type Mutate = (fn: () => Promise<unknown>) => Promise<boolean>;

function StageEditor({ row, stage, onClose, mutate }: { row: TakpatzTrackRow; stage: StageKey; onClose: () => void; mutate: Mutate }) {
  const cur = row.stages[stage];
  const [status, setStatus] = useState<StageStatus | null>(cur.status);
  const [date, setDate] = useState(cur.date ?? '');
  const [note, setNote] = useState(cur.note);
  const [error, setError] = useState<string | null>(null);
  const label = TRACK_STAGES.find((s) => s.key === stage)!.label;
  const save = async () => {
    const target = row.placementId ? { placementId: row.placementId } : { trackingId: row.trackingId };
    const ok = await mutate(() => api.put('/api/takpatz/stages', { ...target, stage, status, date: date || null, note: note.trim() }));
    if (ok) onClose();
    else setError('השמירה לא הצליחה - נסו שוב');
  };
  return (
    <Modal
      narrow
      title={`${label} - ${row.label}`}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            ביטול
          </button>
          <button type="button" className="btn btn-primary" onClick={() => void save()}>
            שמירה
          </button>
        </>
      }
    >
      <div className="tk-form">
        <div className="muted small">{row.cadetName}</div>
        <Field label="מצב">
          <div className="tk-chips" role="radiogroup" aria-label="מצב">
            {STAGE_STATUSES.map((s) => (
              <button key={s} type="button" role="radio" aria-checked={status === s} className={`tk-status-btn is-${s}${status === s ? ' on' : ''}`} onClick={() => setStatus(s)}>
                {STATUS_LABELS[s]}
              </button>
            ))}
            <button type="button" role="radio" aria-checked={status === null} className={`tk-status-btn${status === null ? ' on' : ''}`} onClick={() => setStatus(null)}>
              ללא
            </button>
          </div>
        </Field>
        <Field label="תאריך">
          <DateInput value={date} onChange={setDate} aria-label="תאריך" />
        </Field>
        <Field label="הערה">
          <textarea className="input" rows={2} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
        <ErrorBox error={error} />
      </div>
    </Modal>
  );
}

function NewRow({ view, onClose, mutate }: { view: TakpatzTeamView; onClose: () => void; mutate: Mutate }) {
  const [cadetId, setCadetId] = useState<number | null>(null);
  const [label, setLabel] = useState('');
  const [week, setWeek] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    if (!cadetId) return setError('בחרו צוער');
    if (!label.trim()) return setError('כתבו את שם ההתנסות');
    const ok = await mutate(() => api.post('/api/takpatz/tracking', { cadetId, label: label.trim(), week: week === '' ? null : Number(week) }));
    if (ok) onClose();
  };
  return (
    <Modal
      title="התנסות למעקב"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            ביטול
          </button>
          <button type="button" className="btn btn-primary" onClick={() => void save()}>
            הוספה
          </button>
        </>
      }
    >
      <div className="tk-form">
        <p className="muted small">להתנסות שלא בתכנון (תפקיד פלוגתי שניתן בדרך, למשל). התנסויות התכנון הראשי כבר במעקב מעצמן.</p>
        <Field label="צוער" required>
          <Select value={cadetId ?? ''} onChange={(e) => setCadetId(Number(e.target.value) || null)} aria-label="צוער">
            <option value="">בחירת צוער</option>
            {view.cadets.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="התנסות" required>
          <input className="input" value={label} maxLength={80} onChange={(e) => setLabel(e.target.value)} placeholder='למשל: ק. אקדמיה' />
        </Field>
        <Field label="שבוע">
          <Select value={week} onChange={(e) => setWeek(e.target.value)} aria-label="שבוע">
            <option value="">ללא שבוע</option>
            {view.weeks.map((w) => (
              <option key={w.n} value={w.n}>
                {`שבוע ${w.n} - ${w.title}`}
              </option>
            ))}
          </Select>
        </Field>
        <ErrorBox error={error} />
      </div>
    </Modal>
  );
}

function StageCell({ row, stage, onOpen }: { row: TakpatzTrackRow; stage: StageKey; onOpen: () => void }) {
  const s = row.stages[stage];
  const label = TRACK_STAGES.find((x) => x.key === stage)!.label;
  return (
    <button type="button" className="tk-stage" onClick={onOpen} aria-label={`${label}: ${s.status ? STATUS_LABELS[s.status] : 'ללא'}${s.date ? `, ${shortDate(s.date)}` : ''} - עדכון`}>
      <StatusPill status={s.status} small />
      {(s.date || s.note) && (
        <span className="tk-stage-meta">
          {s.date && shortDate(s.date)}
          {s.note && <Icon name="message" size={11} />}
        </span>
      )}
    </button>
  );
}

export function Tracking({ view, filter, setFilter, mutate }: { view: TakpatzTeamView; filter: TrackFilter; setFilter: (f: TrackFilter) => void; mutate: Mutate }) {
  const phone = useMedia(BOTTOM_BAR_MEDIA);
  const [q, setQ] = useState('');
  const [cadet, setCadet] = useState('');
  const [week, setWeek] = useState('');
  const [editing, setEditing] = useState<{ row: TakpatzTrackRow; stage: StageKey } | null>(null);
  const [adding, setAdding] = useState(false);
  const rows = useMemo(
    () =>
      view.tracking.filter(
        (r) =>
          matches(r, filter) &&
          (!cadet || String(r.cadetId) === cadet) &&
          (week === '' || (week === 'none' ? r.weekFrom === null : r.weekFrom !== null && r.weekFrom <= Number(week) && Number(week) <= (r.weekTo ?? r.weekFrom))) &&
          (!q.trim() || searchKey(`${r.label} ${r.cadetName}`).includes(searchKey(q))),
      ),
    [view.tracking, filter, cadet, week, q],
  );
  const counts = useMemo(() => Object.fromEntries(FILTERS.map((f) => [f.value, view.tracking.filter((r) => matches(r, f.value)).length])), [view.tracking]);

  const removeRow = async (r: TakpatzTrackRow) => {
    if (!r.trackingId) return;
    const own = r.placementId === null;
    if (!(await ask({ title: own ? `להסיר את "${r.label}" מהמעקב?` : `לנקות את המעקב של "${r.label}"?`, body: own ? 'השורה וכל מה שנרשם בה יימחקו.' : 'ההתנסות נשארת בתכנון; הסטטוסים, התאריכים וההערות שלה יימחקו.', confirm: own ? 'הסרה' : 'ניקוי', danger: true }))) return;
    await mutate(() => api.del(`/api/takpatz/tracking/${r.trackingId}`));
  };

  return (
    <div className="tk-tracking">
      <div className="tk-toolbar">
        <Seg value={filter} onChange={setFilter} options={FILTERS.map((f) => ({ value: f.value, label: `${f.label} ${counts[f.value] ?? 0}` }))} />
        <div className="tk-toolbar-row">
          <input className="input tk-search" type="search" placeholder="חיפוש צוער או התנסות" value={q} onChange={(e) => setQ(e.target.value)} aria-label="חיפוש" />
          <Select value={cadet} onChange={(e) => setCadet(e.target.value)} aria-label="צוער" fit>
            <option value="">כל הצוערים</option>
            {view.cadets.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
          <Select value={week} onChange={(e) => setWeek(e.target.value)} aria-label="שבוע" fit>
            <option value="">כל השבועות</option>
            {view.weeks.map((w) => (
              <option key={w.n} value={w.n}>
                {`שבוע ${w.n}`}
              </option>
            ))}
            <option value="none">מחוץ לשבועות</option>
          </Select>
          <button type="button" className="btn" onClick={() => setAdding(true)}>
            <Icon name="plus" /> התנסות למעקב
          </button>
        </div>
      </div>
      {!view.tracking.length ? (
        <Empty icon="target" title="עוד אין התנסויות במעקב" text="כל התנסות שמשבצים בתכנון הראשי נכנסת לכאן מעצמה, עם שלבי המעקב שלה." />
      ) : !rows.length ? (
        <Empty icon="filter" title="אין התנסויות שמתאימות לסינון" />
      ) : phone ? (
        <div className="tk-track-cards">
          {rows.map((r) => (
            <div key={r.key} className="card card-pad tk-track-card">
              <div className="tk-track-title">
                {r.category && <CategoryDot category={r.category} />}
                <span className="strong">{r.label}</span>
                <span className="muted small">· {r.cadetName}</span>
              </div>
              <div className="tiny muted">{weekRange(r.weekFrom, r.weekTo)}</div>
              <div className="tk-track-stages">
                {TRACK_STAGES.map((s) => (
                  <div key={s.key} className="tk-track-stage">
                    <span className="tiny muted">{s.label}</span>
                    <StageCell row={r} stage={s.key} onOpen={() => setEditing({ row: r, stage: s.key })} />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="table-wrap">
          <table className="table tk-track-table">
            <thead>
              <tr>
                <th scope="col">התנסות</th>
                <th scope="col">צוער</th>
                {TRACK_STAGES.map((s) => (
                  <th key={s.key} scope="col">
                    {s.label}
                  </th>
                ))}
                <th scope="col">
                  <span className="sr-only">פעולות</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.key}>
                  <td>
                    <div className="tk-track-title">
                      {r.category && <CategoryDot category={r.category} />}
                      <span className="strong">{r.label}</span>
                    </div>
                    <div className="tiny muted">
                      {weekRange(r.weekFrom, r.weekTo)}
                      {r.category ? ` · ${CATEGORY_INFO[r.category].label}` : ' · מחוץ לתכנון'}
                    </div>
                  </td>
                  <td>{r.cadetName}</td>
                  {TRACK_STAGES.map((s) => (
                    <td key={s.key}>
                      <StageCell row={r} stage={s.key} onOpen={() => setEditing({ row: r, stage: s.key })} />
                    </td>
                  ))}
                  <td className="tk-row-actions">
                    {r.trackingId && (
                      <button type="button" className="icon-btn" onClick={() => void removeRow(r)} aria-label={r.placementId ? `ניקוי המעקב של ${r.label}` : `הסרת ${r.label} מהמעקב`} title={r.placementId ? 'ניקוי המעקב' : 'הסרה מהמעקב'}>
                        <Icon name={r.placementId ? 'x' : 'trash'} size={15} />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {editing && <StageEditor row={editing.row} stage={editing.stage} onClose={() => setEditing(null)} mutate={mutate} />}
      {adding && <NewRow view={view} onClose={() => setAdding(false)} mutate={mutate} />}
    </div>
  );
}
