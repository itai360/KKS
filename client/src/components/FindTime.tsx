// "מציאת זמן", as Google Calendar's "Find a time": the day's hours with a column for each person in the
// event - who runs it, who made it, its guests - their busy times in it (an event of theirs the reader may
// not see says only "עסוק"), the event itself as a band across them all, and a tap on a free hour moves it
// there, its length kept. Arrows go a day back or on.

import { useEffect, useMemo, useRef, type CSSProperties, type MouseEvent } from 'react';
import { addDays, shortDate, weekdayName } from '@shared/dates';
import { useApi } from '../lib/useApi';
import { Icon } from './Icon';
import { Loading } from './ui';

export interface FindTimePerson {
  id: number;
  name: string;
  /** "אחראי", "מארגן/ת" - or nothing for a guest */
  role?: string;
}

interface BusyBlock {
  start: string | null;
  end: string | null;
  title: string;
}

/** the hours shown: the day's working hours, as the grid has them, and the evening */
const FROM = 6 * 60;
const TO = 23 * 60;
const HOUR_PX = 44;
const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
const toTime = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const y = (m: number) => ((Math.max(FROM, Math.min(TO, m)) - FROM) / 60) * HOUR_PX;

export function FindTime({
  date,
  start,
  end,
  people,
  exceptId,
  onPick,
}: {
  date: string;
  start: string;
  end: string;
  people: FindTimePerson[];
  /** the event being edited, not in its own way */
  exceptId?: number;
  onPick: (date: string, start: string, end: string) => void;
}) {
  const ids = people.map((p) => p.id).join(',');
  const busy = useApi<Record<number, BusyBlock[]>>(ids ? `/api/events/busy?date=${date}&users=${ids}${exceptId ? `&except=${exceptId}` : ''}` : null, ['events', 'users']);
  const s = start ? toMin(start) : 8 * 60;
  const e = end && toMin(end) > s ? toMin(end) : s + 60;
  const len = e - s;

  // who is busy at the time chosen
  const clash = useMemo(() => {
    const data = busy.data ?? {};
    return people.filter((p) => (data[p.id] ?? []).some((b) => !b.start || !b.end || (toMin(b.start) < e && toMin(b.end) > s)));
  }, [busy.data, people, s, e]);

  // opens at the event's time
  const scroller = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTop = Math.max(0, y(s) - HOUR_PX * 1.5);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date]);

  const pickAt = (ev: MouseEvent<HTMLDivElement>) => {
    const r = ev.currentTarget.getBoundingClientRect();
    const m = FROM + Math.round((((ev.clientY - r.top) / HOUR_PX) * 60) / 15) * 15;
    const from = Math.max(FROM, Math.min(TO - len, m));
    onPick(date, toTime(from), toTime(Math.min(23 * 60 + 59, from + len)));
  };

  return (
    <div className="ft">
      <div className="ft-head">
        <button type="button" className="icon-btn" aria-label="היום הקודם" title="היום הקודם" onClick={() => onPick(addDays(date, -1), toTime(s), toTime(Math.min(23 * 60 + 59, e)))}>
          <Icon name="chevronRight" size={20} />
        </button>
        <b className="ft-day">
          יום {weekdayName(date)}, {shortDate(date)}
        </b>
        <button type="button" className="icon-btn" aria-label="היום הבא" title="היום הבא" onClick={() => onPick(addDays(date, 1), toTime(s), toTime(Math.min(23 * 60 + 59, e)))}>
          <Icon name="chevronLeft" size={20} />
        </button>
        <span className="grow" />
        <span className={`ft-says${clash.length ? ' is-busy' : ' is-free'}`} role="status">
          <Icon name={clash.length ? 'alert' : 'check'} size={16} />
          {!busy.data ? 'בודק...' : clash.length ? `עסוקים בזמן הזה: ${clash.map((p) => p.name).join(', ')}` : people.length > 1 ? 'כולם פנויים בזמן הזה' : 'פנוי בזמן הזה'}
        </span>
      </div>
      {busy.loading && !busy.data ? (
        <Loading rows={4} />
      ) : (
        <div className="ft-grid" style={{ '--n': people.length } as CSSProperties}>
          <div className="ft-people">
            <span className="ft-corner" />
            {people.map((p) => {
              const allDay = (busy.data?.[p.id] ?? []).filter((b) => !b.start);
              return (
                <div key={p.id} className={`ft-person${clash.includes(p) ? ' is-busy' : ''}`}>
                  <b>{p.name}</b>
                  {p.role && <small>{p.role}</small>}
                  {allDay.map((b, i) => (
                    <span key={i} className="ft-allday" title={b.title}>
                      {b.title}
                    </span>
                  ))}
                </div>
              );
            })}
          </div>
          <div className="ft-scroll" ref={scroller}>
            <div className="ft-body" style={{ height: ((TO - FROM) / 60) * HOUR_PX }}>
              <div className="ft-hours" aria-hidden="true">
                {Array.from({ length: (TO - FROM) / 60 }, (_, i) => (
                  <span key={i} style={{ top: i * HOUR_PX }}>
                    {toTime(FROM + i * 60)}
                  </span>
                ))}
              </div>
              <div className="ft-cols" onClick={pickAt} title="לחיצה על שעה פנויה מעבירה את האירוע אליה">
                {people.map((p) => (
                  <div key={p.id} className="ft-col">
                    {(busy.data?.[p.id] ?? [])
                      .filter((b) => b.start && b.end)
                      .map((b, i) => (
                        <div key={i} className="ft-busy" style={{ top: y(toMin(b.start!)), height: Math.max(14, y(toMin(b.end!)) - y(toMin(b.start!)) - 2) }} title={`${b.title} · ${b.start} - ${b.end}`}>
                          <span>{b.title}</span>
                        </div>
                      ))}
                  </div>
                ))}
                {/* the event itself, across everyone */}
                <div className="ft-band" style={{ top: y(s), height: Math.max(14, y(e) - y(s)) }} aria-hidden="true">
                  <span>
                    {toTime(s)} - {toTime(Math.min(23 * 60 + 59, e))}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
