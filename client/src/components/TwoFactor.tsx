// Two-step sign-in (server/src/twofactor.ts): the code step after the password, and turning it
// on and off in the settings - a QR code for the authenticator app and ten one-time backup codes.

import { useEffect, useState } from 'react';
import { renderSVG } from 'uqr';
import type { LoginResult, User } from '@shared/types';
import { api } from '../lib/api';
import { saveFile } from '../lib/download';
import { useHashScroll } from '../lib/hashScroll';
import { useSession } from '../lib/session';
import { Icon } from './Icon';
import { useToast } from './Toasts';
import { ErrorBox, Field, Modal } from './ui';

/** after the password: the 6-digit code from the app, or a backup code */
export function CodeStep({ ticket, onSignedIn, onRestart }: { ticket: string; onSignedIn: (r: { user: User }) => void; onRestart: () => void }) {
  const [code, setCode] = useState('');
  const [backup, setBackup] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      onSignedIn(await api.post<{ user: User }>('/api/auth/2fa/verify', { ticket, code }));
    } catch (err) {
      const m = (err as Error).message;
      // the ticket ran out: back to the password
      if (/פג תוקף|יותר מדי/.test(m)) return onRestart();
      setError(m);
      setCode('');
      setBusy(false);
    }
  };

  return (
    <form className="col gap-12" onSubmit={(e) => void submit(e)} aria-label="קוד אימות">
      <p className="small" style={{ margin: 0 }}>
        {backup ? 'הזינו אחד מקודי הגיבוי שקיבלתם כשהפעלתם את האימות הדו-שלבי. כל קוד עובד פעם אחת.' : 'פתחו את אפליקציית האימות בטלפון והזינו את הקוד בן 6 הספרות שמופיע עכשיו.'}
      </p>
      <Field label={backup ? 'קוד גיבוי' : 'קוד מהאפליקציה'}>
        {backup ? (
          <input key="backup" className="input code-input" dir="ltr" autoComplete="off" value={code} onChange={(e) => setCode(e.target.value)} placeholder="xxxxx-xxxxx" maxLength={11} required autoFocus data-autofocus />
        ) : (
          <input
            key="totp"
            className="input code-input"
            dir="ltr"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="\d{6}"
            maxLength={6}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
            placeholder="000000"
            required
            autoFocus
            data-autofocus
          />
        )}
      </Field>
      <ErrorBox error={error} />
      <button className="btn btn-primary btn-block" disabled={busy || (backup ? code.replace(/\W/g, '').length < 10 : code.length !== 6)}>
        {busy ? 'בודק...' : 'אישור'}
      </button>
      <div className="row wrap gap-6" style={{ justifyContent: 'space-between' }}>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={() => {
            setBackup(!backup);
            setCode('');
            setError(null);
          }}
        >
          {backup ? 'קוד מהאפליקציה' : 'אין גישה לטלפון? קוד גיבוי'}
        </button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onRestart}>
          חזרה לסיסמה
        </button>
      </div>
    </form>
  );
}

/** a sign-in answer: a session, or the code step's ticket */
export const ticketOf = (r: LoginResult | null | undefined): string | null => (r?.twoFactor && r.ticket ? r.ticket : null);

// ---------------- in the settings ----------------

function RecoveryCodes({ codes }: { codes: string[] }) {
  const { settings } = useSession();
  const text = `קודי גיבוי לכניסה - ${settings.courseName}\nכל קוד עובד פעם אחת. שמרו במקום בטוח.\n\n${codes.join('\n')}\n`;
  return (
    <div className="col gap-12">
      <div className="info-box small">
        שמרו את הקודים האלה במקום בטוח (לא בטלפון שבו האפליקציה). הם מוצגים פעם אחת בלבד, וכל אחד מכניס פעם אחת אם הטלפון אבד.
      </div>
      <ol className="recovery-codes" dir="ltr">
        {codes.map((c) => (
          <li key={c}>{c}</li>
        ))}
      </ol>
      <div className="row wrap gap-6">
        <button type="button" className="btn btn-sm" onClick={() => void navigator.clipboard?.writeText(codes.join('\n'))}>
          <Icon name="file" /> העתקה
        </button>
        <button type="button" className="btn btn-sm" onClick={() => void saveFile('קודי-גיבוי.txt', new Blob([text], { type: 'text/plain;charset=utf-8' }))}>
          <Icon name="download" /> הורדה כקובץ
        </button>
      </div>
    </div>
  );
}

function EnableDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [password, setPassword] = useState('');
  const [setup, setSetup] = useState<{ secret: string; uri: string } | null>(null);
  const [code, setCode] = useState('');
  const [codes, setCodes] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="הפעלת אימות דו-שלבי" onClose={codes ? onDone : onClose} closable={!codes}>
      {codes ? (
        <div className="col gap-16">
          <div className="strong">
            <Icon name="shield" /> האימות הדו-שלבי פעיל. מעכשיו בכל כניסה תתבקשו גם לקוד מהאפליקציה.
          </div>
          <RecoveryCodes codes={codes} />
          <button className="btn btn-primary" onClick={onDone}>
            שמרתי את הקודים - סיום
          </button>
        </div>
      ) : !setup ? (
        <form className="col gap-12" onSubmit={(e) => (e.preventDefault(), void run(async () => setSetup(await api.post('/api/auth/2fa/setup', { password }))))}>
          <p className="small" style={{ margin: 0 }}>
            אחרי הסיסמה תתבקשו לקוד בן 6 ספרות מאפליקציית אימות בטלפון (Google Authenticator, Microsoft Authenticator או דומה). כך גם מי שיודע את הסיסמה לא ייכנס בלי הטלפון שלכם.
          </p>
          <Field label="הסיסמה שלך, לאישור">
            <input className="input" type="password" dir="ltr" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required data-autofocus />
          </Field>
          <ErrorBox error={error} />
          <button className="btn btn-primary" disabled={busy || !password}>
            המשך
          </button>
        </form>
      ) : (
        <form
          className="col gap-12"
          onSubmit={(e) => {
            e.preventDefault();
            void run(async () => setCodes((await api.post<{ recoveryCodes: string[] }>('/api/auth/2fa/enable', { code })).recoveryCodes));
          }}
        >
          <ol className="small two-step-steps">
            <li>פתחו את אפליקציית האימות בטלפון ובחרו בהוספת חשבון (+).</li>
            <li>סרקו את הקוד. בטלפון הזה: אפשר גם ללחוץ על &quot;פתיחה באפליקציה&quot;, או להקליד את המפתח.</li>
            <li>הזינו כאן את הקוד בן 6 הספרות שהאפליקציה מראה.</li>
          </ol>
          <QrCode value={setup.uri} />
          <div className="row wrap gap-6" style={{ justifyContent: 'center' }}>
            <a className="btn btn-sm" href={setup.uri}>
              <Icon name="external" /> פתיחה באפליקציה
            </a>
          </div>
          <div className="small muted" style={{ textAlign: 'center' }}>
            מפתח להקלדה:{' '}
            <code className="secret-key" dir="ltr">
              {setup.secret.replace(/(.{4})/g, '$1 ').trim()}
            </code>
          </div>
          <Field label="הקוד מהאפליקציה">
            <input className="input code-input" dir="ltr" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} placeholder="000000" required data-autofocus />
          </Field>
          <ErrorBox error={error} />
          <button className="btn btn-primary" disabled={busy || code.length !== 6}>
            הפעלה
          </button>
        </form>
      )}
    </Modal>
  );
}

function QrCode({ value }: { value: string }) {
  const [src, setSrc] = useState('');
  useEffect(() => {
    // black on white whatever the theme (the camera reads it best), drawn as an image
    setSrc(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(renderSVG(value, { border: 2, whiteColor: '#ffffff', blackColor: '#000000' }))}`);
  }, [value]);
  return src ? <img className="qr" src={src} alt="קוד QR לסריקה באפליקציית האימות" width={200} height={200} /> : null;
}

function ConfirmDialog({ title, action, onClose, onDone, danger }: { title: string; action: 'disable' | 'recovery'; onClose: () => void; onDone: (codes?: string[]) => void; danger?: boolean }) {
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await api.post<{ recoveryCodes?: string[] }>(`/api/auth/2fa/${action}`, { password, code });
      onDone(r.recoveryCodes);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };
  return (
    <Modal title={title} onClose={onClose} narrow>
      <form className="col gap-12" onSubmit={(e) => void submit(e)}>
        <Field label="הסיסמה שלך">
          <input className="input" type="password" dir="ltr" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required data-autofocus />
        </Field>
        <Field label="קוד מהאפליקציה (או קוד גיבוי)">
          <input className="input code-input" dir="ltr" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value)} maxLength={11} required />
        </Field>
        <ErrorBox error={error} />
        <button className={`btn ${danger ? 'btn-danger' : 'btn-primary'}`} disabled={busy || !password || !code}>
          {action === 'disable' ? 'ביטול האימות הדו-שלבי' : 'יצירת קודים חדשים'}
        </button>
      </form>
    </Modal>
  );
}

export function TwoFactorSettings() {
  const { user, isCommander, refresh, recoveryLeft } = useSession();
  const [dialog, setDialog] = useState<'enable' | 'disable' | 'recovery' | null>(null);
  const [codes, setCodes] = useState<string[] | null>(null);
  const toast = useToast();
  const on = !!user.twoFactor;
  useHashScroll('security');
  return (
    <section className="card" id="security" aria-label="אימות דו-שלבי">
      <div className="card-head">
        <Icon name="shield" />
        <h3 className="grow">אימות דו-שלבי</h3>
        <span className={`badge ${on ? 't-green' : 't-gray'}`}>{on ? 'פעיל' : 'כבוי'}</span>
      </div>
      <div className="card-body col gap-12">
        <p className="small muted" style={{ margin: 0 }}>
          {on
            ? `בכל כניסה, אחרי הסיסמה, מתבקש גם קוד מאפליקציית האימות בטלפון.${recoveryLeft !== null ? ` נותרו ${recoveryLeft} קודי גיבוי.` : ''}`
            : isCommander
              ? 'חשבון מפקד הקורס פותח את כל נתוני הקורס. עם אימות דו-שלבי, גם מי שיודע את הסיסמה לא ייכנס בלי הטלפון שלך.'
              : 'עם אימות דו-שלבי, גם מי שיודע את הסיסמה לא ייכנס בלי הטלפון שלך.'}
        </p>
        {recoveryLeft !== null && on && recoveryLeft <= 2 && <div className="info-box small">כמעט נגמרו קודי הגיבוי - כדאי ליצור חדשים.</div>}
        <div className="row wrap gap-6">
          {on ? (
            <>
              <button className="btn btn-sm" onClick={() => setDialog('recovery')}>
                קודי גיבוי חדשים
              </button>
              <button className="btn btn-sm btn-ghost" onClick={() => setDialog('disable')}>
                ביטול
              </button>
            </>
          ) : (
            <button className="btn btn-primary btn-sm" onClick={() => setDialog('enable')}>
              <Icon name="shield" /> הפעלה
            </button>
          )}
        </div>
      </div>
      {dialog === 'enable' && (
        <EnableDialog
          onClose={() => setDialog(null)}
          onDone={() => {
            setDialog(null);
            void refresh();
          }}
        />
      )}
      {dialog === 'disable' && (
        <ConfirmDialog
          title="ביטול אימות דו-שלבי"
          action="disable"
          danger
          onClose={() => setDialog(null)}
          onDone={() => {
            setDialog(null);
            toast({ title: 'האימות הדו-שלבי בוטל', tone: 'green' });
            void refresh();
          }}
        />
      )}
      {dialog === 'recovery' && (
        <ConfirmDialog
          title="קודי גיבוי חדשים"
          action="recovery"
          onClose={() => setDialog(null)}
          onDone={(c) => {
            setDialog(null);
            setCodes(c ?? null);
            void refresh();
          }}
        />
      )}
      {codes && (
        <Modal title="קודי הגיבוי החדשים" onClose={() => setCodes(null)}>
          <div className="col gap-12">
            <RecoveryCodes codes={codes} />
            <button className="btn btn-primary" onClick={() => setCodes(null)}>
              שמרתי - סיום
            </button>
          </div>
        </Modal>
      )}
    </section>
  );
}
