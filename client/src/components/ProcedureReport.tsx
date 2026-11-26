// Not keeping to procedures (אי עמידה בנהלים) - from the "+" and the quick search: the cadet, what happened -
// a weapon left, a weapon on the back, a phone (in what situation), the dress (which items) or something else
// (written) - and a few words. Kept in the cadet's file as discipline (shared/procedures.ts), seen by the
// writer, the team commander and the course commander; the form tells which time this is for the cadet.

import { useEffect, useMemo, useState } from 'react';
import {
  DRESS_ITEMS,
  PROCEDURE_KINDS,
  PROCEDURE_LABELS,
  PROCEDURE_LIMITS,
  PROCEDURE_SUBJECT,
  procedureExemption,
  procedureMissing,
  procedureOffense,
  procedureWhat,
  type ProcedureKind,
} from '@shared/procedures';
import type { Cadet, DisciplinePreview } from '@shared/types';
import { api, qs } from '../lib/api';
import { emitLocalChange } from '../lib/realtime';
import { useApi } from '../lib/useApi';
import { timeLabel } from './Discipline';
import { Icon } from './Icon';
import { Select } from './pickers';
import { useToast } from './Toasts';
import { ErrorBox, Field, Modal } from './ui';

let openHost: (() => void) | null = null;
/** asked for before the host was up (the app just opened): it opens as the host mounts */
let asked = false;

/** Opens the report, empty */
export function addProcedure(): void {
  if (openHost) openHost();
  else asked = true;
}

export function ProcedureReportHost() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    openHost = () => setOpen(true);
    if (asked) {
      asked = false;
      setOpen(true);
    }
    return () => {
      openHost = null;
    };
  }, []);
  return open ? <ProcedureModal onClose={() => setOpen(false)} /> : null;
}

/** the tone of which time this is: the first quietly, a repeat in orange, a third and on in red */
export const timeTone = (n: number) => (n >= 3 ? 't-red' : n === 2 ? 't-orange' : 't-gray');

function ProcedureModal({ onClose }: { onClose: () => void }) {
  const toast = useToast();
  const cadets = useApi<Cadet[]>('/api/cadets', ['cadets']);
  const [cadetId, setCadetId] = useState<number | null>(null);
  const [kind, setKind] = useState<ProcedureKind | null>(null);
  const [other, setOther] = useState('');
  const [situation, setSituation] = useState('');
  const [dress, setDress] = useState<string[]>([]);
  const [details, setDetails] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // the course's cadets, each team in its group - the user's own teams first
  const groups = useMemo(() => {
    const active = (cadets.data ?? []).filter((c) => c.status === 'active');
    const byTeam = new Map<string, { own: boolean; list: Cadet[] }>();
    for (const c of active) {
      const team = c.teamName ?? 'ללא צוות';
      const g = byTeam.get(team) ?? { own: false, list: [] };
      g.own ||= c.canManage;
      g.list.push(c);
      byTeam.set(team, g);
    }
    return [...byTeam].sort(([a, x], [b, y]) => Number(y.own) - Number(x.own) || Number(a === 'ללא צוות') - Number(b === 'ללא צוות')).map(([team, g]) => ({ team, list: g.list }));
  }, [cadets.data]);
  const cadet = cadets.data?.find((c) => c.id === cadetId) ?? null;

  const report = { cadetId: cadetId ?? 0, kind: kind ?? undefined, other, situation, dress, details };
  const missing = procedureMissing(report);
  // which time this is for the cadet - not for "אחר", counted by its words as they are being typed
  const offense = cadet && kind && kind !== 'other' ? procedureOffense({ kind }) : null;
  const preview = useApi<DisciplinePreview>(cadet && offense ? `/api/cadets/${cadet.id}/discipline-preview${qs({ offense })}` : null, ['cadets']).data;
  const exemption = cadet ? procedureExemption(kind, cadet.exemptions) : undefined;

  const toggleDress = (item: string) => setDress((d) => (d.includes(item) ? d.filter((x) => x !== item) : [...d, item]));

  const save = async () => {
    if (missing.length || !cadet || !kind) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api.post<{ recordId: number; occurrence: number }>('/api/procedures', { cadetId: cadet.id, kind, other, situation, dress, details });
      emitLocalChange('cadets');
      toast({
        title: `נרשם בתיק של ${cadet.fullName}`,
        body: `${procedureWhat({ kind, other, dress })} · ${timeLabel(res.occurrence)}`,
        tone: 'green',
        link: `/cadets/${cadet.id}`,
      });
      onClose();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <Modal
      title={PROCEDURE_SUBJECT}
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-primary" onClick={() => void save()} disabled={busy || missing.length > 0}>
            <Icon name="check" /> {busy ? 'שומר...' : 'שמירה בתיק הצוער'}
          </button>
          <button className="btn btn-ghost" onClick={onClose}>
            ביטול
          </button>
          {missing.length > 0 && <span className="tiny muted entry-missing">חסר: {missing.join(', ')}</span>}
        </>
      }
    >
      <form
        className="col gap-16 proc-form"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <Field label="שם הצוער" required>
          <Select value={cadetId ?? ''} onChange={(e) => setCadetId(e.target.value ? Number(e.target.value) : null)} aria-label="שם הצוער" searchable data-autofocus>
            <option value="">{cadets.loading && !cadets.data ? 'טוען צוערים...' : 'בחירת צוער...'}</option>
            {groups.map((g) => (
              <optgroup key={g.team} label={g.team}>
                {g.list.map((c) => (
                  <option key={c.id} value={c.id} data-shown={c.teamName ? `${c.fullName} · ${c.teamName}` : c.fullName}>
                    {c.fullName}
                  </option>
                ))}
              </optgroup>
            ))}
          </Select>
        </Field>
        <ErrorBox error={cadets.error} />

        <fieldset className="proc-group">
          <legend>
            מה קרה<span className="req"> *</span>
          </legend>
          <div className="chips proc-kinds" role="radiogroup" aria-label="מה קרה">
            {PROCEDURE_KINDS.map((k) => (
              <label key={k} className={`chip proc-chip${kind === k ? ' on' : ''}`}>
                <input type="radio" name="proc-kind" value={k} checked={kind === k} onChange={() => setKind(k)} className="proc-input" />
                {PROCEDURE_LABELS[k]}
              </label>
            ))}
          </div>
        </fieldset>

        {kind === 'phone' && (
          <div className="proc-more" key="phone">
            <Field label="מה הסיטואציה">
              <input className="input" value={situation} onChange={(e) => setSituation(e.target.value)} maxLength={PROCEDURE_LIMITS.situation} placeholder="לדוגמה: בשיעור, במסדר, בזמן תרגיל" autoComplete="off" />
            </Field>
          </div>
        )}
        {kind === 'dress' && (
          <fieldset className="proc-more proc-group" key="dress">
            <legend>
              מה בדיגום<span className="req"> *</span>
            </legend>
            <div className="chips proc-kinds">
              {DRESS_ITEMS.map((item) => (
                <label key={item} className={`chip proc-chip${dress.includes(item) ? ' on' : ''}`}>
                  <input type="checkbox" checked={dress.includes(item)} onChange={() => toggleDress(item)} className="proc-input" />
                  {dress.includes(item) && <Icon name="check" size={14} />}
                  {item}
                </label>
              ))}
            </div>
          </fieldset>
        )}
        {kind === 'other' && (
          <div className="proc-more" key="other">
            <Field label="מה לא נשמר" required>
              <input className="input" value={other} onChange={(e) => setOther(e.target.value)} maxLength={PROCEDURE_LIMITS.other} placeholder="לדוגמה: גילוח" autoComplete="off" autoFocus />
            </Field>
          </div>
        )}

        {cadet && kind && (preview || exemption) && (
          <div className="proc-status" role="status">
            {preview && kind !== 'other' && (
              <span>
                <span className={`badge ${timeTone(preview.occurrence)}`}>{timeLabel(preview.occurrence)}</span> של {cadet.firstName} ב{PROCEDURE_LABELS[kind]}
              </span>
            )}
            {exemption && (
              <span className="proc-exempt">
                <Icon name="alert" size={14} /> ל{cadet.firstName} יש פטור בנושא {exemption} - כדאי לבדוק לפני שרושמים.
              </span>
            )}
          </div>
        )}

        <Field label="פירוט">
          <textarea className="textarea" rows={3} value={details} onChange={(e) => setDetails(e.target.value)} maxLength={PROCEDURE_LIMITS.details} placeholder="מה ראית, איפה ומתי - ומה נעשה במקום" />
        </Field>
        <p className="tiny muted entry-privacy">
          <Icon name="lock" size={13} /> נשמר במשמעת שבתיק הצוער - גלוי רק לך, למפקד הצוות ולמפקד הקורס.
        </p>
        <ErrorBox error={error} />
      </form>
    </Modal>
  );
}
