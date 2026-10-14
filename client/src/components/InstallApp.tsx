// Installing the app on the phone (lib/install.ts): in the settings, a card that installs it or says how on
// this device; on the home screen of a phone still in its browser, a short offer that can wait.

import { useState, type ReactNode } from 'react';
import { IS_DEMO } from '../lib/demo';
import { installApp, useInstallWay, type InstallWay } from '../lib/install';
import { useMedia } from '../lib/media';
import { Icon } from './Icon';
import { useToast } from './Toasts';
import { Modal } from './ui';

const ios = (way: InstallWay) => way === 'ios-safari' || way === 'ios-other';

/** what the app gives over the site in the browser, on this device */
function Gains({ way }: { way: InstallWay }) {
  return (
    <ul className="install-gains small">
      <li>אייקון במסך הבית שנפתח במסך מלא, בלי שורת הכתובת</li>
      <li>{ios(way) ? 'התראות לטלפון - באייפון הן מגיעות רק לאפליקציה שבמסך הבית' : 'התראות לטלפון גם כשהאפליקציה סגורה'}</li>
      {!ios(way) && <li>לחיצה ארוכה על האייקון: משימה חדשה, לתחקיר השבוע, המשימות שלי ולו"ז</li>}
    </ul>
  );
}

/** the steps on this device, each with the control to look for */
export function InstallSteps({ way }: { way: InstallWay }) {
  const steps: { icon: string; text: ReactNode }[] =
    way === 'ios-safari'
      ? [
          {
            icon: 'share',
            text: (
              <>
                לוחצים על <b>שיתוף</b> בסרגל של Safari (או על <b>⋯</b> ואז <b>שיתוף</b>)
              </>
            ),
          },
          {
            icon: 'addSquare',
            text: (
              <>
                גוללים ובוחרים <b>הוספה למסך הבית</b>
              </>
            ),
          },
          {
            icon: 'check',
            text: (
              <>
                לוחצים <b>הוספה</b> - ופותחים מהאייקון החדש. בפעם הראשונה מתחברים שוב
              </>
            ),
          },
        ]
      : way === 'ios-other'
        ? [
            {
              icon: 'share',
              text: (
                <>
                  לוחצים על <b>שיתוף</b> בשורת הכתובת - או פותחים את האתר ב-<b>Safari</b>
                </>
              ),
            },
            {
              icon: 'addSquare',
              text: (
                <>
                  בוחרים <b>הוספה למסך הבית</b>
                </>
              ),
            },
            {
              icon: 'check',
              text: (
                <>
                  לוחצים <b>הוספה</b> - ופותחים מהאייקון החדש. בפעם הראשונה מתחברים שוב
                </>
              ),
            },
          ]
        : [
            {
              icon: 'moreVertical',
              text: (
                <>
                  פותחים את התפריט של הדפדפן (<b>⋮</b> בפינה)
                </>
              ),
            },
            {
              icon: 'addSquare',
              text: (
                <>
                  בוחרים <b>התקנת אפליקציה</b> או <b>הוספה למסך הבית</b>
                </>
              ),
            },
            {
              icon: 'check',
              text: (
                <>
                  מאשרים <b>התקנה</b> - והאפליקציה במסך הבית ובמגירת האפליקציות
                </>
              ),
            },
          ];
  return (
    <ol className="install-steps">
      {steps.map((s, i) => (
        <li key={i}>
          <span className="install-step-icon" aria-hidden="true">
            <Icon name={s.icon} size={20} />
          </span>
          <span>{s.text}</span>
        </li>
      ))}
    </ol>
  );
}

function useInstall() {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  return {
    busy,
    install: async () => {
      setBusy(true);
      try {
        if (await installApp()) toast({ title: 'האפליקציה מותקנת', body: 'פותחים אותה מהאייקון במסך הבית', tone: 'green' });
      } finally {
        setBusy(false);
      }
    },
  };
}

/** in the settings: installs the app, or says how on this device - or that it is installed */
export function InstallCard() {
  const way = useInstallWay();
  const { busy, install } = useInstall();
  return (
    <div className="card">
      <div className="card-head">
        <Icon name="smartphone" />
        <h3 className="grow">אפליקציה בטלפון</h3>
        {way === 'installed' && <span className="badge t-green">מותקנת במכשיר הזה</span>}
      </div>
      <div className="card-body col gap-12">
        {way === 'installed' ? (
          <p className="small">האתר פתוח כאפליקציה מהמסך הראשי. התראות לטלפון מפעילים בכרטיס "התראות לטלפון ולמחשב".</p>
        ) : (
          <>
            <p className="small">מתקינים את המערכת כאפליקציה בטלפון - בלי חנות אפליקציות, בחינם, תמיד בגרסה האחרונה:</p>
            <Gains way={way} />
            {way === 'prompt' ? (
              <div>
                <button className="btn btn-primary" disabled={busy} onClick={() => void install()}>
                  <Icon name="download" /> התקנת האפליקציה
                </button>
              </div>
            ) : way === 'none' ? (
              <p className="small muted">פותחים את האתר בטלפון - ב-Safari באייפון או ב-Chrome באנדרואיד - ומתקינים משם (כאן בהגדרות, או מההצעה במסך הבית).</p>
            ) : (
              <InstallSteps way={way} />
            )}
          </>
        )}
      </div>
    </div>
  );
}

const LATER_KEY = 'kks.installLater';
const LATER_DAYS = 30;

/** on the home screen of a phone still in its browser: a short offer, until installed - or asked to wait */
export function InstallNudge() {
  const way = useInstallWay();
  const touch = useMedia('(pointer: coarse)');
  const { busy, install } = useInstall();
  const [steps, setSteps] = useState(false);
  const [later, setLater] = useState(() => {
    try {
      return Number(localStorage.getItem(LATER_KEY) ?? 0) > Date.now();
    } catch {
      return false;
    }
  });
  // a computer offering to install is answered in the settings, not on the home screen
  if (IS_DEMO || later || way === 'installed' || way === 'none' || (way === 'prompt' && !touch)) return null;
  const wait = () => {
    try {
      localStorage.setItem(LATER_KEY, String(Date.now() + LATER_DAYS * 86_400_000));
    } catch {
      /* this visit only */
    }
    setLater(true);
  };
  return (
    <div className="card card-pad row wrap setup-nudge install-nudge">
      <img className="install-nudge-icon" src="/icon-192.png" alt="" width={44} height={44} />
      <div className="grow">
        <div className="strong">קק"ס כאפליקציה בטלפון</div>
        <div className="small muted">{ios(way) ? 'אייקון במסך הבית, מסך מלא - ורק כך מגיעות התראות לאייפון.' : 'אייקון במסך הבית, מסך מלא והתראות - בלי חנות אפליקציות.'}</div>
      </div>
      <div className="setup-nudge-actions">
        {way === 'prompt' ? (
          <button className="btn btn-primary" disabled={busy} onClick={() => void install()}>
            התקנה
          </button>
        ) : (
          <button className="btn btn-primary" onClick={() => setSteps(true)}>
            איך מתקינים
          </button>
        )}
        <button className="btn btn-ghost" onClick={wait}>
          לא עכשיו
        </button>
      </div>
      {steps && (
        <Modal title="התקנת האפליקציה" onClose={() => setSteps(false)}>
          <div className="col gap-12">
            <Gains way={way} />
            <InstallSteps way={way} />
          </div>
        </Modal>
      )}
    </div>
  );
}
