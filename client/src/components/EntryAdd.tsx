// A visitor's entry to the base (אישור כניסה) - from the "+", the quick search and the entries screen. Anyone on
// the staff fills it in; it goes straight to the course commander, who sends it on to the base in its format
// (shared/entry.ts). The same form edits a request while it waits.

import { useEffect, useState } from 'react';
import { entryMissing, VISITOR_KIND_LABELS, VISITOR_KINDS, type EntryFields, type VisitorKind } from '@shared/entry';
import type { EntryRequest } from '@shared/types';
import { api } from '../lib/api';
import { todayKey } from '../lib/format';
import { emitLocalChange } from '../lib/realtime';
import { useSession } from '../lib/session';
import { Icon } from './Icon';
import { useToast } from './Toasts';
import { DateInput, ErrorBox, Field, Modal, Seg } from './ui';

let openHost: ((editing?: EntryRequest) => void) | null = null;
/** asked for before the host was up (the app just opened): it opens as the host mounts */
let asked = false;

/** Opens the form - empty, or with a request to change */
export function addEntry(editing?: EntryRequest): void {
  if (openHost) openHost(editing);
  else asked = true;
}

export function EntryAddHost() {
  const [state, setState] = useState<{ editing?: EntryRequest } | null>(null);
  useEffect(() => {
    openHost = (editing) => setState({ editing });
    if (asked) {
      asked = false;
      setState({});
    }
    return () => {
      openHost = null;
    };
  }, []);
  return state ? <EntryModal editing={state.editing} onClose={() => setState(null)} /> : null;
}

const EMPTY: EntryFields = {
  visitDate: '',
  fullName: '',
  phone: '',
  visitorKind: 'civilian',
  rank: '',
  clearance: '',
  idNumber: '',
  escort: false,
  byCar: false,
  carNumber: '',
  carKind: '',
  reason: '',
};

function EntryModal({ editing, onClose }: { editing?: EntryRequest; onClose: () => void }) {
  const { isCommander } = useSession();
  const toast = useToast();
  const [f, setF] = useState<EntryFields>(() => (editing ? { ...EMPTY, ...pick(editing) } : EMPTY));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof EntryFields>(k: K, v: EntryFields[K]) => setF((x) => ({ ...x, [k]: v }));
  const missing = entryMissing(f);
  const soldier = f.visitorKind === 'soldier';

  const save = async () => {
    if (missing.length) {
      setError(`חסר: ${missing.join(', ')}`);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      let id = editing?.id;
      if (editing) await api.patch(`/api/entries/${editing.id}`, f);
      else id = (await api.post<{ id: number }>('/api/entries', f)).id;
      emitLocalChange('entries');
      toast({
        title: editing ? 'הבקשה עודכנה' : isCommander ? 'הבקשה נשמרה - ההודעה מוכנה לשליחה' : 'הבקשה נשלחה למפקד הקורס',
        body: f.fullName.trim(),
        tone: 'green',
        link: `/entries#entry-${id}`,
      });
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title={editing ? 'עריכת אישור כניסה' : 'אישור כניסה לבסיס'}
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-primary" onClick={() => void save()} disabled={busy || missing.length > 0}>
            <Icon name="check" /> {editing ? 'שמירה' : isCommander ? 'שמירה' : 'שליחה למפקד הקורס'}
          </button>
          <button className="btn btn-ghost" onClick={onClose}>
            ביטול
          </button>
          {missing.length > 0 && <span className="tiny muted entry-missing">חסר: {missing.join(', ')}</span>}
        </>
      }
    >
      <form
        className="col gap-12 entry-form"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <div className="form-grid">
          <Field label="שם מלא" required>
            <input className="input" value={f.fullName} onChange={(e) => set('fullName', e.target.value)} maxLength={80} autoComplete="off" data-autofocus />
          </Field>
          <Field label="תאריך הביקור" required>
            <DateInput value={f.visitDate} onChange={(v) => set('visitDate', v)} min={editing ? undefined : todayKey()} aria-label="תאריך הביקור" />
          </Field>
        </div>
        <div className="form-grid">
          <Field label="טלפון" required>
            <input className="input" dir="ltr" type="tel" inputMode="tel" value={f.phone} onChange={(e) => set('phone', e.target.value)} maxLength={20} autoComplete="off" />
          </Field>
          <div className="col gap-6">
            <span className="label-caps">אזרח או חייל</span>
            <Seg<VisitorKind> value={f.visitorKind} onChange={(v) => set('visitorKind', v)} options={VISITOR_KINDS.map((k) => ({ value: k, label: VISITOR_KIND_LABELS[k] }))} />
          </div>
        </div>
        <div className="form-grid">
          {soldier && (
            <Field label="דרגה" required>
              <input className="input" value={f.rank} onChange={(e) => set('rank', e.target.value)} maxLength={30} autoComplete="off" />
            </Field>
          )}
          <Field label={soldier ? 'מספר אישי' : 'תעודת זהות'} required>
            <input className="input" dir="ltr" inputMode="numeric" value={f.idNumber} onChange={(e) => set('idNumber', e.target.value.replace(/\D/g, ''))} maxLength={10} autoComplete="off" />
          </Field>
          <Field label="סיווג ביטחוני" hint="אם ידוע">
            <input className="input" value={f.clearance} onChange={(e) => set('clearance', e.target.value)} maxLength={30} autoComplete="off" />
          </Field>
        </div>
        <div className="form-grid">
          <div className="col gap-6">
            <span className="label-caps">ליווי</span>
            <Seg value={f.escort ? 'yes' : 'no'} onChange={(v) => set('escort', v === 'yes')} options={[{ value: 'no', label: 'לא דרוש ליווי' }, { value: 'yes', label: 'דרוש ליווי' }]} />
          </div>
          <div className="col gap-6">
            <span className="label-caps">הגעה</span>
            <Seg value={f.byCar ? 'car' : 'foot'} onChange={(v) => set('byCar', v === 'car')} options={[{ value: 'foot', label: 'רגלי' }, { value: 'car', label: 'רכוב' }]} />
          </div>
        </div>
        {f.byCar && (
          <div className="form-grid">
            <Field label="מספר רכב" required>
              <input className="input" dir="ltr" value={f.carNumber} onChange={(e) => set('carNumber', e.target.value)} maxLength={20} autoComplete="off" />
            </Field>
            <Field label="סוג וצבע הרכב" required>
              <input className="input" value={f.carKind} onChange={(e) => set('carKind', e.target.value)} maxLength={60} autoComplete="off" />
            </Field>
          </div>
        )}
        <Field label="סיבת ההגעה" required>
          <input className="input" value={f.reason} onChange={(e) => set('reason', e.target.value)} maxLength={300} autoComplete="off" />
        </Field>
        <p className="tiny muted entry-privacy">
          <Icon name="lock" size={13} /> הפרטים גלויים רק לך ולמפקד הקורס, ונמחקים שבוע אחרי הביקור.
        </p>
        <ErrorBox error={error} />
      </form>
    </Modal>
  );
}

const pick = (e: EntryRequest): EntryFields => ({
  visitDate: e.visitDate,
  fullName: e.fullName,
  phone: e.phone,
  visitorKind: e.visitorKind,
  rank: e.rank,
  clearance: e.clearance,
  idNumber: e.idNumber,
  escort: e.escort,
  byCar: e.byCar,
  carNumber: e.carNumber,
  carKind: e.carKind,
  reason: e.reason,
});
