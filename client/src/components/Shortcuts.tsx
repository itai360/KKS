// "?" shows every keyboard shortcut in one place.

import { useEffect, useState } from 'react';
import { VIEW_KEYS, VIEW_LABELS, type CalView } from '../lib/calendarBar';
import { takesKeys } from '../lib/keyboard';
import { Modal } from './ui';

/** the calendar's views by their keys, in the order of the numbers (as in Google Calendar) */
const VIEW_LINES = (Object.entries(VIEW_KEYS) as [CalView, [string, string]][])
  .sort((a, b) => Number(a[1][1]) - Number(b[1][1]))
  .map(([v, keys]): [string[], string] => [keys, `תצוגת ${VIEW_LABELS[v]}`]);

const GROUPS: { title: string; keys: [string[], string][] }[] = [
  {
    title: 'בכל מקום',
    keys: [
      [['Ctrl', 'K'], 'פקודה מהירה: מסך, פעולה, משימה, שבוע או צוער'],
      [['N'], 'משימה חדשה'],
      [['/'], 'חיפוש'],
      [['Tab', 'Enter'], 'מעבר בין שורות ופתיחה'],
      [['Esc'], 'סגירת חלון'],
      [['?'], 'הרשימה הזו'],
    ],
  },
  { title: 'בטופס', keys: [[['Ctrl', 'Enter'], 'שליחה (משימה חדשה, עדכון במשימה)']] },
  {
    title: 'ביומן',
    keys: [
      [['T'], 'חזרה להיום'],
      [['J', 'K'], 'התקופה הבאה / הקודמת'],
      ...VIEW_LINES,
      [['C'], 'אירוע חדש'],
      [['E'], 'עריכת האירוע שכרטיסו פתוח'],
      [['Delete'], 'מחיקת האירוע שכרטיסו פתוח (עם ביטול)'],
      [['G'], 'מעבר לתאריך'],
    ],
  },
];

/** the top bar's help button opens the list too */
export const OPEN_SHORTCUTS = 'kks:shortcuts';

export function ShortcutsHelp() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const show = () => setOpen(true);
    window.addEventListener(OPEN_SHORTCUTS, show);
    return () => window.removeEventListener(OPEN_SHORTCUTS, show);
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '?' || e.ctrlKey || e.metaKey || e.altKey) return;
      const el = e.target as HTMLElement;
      if (takesKeys(el)) return;
      if (document.querySelector('.modal')) return;
      e.preventDefault();
      setOpen(true);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);
  if (!open) return null;
  return (
    <Modal title="קיצורי מקלדת" narrow onClose={() => setOpen(false)}>
      <div className="col gap-16">
        {GROUPS.map((g) => (
          <div key={g.title}>
            <div className="label-caps mb-12">{g.title}</div>
            <dl className="shortcuts">
              {g.keys.map(([keys, what]) => (
                <div key={what} className="row">
                  <dt className="row gap-4">
                    {keys.map((k) => (
                      <span key={k} className="kbd">
                        {k}
                      </span>
                    ))}
                  </dt>
                  <dd className="grow small">{what}</dd>
                </div>
              ))}
            </dl>
          </div>
        ))}
      </div>
    </Modal>
  );
}
