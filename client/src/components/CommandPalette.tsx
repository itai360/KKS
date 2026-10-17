// Ctrl+K: one bar to go anywhere and do the common things - the screens, a few actions,
// and whatever the search finds (tasks, weeks, cadets, events, debriefs, documents, people).

import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router';
import { isOpenStatus, STATUS_LABELS } from '@shared/constants';
import { shortDate } from '@shared/dates';
import { matchesSearch, searchKey } from '@shared/search';
import type { SearchResults } from '@shared/types';
import { Icon } from './Icon';
import { useNewTask } from './NewTask';
import { addToWeekDebrief } from './WeekDebriefAdd';
import { addToWeekly } from './WeeklyAdd';
import { api } from '../lib/api';
import { fmtDeadline, todayKey } from '../lib/format';
import { useSession } from '../lib/session';
import { setThemePref } from '../lib/theme';

export interface FindItem {
  id: string;
  group: string;
  label: string;
  sub?: string;
  icon: string;
  hint?: string;
  /** other words it is found by (a screen's, from the menu) */
  keywords?: string;
  run: () => void;
}

type Item = FindItem;
export type FindPage = { to: string; label: string; icon: string; keywords?: string };

export const OPEN_PALETTE = 'kks:palette';

/**
 * What a few typed letters find: the actions, the screens, the people and the weeks (here at once), and
 * a moment later what the search finds (tasks, cadets, events, debriefs, documents). `capped`: a few of
 * each, for the top bar's list.
 */
export function useFindItems(q: string, pages: FindPage[], { capped = false }: { capped?: boolean } = {}): FindItem[] {
  const { isCommander, weeks, users, settings } = useSession();
  const navigate = useNavigate();
  const newTask = useNewTask();
  const [found, setFound] = useState<SearchResults | null>(null);

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

  return useMemo<Item[]>(() => {
    const go = (to: string) => () => navigate(to);
    const today = todayKey();
    const typed = !!q.trim();
    const cap = <T,>(list: T[], n: number) => (capped ? list.slice(0, n) : list);
    const cur = weeks.find((w) => w.startDate <= today && w.endDate >= today) ?? weeks.find((w) => w.startDate > today);
    const actions: Item[] = [
      { id: 'a:task', group: 'פעולות', label: 'משימה חדשה', icon: 'plus', hint: 'N', run: () => newTask() },
      ...(cur
        ? [
            { id: 'a:week', group: 'פעולות', label: `השבוע הנוכחי - ${cur.name}`, icon: 'layers', run: go(`/weeks/${cur.id}`) },
            { id: 'a:order', group: 'פעולות', label: `פקודת שבוע - ${cur.name}`, icon: 'file', run: go(`/weeks/${cur.id}/order`) },
          ]
        : []),
      { id: 'a:weeklyadd', group: 'פעולות', label: 'הוספה לשבועי - נושא, סגירה מקצועית או הערה ללו"ז', icon: 'weekly', run: () => addToWeekly() },
      { id: 'a:weeknote', group: 'פעולות', label: 'לתחקיר השבוע - לשימור, לשיפור או לקח', icon: 'lightbulb', run: () => addToWeekDebrief() },
      { id: 'a:weeklynow', group: 'פעולות', label: 'השבועי הקרוב', icon: 'weekly', run: go('/weekly') },
      { id: 'a:weekly', group: 'פעולות', label: 'תחקיר שבועי חדש', icon: 'calendar', run: go('/debriefs?new=weekly') },
      { id: 'a:eventdebrief', group: 'פעולות', label: 'תחקיר מופע עצים חדש', icon: 'zap', run: go('/debriefs?new=event') },
      ...(isCommander
        ? [
            { id: 'a:event', group: 'פעולות', label: 'אירוע חדש בלו"ז', icon: 'calendar', run: go('/schedule?new=1') },
            { id: 'a:announce', group: 'פעולות', label: 'הודעה לסגל', icon: 'flag', run: go('/announcements') },
          ]
        : []),
      { id: 'a:roll', group: 'פעולות', label: 'מצבה להיום', icon: 'check', run: go('/attendance') },
      { id: 'a:away', group: 'פעולות', label: 'סימון היעדרות (חופשה, מחלה, השתלמות)', icon: 'calendar', run: go('/settings#absences') },
      { id: 'a:bank', group: 'פעולות', label: 'בנק לקחים', icon: 'history', run: go('/debriefs?tab=bank') },
      { id: 'a:dark', group: 'פעולות', label: 'מצב כהה', icon: 'moon', run: () => setThemePref('dark') },
      { id: 'a:light', group: 'פעולות', label: 'מצב בהיר', icon: 'sun', run: () => setThemePref('light') },
    ];
    const screens: Item[] = pages.map((p) => ({ id: `p:${p.to}`, group: 'מסכים', label: p.label, icon: p.icon, keywords: p.keywords, run: go(p.to) }));
    const match = (i: Item) => !typed || matchesSearch(q, i.label, i.keywords);
    // the palette leads with what to do; the top bar's search with where to go
    const local = capped ? [...cap(screens.filter(match), 6), ...cap(actions.filter(match), 4)] : [...actions, ...screens].filter(match);
    if (!typed) return local;
    // the people, the weeks and the domains are all here already: found from the first letter
    const people: Item[] = users
      .filter((u) => matchesSearch(q, u.displayName, u.title))
      .map((u) => ({ id: `u:${u.id}`, group: 'סגל', label: u.displayName, sub: u.title || undefined, icon: 'users', run: go(isCommander ? `/team/${u.id}` : `/tasks?owner=${u.id}`) }));
    const weekItems: Item[] = weeks
      .filter((w) => matchesSearch(q, w.name, w.topic, `שבוע ${w.number}`))
      .map((w) => ({ id: `w:${w.id}`, group: 'שבועות', label: w.name, sub: `שבוע ${w.number} · ${shortDate(w.startDate)}-${shortDate(w.endDate)}`, icon: 'layers', run: go(`/weeks/${w.id}`) }));
    const domains: Item[] = settings.domains
      .filter((d) => matchesSearch(q, d))
      .map((d) => ({ id: `dom:${d}`, group: 'תחומים', label: d, sub: 'משימות בתחום', icon: 'tasks', run: go(`/tasks?domain=${encodeURIComponent(d)}`) }));
    const near = [...local, ...cap(people, 5), ...cap(weekItems, 4), ...cap(domains, 3)];
    if (!found) return near;
    const fromSearch: Item[] = [
      // the open ones first (the search puts them there); one already closed says so instead of its deadline
      ...found.tasks.slice(0, capped ? 5 : 6).map((t) => ({
        id: `t:${t.id}`,
        group: 'משימות',
        label: t.title,
        sub: `${t.ownerName} · ${isOpenStatus(t.status) ? fmtDeadline(t.deadline) : STATUS_LABELS[t.status]}`,
        icon: isOpenStatus(t.status) ? 'tasks' : 'check',
        run: go(`/tasks/${t.id}`),
      })),
      ...found.cadets.slice(0, capped ? 4 : 5).map((c) => ({ id: `c:${c.id}`, group: 'צוערים', label: c.fullName, sub: c.teamName ?? undefined, icon: 'shield', run: go(`/cadets/${c.id}`) })),
      ...found.events.slice(0, capped ? 3 : 4).map((e) => ({ id: `e:${e.id}`, group: 'לו"ז', label: e.title, sub: `${shortDate(e.date)} ${e.startTime}`, icon: 'calendar', run: go(`/schedule?date=${e.date}&event=${e.id}`) })),
      ...found.debriefs.slice(0, capped ? 3 : 4).map((d) => ({ id: `d:${d.id}`, group: 'תחקירים', label: d.title, sub: shortDate(d.occurredOn), icon: 'lightbulb', run: go(`/debriefs/${d.id}`) })),
      ...found.documents.slice(0, capped ? 3 : 4).map((d) => ({ id: `doc:${d.id}`, group: 'מסמכים', label: d.title, sub: d.category, icon: 'file', run: go(`/search?q=${encodeURIComponent(d.title)}`) })),
    ];
    return [...near, ...fromSearch, { id: 'all', group: 'חיפוש', label: `כל התוצאות עבור "${q.trim()}"`, icon: 'search', run: go(`/search?q=${encodeURIComponent(q.trim())}`) }];
  }, [q, found, pages, weeks, users, settings.domains, isCommander, navigate, newTask, capped]);
}

export function CommandPalette({ pages }: { pages: FindPage[] }) {
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

function Palette({ pages, onClose }: { pages: FindPage[]; onClose: () => void }) {
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const back = useRef<HTMLElement | null>(document.activeElement as HTMLElement | null);
  const items = useFindItems(q, pages);

  useEffect(() => {
    input.current?.focus();
    const prev = back.current;
    return () => prev?.focus?.();
  }, []);

  const at = Math.min(active, Math.max(0, items.length - 1));
  useEffect(() => {
    setActive(0);
  }, [q]);
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
