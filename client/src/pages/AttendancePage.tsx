// The daily roll call (מצבה): every active cadet by team, one tap for where they are today,
// the head count for the morning report, and the day as CSV or on paper.

import { useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { ATTENDANCE_IN, ATTENDANCE_LABELS, ATTENDANCE_STATUSES, ATTENDANCE_TONES, type AttendanceStatus } from '@shared/constants';
import { addDays, longDate } from '@shared/dates';
import type { RollCall, RollEntry } from '@shared/types';
import { Icon } from '../components/Icon';
import { useToast } from '../components/Toasts';
import { Empty, ErrorBox, Loading, PageHead } from '../components/ui';
import { api } from '../lib/api';
import { saveCsv } from '../lib/csv';
import { todayKey } from '../lib/format';
import { emitLocalChange } from '../lib/realtime';
import { useApi } from '../lib/useApi';

interface Mark {
  status: AttendanceStatus | null;
  note: string;
}

function countOf(entries: RollEntry[]): RollCall['counts'] {
  const c = Object.fromEntries(ATTENDANCE_STATUSES.map((s) => [s, 0])) as RollCall['counts'];
  c.total = entries.length;
  c.unmarked = 0;
  for (const e of entries) {
    if (e.status) c[e.status]++;
    else c.unmarked++;
  }
  return c;
}

/** short labels for the buttons; the full ones in the counts */
const SHORT: Record<AttendanceStatus, string> = { present: 'נוכח', late: 'איחור', sick: 'גימלים', leave: 'בית', appointment: 'תור', absent: 'נעדר' };

export function AttendancePage() {
  const [params, setParams] = useSearchParams();
  const date = params.get('date') ?? todayKey();
  const team = params.get('team') ?? '';
  const { data: server, error, loading, setData } = useApi<RollCall>(`/api/attendance?date=${date}`, ['cadets']);
  const toast = useToast();
  // marks not yet confirmed by the server, by "date:cadet": shown over what the server says,
  // and sent one request at a time - two in flight could arrive in the wrong order
  const [overlay, setOverlay] = useState<Map<string, Mark>>(new Map());
  const queue = useRef<(Mark & { date: string; cadetId: number })[]>([]);
  const inflight = useRef<Promise<void> | null>(null);
  const shownDate = useRef(date);
  shownDate.current = date;
  const set = (p: Record<string, string>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(p)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    setParams(next, { replace: true });
  };

  const flush = async () => {
    while (inflight.current) await inflight.current;
    const batch = queue.current;
    if (!batch.length) return;
    queue.current = [];
    const day = batch[0].date;
    const mine = batch.filter((b) => b.date === day);
    queue.current = batch.filter((b) => b.date !== day);
    const settle = (sent: typeof mine) =>
      setOverlay((o) => {
        const n = new Map(o);
        for (const b of sent) {
          const k = `${b.date}:${b.cadetId}`;
          if (n.get(k) === b && !queue.current.some((q) => q.date === b.date && q.cadetId === b.cadetId)) n.delete(k);
        }
        return n;
      });
    const run = (async () => {
      try {
        const res = await api.put<RollCall>('/api/attendance', { date: day, entries: mine.map(({ cadetId, status, note }) => ({ cadetId, status, note })) });
        // the day still on screen (not one the user has since moved away from)
        if (res.date === shownDate.current) setData(res);
        emitLocalChange('cadets');
      } catch (e) {
        toast({ title: (e as Error).message, tone: 'red' });
      }
      settle(mine);
    })();
    inflight.current = run;
    await run;
    inflight.current = null;
    if (queue.current.length) void flush();
  };

  const mark = (marks: { cadetId: number; status: AttendanceStatus | null; note?: string }[]) => {
    const items = marks.map((m) => ({ date, cadetId: m.cadetId, status: m.status, note: m.note ?? '' }));
    setOverlay((o) => {
      const n = new Map(o);
      for (const it of items) n.set(`${date}:${it.cadetId}`, it);
      return n;
    });
    // a newer mark of the same cadet replaces one still waiting
    queue.current = [...queue.current.filter((q) => !items.some((it) => it.date === q.date && it.cadetId === q.cadetId)), ...items];
    void flush();
  };

  // what the server says, with what was just marked over it
  const entries: RollEntry[] = (server?.entries ?? []).map((e) => {
    const m = overlay.get(`${date}:${e.cadetId}`);
    return m ? { ...e, status: m.status, note: m.note } : e;
  });
  const data = server ? { ...server, entries } : undefined;
  const shown = entries.filter((e) => !team || String(e.teamId ?? 0) === team);
  const groups = new Map<string, RollEntry[]>();
  for (const e of shown) groups.set(String(e.teamId ?? 0), [...(groups.get(String(e.teamId ?? 0)) ?? []), e]);
  const counts = server ? countOf(entries) : undefined;
  const inCourse = counts ? counts.present + counts.late : 0;
  const teamCount = (key: string) => {
    const list = entries.filter((e) => String(e.teamId ?? 0) === key);
    return { marked: list.filter((e) => e.status).length, total: list.length };
  };

  return (
    <div className="page roll-page">
      <PageHead
        title="מצבה"
        sub="איפה כל צוער היום - סימון בלחיצה, ספירה לפי צוות ודוח בוקר."
        actions={
          <>
            <button
              className="btn"
              disabled={!data}
              onClick={() =>
                data &&
                void saveCsv(
                  `מצבה-${date}`,
                  ['צוות', 'שם', 'מצב', 'הערה', 'סומן ע"י'],
                  data.entries.map((e) => [e.teamName ?? '', e.fullName, e.status ? ATTENDANCE_LABELS[e.status] : 'לא סומן', e.note, e.markedByName ?? '']),
                )
              }
            >
              <Icon name="download" /> ייצוא
            </button>
            <button className="btn" onClick={() => window.print()} aria-label="הדפסה">
              <Icon name="print" />
              <span className="hide-mobile">הדפסה</span>
            </button>
          </>
        }
      />

      <div className="roll-bar no-print">
        <div className="row gap-6">
          <button className="icon-btn" aria-label="היום הקודם" onClick={() => set({ date: addDays(date, -1) })}>
            <Icon name="chevronRight" />
          </button>
          <input className="input mono" type="date" value={date} onChange={(e) => set({ date: e.target.value })} aria-label="תאריך" />
          <button className="icon-btn" aria-label="היום הבא" onClick={() => set({ date: addDays(date, 1) })}>
            <Icon name="chevronLeft" />
          </button>
          {date !== todayKey() && (
            <button className="btn btn-sm" onClick={() => set({ date: '' })}>
              היום
            </button>
          )}
        </div>
        {data && data.teams.length > 1 && (
          <div className="chips" role="group" aria-label="צוות">
            <button className={`chip chip-sm${!team ? ' on' : ''}`} aria-pressed={!team} onClick={() => set({ team: '' })}>
              כל הצוותים
            </button>
            {data.teams.map((t) => (
              <button key={String(t.teamId)} className={`chip chip-sm${team === String(t.teamId ?? 0) ? ' on' : ''}`} aria-pressed={team === String(t.teamId ?? 0)} onClick={() => set({ team: String(t.teamId ?? 0) })}>
                {t.name} <span className="mono">{teamCount(String(t.teamId ?? 0)).marked}/{t.total}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      <ErrorBox error={error} />
      {loading && !data ? (
        <Loading rows={5} />
      ) : !data?.entries.length ? (
        <Empty icon="shield" title="אין צוערים פעילים" text={<>הוסיפו צוערים במסך <Link to="/cadets">צוערים</Link>.</>} />
      ) : (
        <>
          <div className="card card-pad roll-summary">
            <div className="roll-big">
              <span className="dq-big mono">
                {inCourse}/{counts!.total}
              </span>
              <span className="small muted">בקורס · {longDate(date)}</span>
            </div>
            <div className="row wrap gap-6">
              {ATTENDANCE_STATUSES.filter((s) => counts![s] > 0).map((s) => (
                <span key={s} className={`badge t-${ATTENDANCE_TONES[s]}`}>
                  {ATTENDANCE_LABELS[s]} {counts![s]}
                </span>
              ))}
              {counts!.unmarked > 0 && <span className="badge">לא סומנו {counts!.unmarked}</span>}
            </div>
          </div>

          <div className="col gap-16">
            {[...groups].map(([key, list]) => {
              const t = data.teams.find((x) => String(x.teamId ?? 0) === key)!;
              const left = list.filter((e) => !e.status);
              const marked = list.length - left.length;
              return (
                <section key={key} className="card roll-team" aria-label={t.name}>
                  <div className="card-head">
                    <Icon name="users" />
                    <h2 className="grow">
                      {t.name}
                      {t.commanderName && <span className="small muted"> · {t.commanderName}</span>}
                    </h2>
                    <span className={`badge ${marked === list.length ? 't-green' : ''}`}>
                      סומנו {marked}/{list.length}
                    </span>
                    {left.length > 0 && (
                      <button className="btn btn-sm no-print" onClick={() => mark(left.map((e) => ({ cadetId: e.cadetId, status: 'present' })))}>
                        <Icon name="check" /> {left.length === list.length ? 'כולם נוכחים' : `כל השאר נוכחים (${left.length})`}
                      </button>
                    )}
                  </div>
                  <div className="roll-list">
                    {list.map((e) => (
                      <RollRow key={e.cadetId} entry={e} onMark={(status, note) => mark([{ cadetId: e.cadetId, status, note }])} />
                    ))}
                  </div>
                </section>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

function RollRow({ entry: e, onMark }: { entry: RollEntry; onMark: (status: AttendanceStatus | null, note?: string) => void }) {
  const [note, setNote] = useState(e.note);
  const away = e.status && !ATTENDANCE_IN.includes(e.status);
  return (
    <div className={`roll-row${e.status ? ` is-${ATTENDANCE_TONES[e.status]}` : ''}`}>
      <div className="roll-name">
        <Link to={`/cadets/${e.cadetId}`} className="strong">
          {e.fullName}
        </Link>
        {e.exemptions.length > 0 && (
          <span className="badge t-purple" title={`פטור: ${e.exemptions.join(', ')}`}>
            פטור
          </span>
        )}
        <span className="print-only small">{e.status ? ATTENDANCE_LABELS[e.status] : '-'}</span>
      </div>
      <div className="roll-choices no-print" role="group" aria-label={`המצב של ${e.fullName}`}>
        {ATTENDANCE_STATUSES.map((s) => (
          <button key={s} type="button" className={`t-${ATTENDANCE_TONES[s]}`} aria-pressed={e.status === s} onClick={() => onMark(e.status === s ? null : s, s === 'present' ? '' : note)}>
            {SHORT[s]}
          </button>
        ))}
      </div>
      {(away || e.status === 'late') && (
        <input
          className="input roll-note"
          value={note}
          onChange={(ev) => setNote(ev.target.value)}
          onBlur={() => note !== e.note && onMark(e.status, note)}
          placeholder={e.status === 'late' ? 'מתי הגיע?' : 'סיבה / עד מתי'}
          aria-label={`הערה ל${e.fullName}`}
          maxLength={200}
          data-transient
        />
      )}
    </div>
  );
}
