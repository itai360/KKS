// An account the commander opened (or a password the commander reset) comes
// with a password someone else knows. On the first sign-in the person picks
// their own - before anything else.

import { useState } from 'react';
import type { User } from '@shared/types';
import { api } from '../lib/api';
import { ErrorBox, Field, Modal } from './ui';

export function FirstPasswordDialog({ user, onDone, onLogout }: { user: User; onDone: () => void; onLogout: () => void }) {
  const [next, setNext] = useState('');
  const [again, setAgain] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const mismatch = again.length > 0 && again !== next;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (next !== again) return setError('הסיסמאות לא זהות');
    setBusy(true);
    setError(null);
    try {
      await api.post('/api/auth/password/first', { next });
      onDone();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  return (
    <Modal
      title="בחירת סיסמה אישית"
      narrow
      closable={false}
      onClose={() => undefined}
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onLogout}>
            יציאה
          </button>
          <button type="submit" form="first-password" className="btn btn-primary" disabled={busy || next.length < 6 || next !== again}>
            {busy ? 'שומר...' : 'שמירה והמשך'}
          </button>
        </>
      }
    >
      <form id="first-password" className="col gap-12" onSubmit={(e) => void submit(e)}>
        <p className="small" style={{ margin: 0 }}>
          שלום {user.displayName}. החשבון נפתח עבורך עם סיסמה זמנית - בחרו סיסמה שרק אתם יודעים, וממנה תתחברו מעכשיו.
        </p>
        <ErrorBox error={error} />
        <input type="text" name="username" autoComplete="username" value={user.username} readOnly hidden />
        <Field label="סיסמה חדשה" hint="לפחות 6 תווים">
          <input className="input" dir="ltr" type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} data-autofocus required />
        </Field>
        <Field label="שוב, לאימות" hint={mismatch ? 'הסיסמאות לא זהות' : undefined}>
          <input className="input" dir="ltr" type="password" autoComplete="new-password" value={again} onChange={(e) => setAgain(e.target.value)} required aria-invalid={mismatch} />
        </Field>
      </form>
    </Modal>
  );
}
