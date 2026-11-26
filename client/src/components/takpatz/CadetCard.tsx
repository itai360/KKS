// One cadet's takpatz in one place: their third and rank, three goals, notes and ideas (each kept as it
// is written), the experiences of both plans, and how far each one of the main plan got in its tracking.

import { Link } from 'react-router';
import {
  BOARD_LABELS,
  CATEGORY_INFO,
  TAKPATZ_BOARDS,
  THIRD_LABELS,
  THIRDS,
  TRACK_STAGES,
  weekRange,
  type TakpatzPlacement,
  type TakpatzTeamView,
} from '@shared/takpatz';
import { formatAgo } from '@shared/dates';
import { Icon } from '../Icon';
import { Field, Modal } from '../ui';
import { api } from '../../lib/api';
import { catStyle, EditCell, StatusPill } from './common';
import type { PlacementDraft } from './PlacementEditor';

type Mutate = (fn: () => Promise<unknown>) => Promise<boolean>;

export function CadetCard({
  view,
  cadetId,
  onClose,
  mutate,
  onAdd,
  onEdit,
}: {
  view: TakpatzTeamView;
  cadetId: number;
  onClose: () => void;
  mutate: Mutate;
  onAdd: (d: PlacementDraft) => void;
  onEdit: (p: TakpatzPlacement) => void;
}) {
  const c = view.cadets.find((x) => x.id === cadetId);
  if (!c) return null;
  const save = (patch: Record<string, unknown>) => mutate(() => api.patch(`/api/takpatz/cadets/${c.id}`, patch));
  const mine = view.placements.filter((p) => p.cadetId === c.id);
  return (
    <Modal
      wide
      title={c.name}
      onClose={onClose}
      footer={
        <>
          <Link className="btn btn-ghost" to={`/cadets/${c.id}`} onClick={onClose}>
            <Icon name="cap" /> לתיק הצוער
          </Link>
          <span className="grow" />
          <button type="button" className="btn btn-primary" onClick={onClose}>
            סגירה
          </button>
        </>
      }
    >
      <div className="tk-cadet">
        <div className="tk-cadet-meta muted small">
          {view.team.name}
          {c.updatedAt && ` · עודכן ${formatAgo(c.updatedAt)}${c.updatedByName ? ` על ידי ${c.updatedByName}` : ''}`}
        </div>
        <div className="tk-cadet-grid">
          <Field label="שליש">
            <div className="tk-third-pick" role="radiogroup" aria-label="שליש">
              {THIRDS.map((t) => (
                <button key={t} type="button" role="radio" aria-checked={c.third === t} className={`tk-third-btn t-${t}${c.third === t ? ' on' : ''}`} onClick={() => void save({ third: c.third === t ? null : t })}>
                  {THIRD_LABELS[t]}
                </button>
              ))}
            </div>
          </Field>
          <Field label="דירוג בצוות">
            <span className="strong">{c.rank ?? '-'}</span> <span className="muted tiny">(במיפוי השלישים)</span>
          </Field>
        </div>
        {c.goals.map((g, i) => (
          <Field key={i} label={`יעד אישי ${i + 1}`}>
            <EditCell value={g} label={`יעד אישי ${i + 1}`} placeholder="הוספת יעד" className="boxed" onSave={(v) => save({ goals: c.goals.map((x, k) => (k === i ? v : x)) })} />
          </Field>
        ))}
        <Field label="הערות">
          <EditCell value={c.notes} label="הערות" placeholder="הוספת הערה" className="boxed" onSave={(v) => save({ notes: v })} />
        </Field>
        <Field label="רעיונות ומחשבות">
          <EditCell value={c.ideas} label="רעיונות ומחשבות" placeholder="הוספה" className="boxed" onSave={(v) => save({ ideas: v })} />
        </Field>
        {TAKPATZ_BOARDS.map((b) => {
          const list = mine.filter((p) => p.board === b);
          return (
            <section key={b} className="tk-cadet-board">
              <div className="tk-cadet-board-head">
                <h3>{BOARD_LABELS[b]}</h3>
                <button type="button" className="btn btn-sm" onClick={() => onAdd({ cadetId: c.id, board: b })}>
                  <Icon name="plus" /> שיבוץ
                </button>
              </div>
              {!list.length ? (
                <div className="muted small">אין התנסויות ב{BOARD_LABELS[b]}.</div>
              ) : (
                <ul className="tk-cadet-list">
                  {list.map((p) => {
                    const row = b === 'main' ? view.tracking.find((t) => t.placementId === p.id) : undefined;
                    return (
                      <li key={p.id}>
                        <button type="button" className="tk-cadet-pl" style={catStyle(p.category)} onClick={() => onEdit(p)}>
                          <span className="tk-dot" aria-hidden="true" />
                          <span className="strong">{p.label}</span>
                          <span className="muted small">
                            {weekRange(p.weekFrom, p.weekTo)} · {CATEGORY_INFO[p.category].label}
                          </span>
                        </button>
                        {row && (
                          <div className="tk-cadet-stages">
                            {TRACK_STAGES.map((s) => (
                              <span key={s.key} className="tk-cadet-stage">
                                <span className="tiny muted">{s.label}</span>
                                <StatusPill status={row.stages[s.key].status} small />
                              </span>
                            ))}
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          );
        })}
      </div>
    </Modal>
  );
}
