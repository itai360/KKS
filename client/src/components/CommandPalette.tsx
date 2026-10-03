// Ctrl+K: one bar to go anywhere and do the common things - the screens, a few actions,
// and whatever the search finds (tasks, weeks, cadets, events, debriefs, documents, people).

import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router';
import { shortDate } from '@shared/dates';
import { matchesSearch, searchKey } from '@shared/search';
import type { SearchResults } from '@shared/types';
import { Icon } from './Icon';
import { useNewTask } from './NewTask';
import { api } from '../lib/api';
import { fmtDeadline, todayKey } from '../lib/format';
import { useSession } from '../lib/session';
import { setThemePref } from '../lib/theme';

interface Item {
  id: string;
  group: string;
  label: string;
  sub?: string;
  icon: string;
  hint?: string;
  run: () => void;
}

export const OPEN_PALETTE = 'kks:palette';

export function CommandPalette({ pages }: { pages: { to: string; label: string; icon: string }[] }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && (e.key === 'k' || e.key === 'K' || e.code === 'KeyK')) {
        // in a dialog it stays the dialog's
        if (!open && document.querySelector('.modal')) return;
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    const onOpen = () => setOpen(true);
    document.addEventListener('keydown', onKey);
    window.addEventListener(OPEN_PALETTE, onOpen);
    return () => {
      document.removeEventListener('keydown', onKey);
      window.removeEventListener(OPEN_PALETTE, onOpen);
    };
  }, [open]);
  if (!open) return null;
  return <Palette pages={pages} onClose={() => setOpen(false)} />;
}

function Palette({ pages, onClose }: { pages: { to: string; label: string; icon: string }[]; onClose: () => void }) {
  const { isCommander, weeks } = useSession();
  const navigate = useNavigate();
  const newTask = useNewTask();
  const [q, setQ] = useState('');
  const [found, setFound] = useState<SearchResults | null>(null);
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const back = useRef<HTMLElement | null>(document.activeElement as HTMLElement | null);

  useEffect(() => {
    input.current?.focus();
    const prev = back.current;
    return () => prev?.focus?.();
  }, []);

  // what the search finds, a moment after typing stops
  useEffect(() => {
    if (searchKey(q).length < 2) {
      setFound(null);
      return;
    }
    let live = true;
    const t = setTimeout(() => {
      api
        .get<SearchResults>(`/api/search?q=${encodeURIComponent(q)}`)
        .then((r) => live && setFound(r))
        .catch(() => live && setFound(null));
    }, 180);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [q]);

  const items = useMemo<Item[]>(() => {
    const go = (to: string) => () => navigate(to);
    const today = todayKey();
    const cur = weeks.find((w) => w.startDate <= today && w.endDate >= today) ?? weeks.find((w) => w.startDate > today);
    const actions: Item[] = [
      { id: 'a:task', group: 'פעולות', label: 'משימה חדשה', icon: 'plus', hint: 'N', run: () => newTask() },
      ...(cur
        ? [
            { id: 'a:week', group: 'פעולות', label: `השבוע הנוכחי - ${cur.name}`, icon: 'layers', run: go(`/weeks/${cur.id}`) },
            { id: 'a:order', group: 'פעולות', label: `פקודת שבוע - ${cur.name}`, icon: 'file', run: go(`/weeks/${cur.id}/order`) },
          ]
        : []),
      { id: 'a:weekly', group: 'פעולות', label: 'תחקיר שבועי חדש', icon: 'calendar', run: go('/debriefs?new=weekly') },
      { id: 'a:eventdebrief', group: 'פעולות', label: 'תחקיר מופע עצים חדש', icon: 'zap', run: go('/debriefs?new=event') },
      ...(isCommander ? [{ id: 'a:event', group: 'פעולות', label: 'אירוע חדש בלו"ז', icon: 'calendar', run: go('/schedule?new=1') }] : []),
      { id: 'a:away', group: 'פעולות', label: 'סימון היעדרות (חופשה, מחלה, השתלמות)', icon: 'calendar', run: go('/settings#absences') },
      { id: 'a:bank', group: 'פעולות', label: 'בנק לקחים', icon: 'history', run: go('/debriefs?tab=bank') },
      { id: 'a:dark', group: 'פעולות', label: 'מצב כהה', icon: 'moon', run: () => setThemePref('dark') },
      { id: 'a:light', group: 'פעולות', label: 'מצב בהיר', icon: 'sun', run: () => setThemePref('light') },
    ];
    const screens: Item[] = pages.map((p) => ({ id: `p:${p.to}`, group: 'מסכים', label: p.label, icon: p.icon, run: go(p.to) }));
    const local = [...actions, ...screens].filter((i) => !q.trim() || matchesSearch(q, i.label));
    if (!found) return local;
    const fromSearch: Item[] = [
      ...found.tasks.slice(0, 6).map((t) => ({ id: `t:${t.id}`, group: 'משימות', label: t.title, sub: `${t.ownerName} · ${fmtDeadline(t.deadline)}`, icon: 'tasks', run: go(`/tasks/${t.id}`) })),
      ...found.weeks.slice(0, 4).map((w) => ({ id: `w:${w.id}`, group: 'שבועות', label: w.name, sub: `שבוע ${w.number} · ${shortDate(w.startDate)}-${shortDate(w.endDate)}`, icon: 'layers', run: go(`/weeks/${w.id}`) })),
      ...found.cadets.slice(0, 5).map((c) => ({ id: `c:${c.id}`, group: 'צוערים', label: c.fullName, sub: c.teamName ?? undefined, icon: 'shield', run: go(`/cadets/${c.id}`) })),
      ...found.events.slice(0, 4).map((e) => ({ id: `e:${e.id}`, group: 'לו"ז', label: e.title, sub: `${shortDate(e.date)} ${e.startTime}`, icon: 'calendar', run: go(`/schedule?date=${e.date}&event=${e.id}`) })),
      ...found.debriefs.slice(0, 4).map((d) => ({ id: `d:${d.id}`, group: 'תחקירים', label: d.title, sub: shortDate(d.occurredOn), icon: 'lightbulb', run: go(`/debriefs/${d.id}`) })),
      ...found.documents.slice(0, 4).map((d) => ({ id: `doc:${d.id}`, group: 'מסמכים', label: d.title, sub: d.category, icon: 'file', run: go(`/search?q=${encodeURIComponent(d.title)}`) })),
      ...found.users.slice(0, 4).map((u) => ({ id: `u:${u.id}`, group: 'סגל', label: u.displayName, sub: u.title || undefined, icon: 'users', run: go(`/team/${u.id}`) })),
    ];
    return [...local, ...fromSearch, { id: 'all', group: 'חיפוש', label: `כל התוצאות עבור "${q.trim()}"`, icon: 'search', run: go(`/search?q=${encodeURIComponent(q.trim())}`) }];
  }, [q, found, pages, weeks, isCommander, navigate, newTask]);

  const at = Math.min(active, Math.max(0, items.length - 1));
  useEffect(() => setActive(0), [q]);
  useEffect(() => {
    list.current?.querySelector(`[data-i="${at}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [at]);

  const run = (i: Item | undefined) => {
    if (!i) return;
    onClose();
    i.run();
  };
  const onKey = (e: ReactKeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((at + 1) % Math.max(1, items.length));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((at - 1 + items.length) % Math.max(1, items.length));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      run(items[at]);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    } else if (e.key === 'Tab') {
      e.preventDefault(); // the bar keeps the focus
    }
  };

  let lastGroup = '';
  return createPortal(
    <div className="palette-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="palette" role="dialog" aria-modal="true" aria-label="פקודה מהירה" onKeyDown={onKey}>
        <div className="palette-input">
          <Icon name="search" />
          <input
            ref={input}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="לאן? מה לעשות? - מסך, משימה, שבוע, צוער..."
            role="combobox"
            aria-expanded="true"
            aria-controls="palette-list"
            aria-activedescendant={items[at] ? `pal-${at}` : undefined}
            aria-autocomplete="list"
            aria-label="חיפוש פקודה, מסך או פריט"
          />
          <span className="kbd">Esc</span>
        </div>
        <div className="palette-list" id="palette-list" role="listbox" ref={list} aria-label="תוצאות">
          {items.length === 0 && <div className="palette-empty small muted">{searchKey(q).length < 2 ? 'הקלידו לפחות שתי אותיות' : 'מחפש...'}</div>}
          {items.map((i, idx) => {
            const head = i.group !== lastGroup;
            lastGroup = i.group;
            return (
              <div key={i.id} role="presentation">
                {head && (
                  <div className="palette-group" role="presentation">
                    {i.group}
                  </div>
                )}
                <div
                  id={`pal-${idx}`}
                  data-i={idx}
                  role="option"
                  aria-selected={idx === at}
                  className={`palette-item${idx === at ? ' on' : ''}`}
                  onMouseMove={() => idx !== at && setActive(idx)}
                  onClick={() => run(i)}
                >
                  <Icon name={i.icon} size={16} />
                  <span className="grow palette-label">
                    {i.label}
                    {i.sub && <span className="tiny muted"> · {i.sub}</span>}
                  </span>
                  {i.hint && <span className="kbd">{i.hint}</span>}
                </div>
              </div>
            );
          })}
        </div>
        <div className="palette-foot tiny muted">
          <span className="kbd">↑</span>
          <span className="kbd">↓</span> מעבר · <span className="kbd">Enter</span> פתיחה · <span className="kbd">Ctrl</span>+<span className="kbd">K</span> בכל מסך
        </div>
      </div>
    </div>,
    document.body,
  );
}
