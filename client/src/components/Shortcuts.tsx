// "?" shows every keyboard shortcut in one place.

import { useEffect, useState } from 'react';
import { Modal } from './ui';

const GROUPS: { title: string; keys: [string[], string][] }[] = [
  {
    title: 'בכל מקום',
    keys: [
      [['N'], 'משימה חדשה'],
      [['/'], 'חיפוש'],
      [['Tab', 'Enter'], 'מעבר בין שורות ופתיחה'],
      [['Esc'], 'סגירת חלון'],
      [['?'], 'הרשימה הזו'],
    ],
  },
  { title: 'בטופס', keys: [[['Ctrl', 'Enter'], 'שליחה (משימה חדשה, עדכון במשימה)']] },
  {
    title: 'בלו"ז',
    keys: [
      [['T'], 'היום'],
      [['J', 'K'], 'הבא / הקודם'],
      [['A', 'D', 'W', 'M'], 'רשימה / יום / שבוע / חודש'],
    ],
  },
];

export function ShortcutsHelp() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '?' || e.ctrlKey || e.metaKey || e.altKey) return;
      const el = e.target as HTMLElement;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)) return;
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
