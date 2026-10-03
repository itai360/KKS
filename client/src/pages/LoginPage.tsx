// Section 3 - a very simple entry screen. On a fresh install it becomes the
// course set-up screen that creates the commander account (section 36).

import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';
import { IS_DEMO } from '../lib/demo';
import { setTitleSuffix, usePageTitle } from '../lib/title';
import { ErrorBox, Field } from '../components/ui';
import { Icon } from '../components/Icon';

interface Info {
  courseName: string;
  courseSymbol: string;
  needsSetup: boolean;
  googleClientId: string | null;
}

interface GoogleIdApi {
  accounts: {
    id: {
      initialize: (o: { client_id: string; callback: (r: { credential: string }) => void; ux_mode?: string }) => void;
      renderButton: (el: HTMLElement, o: Record<string, unknown>) => void;
    };
  };
}

/** Section 3: optional "sign in with Google", rendered by Google's own button. */
export function GoogleButton({ clientId, onLogin, onError }: { clientId: string; onLogin: () => void; onError: (m: string) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const render = () => {
      const g = (window as unknown as { google?: GoogleIdApi }).google;
      if (!g || !ref.current) return;
      g.accounts.id.initialize({
        client_id: clientId,
        callback: (r) =>
          void api
            .post('/api/auth/google', { credential: r.credential })
            .then(onLogin)
            .catch((e: Error) => onError(e.message)),
      });
      g.accounts.id.renderButton(ref.current, { theme: 'outline', size: 'large', text: 'signin_with', locale: 'he', width: 380, shape: 'rectangular' });
    };
    if ((window as unknown as { google?: GoogleIdApi }).google) return render();
    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.onload = render;
    document.head.appendChild(script);
  }, [clientId, onLogin, onError]);
  return <div ref={ref} style={{ minHeight: 44, display: 'flex', justifyContent: 'center' }} />;
}

const DEMO_USERS: { username: string; label: string; hint: string }[] = [
  { username: 'mefaked', label: 'מפקד הקורס', hint: 'רואה הכל, מאשר ומקצה' },
  { username: 'mefakatz1', label: 'מפק"צ 1', hint: 'מוביל שבוע, מפקד צוות 1' },
  { username: 'mefakatz2', label: 'מפק"צ 2', hint: 'איש סגל, מפקד צוות 2' },
];

/** Demo build: one tap signs in as one of the demo course's people. */
function DemoLogins({ onLogin, onError }: { onLogin: () => void; onError: (m: string) => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const go = async (username: string) => {
    setBusy(username);
    try {
      await api.post('/api/auth/login', { username, password: 'kks12345' });
      onLogin();
    } catch (e) {
      onError((e as Error).message);
      setBusy(null);
    }
  };
  return (
    <div className="col gap-6">
      <div className="info-box small">
        גרסת הדגמה עם קורס לדוגמה. הנתונים נשמרים רק בדפדפן הזה. בחרו בתפקיד כדי להיכנס (סיסמה לכולם: <span className="mono">kks12345</span>).
      </div>
      {DEMO_USERS.map((u) => (
        <button key={u.username} type="button" className="btn btn-lg btn-block" style={{ justifyContent: 'space-between' }} disabled={!!busy} onClick={() => void go(u.username)}>
          <span className="col" style={{ alignItems: 'flex-start', gap: 0 }}>
            <b>{u.label}</b>
            <span className="tiny muted">{u.hint}</span>
          </span>
          <Icon name="chevronLeft" />
        </button>
      ))}
    </div>
  );
}

export function LoginPage({ onLogin }: { onLogin: () => void }) {
  const [info, setInfo] = useState<Info | null>(null);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [courseName, setCourseName] = useState('קורס קק"ס');
  const [courseSymbol, setCourseSymbol] = useState('קק"ס');
  const [displayName, setDisplayName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api
      .get<Info>('/api/public/info')
      .then(setInfo)
      .catch(() => setInfo({ courseName: 'קורס קק"ס', courseSymbol: 'קק"ס', needsSetup: false, googleClientId: null }));
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (info?.needsSetup) {
        await api.post('/api/setup', { courseName, courseSymbol, username, password, displayName: displayName || 'מפקד הקורס' });
      } else {
        await api.post('/api/auth/login', { username, password });
      }
      onLogin();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const setup = info?.needsSetup;
  const symbol = (setup ? courseSymbol : info?.courseSymbol) || 'קק"ס';
  useEffect(() => {
    if (info && !info.needsSetup) setTitleSuffix(info.courseSymbol || info.courseName);
  }, [info]);
  usePageTitle(info ? (setup ? 'הקמת קורס' : 'כניסה') : null);

  return (
    <div className="login">
      <div className="login-art">
        <div className="login-symbol">{symbol}</div>
        <p className="login-tag">
          {info?.courseName ?? ''}
          <br />
          מקום אחד לכל המשימות, האחריות, הדד-ליינים ותמונת המצב של הקורס.
        </p>
        <div className="login-principles">
          <div>
            <b>אחריות</b>
            <span>ברור מי אחראי על כל דבר</span>
          </div>
          <div>
            <b>זמן</b>
            <span>ברור מתי כל דבר צריך להסתיים</span>
          </div>
          <div>
            <b>תמונת מצב</b>
            <span>בלי לעבור איש-איש ולשאול</span>
          </div>
        </div>
      </div>
      <div className="login-form">
        <form className="login-card col gap-16" onSubmit={submit}>
          <div>
            <h1>{setup ? 'הקמת הקורס' : 'כניסה'}</h1>
            <p className="muted">{setup ? 'הגדרה ראשונית: שם הקורס וחשבון מפקד הקורס.' : 'הזן שם משתמש וסיסמה.'}</p>
          </div>
          {IS_DEMO && !setup && <DemoLogins onLogin={onLogin} onError={setError} />}
          {setup && (
            <>
              <div className="row gap-6">
                <Field label="שם הקורס" required className="grow">
                  <input className="input" value={courseName} onChange={(e) => setCourseName(e.target.value)} required />
                </Field>
                <Field label="סמל" className="" hint="עד 6 תווים">
                  <input className="input" value={courseSymbol} maxLength={6} onChange={(e) => setCourseSymbol(e.target.value)} style={{ width: 92 }} />
                </Field>
              </div>
              <Field label="השם שלך" required>
                <input className="input" value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="לדוגמה: סרן דנה כהן" required />
              </Field>
            </>
          )}
          <Field label="שם משתמש" required>
            <input className="input" dir="ltr" autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} required autoFocus />
          </Field>
          <Field label="סיסמה" required hint={setup ? 'לפחות 8 תווים, אותיות וגם ספרה או סימן' : undefined}>
            <input className="input" dir="ltr" type="password" autoComplete={setup ? 'new-password' : 'current-password'} value={password} onChange={(e) => setPassword(e.target.value)} required />
          </Field>
          <ErrorBox error={error} />
          <button className="btn btn-primary btn-lg btn-block" disabled={busy || !info}>
            {setup ? 'הקם את הקורס' : 'כניסה'} <Icon name="chevronLeft" />
          </button>
          {!setup && info?.googleClientId && (
            <>
              <div className="row small muted" style={{ justifyContent: 'center' }}>
                או
              </div>
              <GoogleButton clientId={info.googleClientId} onLogin={onLogin} onError={setError} />
            </>
          )}
        </form>
      </div>
    </div>
  );
}
