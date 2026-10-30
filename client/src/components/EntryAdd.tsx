// A visitor's entry to the base (אישור כניסה) - from the "+", the quick search and the entries screen. Anyone on
// the staff fills it in; it goes straight to the course commander, who sends it on to the base in its format
// (shared/entry.ts). The same form edits a request while it waits.
//
// The base's format, pasted as it came in WhatsApp (one message or several), fills the form by itself - in the
// form, from the "הדבקת פורמט" button, or anywhere on the entries screen. After saving, "העתקת הפורמט" copies
// the request back in the same format.

import { useEffect, useRef, useState } from 'react';
import { emptyEntryFields, entryMessage, entryMissing, parseEntryMessages, VISITOR_KIND_LABELS, VISITOR_KINDS, type EntryFields, type EntryPlace, type VisitorKind } from '@shared/entry';
import type { EntryRequest } from '@shared/types';
import { api } from '../lib/api';
import { copyText, readText } from '../lib/clipboard';
import { emitLocalChange } from '../lib/realtime';
import { useSession } from '../lib/session';
import { Icon } from './Icon';
import { useToast } from './Toasts';
import { ErrorBox, Field, Modal, Seg } from './ui';

interface Opening {
  editing?: EntryRequest;
  /** a pasted message to fill the form from; true - open with the box to paste it into */
  paste?: string | true;
}

let openHost: ((o: Opening) => void) | null = null;
/** asked for before the host was up (the app just opened): it opens as the host mounts */
let asked: Opening | null = null;

const open = (o: Opening) => {
  if (openHost) openHost(o);
  else asked = o;
};

/** Opens the form - empty, or with a request to change */
export function addEntry(editing?: EntryRequest): void {
  open({ editing });
}

/** Opens the form filled from the base's format pasted as is; with no text, from the clipboard - or, when the
 *  browser will not hand it over or it holds something else, with the box to paste it into */
export function pasteEntry(text?: string): void {
  if (text !== undefined) {
    open({ paste: text });
    return;
  }
  void readText().then((t) => open({ paste: t && parseEntryMessages(t).entries.length ? t : true }));
}

/** the requests in a pasted text, read against the course's own place: the same camp and unit are not kept apart */
export function readEntryPaste(text: string, place: EntryPlace): EntryFields[] {
  const same = (a: string, b: string) => a.replace(/\s+/g, ' ').trim() === b.replace(/\s+/g, ' ').trim();
  return parseEntryMessages(text).entries.map(({ fields }) => ({
    ...fields,
    camp: fields.camp && same(fields.camp, place.camp) ? '' : fields.camp,
    unit: fields.unit && same(fields.unit, place.unit) ? '' : fields.unit,
  }));
}

export function EntryAddHost() {
  const [state, setState] = useState<Opening | null>(null);
  useEffect(() => {
    openHost = (o) => setState(o);
    if (asked) {
      setState(asked);
      asked = null;
    }
    return () => {
      openHost = null;
    };
  }, []);
  return state ? <EntryModal editing={state.editing} paste={state.paste} onClose={() => setState(null)} /> : null;
}

/** a request's fields, as the form holds them */
const pick = (e: EntryRequest): EntryFields => {
  const out = emptyEntryFields();
  return Object.fromEntries((Object.keys(out) as (keyof EntryFields)[]).map((k) => [k, e[k] ?? out[k]])) as unknown as EntryFields;
};

/** a batch read from one paste: which of them the form is on */
interface Batch {
  total: number;
  at: number;
}

function EntryModal({ editing, paste, onClose }: { editing?: EntryRequest; paste?: string | true; onClose: () => void }) {
  const { isCommander, settings } = useSession();
  const toast = useToast();
  const place: EntryPlace = { camp: settings.entryCamp ?? '', unit: settings.entryUnit ?? '' };
  // a paste the screen handed over: read at once, the first in the form and the rest waiting their turn
  const [first] = useState(() => (typeof paste === 'string' ? readEntryPaste(paste, place) : []));
  const [f, setF] = useState<EntryFields>(() => first[0] ?? (editing ? pick(editing) : emptyEntryFields()));
  const [queue, setQueue] = useState<EntryFields[]>(() => first.slice(1));
  const [batch, setBatch] = useState<Batch | null>(() => (first.length ? { total: first.length, at: 1 } : null));
  const [pasteOpen, setPasteOpen] = useState(paste === true || (typeof paste === 'string' && !first.length));
  const [pasteText, setPasteText] = useState(typeof paste === 'string' && !first.length ? paste : '');
  const [placeOpen, setPlaceOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const set = <K extends keyof EntryFields>(k: K, v: EntryFields[K]) => setF((x) => ({ ...x, [k]: v }));
  const missing = entryMissing(f);
  const soldier = f.visitorKind === 'soldier';
  const ready = queue.every((q) => !entryMissing(q).length) && !missing.length;

  /** fills the form from a pasted text; false when it is not the base's format */
  const take = (text: string): boolean => {
    const read = readEntryPaste(text, place);
    if (!read.length) return false;
    setF(read[0]);
    setQueue(read.slice(1));
    setBatch({ total: read.length, at: 1 });
    setPasteOpen(false);
    setPasteText('');
    setError(null);
    setPlaceOpen(false);
    // the form starts again at its top, where the filled fields are
    formRef.current?.closest('.modal-body, .modal')?.scrollTo({ top: 0, behavior: 'smooth' });
    return true;
  };

  const fromClipboard = async () => {
    const text = await readText();
    if (text && take(text)) return;
    // not allowed to read it, or not the format: the box to paste into, with what was there
    if (text) setPasteText(text);
    setPasteOpen(true);
  };

  const copyNow = async (msg: string, name = '') => {
    const ok = await copyText(msg);
    toast(ok ? { title: 'הפורמט הועתק', body: name || undefined, tone: 'green' } : { title: 'לא הצלחנו להעתיק', body: 'אפשר לפתוח את הבקשה במסך אישורי הכניסה ולסמן את ההודעה', tone: 'gray' });
  };

  /** the edited request takes the first of a paste; the rest are new requests */
  const send = async (e: EntryFields, first: boolean): Promise<number> => {
    if (editing && first) {
      await api.patch(`/api/entries/${editing.id}`, e);
      return editing.id;
    }
    return (await api.post<{ id: number }>('/api/entries', e)).id;
  };

  const save = async () => {
    if (missing.length) {
      setError(`חסר: ${missing.join(', ')}`);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const id = await send(f, !batch || batch.at === 1);
      emitLocalChange('entries');
      const msg = entryMessage(f, place);
      const updated = Boolean(editing) && (!batch || batch.at === 1);
      toast({
        title: updated ? 'הבקשה עודכנה' : isCommander ? 'הבקשה נשמרה - ההודעה מוכנה לשליחה' : 'הבקשה נשלחה למפקד הקורס',
        body: f.fullName.trim(),
        tone: 'green',
        link: `/entries#entry-${id}`,
        action: { label: 'העתקת הפורמט', run: () => void copyNow(msg, f.fullName.trim()) },
      });
      // more from the same paste: the next one in the form
      if (queue.length) {
        setF(queue[0]);
        setQueue(queue.slice(1));
        setBatch((b) => b && { ...b, at: b.at + 1 });
        formRef.current?.closest('.modal-body, .modal')?.scrollTo({ top: 0, behavior: 'smooth' });
        return;
      }
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  /** every request of the paste at once, when each has all it needs */
  const saveAll = async () => {
    setBusy(true);
    setError(null);
    const all = [f, ...queue];
    const msgs: string[] = [];
    try {
      for (const [i, e] of all.entries()) {
        await send(e, i === 0 && batch?.at === 1);
        msgs.push(entryMessage(e, place));
        // what was saved leaves the batch: a failure halfway keeps only what is left
        setQueue(all.slice(i + 2));
        if (i + 1 < all.length) setF(all[i + 1]);
      }
      emitLocalChange('entries');
      const text = msgs.join('\n\n');
      toast({
        title: isCommander ? `${all.length} בקשות נשמרו - ההודעות מוכנות לשליחה` : `${all.length} בקשות נשלחו למפקד הקורס`,
        body: all.map((e) => e.fullName.trim()).join(', '),
        tone: 'green',
        link: '/entries',
        action: { label: 'העתקת הפורמטים', run: () => void copyNow(text) },
      });
      onClose();
    } catch (e) {
      emitLocalChange('entries');
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const otherPlace = placeOpen || Boolean(f.unit || f.camp);
  const editingNow = Boolean(editing) && (!batch || batch.at === 1);

  return (
    <Modal
      title={editingNow ? 'עריכת אישור כניסה' : 'אישור כניסה לבסיס'}
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-primary" onClick={() => void save()} disabled={busy || missing.length > 0}>
            <Icon name="check" /> {editingNow ? 'שמירה' : queue.length ? 'שמירה והבאה' : isCommander ? 'שמירה' : 'שליחה למפקד הקורס'}
          </button>
          {queue.length > 0 && ready && (
            <button className="btn" onClick={() => void saveAll()} disabled={busy}>
              <Icon name="checks" /> שמירת כל {queue.length + 1}
            </button>
          )}
          <button className="btn btn-ghost" onClick={() => void copyNow(entryMessage(f, place), f.fullName.trim())} disabled={missing.length > 0} title="ההודעה בפורמט של הבסיס, להדבקה בוואטסאפ">
            <Icon name="copy" /> העתקה
          </button>
          {missing.length > 0 && <span className="tiny muted entry-missing">חסר: {missing.join(', ')}</span>}
        </>
      }
    >
      <form
        ref={formRef}
        className="col gap-12 entry-form"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
        // the whole format pasted into any field fills every field
        onPaste={(e) => {
          const text = e.clipboardData.getData('text');
          if (text.includes('\n') && take(text)) e.preventDefault();
        }}
      >
        {batch ? (
          <div className="entry-pasted small" role="status">
            <Icon name="check" size={15} />
            <span className="grow">
              מולא מהפורמט שהודבק{batch.total > 1 ? ` · בקשה ${batch.at} מתוך ${batch.total}` : ''}
            </span>
            <button type="button" className="link-btn tiny" onClick={() => void fromClipboard()}>
              הדבקה אחרת
            </button>
          </div>
        ) : pasteOpen ? null : (
          <button type="button" className="entry-paste-btn" onClick={() => void fromClipboard()}>
            <span className="entry-paste-ic" aria-hidden>
              <Icon name="clipboard" size={18} />
            </span>
            <span className="col grow">
              <span className="strong">הדבקת פורמט אישור כניסה</span>
              <span className="tiny muted">קיבלתם את הפורמט בוואטסאפ? מדביקים אותו כמו שהוא, והכל מתמלא לבד</span>
            </span>
          </button>
        )}
        {pasteOpen && (
          <div className="col gap-6 entry-paste-box">
            <label className="label-caps" htmlFor="entry-paste">
              הדביקו כאן את הפורמט כמו שהוא
            </label>
            <textarea
              id="entry-paste"
              className="textarea"
              dir="rtl"
              rows={6}
              value={pasteText}
              placeholder={'*🔵פורמט אישור כניסה 🔵*\n*שם מלא:* ...\n*מס\' טלפון:* ...'}
              onChange={(e) => {
                setPasteText(e.target.value);
                take(e.target.value);
              }}
              data-autofocus
            />
            {pasteText.trim() && <span className="tiny text-red">לא זיהינו כאן פורמט אישור כניסה - צריך לפחות שלוש שורות כמו "*שם מלא:* ..."</span>}
            <button type="button" className="link-btn tiny" onClick={() => setPasteOpen(false)} style={{ alignSelf: 'flex-start' }}>
              מילוי ידני
            </button>
          </div>
        )}
        <div className="form-grid">
          <Field label="שם מלא" required>
            <input className="input" value={f.fullName} onChange={(e) => set('fullName', e.target.value)} maxLength={80} autoComplete="off" data-autofocus={pasteOpen ? undefined : true} />
          </Field>
          <Field label="טלפון" required>
            <input className="input" dir="ltr" type="tel" inputMode="tel" value={f.phone} onChange={(e) => set('phone', e.target.value)} maxLength={20} autoComplete="off" />
          </Field>
        </div>
        <div className="form-grid">
          <div className="col gap-6">
            <span className="label-caps">אזרח או חייל</span>
            <Seg<VisitorKind> value={f.visitorKind} onChange={(v) => set('visitorKind', v)} options={VISITOR_KINDS.map((k) => ({ value: k, label: VISITOR_KIND_LABELS[k] }))} />
          </div>
          {soldier && (
            <Field label="דרגה" required>
              <input className="input" value={f.rank} onChange={(e) => set('rank', e.target.value)} maxLength={30} autoComplete="off" />
            </Field>
          )}
        </div>
        <div className="form-grid">
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
            <Seg value={f.escort ? 'yes' : 'no'} onChange={(v) => set('escort', v === 'yes')} options={[{ value: 'no', label: 'לא נדרש ליווי' }, { value: 'yes', label: 'נדרש ליווי' }]} />
          </div>
          <div className="col gap-6">
            <span className="label-caps">הגעה</span>
            <Seg value={f.byCar ? 'car' : 'foot'} onChange={(v) => set('byCar', v === 'car')} options={[{ value: 'foot', label: 'רגלי' }, { value: 'car', label: 'רכוב' }]} />
          </div>
        </div>
        {f.byCar && (
          <>
            <div className="col gap-6">
              <span className="label-caps">רכב</span>
              <Seg value={f.carMilitary ? 'military' : 'civil'} onChange={(v) => set('carMilitary', v === 'military')} options={[{ value: 'civil', label: 'אזרחי' }, { value: 'military', label: 'צבאי' }]} />
            </div>
            <div className="form-grid">
              <Field label="מספר רכב" required>
                <input className="input" dir="ltr" value={f.carNumber} onChange={(e) => set('carNumber', e.target.value)} maxLength={20} autoComplete="off" />
              </Field>
              <Field label="סוג וצבע הרכב" required>
                <input className="input" value={f.carKind} onChange={(e) => set('carKind', e.target.value)} maxLength={60} autoComplete="off" />
              </Field>
            </div>
          </>
        )}
        <Field label="סיבת ההגעה" required>
          <input className="input" value={f.reason} onChange={(e) => set('reason', e.target.value)} maxLength={300} autoComplete="off" />
        </Field>
        {otherPlace ? (
          <div className="form-grid">
            <Field label="יחידה אליה המבקר מגיע" hint={place.unit ? `ריק - ${place.unit}` : undefined}>
              <input className="input" value={f.unit} placeholder={place.unit} onChange={(e) => set('unit', e.target.value)} maxLength={80} autoComplete="off" />
            </Field>
            <Field label="מחנה" hint={place.camp ? `ריק - ${place.camp}` : undefined}>
              <input className="input" value={f.camp} placeholder={place.camp} onChange={(e) => set('camp', e.target.value)} maxLength={80} autoComplete="off" />
            </Field>
          </div>
        ) : (
          <button type="button" className="link-btn tiny" onClick={() => setPlaceOpen(true)} style={{ alignSelf: 'flex-start' }}>
            מגיע ליחידה או למחנה אחרים?
          </button>
        )}
        <p className="tiny muted entry-privacy">
          <Icon name="lock" size={13} /> הפרטים גלויים רק לך ולמפקד הקורס, ונמחקים שבוע אחרי שנשלחו לבסיס.
        </p>
        <ErrorBox error={error} />
      </form>
    </Modal>
  );
}
