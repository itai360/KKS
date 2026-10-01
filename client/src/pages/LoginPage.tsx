// Section 3 - a very simple entry screen. On a fresh install it becomes the
// course set-up screen that creates the commander account (section 36).

import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { ErrorBox, Field } from '../components/ui';
import { Icon } from '../components/Icon';

interface Info {
  courseName: string;
  courseSymbol: string;
  needsSetup: boolean;
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
      .catch(() => setInfo({ courseName: 'קורס קק"ס', courseSymbol: 'קק"ס', needsSetup: false }));
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
          <Field label="סיסמה" required hint={setup ? 'לפחות 6 תווים' : undefined}>
            <input className="input" dir="ltr" type="password" autoComplete={setup ? 'new-password' : 'current-password'} value={password} onChange={(e) => setPassword(e.target.value)} required />
          </Field>
          <ErrorBox error={error} />
          <button className="btn btn-primary btn-lg btn-block" disabled={busy || !info}>
            {setup ? 'הקם את הקורס' : 'כניסה'} <Icon name="chevronLeft" />
          </button>
        </form>
      </div>
    </div>
  );
}
