// The team's planning by halves, as the planning sheet lays it out: the course's catalog of experiences
// by kind, who of the team has each one in the main plan - and which are still open. An open one is
// planned from here straight into the cadet's weeks. The commander keeps the catalog: adds, renames and
// takes out (what was planned from an entry stays, by its own name).

import { useState } from 'react';
import {
  CATEGORY_INFO,
  HALF_LABELS,
  ROLE_KIND_LABEL,
  TAKPATZ_CATEGORIES,
  TAKPATZ_HALVES,
  weekRange,
  type CatalogKind,
  type TakpatzCatalogItem,
  type TakpatzHalf,
  type TakpatzTeamView,
} from '@shared/takpatz';
import { ask } from '../Confirm';
import { Icon } from '../Icon';
import { api } from '../../lib/api';
import { catStyle, EditCell } from './common';
import type { PlacementDraft } from './PlacementEditor';

type Mutate = (fn: () => Promise<unknown>) => Promise<boolean>;

function AddItem({ half, kind, mutate }: { half: TakpatzHalf; kind: CatalogKind; mutate: Mutate }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  if (!open)
    return (
      <button type="button" className="tk-chip tk-chip-add" onClick={() => setOpen(true)}>
        <Icon name="plus" size={13} /> הוספה
      </button>
    );
  const save = async () => {
    if (!name.trim()) return setOpen(false);
    if (await mutate(() => api.post('/api/takpatz/catalog', { half, kind, name: name.trim() }))) {
      setName('');
      setOpen(false);
    }
  };
  return (
    <form
      className="tk-inline-add"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <input className="input" autoFocus value={name} maxLength={60} onChange={(e) => setName(e.target.value)} placeholder="שם ההתנסות" aria-label="שם ההתנסות החדשה" onKeyDown={(e) => e.key === 'Escape' && setOpen(false)} />
      <button type="submit" className="btn btn-primary btn-sm">
        הוספה
      </button>
    </form>
  );
}

export function Planning({ view, onPlan, mutate }: { view: TakpatzTeamView; onPlan: (d: PlacementDraft) => void; mutate: Mutate }) {
  const [managing, setManaging] = useState(false);
  const names = new Map(view.cadets.map((c) => [c.id, c.name]));
  const main = view.placements.filter((p) => p.board === 'main');
  const assigned = (item: TakpatzCatalogItem) => main.filter((p) => p.catalogId === item.id);

  const rename = (item: TakpatzCatalogItem, name: string) =>
    name && name !== item.name ? mutate(() => api.patch(`/api/takpatz/catalog/${item.id}`, { name })) : Promise.resolve(true);
  const remove = async (item: TakpatzCatalogItem) => {
    const used = assigned(item).length;
    if (!(await ask({ title: `להוציא את "${item.name}" מהמאגר?`, body: used ? `${used} שיבוצים בצוות נשארים בתכנון, בשמם.` : 'ההתנסות לא תופיע יותר לבחירה, לאף צוות.', confirm: 'הוצאה מהמאגר', danger: true }))) return;
    await mutate(() => api.del(`/api/takpatz/catalog/${item.id}`));
  };

  const open = main.length;
  const total = view.catalog.filter((x) => x.kind !== 'role').length;
  const covered = view.catalog.filter((x) => x.kind !== 'role' && assigned(x).length).length;

  return (
    <div className="tk-planning">
      <div className="tk-toolbar-row">
        <span className="muted small">
          {covered} מתוך {total} התנסויות המאגר שובצו בצוות · {open} התנסויות בתכנון הראשי
        </span>
        <span className="grow" />
        {view.canManageCatalog && (
          <button type="button" className={`btn${managing ? ' btn-primary' : ''}`} onClick={() => setManaging((m) => !m)} aria-pressed={managing}>
            <Icon name="edit" /> {managing ? 'סיום עריכת המאגר' : 'עריכת המאגר'}
          </button>
        )}
      </div>
      <div className="tk-halves">
        {TAKPATZ_HALVES.map((h) => (
          <section key={h} className="tk-half" aria-label={HALF_LABELS[h]}>
            <h2 className="tk-half-title">{HALF_LABELS[h]}</h2>
            {TAKPATZ_CATEGORIES.map((k) => {
              const items = view.catalog.filter((x) => x.half === h && x.kind === k);
              if (!items.length && !managing) return null;
              return (
                <div key={k} className="tk-block" style={catStyle(k)}>
                  <div className="tk-block-head">{h === 2 && k === 'instruct_team' ? 'הדרכתי - צוותי' : CATEGORY_INFO[k].label}</div>
                  <div className="tk-block-items">
                    {items.map((item) => {
                      const who = assigned(item);
                      return (
                        <div key={item.id} className={`tk-item${who.length ? '' : ' is-open'}`}>
                          <div className="tk-item-name">
                            {managing ? <EditCell value={item.name} label={`שם ההתנסות ${item.name}`} multiline={false} onSave={(v) => rename(item, v)} /> : <span>{item.name}</span>}
                            {managing && (
                              <span className="tk-item-tools">
                                <button type="button" className="icon-btn" onClick={() => void remove(item)} aria-label={`הוצאת ${item.name} מהמאגר`}>
                                  <Icon name="trash" size={13} />
                                </button>
                              </span>
                            )}
                          </div>
                          <div className="tk-item-who">
                            {who.map((p) => (
                              <span key={p.id} className="tk-who" title={weekRange(p.weekFrom, p.weekTo)}>
                                {names.get(p.cadetId)}
                                {p.label !== item.name && <span className="muted"> ({p.label})</span>}
                              </span>
                            ))}
                            {!who.length && <span className="tk-open-mark">טרם שובץ</span>}
                          </div>
                          <button type="button" className="tk-plan-btn" onClick={() => onPlan({ board: 'main', category: k, catalogId: item.id, label: item.name })}>
                            <Icon name="plus" size={13} /> שיבוץ
                          </button>
                        </div>
                      );
                    })}
                    {managing && <AddItem half={h} kind={k} mutate={mutate} />}
                  </div>
                </div>
              );
            })}
            {(() => {
              const roles = view.catalog.filter((x) => x.half === h && x.kind === 'role');
              if (!roles.length && !managing) return null;
              return (
                <div className="tk-roles">
                  <div className="label-caps">{ROLE_KIND_LABEL} לרוחב פלוגתי</div>
                  <div className="tk-chips">
                    {roles.map((r) => (
                      <span key={r.id} className="tk-chip static">
                        {r.name}
                        {managing && (
                          <button type="button" className="icon-btn" onClick={() => void remove(r)} aria-label={`הוצאת ${r.name}`}>
                            <Icon name="x" size={11} />
                          </button>
                        )}
                      </span>
                    ))}
                    {managing && <AddItem half={h} kind="role" mutate={mutate} />}
                  </div>
                </div>
              );
            })()}
          </section>
        ))}
      </div>
    </div>
  );
}
