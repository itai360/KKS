// The small month in the side bar, as Google Calendar keeps one under "יצירה": a month of six weeks,
// today in a full circle, the day the calendar is on in a light one and the days it shows on a band.
// A day picked takes the calendar there; the arrows (and the arrow keys) move through the months.

import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { MONTH_NAMES, monthWeeks, stepDate } from '@shared/calendarGrid';
import { addDays, parseDateKey } from '@shared/dates';
import { dayLabel, WEEKDAY_LETTERS } from './Agenda';
import { Icon } from './Icon';

/** always six weeks, so the side bar does not jump from month to month */
function sixWeeks(month: string): string[] {
  const weeks = monthWeeks(month).flat();
  while (weeks.length < 42) weeks.push(addDays(weeks[weeks.length - 1], 1));
  return weeks;
}

export function MiniMonth({ selected, shown, today, onPick }: { selected: string; shown: string[]; today: string; onPick: (d: string) => void }) {
  // the month on show follows the calendar's day, until the arrows take it elsewhere
  const [month, setMonth] = useState({ for: selected, at: selected });
  const at = month.for === selected ? month.at : selected;
  const go = (dir: 1 | -1) => setMonth({ for: selected, at: stepDate('month', at, dir) });
  const { year, month: mo } = parseDateKey(at);
  const days = sixWeeks(at);
  const inMonth = at.slice(0, 7);
  const band = new Set(shown.length > 1 ? shown : []);
  const grid = useRef<HTMLDivElement>(null);
  // the keyboard's place in the month: the day the calendar is on, or the first of the month
  const [focus, setFocus] = useState<string | null>(null);
  const focusDay = focus && days.includes(focus) ? focus : days.includes(selected) ? selected : `${inMonth}-01`;
  const moved = useRef(false);
  useEffect(() => {
    if (!moved.current) return;
    moved.current = false;
    grid.current?.querySelector<HTMLButtonElement>(`[data-day="${focusDay}"]`)?.focus();
  }, [focusDay]);

  const onKey = (e: KeyboardEvent) => {
    // right to left: the left arrow is the next day
    const step = { ArrowLeft: 1, ArrowRight: -1, ArrowDown: 7, ArrowUp: -7 }[e.key];
    if (!step) return;
    e.preventDefault();
    const next = addDays(focusDay, step);
    moved.current = true;
    setFocus(next);
    if (next.slice(0, 7) !== inMonth) setMonth({ for: selected, at: next });
  };

  return (
    <div className="mini-month">
      <div className="mini-month-head">
        <b className="grow" aria-live="polite">
          {MONTH_NAMES[mo - 1]} {year}
        </b>
        <button type="button" className="icon-btn mini-month-step" aria-label="החודש הקודם" title="החודש הקודם" onClick={() => go(-1)}>
          <Icon name="chevronRight" size={18} />
        </button>
        <button type="button" className="icon-btn mini-month-step" aria-label="החודש הבא" title="החודש הבא" onClick={() => go(1)}>
          <Icon name="chevronLeft" size={18} />
        </button>
      </div>
      <div className="mini-month-grid" ref={grid} role="grid" aria-label={`${MONTH_NAMES[mo - 1]} ${year}`} onKeyDown={onKey}>
        {WEEKDAY_LETTERS.map((l) => (
          <span key={l} className="mini-month-w" aria-hidden="true">
            {l}
          </span>
        ))}
        {days.map((d, i) => {
          const inBand = band.has(d);
          const col = i % 7;
          return (
            <button
              key={d}
              type="button"
              data-day={d}
              tabIndex={d === focusDay ? 0 : -1}
              className={[
                'mini-month-day',
                d.slice(0, 7) !== inMonth && 'out',
                d === today && 'today',
                d === selected && 'on',
                inBand && 'band',
                inBand && (col === 0 || !band.has(addDays(d, -1))) && 'band-start',
                inBand && (col === 6 || !band.has(addDays(d, 1))) && 'band-end',
              ]
                .filter(Boolean)
                .join(' ')}
              aria-current={d === today ? 'date' : undefined}
              aria-pressed={d === selected}
              aria-label={dayLabel(d, today)}
              onClick={() => {
                setFocus(d);
                onPick(d);
              }}
            >
              <span>{Number(d.slice(8))}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
