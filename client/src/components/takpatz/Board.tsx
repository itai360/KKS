// The takpatz itself: a row for each cadet - their goals, notes and ideas, written where they stand -
// and the plan's experiences in the weeks, each one bar across its weeks in its kind's color; an empty
// week is tapped to plan one there. The names stay in sight while the weeks scroll. On a phone each
// cadet is a card with the weeks as a strip.

import { Fragment, type ReactElement } from 'react';
import { shortDate } from '@shared/dates';
import {
  CATEGORY_INFO,
  STAGE_KEYS,
  THIRD_LABELS,
  weekRange,
  type TakpatzBoard,
  type TakpatzCadet,
  type TakpatzPlacement,
  type TakpatzTeamView,
} from '@shared/takpatz';
import { Icon } from '../Icon';
import { openable } from '../ui';
import { catStyle, EditCell } from './common';
import type { PlacementDraft } from './PlacementEditor';

export type BoardMode = 'all' | 'weeks' | 'goals';

interface Props {
  view: TakpatzTeamView;
  board: TakpatzBoard;
  mode: BoardMode;
  onOpenCadet: (id: number) => void;
  onAdd: (d: PlacementDraft) => void;
  onEdit: (p: TakpatzPlacement) => void;
  onSaveProfile: (c: TakpatzCadet, patch: Record<string, unknown>) => Promise<unknown>;
}

/** how far an experience of the main plan got in its tracking */
function progressOf(view: TakpatzTeamView, p: TakpatzPlacement): number | null {
  if (p.board !== 'main') return null;
  const row = view.tracking.find((t) => t.placementId === p.id);
  if (!row) return 0;
  return STAGE_KEYS.filter((k) => row.stages[k].status === 'done').length;
}

function PlacementBar({ view, p, onEdit, compact }: { view: TakpatzTeamView; p: TakpatzPlacement; onEdit: (p: TakpatzPlacement) => void; compact?: boolean }) {
  const done = progressOf(view, p);
  return (
    <button
      type="button"
      className={`tk-pl${compact ? ' compact' : ''}`}
      style={catStyle(p.category)}
      onClick={(e) => {
        e.stopPropagation();
        onEdit(p);
      }}
      title={`${p.label} · ${CATEGORY_INFO[p.category].label} · ${weekRange(p.weekFrom, p.weekTo)}${p.notes ? `\n${p.notes}` : ''}`}
    >
      <span className="tk-pl-label">{p.label}</span>
      {p.notes && <Icon name="message" size={11} />}
      {done !== null && done > 0 && (
        <span className="tk-pl-done" aria-label={`${done} מתוך 5 שלבים במעקב הושלמו`}>
          {done}/5
        </span>
      )}
    </button>
  );
}

export function BoardTable({ view, board, mode, onOpenCadet, onAdd, onEdit, onSaveProfile }: Props) {
  const weeks = view.weeks;
  const first = weeks[0].n;
  const last = weeks[weeks.length - 1].n;
  const showProfile = mode !== 'weeks';
  const showWeeks = mode !== 'goals';
  return (
    <div className="tk-board-wrap" tabIndex={0} role="region" aria-label="התקפ״צ - צוערים ושבועות">
      <table className={`tk-board mode-${mode}`}>
        <thead>
          <tr>
            <th scope="col" className="tk-sticky tk-name-col">
              שם הצוער
            </th>
            {showProfile && (
              <>
                <th scope="col" className="tk-third-col">
                  שליש
                </th>
                <th scope="col">יעד אישי 1</th>
                <th scope="col">יעד אישי 2</th>
                <th scope="col">יעד אישי 3</th>
                <th scope="col">הערות</th>
                <th scope="col">רעיונות ומחשבות</th>
              </>
            )}
            {showWeeks && (
              <>
                {weeks.map((w) => (
                  <th key={w.n} scope="col" className="tk-week-h">
                    <span className="tk-wn">שבוע {w.n}</span>
                    <span className="tk-wt">{w.title}</span>
                    {w.startDate && w.endDate && (
                      <span className="tk-wd">
                        {shortDate(w.startDate)}-{shortDate(w.endDate)}
                      </span>
                    )}
                  </th>
                ))}
                <th scope="col" className="tk-aside-h">
                  מחוץ לשבועות
                </th>
              </>
            )}
          </tr>
        </thead>
        <tbody>
          {view.cadets.map((c) => {
            const mine = view.placements.filter((p) => p.cadetId === c.id && p.board === board);
            const cells: ReactElement[] = [];
            for (let w = first; w <= last; ) {
              const p = mine.find((x) => x.weekFrom === w);
              if (p) {
                const n = p.weekTo! - p.weekFrom! + 1;
                cells.push(
                  <td key={w} colSpan={n} className="tk-week has-pl">
                    <PlacementBar view={view} p={p} onEdit={onEdit} />
                  </td>,
                );
                w += n;
                continue;
              }
              // a week inside an experience that started before the plan's first week cannot be; an empty one plans
              const week = w;
              cells.push(
                <td key={w} className="tk-week">
                  <button type="button" className="tk-add" onClick={() => onAdd({ cadetId: c.id, board, weekFrom: week, weekTo: week })} aria-label={`שיבוץ ל${c.name} בשבוע ${week}`}>
                    <Icon name="plus" size={14} />
                  </button>
                </td>,
              );
              w++;
            }
            const aside = mine.filter((p) => p.weekFrom === null);
            return (
              <tr key={c.id}>
                <th scope="row" className="tk-sticky tk-name-col">
                  <button type="button" className="tk-name" onClick={() => onOpenCadet(c.id)}>
                    {c.name}
                  </button>
                </th>
                {showProfile && (
                  <>
                    <td className="tk-third-col">{c.third ? <span className={`tk-third t-${c.third}`}>{THIRD_LABELS[c.third]}</span> : <span className="faint">-</span>}</td>
                    {c.goals.map((g, i) => (
                      <td key={i} className="tk-text">
                        <EditCell
                          value={g}
                          label={`יעד אישי ${i + 1} של ${c.name}`}
                          onSave={(v) => onSaveProfile(c, { goals: c.goals.map((x, k) => (k === i ? v : x)) })}
                        />
                      </td>
                    ))}
                    <td className="tk-text">
                      <EditCell value={c.notes} label={`הערות על ${c.name}`} onSave={(v) => onSaveProfile(c, { notes: v })} />
                    </td>
                    <td className="tk-text">
                      <EditCell value={c.ideas} label={`רעיונות ומחשבות על ${c.name}`} onSave={(v) => onSaveProfile(c, { ideas: v })} />
                    </td>
                  </>
                )}
                {showWeeks && (
                  <>
                    {cells}
                    <td className="tk-aside">
                      <div className="tk-aside-list">
                        {aside.map((p) => (
                          <Fragment key={p.id}>
                            <PlacementBar view={view} p={p} onEdit={onEdit} compact />
                          </Fragment>
                        ))}
                        <button type="button" className="tk-add small" onClick={() => onAdd({ cadetId: c.id, board, weekFrom: null, weekTo: null })} aria-label={`התנסות ל${c.name} שעוד לא שובצה לשבוע`}>
                          <Icon name="plus" size={13} />
                        </button>
                      </div>
                    </td>
                  </>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** the phone's: a card for each cadet - their goals, and the weeks as a strip of the plan's bars */
export function BoardCards({ view, board, onOpenCadet, onAdd, onEdit }: Omit<Props, 'mode' | 'onSaveProfile'>) {
  const weeks = view.weeks;
  const first = weeks[0].n;
  return (
    <div className="tk-cards">
      {view.cadets.map((c) => {
        const mine = view.placements.filter((p) => p.cadetId === c.id && p.board === board);
        const goals = c.goals.filter((g) => g.trim());
        return (
          <div key={c.id} className="card tk-card" {...openable(() => onOpenCadet(c.id), { role: false })} aria-label={`${c.name} - פתיחת הכרטיס`}>
            <div className="tk-card-head">
              <span className="strong">{c.name}</span>
              {c.third && <span className={`tk-third t-${c.third}`}>{THIRD_LABELS[c.third]}</span>}
              <span className="grow" />
              <button
                type="button"
                className="icon-btn"
                onClick={(e) => {
                  e.stopPropagation();
                  onAdd({ cadetId: c.id, board });
                }}
                aria-label={`שיבוץ התנסות ל${c.name}`}
              >
                <Icon name="plus" />
              </button>
            </div>
            {goals.length > 0 && <div className="tk-card-goals">{goals.join(' · ')}</div>}
            <div className="tk-strip" style={{ gridTemplateColumns: `repeat(${weeks.length}, 1fr)` }} aria-hidden="true">
              {weeks.map((w) => (
                <span key={w.n} className="tk-strip-cell" style={{ gridColumn: `${w.n - first + 1}` }}>
                  {w.n}
                </span>
              ))}
              {mine
                .filter((p) => p.weekFrom !== null)
                .map((p) => (
                  <span key={p.id} className="tk-strip-bar" style={{ ...catStyle(p.category), gridColumn: `${p.weekFrom! - first + 1} / span ${p.weekTo! - p.weekFrom! + 1}` }} />
                ))}
            </div>
            {mine.length > 0 && (
              <div className="tk-card-list">
                {mine.map((p) => (
                  <PlacementBar key={p.id} view={view} p={p} onEdit={onEdit} compact />
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
