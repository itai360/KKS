// Selecting several items in a list (or all of them) and acting on them at once.
// A page wraps its list in <BulkScope>, puts <BulkToggle> where the user starts
// selecting, and each row shows <BulkCheck> and toggles with useBulk() instead of
// opening while selecting. The actions go to /api/bulk in one request (see
// server/src/bulk.ts), which reports items that could not be changed.

import { createContext, useContext, useEffect, useMemo, useRef, useState, type HTMLAttributes, type ReactNode } from 'react';
import { api } from '../lib/api';
import { quickDelete, useRemoving } from '../lib/quickDelete';
import { emitLocalChange } from '../lib/realtime';
import { Icon } from './Icon';
import { usePhonePicker } from './pickers';
import { useSwipeAction } from './swipeAction';
import { useToast } from './Toasts';
import { ErrorBox, Field, Modal, openable, Select } from './ui';
import { ask } from './Confirm';

export interface BulkAction {
  /** the server action (see OPS in server/src/bulk.ts) */
  key: string;
  label: string;
  icon?: string;
  danger?: boolean;
  /** asked before running; {n} is the number of items */
  confirm?: string;
  /** a value to choose before running */
  ask?: { title: string; label: string; options?: { value: string; label: string }[]; type?: 'number' | 'text'; placeholder?: string; initial?: string };
  /** a fixed value sent with the action */
  value?: string | number | boolean | null;
  /** hidden unless true */
  show?: boolean;
}

interface BulkState {
  active: boolean;
  setActive: (v: boolean) => void;
  selected: Set<number>;
  toggle: (id: number) => void;
  /** one item deleted at once from its row (swipe, trash, Delete), with a moment to bring it back - where the list deletes */
  quick: null | { entity: string; topics: string[]; allowed: (id: number) => boolean; idsOf: (id: number) => number[] };
}

const Ctx = createContext<BulkState | null>(null);

/** The selection of the surrounding list, or null outside one. */
export function useBulk(): BulkState | null {
  return useContext(Ctx);
}

export function BulkScope({
  entity,
  ids,
  actions,
  noun,
  topics = ['*'],
  quickDelete: quick = true,
  deletable,
  expand,
  children,
}: {
  entity: string;
  ids: number[];
  actions: BulkAction[];
  /** what the items are called, plural: "משימות" */
  noun: string;
  topics?: string[];
  /** false: deleting goes only through selecting and a question (people's records - cadets, teams) */
  quickDelete?: boolean;
  /** the items one may delete, when not all of the list (a task: its creator, or the commander) */
  deletable?: number[];
  /** the items an action reaches, when a row stands for more than itself (a task's copies, one for each person) */
  expand?: (action: string, ids: number[]) => number[];
  children: ReactNode;
}) {
  const toast = useToast();
  const [active, setActiveRaw] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [asking, setAsking] = useState<BulkAction | null>(null);
  const [busy, setBusy] = useState(false);
  const idKey = ids.join(',');

  // items that left the list (deleted, filtered out) leave the selection
  useEffect(() => {
    const present = new Set(ids);
    setSelected((prev) => {
      const next = new Set([...prev].filter((id) => present.has(id)));
      return next.size === prev.size ? prev : next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idKey]);

  const setActive = (v: boolean) => {
    setActiveRaw(v);
    if (!v) setSelected(new Set());
  };
  const toggle = (id: number) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const all = ids.length > 0 && ids.every((id) => selected.has(id));

  const run = async (a: BulkAction, value?: string | number | boolean | null) => {
    const list = [...selected];
    if (!list.length) return;
    if (a.confirm && !(await ask({ title: a.confirm.replace('{n}', String(list.length)), confirm: a.label, danger: a.danger }))) return;
    const reach = expand ? expand(a.key, list) : list;
    if (!reach.length) return toast({ title: `${a.label} לא חל על מה שנבחר`, tone: 'orange' });
    setBusy(true);
    try {
      const r = await api.post<{ done: number; failed: { id: number; error: string }[] }>('/api/bulk', { entity, action: a.key, ids: reach, value: value ?? a.value });
      emitLocalChange(...topics);
      if (r.failed.length) {
        const reasons = [...new Set(r.failed.map((f) => f.error))].join('; ');
        toast({ title: `${a.label}: ${r.done} בוצעו, ${r.failed.length} לא`, body: reasons, tone: r.done ? 'orange' : 'red' });
        // what failed stays selected - the rows it was reached through
        const failed = new Set(r.failed.map((f) => f.id));
        setSelected(new Set(list.filter((id) => (expand ? expand(a.key, [id]) : [id]).some((x) => failed.has(x)))));
      } else {
        toast({ title: `${a.label}: ${list.length} ${noun}`, tone: 'green' });
        setActive(false);
      }
    } catch (e) {
      toast({ title: (e as Error).message, tone: 'red' });
    } finally {
      setBusy(false);
    }
  };

  // deleting one item from its row: where the list deletes, and only items it would delete
  const canDelete = quick && actions.some((a) => a.key === 'delete' && a.show !== false);
  const deletableKey = deletable?.join(',');
  const quickState = useMemo(() => {
    if (!canDelete) return null;
    const own = new Set((deletableKey ?? idKey).split(',').filter(Boolean).map(Number));
    return { entity, topics, allowed: (id: number) => own.has(id), idsOf: (id: number) => (expand ? expand('delete', [id]) : [id]) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canDelete, entity, idKey, deletableKey, topics.join(','), expand]);
  const value = useMemo<BulkState>(() => ({ active, setActive, selected, toggle, quick: quickState }), [active, selected, quickState]);
  const shown = actions.filter((a) => a.show !== false);

  return (
    <Ctx.Provider value={value}>
      {children}
      {active && (
        <div className="bulk-bar" role="toolbar" aria-label="פעולות על הנבחרים">
          <label className="row gap-6 small strong">
            <input type="checkbox" checked={all} onChange={() => setSelected(all ? new Set() : new Set(ids))} />
            {all ? 'בטל הכל' : 'סמן הכל'}
          </label>
          <span className="small muted">
            {selected.size} מתוך {ids.length} נבחרו
          </span>
          <span className="grow" />
          {shown.map((a) => (
            <button
              key={`${a.key}:${String(a.value)}`}
              className={`btn btn-sm${a.danger ? ' text-red' : ''}`}
              disabled={busy || !selected.size}
              onClick={() => (a.ask ? setAsking(a) : void run(a))}
            >
              {a.icon && <Icon name={a.icon} />} {a.label}
            </button>
          ))}
          <button className="btn btn-sm btn-ghost" onClick={() => setActive(false)}>
            סיום
          </button>
        </div>
      )}
      {asking && (
        <AskDialog
          action={asking}
          count={selected.size}
          onClose={() => setAsking(null)}
          onApply={(v) => {
            setAsking(null);
            void run(asking, v);
          }}
        />
      )}
    </Ctx.Provider>
  );
}

/** The button that starts and ends selecting. */
export function BulkToggle({ label = 'בחירה' }: { label?: string }) {
  const b = useBulk();
  if (!b) return null;
  return (
    <button className={`btn${b.active ? ' btn-primary' : ''}`} onClick={() => b.setActive(!b.active)} aria-pressed={b.active}>
      <Icon name="check" /> {b.active ? 'סיום בחירה' : label}
    </button>
  );
}

/** A row's checkbox, shown while selecting. */
export function BulkCheck({ id }: { id: number }) {
  const b = useBulk();
  if (!b?.active) return null;
  return (
    <input
      type="checkbox"
      className="bulk-check"
      checked={b.selected.has(id)}
      onChange={() => b.toggle(id)}
      onClick={(e) => e.stopPropagation()}
      aria-label="בחירה"
    />
  );
}

/** A row's click: toggles while selecting, otherwise does what it always did. */
export function bulkClick(b: BulkState | null, id: number, otherwise: () => void): () => void {
  return () => (b?.active ? b.toggle(id) : otherwise());
}

/**
 * A row of a list that can be acted on in place: on a phone, swiped toward its trailing side (right)
 * it is deleted, and toward its leading side (left) it is done - when given that; on a computer, a
 * trash shows on the row under the pointer, and the Delete key deletes the row in focus. Deleting asks
 * nothing: the row folds away, and a message offers to bring it back until the deletion is sent.
 */
export function SwipeRow({ itemId, label, done, children, className = '' }: { itemId: number; label: string; done?: { label: string; run: () => void } | null; children: ReactNode; className?: string }) {
  const b = useBulk();
  const toast = useToast();
  const q = b?.quick && b.quick.allowed(itemId) ? b.quick : null;
  const removing = useRemoving(b?.quick?.entity, itemId);
  // folded away: out of the page a moment later, once its fold has played
  const [gone, setGone] = useState(false);
  useEffect(() => {
    if (!removing) return setGone(false);
    const t = setTimeout(() => setGone(true), 340);
    return () => clearTimeout(t);
  }, [removing]);
  const remove = () => q && quickDelete({ entity: q.entity, id: itemId, ids: q.idsOf(itemId), label, topics: q.topics, toast });
  const row = useRef<HTMLDivElement>(null);
  const phone = usePhonePicker();
  useSwipeAction(row, { enabled: phone && !b?.active && !removing && (!!q || !!done), lead: done?.run, trail: q ? remove : undefined });
  return (
    <div
      className={`swipe-wrap${removing ? ' is-removing' : ''}${className ? ` ${className}` : ''}`}
      hidden={gone}
      onKeyDown={(e) => {
        if (e.key !== 'Delete' || !q || b?.active || (e.target as HTMLElement).closest('input, textarea, select, [contenteditable="true"]')) return;
        e.preventDefault();
        remove();
      }}
    >
      {done && (
        <div className="swipe-pad is-lead" aria-hidden="true">
          <Icon name="check" size={20} />
          <span>{done.label}</span>
        </div>
      )}
      {q && (
        <div className="swipe-pad is-trail" aria-hidden="true">
          <Icon name="trash" size={19} />
          <span>מחיקה</span>
        </div>
      )}
      <div className="swipe-row" ref={row}>
        {children}
        {q && !b?.active && (
          <button
            type="button"
            className="quick-del no-print"
            aria-label={`מחיקה: ${label}`}
            title="מחיקה (Delete)"
            onClick={(e) => {
              e.stopPropagation();
              remove();
            }}
          >
            <Icon name="trash" size={15} />
          </button>
        )}
      </div>
    </div>
  );
}

/** A row that opens on click, and toggles while selecting - deleted in place where its list deletes. */
export function BulkRow({ itemId, label = 'הפריט', onOpen, className = '', children, ...rest }: { itemId: number; label?: string; onOpen?: () => void; className?: string; children: ReactNode } & Omit<HTMLAttributes<HTMLDivElement>, 'onClick' | 'id'>) {
  const b = useBulk();
  return (
    <SwipeRow itemId={itemId} label={label}>
      <div
        {...(onOpen ? openable(() => (b?.active ? b.toggle(itemId) : onOpen())) : {})}
        {...rest}
        className={`${className}${b?.selected.has(itemId) ? ' selected' : ''}`}
        onClick={b?.active ? () => b.toggle(itemId) : onOpen}
      >
        {children}
      </div>
    </SwipeRow>
  );
}

function AskDialog({ action, count, onClose, onApply }: { action: BulkAction; count: number; onClose: () => void; onApply: (v: string | number) => void }) {
  const ask = action.ask!;
  const [value, setValue] = useState(ask.initial ?? ask.options?.[0]?.value ?? '');
  const [error, setError] = useState<string | null>(null);
  const apply = () => {
    if (ask.type === 'number') {
      const n = Number(value);
      if (!Number.isInteger(n) || n === 0) return setError('יש לכתוב מספר שלם (אפשר שלילי)');
      return onApply(n);
    }
    onApply(value);
  };
  return (
    <Modal
      title={`${ask.title} (${count})`}
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-primary" onClick={apply}>
            {action.label}
          </button>
          <button className="btn btn-ghost" onClick={onClose}>
            ביטול
          </button>
        </>
      }
    >
      <Field label={ask.label}>
        {ask.options ? (
          <Select className="select" value={value} onChange={(e) => setValue(e.target.value)} data-autofocus>
            {ask.options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        ) : (
          <input className="input" type={ask.type === 'number' ? 'number' : 'text'} value={value} onChange={(e) => setValue(e.target.value)} placeholder={ask.placeholder} data-autofocus />
        )}
      </Field>
      <ErrorBox error={error} />
    </Modal>
  );
}
