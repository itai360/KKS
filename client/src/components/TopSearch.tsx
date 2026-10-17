// The top bar's search on a computer: as one types, everything it finds opens under it - the screens,
// actions, people, weeks and domains from the first letter, then the tasks, cadets, events, debriefs and
// documents - narrowing with every letter, as the search screen does on a phone. Arrows and Enter pick,
// Escape closes; Enter with nothing picked opens the full search.

import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { searchKey } from '@shared/search';
import { OPEN_PALETTE, useFindItems, type FindItem, type FindPage } from './CommandPalette';
import { Icon } from './Icon';
import { readRecent, rememberSearch } from '../lib/recentSearches';
import { useSession } from '../lib/session';

export function TopSearch({ pages }: { pages: FindPage[] }) {
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useSession();
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const found = useFindItems(q, pages, { capped: true });
  // nothing typed yet: what was looked for lately, one click brings it back
  const recent: FindItem[] = q.trim()
    ? []
    : readRecent(user.id).map((r) => ({ id: `r:${r}`, group: 'חיפושים אחרונים', label: r, icon: 'history', run: () => setQ(r) }));
  const items = q.trim() ? found : recent;

  // another screen: the list closes and the field empties
  useEffect(() => {
    setOpen(false);
    setQ('');
  }, [location.pathname]);
  useEffect(() => {
    setActive(-1);
  }, [q]);
  useEffect(() => {
    if (active >= 0) list.current?.querySelector(`[data-i="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const close = () => {
    setOpen(false);
    setActive(-1);
  };
  const run = (i: FindItem) => {
    if (i.id.startsWith('r:')) {
      i.run();
      input.current?.focus();
      return;
    }
    if (searchKey(q).length >= 2) rememberSearch(user.id, q);
    close();
    setQ('');
    input.current?.blur();
    i.run();
  };
  const all = () => {
    const t = q.trim();
    if (!t) return;
    rememberSearch(user.id, t);
    close();
    input.current?.blur();
    navigate(`/search?q=${encodeURIComponent(t)}`);
  };
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!open) setOpen(true);
      if (!items.length) return;
      const step = e.key === 'ArrowDown' ? 1 : -1;
      setActive((a) => (a < 0 ? (step > 0 ? 0 : items.length - 1) : (a + step + items.length) % items.length));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (open && active >= 0 && items[active]) run(items[active]);
      else all();
    } else if (e.key === 'Escape') {
      if (open) {
        e.preventDefault();
        close();
      } else input.current?.blur();
    } else if (e.key === 'Tab') close();
  };

  const shown = open && (items.length > 0 || !!q.trim());
  let lastGroup = '';
  return (
    <form
      className="search"
      role="search"
      onSubmit={(e) => {
        e.preventDefault();
        all();
      }}
    >
      <Icon name="search" />
      <input
        ref={input}
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        // a click in the list keeps the focus here (it is pressed down without taking it): only a click elsewhere closes
        onBlur={close}
        onKeyDown={onKey}
        placeholder="חיפוש משימה, איש סגל, צוער, שבוע, מסך..."
        aria-label="חיפוש"
        aria-keyshortcuts="/"
        role="combobox"
        aria-expanded={shown}
        aria-controls="top-search-list"
        aria-activedescendant={shown && active >= 0 ? `ts-${active}` : undefined}
        aria-autocomplete="list"
        autoComplete="off"
      />
      <button type="button" className="search-palette" onClick={() => window.dispatchEvent(new Event(OPEN_PALETTE))} aria-label="פקודה מהירה" aria-keyshortcuts="Control+K" title="פקודה מהירה: מסך, פעולה או פריט">
        <span className="kbd">Ctrl K</span>
      </button>
      {shown && (
        <div className="search-pop" onMouseDown={(e) => e.preventDefault()}>
          <div className="search-pop-list" id="top-search-list" role="listbox" aria-label="תוצאות החיפוש" ref={list}>
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
                    id={`ts-${idx}`}
                    data-i={idx}
                    role="option"
                    aria-selected={idx === active}
                    className={`palette-item${idx === active ? ' on' : ''}`}
                    onMouseMove={() => idx !== active && setActive(idx)}
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
            {!items.length && <div className="palette-empty small muted">{searchKey(q).length >= 2 ? 'מחפש...' : 'לא נמצא דבר בשם הזה'}</div>}
          </div>
          {q.trim() && (
            <div className="search-pop-foot tiny muted">
              <span className="kbd">↑</span>
              <span className="kbd">↓</span> מעבר · <span className="kbd">Enter</span> {active >= 0 ? 'פתיחה' : 'כל התוצאות'} · <span className="kbd">Esc</span> סגירה
            </div>
          )}
        </div>
      )}
    </form>
  );
}
