// An experience in a cadet's plan: its kind (with the course's catalog to pick from), its name, its
// weeks - or none yet, kept beside the weeks as long as it will be - and a note. Two experiences in one
// week of a plan are refused by the server; the answer offers to keep this one beside the weeks.

import { useMemo, useState } from 'react';
import {
  BOARD_LABELS,
  CATEGORY_INFO,
  HALF_LABELS,
  TAKPATZ_CATEGORIES,
  TAKPATZ_HALVES,
  type TakpatzBoard,
  type TakpatzCategory,
  type TakpatzPlacement,
  type TakpatzTeamView,
} from '@shared/takpatz';
import { ask } from '../Confirm';
import { Icon } from '../Icon';
import { useToast } from '../Toasts';
import { ErrorBox, Field, Modal, Seg, Select } from '../ui';
import { api, ApiError } from '../../lib/api';
import { catStyle } from './common';

export interface PlacementDraft {
  placement?: TakpatzPlacement;
  cadetId?: number;
  board: TakpatzBoard;
  category?: TakpatzCategory;
  catalogId?: number | null;
  label?: string;
  weekFrom?: number | null;
  weekTo?: number | null;
}

export function PlacementEditor({ view, draft, onClose, onSaved }: { view: TakpatzTeamView; draft: PlacementDraft; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const p = draft.placement;
  const [cadetId, setCadetId] = useState<number | null>(p?.cadetId ?? draft.cadetId ?? null);
  const [category, setCategory] = useState<TakpatzCategory>(p?.category ?? draft.category ?? 'command_team');
  const [catalogId, setCatalogId] = useState<number | null>(p?.catalogId ?? draft.catalogId ?? null);
  const [label, setLabel] = useState(p?.label ?? draft.label ?? '');
  const firstWeek = p ? p.weekFrom : draft.weekFrom !== undefined ? draft.weekFrom : view.weeks[0].n;
  const [inWeeks, setInWeeks] = useState<'in' | 'out'>(firstWeek === null ? 'out' : 'in');
  const [weekFrom, setWeekFrom] = useState<number>(firstWeek ?? view.weeks[0].n);
  const [weekTo, setWeekTo] = useState<number>((p ? p.weekTo : draft.weekTo) ?? firstWeek ?? view.weeks[0].n);
  const [span, setSpan] = useState<number>(p?.span ?? 1);
  const [notes, setNotes] = useState(p?.notes ?? '');
  const [error, setError] = useState<string | null>(null);
  const [overlap, setOverlap] = useState(false);
  const [busy, setBusy] = useState(false);
  const board = p?.board ?? draft.board;
  const cadet = view.cadets.find((c) => c.id === cadetId);

  const items = useMemo(() => view.catalog.filter((x) => x.kind === category), [view.catalog, category]);
  const chosen = view.catalog.find((x) => x.id === catalogId);
  const roles = view.catalog.filter((x) => x.kind === 'role' && (!chosen || x.half === chosen.half));
  const roleNames = [...new Set(roles.map((r) => r.name))];

  const pickCategory = (c: TakpatzCategory) => {
    setCategory(c);
    if (chosen && chosen.kind !== c) setCatalogId(null);
  };
  const pickItem = (id: number) => {
    const item = view.catalog.find((x) => x.id === id)!;
    setCatalogId(id);
    // a broad company experience is named by the role it takes; the slot is where it is
    if (item.kind !== 'broad_company' || !label || label === chosen?.name) setLabel(item.name);
  };
  const typeLabel = (v: string) => {
    setLabel(v);
    if (category === 'broad_company') return;
    const half = inWeeks === 'in' ? (weekFrom <= 4 ? 1 : 2) : null;
    const same = items.filter((x) => x.name === v.trim());
    setCatalogId((same.find((x) => x.half === half) ?? same[0])?.id ?? null);
  };

  const body = (out = inWeeks === 'out') => ({
    board,
    category,
    catalogId,
    label: label.trim(),
    weekFrom: out ? null : weekFrom,
    weekTo: out ? null : Math.max(weekFrom, weekTo),
    span: out ? span : Math.max(weekFrom, weekTo) - weekFrom + 1,
    notes: notes.trim(),
  });

  const save = async (out?: boolean) => {
    if (!cadetId) return setError('בחרו צוער');
    if (!label.trim()) return setError('כתבו את שם ההתנסות או בחרו מהמאגר');
    setBusy(true);
    setError(null);
    setOverlap(false);
    try {
      if (p) await api.patch(`/api/takpatz/placements/${p.id}`, body(out));
      else await api.post('/api/takpatz/placements', { cadetId, ...body(out) });
      onSaved();
      onClose();
    } catch (e) {
      setError((e as Error).message);
      setOverlap(e instanceof ApiError && e.status === 409 && !out && inWeeks === 'in');
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!p) return;
    if (!(await ask({ title: `להסיר את "${p.label}"?`, body: `ההתנסות תוסר מה${BOARD_LABELS[p.board]} של ${cadet?.name ?? 'הצוער'}. מה שנרשם במעקב שלה נשמר.`, confirm: 'הסרה', danger: true }))) return;
    try {
      await api.del(`/api/takpatz/placements/${p.id}`);
      toast({ title: `"${p.label}" הוסר`, tone: 'green' });
      onSaved();
      onClose();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const other: TakpatzBoard = board === 'main' ? 'alt' : 'main';
  const copy = async () => {
    if (!p) return;
    try {
      await api.post(`/api/takpatz/placements/${p.id}/copy`, { to: other });
      toast({ title: `"${p.label}" הועתק ל${BOARD_LABELS[other]}`, tone: 'green' });
      onSaved();
      onClose();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const weekOptions = view.weeks.map((w) => (
    <option key={w.n} value={w.n}>
      {`שבוע ${w.n} - ${w.title}`}
    </option>
  ));

  return (
    <Modal
      title={p ? `${p.label} - ${cadet?.name ?? ''}` : `שיבוץ התנסות${cadet ? ` - ${cadet.name}` : ''}`}
      onClose={onClose}
      footer={
        <>
          {p && (
            <>
              <button type="button" className="btn btn-danger" onClick={() => void remove()}>
                <Icon name="trash" /> הסרה
              </button>
              <button type="button" className="btn btn-ghost" onClick={() => void copy()}>
                <Icon name="copy" /> העתקה ל{BOARD_LABELS[other]}
              </button>
            </>
          )}
          <span className="grow" />
          <button type="button" className="btn" onClick={onClose}>
            ביטול
          </button>
          <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void save()}>
            {busy ? 'שומר...' : 'שמירה'}
          </button>
        </>
      }
    >
      <div className="tk-form">
        {!p && !draft.cadetId && (
          <Field label="צוער" required>
            <Select value={cadetId ?? ''} onChange={(e) => setCadetId(Number(e.target.value) || null)} aria-label="צוער">
              <option value="">בחירת צוער</option>
              {view.cadets.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </Field>
        )}
        <Field label="סוג ההתנסות">
          <div className="tk-cats" role="radiogroup" aria-label="סוג ההתנסות">
            {TAKPATZ_CATEGORIES.map((c) => (
              <button key={c} type="button" role="radio" aria-checked={category === c} className={`tk-cat${category === c ? ' on' : ''}`} style={catStyle(c)} onClick={() => pickCategory(c)}>
                {CATEGORY_INFO[c].label}
              </button>
            ))}
          </div>
        </Field>
        {items.length > 0 && (
          <Field label="מהמאגר">
            <div className="tk-catalog">
              {TAKPATZ_HALVES.map((h) => {
                const list = items.filter((x) => x.half === h);
                if (!list.length) return null;
                return (
                  <div key={h} className="tk-catalog-half">
                    <span className="tiny muted">{HALF_LABELS[h]}</span>
                    <div className="tk-chips">
                      {list.map((x) => (
                        <button key={x.id} type="button" className={`tk-chip${catalogId === x.id ? ' on' : ''}`} style={catStyle(category)} onClick={() => pickItem(x.id)} aria-pressed={catalogId === x.id}>
                          {x.name}
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </Field>
        )}
        {category === 'broad_company' && roleNames.length > 0 && (
          <Field label="תפקיד" hint="התפקיד הוא מה שמופיע בתא של הצוער">
            <div className="tk-chips">
              {roleNames.map((r) => (
                <button key={r} type="button" className={`tk-chip${label === r ? ' on' : ''}`} style={catStyle(category)} onClick={() => setLabel(r)} aria-pressed={label === r}>
                  {r}
                </button>
              ))}
            </div>
          </Field>
        )}
        <Field label="שם ההתנסות" required>
          <input className="input" value={label} maxLength={80} onChange={(e) => typeLabel(e.target.value)} placeholder='למשל: ממ"ש שטח' />
        </Field>
        <Field label="מתי">
          <Seg
            value={inWeeks}
            onChange={(v) => {
              // beside the weeks it keeps the length it had in them
              if (v === 'out' && inWeeks === 'in') setSpan(Math.max(weekFrom, weekTo) - weekFrom + 1);
              setInWeeks(v);
            }}
            options={[
              { value: 'in', label: 'בשבועות' },
              { value: 'out', label: 'מחוץ לשבועות (עוד לא הוחלט)' },
            ]}
          />
        </Field>
        {inWeeks === 'in' ? (
          <div className="tk-row2">
            <Field label="משבוע">
              <Select
                value={weekFrom}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  setWeekFrom(v);
                  if (weekTo < v) setWeekTo(v);
                }}
                aria-label="משבוע"
              >
                {weekOptions}
              </Select>
            </Field>
            <Field label="עד שבוע">
              <Select value={Math.max(weekFrom, weekTo)} onChange={(e) => setWeekTo(Number(e.target.value))} aria-label="עד שבוע">
                {view.weeks.filter((w) => w.n >= weekFrom).map((w) => (
                  <option key={w.n} value={w.n}>
                    {`שבוע ${w.n} - ${w.title}`}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
        ) : (
          <Field label="כמה שבועות" hint="נשמר ליד השבועות, באורך הזה, עד שיוחלט מתי">
            <Select value={span} onChange={(e) => setSpan(Number(e.target.value))} aria-label="כמה שבועות">
              {view.weeks.map((_, i) => (
                <option key={i} value={i + 1}>
                  {i === 0 ? 'שבוע אחד' : `${i + 1} שבועות`}
                </option>
              ))}
            </Select>
          </Field>
        )}
        <Field label="הערות">
          <textarea className="input" rows={2} value={notes} maxLength={1000} onChange={(e) => setNotes(e.target.value)} />
        </Field>
        <ErrorBox error={error} />
        {overlap && (
          <button type="button" className="btn" onClick={() => void save(true)}>
            <Icon name="pin" /> לשמור מחוץ לשבועות בינתיים
          </button>
        )}
      </div>
    </Modal>
  );
}
