// One decision, at once (an approval, a request): the row says what was decided, folds away, and the
// next one is right there - the rest of the list stays to hand meanwhile (one row's answer does not hold
// up the others). If the server says no, the row comes back with the reason. The requests page and the
// home page's "לטיפול שלך" both decide this way.

import { useState } from 'react';
import { haptic } from '../lib/haptics';
import { emitLocalChange } from '../lib/realtime';
import { Icon } from './Icon';
import { useToast } from './Toasts';

export type Verdict = 'approved' | 'rejected' | 'returned';
const VERDICT_LABELS: Record<Verdict, string> = { approved: 'אושר', rejected: 'נדחה', returned: 'הוחזר להשלמה' };

export function useDecision(onDecided?: () => void) {
  const toast = useToast();
  const [verdict, setVerdict] = useState<Verdict | null>(null);
  const [fold, setFold] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const decide = async (as: Verdict, fn: () => Promise<unknown>, title: string) => {
    setVerdict(as);
    setError(null);
    if (as === 'approved') haptic('success');
    const folding = setTimeout(() => setFold(true), 650);
    try {
      await fn();
      toast({ title, tone: 'green' });
      onDecided?.();
      // the lists catch up once the row has folded away
      setTimeout(() => emitLocalChange('tasks', 'requests'), 1000);
      return true;
    } catch (e) {
      clearTimeout(folding);
      setVerdict(null);
      setFold(false);
      setError((e as Error).message);
      return false;
    }
  };
  return { verdict, fold, error, decide };
}

export function Decided({ verdict }: { verdict: Verdict }) {
  return (
    <span className={`verdict-pill t-${verdict === 'approved' ? 'green' : 'gray'}`} role="status">
      <Icon name={verdict === 'approved' ? 'check' : verdict === 'returned' ? 'repeat' : 'x'} size={15} />
      {VERDICT_LABELS[verdict]}
    </span>
  );
}
