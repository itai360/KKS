// A cadet's exceptional-weapon form (server/src/weaponForms.ts): filled in from the cadet's file by whoever
// caught it, and kept as a printed form - the event, the weapon, what happened, the cadet's version, the team
// commander's handling, the course commander's decision, and the lines to sign.

import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { shortDate } from '@shared/dates';
import type { WeaponForm, WeaponFormSummary } from '@shared/types';
import { WEAPON_EXCEPTION_LABELS, WEAPON_EXCEPTIONS, WEAPON_TYPES, type WeaponException } from '@shared/weaponForms';
import { PageBack } from '../components/BackButton';
import { ask } from '../components/Confirm';
import { WordButton } from '../components/DocNav';
import { Icon } from '../components/Icon';
import { useToast } from '../components/Toasts';
import { DateInput, ErrorBox, Field, Loading, Modal, PageError, SuggestInput, TimeInput } from '../components/ui';
import { api } from '../lib/api';
import { fmtDateTime, todayKey } from '../lib/format';
import { emitLocalChange } from '../lib/realtime';
import { useSession } from '../lib/session';
import { usePageTitle } from '../lib/title';
import { useApi } from '../lib/useApi';

const when = (f: { occurredOn: string; occurredAt: string | null }) => `${shortDate(f.occurredOn)}${f.occurredAt ? ` · ${f.occurredAt}` : ''}`;

/** Filling one in, or changing it. */
export function WeaponFormDialog({ cadetId, cadetName, form, onClose, onSaved }: { cadetId: number; cadetName: string; form?: WeaponForm; onClose: () => void; onSaved?: (f: WeaponForm) => void }) {
  const navigate = useNavigate();
  const { user } = useSession();
  const [occurredOn, setOccurredOn] = useState(form?.occurredOn ?? todayKey());
  const [occurredAt, setOccurredAt] = useState(form?.occurredAt ?? '');
  const [place, setPlace] = useState(form?.place ?? '');
  const [kind, setKind] = useState<WeaponException>(form?.kind ?? 'abandoned');
  const [kindOther, setKindOther] = useState(form?.kindOther ?? '');
  const [weaponType, setWeaponType] = useState(form?.weaponType ?? '');
  const [weaponNumber, setWeaponNumber] = useState(form?.weaponNumber ?? '');
  const [description, setDescription] = useState(form?.description ?? '');
  const [foundBy, setFoundBy] = useState(form?.foundBy ?? user.displayName);
  const [cadetVersion, setCadetVersion] = useState(form?.cadetVersion ?? '');
  const [handling, setHandling] = useState(form?.handling ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    const body = { occurredOn, occurredAt: occurredAt || null, place, kind, kindOther, weaponType, weaponNumber, description, foundBy, cadetVersion, handling };
    try {
      const saved = form ? await api.patch<WeaponForm>(`/api/weapon-forms/${form.id}`, body) : await api.post<WeaponForm>(`/api/cadets/${cadetId}/weapon-forms`, body);
      emitLocalChange('cadets');
      if (onSaved) {
        onSaved(saved);
        onClose();
      } else navigate(`/cadets/${cadetId}/weapon/${saved.id}`);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <Modal
      title={form ? 'עריכת טופס נשק חריג' : `טופס נשק חריג - ${cadetName}`}
      wide
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose} disabled={busy}>
            ביטול
          </button>
          <button className="btn btn-primary" onClick={() => void submit()} disabled={busy || !description.trim() || !occurredOn || (kind === 'other' && !kindOther.trim())}>
            {busy ? 'שומר...' : form ? 'שמירה' : 'שמירת הטופס'}
          </button>
        </>
      }
    >
      <div className="col gap-16">
        {!form && <p className="small muted">מפקד הצוות ומפקד הקורס יקבלו התראה. הטופס גלוי רק להם ולמי שמילא אותו.</p>}
        <fieldset className="wform-part">
          <legend>האירוע</legend>
          <div className="wform-grid">
            <Field label="תאריך" required>
              <DateInput value={occurredOn} onChange={(v) => setOccurredOn(v)} max={todayKey()} />
            </Field>
            <Field label="שעה">
              <TimeInput value={occurredAt} onChange={setOccurredAt} />
            </Field>
            <Field label="מקום" className="wform-wide">
              <input className="input" value={place} onChange={(e) => setPlace(e.target.value)} maxLength={200} placeholder="לדוגמה: חדר האוכל, המגורים, המטווח" />
            </Field>
          </div>
          <div className="wform-kinds" role="radiogroup" aria-label="סוג החריג">
            {WEAPON_EXCEPTIONS.map((k) => (
              <button key={k} type="button" role="radio" aria-checked={kind === k} className={`chip${kind === k ? ' on' : ''}`} onClick={() => setKind(k)}>
                {WEAPON_EXCEPTION_LABELS[k]}
              </button>
            ))}
          </div>
          {kind === 'other' && (
            <Field label="מה היה החריג" required>
              <input className="input" value={kindOther} onChange={(e) => setKindOther(e.target.value)} maxLength={200} data-autofocus />
            </Field>
          )}
        </fieldset>
        <fieldset className="wform-part">
          <legend>הנשק</legend>
          <div className="wform-grid">
            <Field label="סוג הנשק">
              <SuggestInput value={weaponType} onChange={setWeaponType} options={WEAPON_TYPES} maxLength={60} />
            </Field>
            <Field label="מספר צ׳">
              <input className="input mono" value={weaponNumber} onChange={(e) => setWeaponNumber(e.target.value)} maxLength={60} inputMode="numeric" dir="ltr" />
            </Field>
          </div>
        </fieldset>
        <Field label="תיאור האירוע" required>
          <textarea className="textarea" rows={3} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={5000} placeholder="מה קרה - איפה הנשק היה, באיזה מצב, מה נעשה" />
        </Field>
        <Field label="מי גילה או דיווח">
          <input className="input" value={foundBy} onChange={(e) => setFoundBy(e.target.value)} maxLength={120} />
        </Field>
        <Field label="גרסת הצוער">
          <textarea className="textarea" rows={2} value={cadetVersion} onChange={(e) => setCadetVersion(e.target.value)} maxLength={5000} placeholder="מה הצוער אמר" />
        </Field>
        <Field label="טיפול מפקד הצוות">
          <textarea className="textarea" rows={2} value={handling} onChange={(e) => setHandling(e.target.value)} maxLength={5000} placeholder="שיחה, הערת משמעת, עונש - מה נעשה" />
        </Field>
        <ErrorBox error={error} />
      </div>
    </Modal>
  );
}

/** The cadet's forms, in the file. */
export function WeaponFormsCard({ cadetId, forms, onNew }: { cadetId: number; forms: WeaponFormSummary[]; onNew?: () => void }) {
  return (
    <div className="card">
      <div className="card-head">
        <Icon name="alert" />
        <h3 className="grow">טופסי נשק חריג</h3>
        <span className="mono tiny muted">{forms.length}</span>
      </div>
      <div className="card-body col gap-6">
        {forms.map((f) => (
          <Link key={f.id} to={`/cadets/${cadetId}/weapon/${f.id}`} className="wform-row">
            <span className="grow col">
              <span className="small strong">{f.kindText}</span>
              <span className="tiny muted">
                {when(f)}
                {f.authorName && ` · ${f.authorName}`}
              </span>
            </span>
            <span className={`badge ${f.decided ? 't-green' : 't-orange'}`}>{f.decided ? 'הוחלט' : 'ממתין להחלטה'}</span>
            <Icon name="chevronLeft" size={14} />
          </Link>
        ))}
        {onNew && (
          <button className="btn btn-ghost btn-sm" style={{ alignSelf: 'flex-start' }} onClick={onNew}>
            <Icon name="plus" size={15} /> טופס חדש
          </button>
        )}
      </div>
    </div>
  );
}

/** One form, as a printed page. */
export function WeaponFormPage() {
  const { id, formId } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const { settings } = useSession();
  const { data: f, error, status, loading, setData } = useApi<WeaponForm>(`/api/weapon-forms/${formId}`, ['cadets']);
  const [editing, setEditing] = useState(false);
  const [decision, setDecision] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  usePageTitle(f ? `טופס נשק חריג - ${f.cadetName}` : 'טופס נשק חריג');

  if (loading && !f)
    return (
      <div className="page">
        <Loading rows={6} />
      </div>
    );
  if (!f)
    return (
      <div className="page">
        <PageError error={error} status={status ?? 404} what="הטופס" back={`/cadets/${id}`} backLabel="לתיק הצוער" />
      </div>
    );

  const decide = async (text: string) => {
    setBusy(true);
    try {
      setData(await api.post<WeaponForm>(`/api/weapon-forms/${f.id}/decision`, { decision: text }));
      setDecision(null);
      emitLocalChange('cadets');
    } catch (e) {
      toast({ title: (e as Error).message, tone: 'red' });
    }
    setBusy(false);
  };
  const remove = async () => {
    if (!(await ask({ title: 'למחוק את הטופס?', body: `טופס הנשק החריג של ${f.cadetName} מ-${shortDate(f.occurredOn)} יימחק.`, confirm: 'מחיקת הטופס', danger: true }))) return;
    try {
      await api.del(`/api/weapon-forms/${f.id}`);
      emitLocalChange('cadets');
      navigate(`/cadets/${f.cadetId}`);
    } catch (e) {
      toast({ title: (e as Error).message, tone: 'red' });
    }
  };
  const title = `טופס נשק חריג - ${f.cadetName}`;
  const writing = decision !== null;

  return (
    <div className="page doc-page">
      <div className="doc-toolbar no-print">
        <PageBack />
        <span className="grow" />
        <Link className="btn btn-ghost" to={`/cadets/${f.cadetId}`}>
          <Icon name="shield" /> תיק הצוער
        </Link>
        {f.canEdit && (
          <button className="btn" onClick={() => setEditing(true)}>
            <Icon name="edit" /> עריכה
          </button>
        )}
        <WordButton title={title} />
        <button className="btn btn-primary" onClick={() => window.print()}>
          <Icon name="print" /> הדפסה / PDF
        </button>
        {f.canDelete && (
          <button className="icon-btn" aria-label="מחיקת הטופס" title="מחיקת הטופס" onClick={() => void remove()}>
            <Icon name="trash" />
          </button>
        )}
      </div>
      <p className="tiny muted no-print doc-note">טופס נשק חריג - גלוי רק למפקד הצוות, למפקד הקורס ולמי שמילא אותו.</p>
      <article className="doc wform-doc" aria-label={title}>
        <header className="doc-head">
          <div className="doc-kicker">{settings.courseName} · למפקדי הצוער בלבד</div>
          <h1 data-bar-title={title}>טופס נשק חריג</h1>
          <div className="doc-title">{f.cadetName}</div>
          <table className="doc-meta">
            <tbody>
              <tr>
                <th>שם הצוער</th>
                <td>{f.cadetName}</td>
                <th>מ.א.</th>
                <td className="mono">{f.personalNumber || '-'}</td>
              </tr>
              <tr>
                <th>צוות</th>
                <td>{f.teamName ?? '-'}</td>
                <th>מפקד הצוות</th>
                <td>{f.teamCommanderName ?? '-'}</td>
              </tr>
              <tr>
                <th>תאריך ושעה</th>
                <td className="mono">{when(f)}</td>
                <th>מקום</th>
                <td>{f.place || '-'}</td>
              </tr>
              <tr>
                <th>סוג החריג</th>
                <td>{f.kindText}</td>
                <th>מילא</th>
                <td>{f.authorName ?? '-'}</td>
              </tr>
            </tbody>
          </table>
        </header>
        <section>
          <h2>1. הנשק</h2>
          <ul className="doc-list">
            <li>
              <b>סוג הנשק:</b> {f.weaponType || '-'}
            </li>
            <li>
              <b>מספר צ׳:</b> <span className="mono">{f.weaponNumber || '-'}</span>
            </li>
          </ul>
        </section>
        <section>
          <h2>2. תיאור האירוע</h2>
          <p className="prewrap">{f.description}</p>
          {f.foundBy && (
            <p>
              <b>גילה / דיווח:</b> {f.foundBy}
            </p>
          )}
        </section>
        <section>
          <h2>3. גרסת הצוער</h2>
          <p className="prewrap">{f.cadetVersion || '-'}</p>
        </section>
        <section>
          <h2>4. טיפול מפקד הצוות</h2>
          <p className="prewrap">{f.handling || '-'}</p>
        </section>
        <section>
          <h2>5. החלטת מפקד הקורס</h2>
          {writing ? (
            <div className="col gap-8 no-print">
              <textarea className="textarea" rows={3} value={decision} onChange={(e) => setDecision(e.target.value)} maxLength={5000} placeholder="ההחלטה - ותיסגר" data-autofocus />
              <div className="row gap-6">
                <button className="btn btn-primary" disabled={busy || !decision.trim()} onClick={() => void decide(decision.trim())}>
                  <Icon name="stamp" /> אישור ההחלטה
                </button>
                <button className="btn" disabled={busy} onClick={() => setDecision(null)}>
                  ביטול
                </button>
              </div>
            </div>
          ) : f.decided ? (
            <>
              <p className="prewrap">{f.decision}</p>
              <p className="tiny muted">
                {f.decidedByName}
                {f.decidedAt && ` · ${fmtDateTime(f.decidedAt)}`}
              </p>
              {f.canDecide && (
                <p className="no-print">
                  <button type="button" className="link-btn" onClick={() => setDecision(f.decision)}>
                    שינוי ההחלטה
                  </button>
                  {' · '}
                  <button type="button" className="link-btn" onClick={() => void decide('')}>
                    ביטול ההחלטה
                  </button>
                </p>
              )}
            </>
          ) : f.canDecide ? (
            <button className="btn no-print" onClick={() => setDecision('')}>
              <Icon name="stamp" /> רישום החלטה
            </button>
          ) : (
            <p className="muted">ממתין להחלטת מפקד הקורס.</p>
          )}
        </section>
        <section className="wform-signs" aria-label="חתימות">
          {['הצוער', 'מפקד הצוות', 'מפקד הקורס'].map((who) => (
            <div key={who} className="wform-sign">
              <span className="wform-sign-line" />
              <span className="tiny">חתימת {who}</span>
            </div>
          ))}
        </section>
        <footer className="doc-foot">
          <div className="tiny muted">
            מולא ב-{fmtDateTime(f.createdAt)} · הופק ב-{shortDate(todayKey())} ממערכת ניהול הקורס
          </div>
        </footer>
      </article>
      {editing && <WeaponFormDialog cadetId={f.cadetId} cadetName={f.cadetName} form={f} onClose={() => setEditing(false)} onSaved={setData} />}
    </div>
  );
}
