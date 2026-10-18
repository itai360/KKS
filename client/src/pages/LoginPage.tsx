// A focused entry to the course workspace. Fresh installs create the course
// and commander account; existing accounts retain password, Google and 2FA login.

import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';
import { IS_DEMO } from '../lib/demo';
import { setTitleSuffix, usePageTitle } from '../lib/title';
import { ErrorBox, Field } from '../components/ui';
import { CodeStep, ticketOf } from '../components/TwoFactor';
import type { LoginResult } from '@shared/types';
import { Icon } from '../components/Icon';
import './LoginPage.css';

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
export function GoogleButton({ clientId, onLogin, onError }: { clientId: string; onLogin: (r: LoginResult) => void; onError: (m: string) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const render = () => {
      const g = (window as unknown as { google?: GoogleIdApi }).google;
      if (!g || !ref.current) return;
      g.accounts.id.initialize({
        client_id: clientId,
        callback: (r) =>
          void api
            .post<LoginResult>('/api/auth/google', { credential: r.credential })
            .then(onLogin)
            .catch((e: Error) => onError(e.message)),
      });
      g.accounts.id.renderButton(ref.current, { theme: 'outline', size: 'large', text: 'signin_with', locale: 'he', width: Math.min(380, ref.current.clientWidth || 280), shape: 'rectangular' });
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

const DEMO_USERS = [
  { username: 'mefaked', label: 'מפקד הקורס', hint: 'ניהול כל הצוותים והמשימות', icon: 'shield' },
  { username: 'mefakatz1', label: 'מפק״צ 1', hint: 'ניהול המשימות של צוות 1', icon: 'users' },
  { username: 'mefakatz2', label: 'מפק״צ 2', hint: 'ניהול המשימות של צוות 2', icon: 'users' },
];

/** Demo build: one tap opens a real, local demo session in the selected role. */
function DemoLogins({ onLogin, onError }: { onLogin: () => void; onError: (m: string) => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const go = async (username: string) => {
    setBusy(username);
    onError('');
    try {
      await api.post('/api/auth/login', { username, password: 'kks12345' });
      onLogin();
    } catch (e) {
      onError((e as Error).message);
      setBusy(null);
    }
  };
  return (
    <div className="welcome-demo">
      <div className="welcome-demo-label"><span /> בחרו עם איזה תפקיד להיכנס</div>
      <div className="welcome-demo-roles" aria-busy={!!busy}>
        {DEMO_USERS.map((user, index) => (
          <button
            key={user.username}
            type="button"
            className={`welcome-role${index === 0 ? ' welcome-role-primary' : ''}`}
            disabled={!!busy}
            onClick={() => void go(user.username)}
          >
            <span className="welcome-role-icon"><Icon name={user.icon} size={21} /></span>
            <span className="welcome-role-copy">
              <strong>{busy === user.username ? 'נכנסים לקורס…' : user.label}</strong>
              <span>{user.hint}</span>
            </span>
            <Icon name="chevronLeft" size={18} />
          </button>
        ))}
      </div>
      <p className="welcome-demo-note">אפשר להתנסות בחופשיות. השינויים בהדגמה נשמרים רק בדפדפן שלכם.</p>
    </div>
  );
}

function WorkspacePreview() {
  return (
    <section className="welcome-preview" aria-labelledby="welcome-preview-title">
      <div className="welcome-preview-top">
        <span className="welcome-preview-mark"><Icon name="layers" size={17} /></span>
        <span>מרחב הקורס</span>
        <Icon name="chevronLeft" size={13} />
        <span>לוח משימות</span>
        <span className="welcome-preview-caption">תצוגה לדוגמה</span>
      </div>
      <div className="welcome-preview-body">
        <div className="welcome-preview-heading">
          <div><h2 id="welcome-preview-title">לוח הקורס</h2><p>כל המשימות, האנשים וההתקדמות במקום אחד.</p></div>
          <span className="welcome-preview-avatars" aria-label="חברי צוות לדוגמה"><span>דכ</span><span>אל</span><span>ימ</span></span>
        </div>
        <div className="welcome-preview-tabs"><span><Icon name="tasks" size={15} /> טבלה ראשית</span></div>
        <div className="welcome-preview-group"><Icon name="chevronDown" size={17} /><h3>השבוע בקורס</h3><span>4 משימות</span></div>
        <div className="welcome-preview-table-wrap">
          <table className="welcome-preview-table">
            <caption className="sr-only">דוגמה ללוח עם משימות, אחראים וסטטוסים</caption>
            <thead><tr><th scope="col">משימה</th><th scope="col">אחראי</th><th scope="col">סטטוס</th><th scope="col">תאריך יעד</th></tr></thead>
            <tbody>
              <tr><td><span className="welcome-preview-checkbox" />תכנון השבוע הבא</td><td><span className="welcome-preview-avatar avatar-blue">דכ</span></td><td className="welcome-status-working">בעבודה</td><td>יום ראשון</td></tr>
              <tr><td><span className="welcome-preview-checkbox checked"><Icon name="check" size={11} /></span>הכנת חומרי הדרכה</td><td><span className="welcome-preview-avatar avatar-purple">אל</span></td><td className="welcome-status-done">הושלם</td><td>יום שני</td></tr>
              <tr><td><span className="welcome-preview-checkbox" />תיאום אימון צוותי</td><td><span className="welcome-preview-avatar avatar-teal">ימ</span></td><td className="welcome-status-waiting">ממתין</td><td>יום שלישי</td></tr>
              <tr><td><span className="welcome-preview-checkbox" />סיכום שבועי</td><td><span className="welcome-preview-avatar avatar-blue">דכ</span></td><td className="welcome-status-working">בעבודה</td><td>יום חמישי</td></tr>
            </tbody>
          </table>
        </div>
        <div className="welcome-preview-summary"><span>התקדמות השבוע</span><span className="welcome-preview-progress"><i /><i /><i /><i /></span><strong>1 מתוך 4 הושלמו</strong></div>
      </div>
      <div className="welcome-preview-bottom"><Icon name="users" size={17} /><span>לכל משימה יש אחראי. לכל הצוות יש תמונת מצב.</span></div>
    </section>
  );
}

export function LoginPage({ onLogin }: { onLogin: () => void }) {
  const [info, setInfo] = useState<Info | null>(null);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [courseName, setCourseName] = useState('קורס קק"ס');
  const [courseSymbol, setCourseSymbol] = useState('קק"ס');
  const [displayName, setDisplayName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // two-step sign-in: the password was right, the code comes next
  const [ticket, setTicket] = useState<string | null>(null);
  const afterPassword = (r: LoginResult) => {
    const t = ticketOf(r);
    if (t) {
      setTicket(t);
      setPassword('');
    } else onLogin();
  };

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
        onLogin();
      } else {
        afterPassword(await api.post<LoginResult>('/api/auth/login', { username, password }));
      }
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

  const credentials = (
    <form className="welcome-credentials" onSubmit={submit} aria-label={setup ? 'הקמת קורס' : 'כניסה עם שם משתמש וסיסמה'}>
      {setup && (
        <>
          <div className="welcome-course-fields">
            <Field label="שם הקורס" required>
              <input className="input" value={courseName} onChange={(e) => setCourseName(e.target.value)} required autoFocus />
            </Field>
            <Field label="סמל הקורס" hint="עד 6 תווים">
              <input className="input" value={courseSymbol} maxLength={6} onChange={(e) => setCourseSymbol(e.target.value)} />
            </Field>
          </div>
          <Field label="השם שלכם" required>
            <input className="input" autoComplete="name" value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="לדוגמה: דנה כהן" required />
          </Field>
        </>
      )}
      <Field label="שם משתמש" required>
        <input className="input" dir="ltr" autoComplete="username" autoCapitalize="none" spellCheck={false} value={username} onChange={(e) => setUsername(e.target.value)} required autoFocus={!IS_DEMO && !setup} placeholder="שם המשתמש שלכם" />
      </Field>
      <div className="field">
        <label htmlFor="welcome-password">סיסמה <span className="req">*</span></label>
        <div className="welcome-password">
          <input id="welcome-password" className="input" dir="ltr" type={showPassword ? 'text' : 'password'} autoComplete={setup ? 'new-password' : 'current-password'} value={password} onChange={(e) => setPassword(e.target.value)} required placeholder="הסיסמה שלכם" aria-describedby={setup ? 'welcome-password-hint' : undefined} />
          <button type="button" className="welcome-password-toggle" onClick={() => setShowPassword(!showPassword)} aria-label={showPassword ? 'הסתרת הסיסמה' : 'הצגת הסיסמה'} aria-pressed={showPassword}>
            <Icon name="eye" size={19} />
          </button>
        </div>
        {setup && <span id="welcome-password-hint" className="hint">לפחות 8 תווים, אותיות וגם ספרה או סימן</span>}
      </div>
      <button className="welcome-submit" disabled={busy || !info}>
        <span>{busy ? (setup ? 'מכינים את הקורס שלכם…' : 'נכנסים לקורס…') : !info ? 'רק רגע…' : setup ? 'יצירת הקורס והמשך' : 'כניסה לקורס'}</span>
        <Icon name="chevronLeft" size={18} />
      </button>
    </form>
  );

  return (
    <div className="welcome-shell" dir="rtl">
      <header className="welcome-header">
        <div className="welcome-brand">
          <span className="welcome-brand-icon"><Icon name="layers" size={22} /></span>
          <span className="welcome-brand-name">KKS<span>{symbol} · ניהול הקורס</span></span>
        </div>
        <span className="welcome-header-note"><Icon name="lock" size={14} /> כניסה למרחב העבודה</span>
      </header>
      <main className="welcome-main">
        <section className="welcome-entry" aria-labelledby="welcome-entry-title">
          <div className="welcome-entry-card">
            <div className="welcome-entry-heading">
              <h1 id="welcome-entry-title">{ticket ? 'אימות החשבון' : setup ? 'יצירת מרחב עבודה' : 'כניסה למרחב העבודה'}</h1>
              <p>{ticket ? 'הזינו את הקוד כדי להשלים את הכניסה.' : setup ? 'הגדירו את הקורס ואת חשבון מפקד הקורס.' : IS_DEMO ? 'בחרו תפקיד ונסו את ניהול הקורס בפועל.' : `התחברו כדי להמשיך לעבוד ב${info?.courseName || 'קורס שלכם'}.`}</p>
            </div>
            {ticket ? (
              <CodeStep
                ticket={ticket}
                onSignedIn={() => onLogin()}
                onRestart={() => {
                  setTicket(null);
                  setError('אפשר להתחבר שוב עם הסיסמה שלכם.');
                }}
              />
            ) : (
              <>
                {IS_DEMO && !setup ? (
                  <>
                    <DemoLogins onLogin={onLogin} onError={setError} />
                    <details className="welcome-other-login">
                      <summary>כניסה עם שם משתמש וסיסמה <Icon name="chevronDown" size={16} /></summary>
                      {credentials}
                    </details>
                  </>
                ) : credentials}
                <ErrorBox error={error} />
                {!setup && info?.googleClientId && (
                  <div className="welcome-google">
                    <div className="welcome-divider"><span>או עם חשבון Google</span></div>
                    <GoogleButton clientId={info.googleClientId} onLogin={afterPassword} onError={setError} />
                  </div>
                )}
              </>
            )}
          </div>
          <p className="welcome-entry-note"><Icon name={IS_DEMO ? 'play' : 'shield'} size={14} /> {IS_DEMO ? 'סביבת הדגמה · אין צורך בהרשמה' : 'סביבת העבודה האישית של סגל הקורס'}</p>
        </section>
        <WorkspacePreview />
      </main>
      <footer className="welcome-footer"><span dir="ltr">KKS workspace</span><span>הצוות שלכם. מרחב עבודה משותף.</span></footer>
    </div>
  );
}
