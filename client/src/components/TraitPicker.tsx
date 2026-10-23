// Choosing the traits a remark names (the catalog: shared/evaluationTraits.ts): the axis, then its sub-axis
// (חוסן has none - its traits come at once), then the traits there, one or several, with a quick filter -
// and words on them if wanted. Another group adds traits of another sub-axis or axis; a search over the
// whole catalog finds a trait by its name and opens its place. Only the catalog's own combinations can be
// chosen, and a sub-axis already chosen in one group is not offered in another.
//
// Shown once written: each group's place and its traits as tags, the words under them - and, over a whole
// file, every trait named with how many times.

import { useId, useMemo, useRef, useState } from 'react';
import { matchesSearch } from '@shared/search';
import { ALL_TRAITS, groupPlace, groupProblem, TRAIT_AXES, traitAxis, traitName, traitSubAxis, traitsUnder, type TraitGroup } from '@shared/evaluationTraits';
import { Icon } from './Icon';

/** a group being chosen: its traits by id */
export interface DraftGroup {
  key: number;
  axis: string;
  sub: string | null;
  traits: string[];
  text: string;
}

let nextKey = 1;
export const emptyGroup = (): DraftGroup => ({ key: nextKey++, axis: '', sub: null, traits: [], text: '' });
/** groups as saved, to choose again */
export const draftGroups = (groups: readonly TraitGroup[]): DraftGroup[] => groups.map((g) => ({ key: nextKey++, axis: g.axis, sub: g.sub, traits: g.traits.map((t) => t.id), text: g.text }));
/** what is sent: the groups begun (an axis chosen) */
export const sentGroups = (groups: readonly DraftGroup[]) => groups.filter((g) => g.axis).map(({ axis, sub, traits, text }) => ({ axis, sub, traits, text }));
/** the first thing still missing in the groups begun (null: none) */
export const groupsProblem = (groups: readonly DraftGroup[]) => sentGroups(groups).map(groupProblem).find(Boolean) ?? null;
/** a group with its traits chosen */
export const groupDone = (g: DraftGroup) => !!g.axis && !groupProblem(g);

/** each axis' colour, the same wherever it shows */
export const AXIS_TONE: Record<string, string> = { military: 't-blue', values: 't-green', leadership: 't-purple', resilience: 't-orange' };

const place = (g: Pick<DraftGroup, 'axis' | 'sub'>) => `${g.axis}|${g.sub ?? ''}`;

export function TraitPicker({ groups, onChange }: { groups: DraftGroup[]; onChange: (groups: DraftGroup[]) => void }) {
  // none yet: one empty group, the same one from render to render
  const blank = useRef<DraftGroup | null>(null);
  blank.current ??= emptyGroup();
  const shown = groups.length ? groups : [blank.current];
  const set = (i: number, g: DraftGroup) => onChange(shown.map((x, j) => (j === i ? g : x)));
  const remove = (i: number) => onChange(shown.length > 1 ? shown.filter((_, j) => j !== i) : [emptyGroup()]);
  // a trait found by the search: into the group of its place if there is one, else this group takes its place
  const pick = (i: number, axis: string, sub: string | null, trait: string) => {
    const j = shown.findIndex((x, k) => k !== i && place(x) === place({ axis, sub }));
    if (j >= 0) onChange(shown.map((x, k) => (k === j && !x.traits.includes(trait) ? { ...x, traits: [...x.traits, trait] } : x)));
    else set(i, { ...shown[i], axis, sub, traits: [trait] });
  };
  const taken = (i: number) => new Set(shown.filter((_, j) => j !== i && shown[j].axis).map(place));
  const allDone = shown.every(groupDone);
  return (
    <div className="tp">
      {shown.map((g, i) => (
        <GroupEditor key={g.key} group={g} n={i + 1} many={shown.length > 1} taken={taken(i)} onChange={(x) => set(i, x)} onRemove={() => remove(i)} onPick={(a, s, t) => pick(i, a, s, t)} />
      ))}
      {allDone && (
        <button type="button" className="tp-add" onClick={() => onChange([...shown, emptyGroup()])}>
          <Icon name="plus" size={15} /> מאפיינים מציר או מתת ציר נוסף
        </button>
      )}
    </div>
  );
}

function GroupEditor({
  group: g,
  n,
  many,
  taken,
  onChange,
  onRemove,
  onPick,
}: {
  group: DraftGroup;
  n: number;
  many: boolean;
  taken: Set<string>;
  onChange: (g: DraftGroup) => void;
  onRemove: () => void;
  onPick: (axis: string, sub: string | null, trait: string) => void;
}) {
  const id = useId();
  const axis = traitAxis(g.axis);
  const sub = traitSubAxis(axis, g.sub);
  const needsSub = !!axis && axis.subAxes.length > 0 && !sub;
  const options = axis && !needsSub ? traitsUnder(g.axis, g.sub) : [];
  const [filter, setFilter] = useState('');
  const [search, setSearch] = useState('');
  const found = useMemo(() => (search.trim() ? ALL_TRAITS.filter((t) => matchesSearch(search, t.trait.name)).slice(0, 14) : []), [search]);
  const toggle = (trait: string) => onChange({ ...g, traits: g.traits.includes(trait) ? g.traits.filter((t) => t !== trait) : [...g.traits, trait] });
  const tone = AXIS_TONE[g.axis] ?? '';
  const filtered = options.filter((t) => matchesSearch(filter, t.name));
  return (
    <fieldset className={`tp-group ${tone}`} aria-labelledby={`${id}-legend`}>
      <div className="tp-head">
        <span id={`${id}-legend`} className="tp-place">
          {many && <span className="tp-n">{n}</span>}
          {axis ? (
            <>
              <button type="button" className="tp-crumb" onClick={() => onChange({ ...g, axis: '', sub: null, traits: [] })} title="בחירת ציר אחר">
                {axis.name}
              </button>
              {sub && (
                <>
                  <Icon name="chevronLeft" size={13} />
                  <button type="button" className="tp-crumb" onClick={() => onChange({ ...g, sub: null, traits: [] })} title="בחירת תת ציר אחר">
                    {sub.name}
                  </button>
                </>
              )}
            </>
          ) : (
            <span>בחירת ציר</span>
          )}
        </span>
        {(many || g.axis) && (
          <button type="button" className="icon-btn tp-remove" onClick={onRemove} aria-label={many ? `הסרת קבוצה ${n}` : 'ניקוי הבחירה'} title={many ? 'הסרת הקבוצה' : 'ניקוי הבחירה'}>
            <Icon name="x" size={15} />
          </button>
        )}
      </div>

      {!axis && (
        <>
          <div className="tp-search">
            <Icon name="search" size={16} />
            <input className="input" type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="חיפוש מאפיין בכל הצירים" aria-label="חיפוש מאפיין בכל הצירים" data-transient />
          </div>
          {search.trim() ? (
            found.length ? (
              <ul className="tp-found" aria-label="מאפיינים שנמצאו">
                {found.map((t) => (
                  <li key={t.trait.id}>
                    <button type="button" onClick={() => (onPick(t.axis.id, t.sub?.id ?? null, t.trait.id), setSearch(''))}>
                      <span className={`tp-dot ${AXIS_TONE[t.axis.id]}`} aria-hidden="true" />
                      <b>{t.trait.name}</b>
                      <span className="tiny muted">{groupPlace({ axis: t.axis.id, sub: t.sub?.id ?? null })}</span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="small muted tp-none">לא נמצא מאפיין בשם הזה.</p>
            )
          ) : (
            <div className="tp-axes" role="group" aria-label="ציר הערכה">
              {TRAIT_AXES.map((a) => {
                const count = a.subAxes.length ? a.subAxes.reduce((s, x) => s + x.traits.length, 0) : a.traits.length;
                const full = !a.subAxes.length && taken.has(`${a.id}|`);
                return (
                  <button key={a.id} type="button" className={`tp-axis ${AXIS_TONE[a.id]}`} disabled={full} onClick={() => onChange({ ...g, axis: a.id, sub: null, traits: [] })}>
                    <b>{a.name}</b>
                    <span className="tiny">{full ? 'נבחר בקבוצה אחרת' : a.subAxes.length ? `${a.subAxes.length} תתי צירים` : `${count} מאפיינים`}</span>
                  </button>
                );
              })}
            </div>
          )}
        </>
      )}

      {needsSub && (
        <div className="tp-subs" role="group" aria-label={`תת ציר ב${axis.name}`}>
          {axis.subAxes.map((s) => {
            const used = taken.has(`${axis.id}|${s.id}`);
            return (
              <button key={s.id} type="button" className="tp-sub" disabled={used} title={used ? 'נבחר בקבוצה אחרת' : undefined} onClick={() => onChange({ ...g, sub: s.id, traits: [] })}>
                {s.name}
                <span className="tiny muted">{used ? 'נבחר' : s.traits.length}</span>
              </button>
            );
          })}
        </div>
      )}

      {options.length > 0 && (
        <>
          {g.traits.length > 0 && (
            <div className="tp-chosen" aria-label="מאפיינים שנבחרו">
              {g.traits.map((t) => (
                <button key={t} type="button" className="tp-chip on" onClick={() => toggle(t)} aria-label={`הסרת ${traitName({ id: t, name: t })}`}>
                  {traitName({ id: t, name: t })}
                  <Icon name="x" size={12} />
                </button>
              ))}
            </div>
          )}
          {options.length > 8 && (
            <div className="tp-search tp-filter">
              <Icon name="search" size={15} />
              <input className="input" type="search" value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="סינון המאפיינים" aria-label="סינון המאפיינים" data-transient />
            </div>
          )}
          <div className="tp-options" role="group" aria-label={`מאפיינים ב${groupPlace(g)}`}>
            {filtered.map((t) => {
              const on = g.traits.includes(t.id);
              return (
                <button key={t.id} type="button" className={`tp-chip${on ? ' on' : ''}`} aria-pressed={on} onClick={() => toggle(t.id)}>
                  {on && <Icon name="check" size={13} />}
                  {t.name}
                </button>
              );
            })}
            {!filtered.length && <span className="small muted">אין מאפיין כזה כאן.</span>}
          </div>
          {!g.traits.length && <p className="tiny muted tp-hint">בחרו מאפיין אחד או יותר.</p>}
          <label className="field tp-text">
            <span>התייחסות (לא חובה)</span>
            <textarea className="textarea" rows={2} value={g.text} maxLength={4000} onChange={(e) => onChange({ ...g, text: e.target.value })} placeholder="מה נראה, מתי ובאיזה הקשר" />
          </label>
        </>
      )}
    </fieldset>
  );
}

/** the traits of a remark: each group's place, its traits as tags, the words on them */
export function TraitGroupsView({ groups }: { groups: readonly TraitGroup[] }) {
  if (!groups.length) return null;
  return (
    <div className="tp-view">
      {groups.map((g) => (
        <div key={`${g.axis}|${g.sub ?? ''}`} className={`tp-view-group ${AXIS_TONE[g.axis] ?? ''}`}>
          <div className="tp-view-place">
            <span className="tp-dot" aria-hidden="true" />
            {groupPlace(g).replace(' · ', ' › ')}
          </div>
          <ul className="tp-tags" aria-label={`מאפיינים ב${groupPlace(g)}`}>
            {g.traits.map((t) => (
              <li key={t.id} className="tp-tag">
                {traitName(t)}
              </li>
            ))}
          </ul>
          {g.text && <div className="eval-readonly tp-view-text">{g.text}</div>}
        </div>
      ))}
    </div>
  );
}

/** every trait named in the file's remarks, by axis and sub-axis, with how many times */
export function TraitSummary({ notes }: { notes: readonly { traits: readonly TraitGroup[] }[] }) {
  const counted = new Map<string, number>();
  for (const n of notes) for (const g of n.traits) for (const t of g.traits) counted.set(t.id, (counted.get(t.id) ?? 0) + 1);
  if (!counted.size) return null;
  const known = ALL_TRAITS.filter((t) => counted.has(t.trait.id));
  // by axis, then by sub-axis, in the catalog's order
  const byAxis = TRAIT_AXES.map((a) => ({ a, items: known.filter((t) => t.axis.id === a.id) })).filter((x) => x.items.length);
  return (
    <section className="tp-summary" aria-label="המאפיינים שתועדו בתיק">
      <div className="label-caps">המאפיינים שתועדו בתיק</div>
      {byAxis.map(({ a, items }) => {
        const subs = a.subAxes.length ? a.subAxes.map((x) => ({ name: x.name, items: items.filter((t) => t.sub?.id === x.id) })).filter((x) => x.items.length) : [{ name: '', items }];
        return (
          <div key={a.id} className={`tp-summary-axis ${AXIS_TONE[a.id]}`}>
            <b className="small tp-summary-name">
              <span className="tp-dot" aria-hidden="true" />
              {a.name}
            </b>
            {subs.map((x) => (
              <div key={x.name} className="tp-summary-sub">
                {x.name && <span className="tiny muted">{x.name}</span>}
                <ul className="tp-tags">
                  {x.items.map((t) => (
                    <li key={t.trait.id} className="tp-tag">
                      {t.trait.name}
                      {(counted.get(t.trait.id) ?? 0) > 1 && <span className="tp-count">×{counted.get(t.trait.id)}</span>}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        );
      })}
    </section>
  );
}
