// The session ended while the app was open (it expired, the password was
// changed, or the person signed out on another device). Instead of dropping to
// the sign-in screen and losing what was typed, ask to sign in again here; the
// request that was refused is then sent again.

import { useCallback, useEffect, useRef, useState } from 'react';
import type { LoginResult, User } from '@shared/types';
import { api, versionHeaders } from '../lib/api';
import { IS_DEMO } from '../lib/demo';
import { GoogleButton } from '../pages/LoginPage';
import { CodeStep, ticketOf } from './TwoFactor';
import { ErrorBox, Field, Modal } from './ui';

export function ReauthDialog({ user, onDone }: { user: User; onDone: (ok: boolean) => void }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [googleId, setGoogleId] = useState<string | null>(null);
  // two-step sign-in: after the password, the code
  const [ticket, setTicket] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<{ googleClientId: string | null }>('/api/public/info')
      .then((i) => setGoogleId(i.googleClientId))
      .catch(() => undefined);
  }, []);

  // someone else signing in on this screen would act on what the first person typed
  const signedIn = (who: { user: User } | null) => {
    if (who && who.user.id !== user.id) return window.location.reload();
    onDone(true);
  };
  // Google's button is set up once; it reaches the latest handler through a ref
  const signedInRef = useRef(signedIn);
  signedInRef.current = signedIn;
  const onGoogle = useCallback((r: LoginResult) => {
    const t = ticketOf(r);
    if (t) setTicket(t);
    else void whoAmI().then((who) => signedInRef.current(who));
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await api.post<LoginResult>('/api/auth/login', { username: user.username, password });
      const t = ticketOf(r);
      if (t) {
        setTicket(t);
        setBusy(false);
      } else signedIn(r.user ? { user: r.user } : null);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  return (
    <Modal
      title="צריך להתחבר שוב"
      narrow
      closable={false}
      onClose={() => undefined}
      footer={
        ticket ? (
          <button type="button" className="btn btn-ghost" onClick={() => onDone(false)}>
            יציאה
          </button>
        ) : (
          <>
            <button type="button" className="btn btn-ghost" onClick={() => onDone(false)}>
              יציאה
            </button>
            <button type="submit" form="reauth-form" className="btn btn-primary" disabled={busy || !password}>
              {busy ? 'מתחבר...' : 'התחברות'}
            </button>
          </>
        )
      }
    >
      {ticket ? (
        <CodeStep
          ticket={ticket}
          onSignedIn={(r) => signedIn(r)}
          onRestart={() => {
            setTicket(null);
            setPassword('');
            setError('צריך להזין שוב את הסיסמה');
          }}
        />
      ) : (
      <form id="reauth-form" className="col gap-12" onSubmit={(e) => void submit(e)}>
        <p className="small" style={{ margin: 0 }}>
          החיבור של <b>{user.displayName}</b> הסתיים. מה שהקלדתם נשמר במסך - אחרי ההתחברות הפעולה תישלח שוב ואפשר להמשיך מאותה נקודה.
        </p>
        <ErrorBox error={error} />
        {/* lets a password manager fill in the right account */}
        <input type="text" name="username" autoComplete="username" value={user.username} readOnly hidden />
        <Field label="סיסמה">
          <input className="input" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} data-autofocus required />
        </Field>
        {googleId && !IS_DEMO && <GoogleButton clientId={googleId} onLogin={onGoogle} onError={setError} />}
      </form>
      )}
    </Modal>
  );
}

/** Who the new session belongs to - asked directly, since this dialog is what an ended session waits on. */
async function whoAmI(): Promise<{ user: User } | null> {
  const res = await fetch('/api/auth/me', { credentials: 'same-origin', cache: 'no-store', headers: { 'x-kks': '1', ...versionHeaders() } }).catch(() => null);
  return res?.ok ? ((await res.json()) as { user: User }) : null;
}
