// Turning phone notifications on (lib/push.ts) where people look: on the home screen of a phone where
// they are still off - a short offer that can wait - and at the foot of the bell's list.

import { useState } from 'react';
import { Link } from 'react-router';
import { IS_DEMO } from '../lib/demo';
import { useMedia } from '../lib/media';
import { turnPushOn, usePushState } from '../lib/push';
import { Icon } from './Icon';
import { useToast } from './Toasts';

const LATER_KEY = 'kks.pushLater';
const LATER_DAYS = 7;

function useTurnOn() {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  return {
    busy,
    turnOn: async () => {
      setBusy(true);
      try {
        await turnPushOn({ test: true });
        toast({ title: 'ההתראות לטלפון הופעלו', body: 'שלחנו התראת בדיקה - כך תיראה כל התראה מהמערכת', tone: 'green' });
      } catch (e) {
        toast({ title: (e as Error).message, tone: 'red' });
      } finally {
        setBusy(false);
      }
    },
  };
}

/** on the home screen of a phone: the notifications are still off here - turned on in a tap */
export function PushNudge() {
  const state = usePushState();
  const touch = useMedia('(pointer: coarse)');
  const { busy, turnOn } = useTurnOn();
  const [later, setLater] = useState(() => {
    try {
      return Number(localStorage.getItem(LATER_KEY) ?? 0) > Date.now();
    } catch {
      return false;
    }
  });
  if (IS_DEMO || later || !touch || state !== 'off') return null;
  const wait = () => {
    try {
      localStorage.setItem(LATER_KEY, String(Date.now() + LATER_DAYS * 86_400_000));
    } catch {
      /* this visit only */
    }
    setLater(true);
  };
  return (
    <div className="card card-pad row wrap setup-nudge push-nudge">
      <span className="push-nudge-icon" aria-hidden="true">
        <Icon name="bell" size={22} />
      </span>
      <div className="grow">
        <div className="strong">התראות לטלפון</div>
        <div className="small muted">כל משימה, תזכורת ועדכון שמגיעים אליך במערכת - ישר לטלפון, גם כשהאפליקציה סגורה.</div>
      </div>
      <div className="setup-nudge-actions">
        <button className="btn btn-primary" disabled={busy} onClick={() => void turnOn()}>
          הפעלה
        </button>
        <button className="btn btn-ghost" onClick={wait}>
          לא עכשיו
        </button>
      </div>
    </div>
  );
}

/** at the foot of the bell's list, on a phone where they do not reach the phone yet */
export function PushBellOffer({ onNavigate }: { onNavigate: () => void }) {
  const state = usePushState();
  const touch = useMedia('(pointer: coarse)');
  const { busy, turnOn } = useTurnOn();
  if (IS_DEMO || !touch) return null;
  if (state === 'install')
    return (
      <Link to="/settings#part-app" className="btn btn-ghost btn-sm notif-push" onClick={onNavigate}>
        <Icon name="smartphone" size={15} /> להתראות לטלפון - התקנת האפליקציה
      </Link>
    );
  if (state !== 'off') return null;
  return (
    <button type="button" className="btn btn-ghost btn-sm notif-push" disabled={busy} onClick={() => void turnOn()}>
      <Icon name="bell" size={15} /> הפעלת התראות לטלפון
    </button>
  );
}
