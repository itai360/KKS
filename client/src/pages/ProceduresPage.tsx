// Not keeping to procedures (אי עמידה בנהלים): every report the user may see, by cadet - which procedures and
// how many of each, the reports themselves a tap away. Over the whole course, this week or last week; by team,
// by kind and by name. As with all discipline, the commander sees every report, a team commander those on the
// cadets of their teams (and their own), anyone else their own (server/src/cadets.ts procedureOverview).

import { Fragment, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { CADET_STATUS_LABELS, CADET_STATUS_TONES } from '@shared/constants';
import { addDays, shortDate, startOfWeek } from '@shared/dates';
import { byCadet, kindCounts, PROCEDURE_KINDS, PROCEDURE_LABELS, procedureWhat, type ProcedureCadet, type ProcedureEntry, type ProcedureKind, type ProcedureOverview } from '@shared/procedures';
import { matchesSearch } from '@shared/search';
import { byHe } from '@shared/sort';
import { ask } from '../components/Confirm';
import { timeLabel } from '../components/Discipline';
import { Icon } from '../components/Icon';
import { addProcedure, timeTone } from '../components/ProcedureReport';
import { Select } from '../components/pickers';
import { useToast } from '../components/Toasts';
import { CountUp, Empty, ErrorBox, initials, Loading, PageHead } from '../components/ui';
import { api } from '../lib/api';
import { BOTTOM_BAR_MEDIA } from '../lib/bottomBar';
import { todayKey } from '../lib/format';
import { useMedia } from '../lib/media';
import { emitLocalChange } from '../lib/realtime';
import { useSession } from '../lib/session';
import { saveSheet } from '../lib/sheet';
import { useApi } from '../lib/useApi';

type Period = '' | 'week' | 'last';
const PERIODS: { key: Period; label: string }[] = [
  { key: '', label: 'כל הקורס' },
  { key: 'week', label: 'השבוע' },
  { key: 'last', label: 'שבוע שעבר' },
];

type SortKey = 'total' | 'name' | 'last' | ProcedureKind;
const SORTS: { key: SortKey; label: string }[] = [
  { key: 'total', label: 'הכי הרבה דיווחים' },
  { key: 'last', label: 'האחרונים' },
  { key: 'name', label: 'לפי שם' },
];

const NO_TEAM = 'none';

const SCOPE_NOTE: Record<ProcedureOverview['scope'], string> = {
  all: 'כל הדיווחים, לפי צוער - על מה ובכמה.',
  teams: 'הדיווחים על הצוערים בצוותים שלך, ומה שרשמת על צוערים אחרים.',
  mine: 'הדיווחים שרשמת. התמונה המלאה אצל מפקד הצוות ומפקד הקורס.',
};

const isKind = (v: string | null): v is ProcedureKind => !!v && (PROCEDURE_KINDS as readonly string[]).includes(v);

export function ProceduresPage() {
  const { viewing } = useSession();
  const toast = useToast();
  const wide = !useMedia(BOTTOM_BAR_MEDIA);
  const { data, error, loading } = useApi<ProcedureOverview>('/api/procedures', ['cadets']);
  const [params, setParams] = useSearchParams();
  const period = (['week', 'last'].includes(params.get('period') ?? '') ? params.get('period') : '') as Period;
  const team = params.get('team') ?? '';
  const kind = isKind(params.get('kind')) ? (params.get('kind') as ProcedureKind) : null;
  const set = (key: string, value: string) =>
    setParams(
      (p) => {
        const next = new URLSearchParams(p);
        if (value) next.set(key, value);
        else next.delete(key);
        return next;
      },
      { replace: true },
    );
  const [q, setQ] = useState('');
  const [sortBy, setSortBy] = useState<SortKey | null>(null);
  const [open, setOpen] = useState<Set<number>>(new Set());
  const toggle = (id: number) =>
    setOpen((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const all = useMemo(() => data?.entries ?? [], [data]);
  // the teams there are reports on, for the filter
  const teams = useMemo(() => {
    const m = new Map<string, string>();
    for (const e of all) m.set(e.teamId === null ? NO_TEAM : String(e.teamId), e.teamName ?? 'ללא צוות');
    return [...m].sort(([a, x], [b, y]) => Number(a === NO_TEAM) - Number(b === NO_TEAM) || byHe(x, y));
  }, [all]);
  const today = todayKey();
  const weekStart = startOfWeek(today);
  const range: [string, string] | null = period === 'week' ? [weekStart, today] : period === 'last' ? [addDays(weekStart, -7), addDays(weekStart, -1)] : null;
  // the period and the team set the numbers; the kind and the name pick the cadets
  const shownEntries = all.filter((e) => (!range || (e.occurredOn >= range[0] && e.occurredOn <= range[1])) && (!team || (e.teamId === null ? NO_TEAM : String(e.teamId)) === team));
  const counts = kindCounts(shownEntries);
  const sort: SortKey = sortBy ?? kind ?? 'total';
  const cadets = byCadet(shownEntries)
    .filter((c) => (!kind || c.byKind[kind] > 0) && matchesSearch(q, c.cadetName, c.teamName))
    .sort((a, b) =>
      sort === 'total'
        ? 0
        : sort === 'name'
          ? byHe(a.cadetName, b.cadetName)
          : sort === 'last'
            ? b.last.localeCompare(a.last)
            : b.byKind[sort] - a.byKind[sort] || b.total - a.total || byHe(a.cadetName, b.cadetName),
    );

  const remove = async (e: ProcedureEntry) => {
    const ok = await ask({
      title: 'למחוק את הדיווח?',
      body: `${e.cadetName}: ${procedureWhat(e)}, ${shortDate(e.occurredOn)}. הוא יימחק גם מתיק הצוער.`,
      confirm: 'מחיקה',
      cancel: 'ביטול',
      danger: true,
    });
    if (!ok) return;
    try {
      await api.del(`/api/records/${e.id}`);
      toast({ title: 'הדיווח נמחק', tone: 'green' });
      emitLocalChange('cadets');
    } catch (err) {
      toast({ title: (err as Error).message, tone: 'red' });
    }
  };

  const exportSheet = () =>
    void saveSheet(
      `אי-עמידה-בנהלים${period === 'week' ? '-השבוע' : period === 'last' ? '-שבוע-שעבר' : ''}`,
      ['צוער', 'צוות', ...PROCEDURE_KINDS.map((k) => PROCEDURE_LABELS[k]), 'סה"כ', 'פירוט דיגום', 'אחר - מה', 'הדיווח האחרון'],
      cadets.map((c) => [
        c.cadetName,
        c.teamName ?? '',
        ...PROCEDURE_KINDS.map((k) => c.byKind[k] || ''),
        c.total,
        c.dress.map((d) => `${d.item} ${d.count}`).join(', '),
        c.others.map((o) => (o.count > 1 ? `${o.text} ${o.count}` : o.text)).join(', '),
        c.last.split('-').reverse().join('.'),
      ]),
    ).catch((e: Error) => toast({ title: e.message, tone: 'red' }));

  const entries = (c: ProcedureCadet) => <Entries c={c} onRemove={viewing ? undefined : remove} />;

  return (
    <div className="page proc-page">
      <PageHead
        title="אי עמידה בנהלים"
        sub={data ? SCOPE_NOTE[data.scope] : undefined}
        actions={
          <>
            {!viewing && (
              <button className="btn btn-primary" onClick={() => addProcedure()}>
                <Icon name="plus" /> דיווח
              </button>
            )}
            <button className="btn" disabled={!cadets.length} onClick={exportSheet} title="הטבלה כפי שהיא מוצגת - נפתחת ב-Google Sheets ובאקסל">
              <Icon name="download" /> ייצוא
            </button>
          </>
        }
      />
      <ErrorBox error={error} />
      {loading && !data ? (
        <Loading rows={5} />
      ) : !all.length ? (
        <Empty
          icon="shield"
          title={data?.scope === 'mine' ? 'עוד לא דיווחת על אי עמידה בנהלים' : 'עוד לא דווח על אי עמידה בנהלים'}
          text={
            viewing ? undefined : (
              <>
                דיווח נעשה מה-"+" - בוחרים צוער ומה קרה.{' '}
                <button type="button" className="link-btn" onClick={() => addProcedure()}>
                  דיווח חדש
                </button>
              </>
            )
          }
        />
      ) : (
        <>
          <div className="chips proc-periods" role="group" aria-label="תקופה">
            {PERIODS.map((p) => (
              <button key={p.key} type="button" className={`chip${period === p.key ? ' on' : ''}`} aria-pressed={period === p.key} onClick={() => set('period', p.key)}>
                {p.label}
              </button>
            ))}
          </div>
          {/* the numbers by kind: a tap shows the cadets with that kind, the most first */}
          <div className="count-taps proc-counts" role="group" aria-label="דיווחים לפי סוג">
            <button type="button" className={`count-tap${!kind ? ' is-on' : ''}`} aria-pressed={!kind} onClick={() => set('kind', '')}>
              <b className="count-tap-n">
                <CountUp value={shownEntries.length} />
              </b>
              <span>הכל</span>
            </button>
            {PROCEDURE_KINDS.map((k) => (
              <button
                key={k}
                type="button"
                className={`count-tap${kind === k ? ' is-on' : ''}`}
                aria-pressed={kind === k}
                disabled={!counts[k] && kind !== k}
                onClick={() => set('kind', kind === k ? '' : k)}
              >
                <b className="count-tap-n">
                  <CountUp value={counts[k]} />
                </b>
                <span>{PROCEDURE_LABELS[k]}</span>
              </button>
            ))}
          </div>
          <div className="filters proc-filters">
            <input className="input" placeholder="חיפוש צוער" value={q} onChange={(e) => setQ(e.target.value)} aria-label="חיפוש צוער" />
            {teams.length > 1 && (
              <Select className="select" value={team} onChange={(e) => set('team', e.target.value)} aria-label="צוות">
                <option value="">כל הצוותים</option>
                {teams.map(([id, name]) => (
                  <option key={id} value={id}>
                    {name}
                  </option>
                ))}
              </Select>
            )}
            {!wide && (
              <Select className="select" value={sortBy ?? (kind ? '' : 'total')} onChange={(e) => setSortBy((e.target.value || null) as SortKey | null)} aria-label="סדר">
                {kind && <option value="">הכי הרבה {PROCEDURE_LABELS[kind]}</option>}
                {SORTS.map((s) => (
                  <option key={s.key} value={s.key}>
                    {s.label}
                  </option>
                ))}
              </Select>
            )}
          </div>

          {!cadets.length ? (
            <Empty icon="search" title="אין דיווחים להצגה" text={q ? 'לא נמצא צוער כזה בדיווחים.' : 'נסו תקופה, צוות או סוג אחרים.'} />
          ) : wide ? (
            <div className="card table-wrap proc-table-wrap">
              <table className="table proc-table">
                <thead>
                  <tr>
                    <SortHead label="צוער" k="name" sort={sort} onSort={setSortBy} dir="ascending" />
                    <th scope="col">צוות</th>
                    {PROCEDURE_KINDS.map((k) => (
                      <SortHead key={k} label={PROCEDURE_LABELS[k]} k={k} sort={sort} onSort={setSortBy} num on={kind === k} />
                    ))}
                    <SortHead label='סה"כ' k="total" sort={sort} onSort={setSortBy} num />
                    <SortHead label="אחרון" k="last" sort={sort} onSort={setSortBy} />
                  </tr>
                </thead>
                <tbody>
                  {cadets.map((c) => {
                    const isOpen = open.has(c.cadetId);
                    return (
                      <Fragment key={c.cadetId}>
                        <tr className={`proc-tr${isOpen ? ' is-open' : ''}`} onClick={() => toggle(c.cadetId)}>
                          <th scope="row">
                            <button
                              type="button"
                              className="proc-name"
                              aria-expanded={isOpen}
                              aria-controls={`proc-${c.cadetId}`}
                              onClick={(ev) => {
                                ev.stopPropagation();
                                toggle(c.cadetId);
                              }}
                            >
                              <Icon name="chevronDown" size={14} className="proc-chev" />
                              {c.cadetName}
                            </button>
                            <StatusBadge c={c} />
                          </th>
                          <td className="muted">{c.teamName ?? '-'}</td>
                          {PROCEDURE_KINDS.map((k) => (
                            <td key={k} className={`num-cell${kind === k ? ' is-on' : ''}`}>
                              {c.byKind[k] ? <b>{c.byKind[k]}</b> : <span className="proc-none">-</span>}
                            </td>
                          ))}
                          <td className="num-cell">
                            <span className={`badge ${timeTone(c.total)}`}>{c.total}</span>
                          </td>
                          <td className="mono small">{shortDate(c.last)}</td>
                        </tr>
                        {isOpen && (
                          <tr className="proc-detail" id={`proc-${c.cadetId}`}>
                            <td colSpan={PROCEDURE_KINDS.length + 4}>{entries(c)}</td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="card proc-cards">
              {cadets.map((c) => {
                const isOpen = open.has(c.cadetId);
                return (
                  <div key={c.cadetId} className={`proc-card${isOpen ? ' is-open' : ''}`}>
                    <button type="button" className="proc-card-head" aria-expanded={isOpen} aria-controls={`proc-${c.cadetId}`} onClick={() => toggle(c.cadetId)}>
                      <span className="avatar">{initials(c.cadetName)}</span>
                      <span className="grow proc-card-text">
                        <span className="proc-card-name">
                          <span className="strong">{c.cadetName}</span>
                          {c.teamName && <span className="tiny muted">{c.teamName}</span>}
                          <StatusBadge c={c} />
                        </span>
                        <span className="proc-card-kinds">
                          {PROCEDURE_KINDS.filter((k) => c.byKind[k] > 0).map((k) => (
                            <span key={k} className={`proc-kind-count${kind === k ? ' is-on' : ''}`}>
                              {PROCEDURE_LABELS[k]} <b>{c.byKind[k]}</b>
                            </span>
                          ))}
                        </span>
                      </span>
                      <span className={`badge ${timeTone(c.total)} proc-total`} aria-label={`${c.total} דיווחים`}>
                        {c.total}
                      </span>
                      <Icon name="chevronDown" size={16} className="proc-chev" />
                    </button>
                    {isOpen && (
                      <div className="proc-card-body" id={`proc-${c.cadetId}`}>
                        {entries(c)}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}

/** a column head that sorts the table by it: the most first (the names in their order) */
function SortHead({ label, k, sort, onSort, num, on, dir = 'descending' }: { label: string; k: SortKey; sort: SortKey; onSort: (k: SortKey) => void; num?: boolean; on?: boolean; dir?: 'ascending' | 'descending' }) {
  const active = sort === k;
  return (
    <th scope="col" className={`${num ? 'num-cell' : ''}${on ? ' is-on' : ''}`} aria-sort={active ? dir : undefined}>
      <button type="button" className={`th-sort${active ? ' is-active' : ''}`} onClick={() => onSort(k)} title={`סידור לפי ${label}`}>
        {label}
        {active && <Icon name="chevronDown" size={12} />}
      </button>
    </th>
  );
}

function StatusBadge({ c }: { c: Pick<ProcedureCadet, 'cadetStatus'> }) {
  if (c.cadetStatus === 'active') return null;
  return <span className={`badge t-${CADET_STATUS_TONES[c.cadetStatus]} proc-status-badge`}>{CADET_STATUS_LABELS[c.cadetStatus]}</span>;
}

/** a cadet's reports, newest first, and what is in the dress and "אחר" over all of them */
function Entries({ c, onRemove }: { c: ProcedureCadet; onRemove?: (e: ProcedureEntry) => void }) {
  return (
    <div className="proc-entries-wrap">
      <ul className="proc-entries">
        {c.entries.map((e) => (
          <li key={e.id} className="proc-entry">
            <span className="mono small muted proc-date">{shortDate(e.occurredOn)}</span>
            <div className="grow proc-entry-text">
              <div className="row wrap gap-6">
                <b className="small">{procedureWhat(e)}</b>
                {e.occurrence && <span className={`badge ${timeTone(e.occurrence)}`}>{timeLabel(e.occurrence)}</span>}
              </div>
              {e.body && <div className="small proc-body">{e.body}</div>}
              <div className="tiny muted">רשם: {e.authorName}</div>
            </div>
            {e.canDelete && onRemove && (
              <button type="button" className="icon-btn proc-remove" onClick={() => onRemove(e)} aria-label={`מחיקת הדיווח מ-${shortDate(e.occurredOn)}`} title="מחיקה">
                <Icon name="trash" size={15} />
              </button>
            )}
          </li>
        ))}
      </ul>
      <div className="proc-entries-foot">
        {c.dress.length > 0 && <span className="tiny muted">בדיגום: {c.dress.map((d) => `${d.item} ${d.count}`).join(', ')}</span>}
        {c.others.length > 0 && <span className="tiny muted">אחר: {c.others.map((o) => (o.count > 1 ? `${o.text} ${o.count}` : o.text)).join(', ')}</span>}
        <span className="grow" />
        <Link to={`/cadets/${c.cadetId}`} className="small">
          לתיק הצוער
        </Link>
      </div>
    </div>
  );
}
