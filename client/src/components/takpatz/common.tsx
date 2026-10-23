// What the takpatz's screens share: the kinds' colors, a text cell edited where it stands, a stage's
// status as a pill, and the line that says everything typed is kept.

import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import { CATEGORY_INFO, STATUS_LABELS, type StageStatus, type TakpatzCategory } from '@shared/takpatz';
import { formatAgo } from '@shared/dates';
import { Icon } from '../Icon';

/** a kind's three shades as CSS variables, for a chip, a bar or a block of the planning */
export const catStyle = (c: TakpatzCategory): CSSProperties =>
  ({ '--cat-dark': CATEGORY_INFO[c].dark, '--cat-mid': CATEGORY_INFO[c].mid, '--cat-light': CATEGORY_INFO[c].light }) as CSSProperties;

export function CategoryDot({ category }: { category: TakpatzCategory }) {
  return <span className="tk-dot" style={catStyle(category)} aria-hidden="true" />;
}

/**
 * A text kept as it is typed: shown as text, a click (or Enter) opens it for writing, and leaving it -
 * or Enter - saves; Escape gives up the change. Shift+Enter starts a new line.
 */
export function EditCell({
  value,
  onSave,
  placeholder,
  label,
  multiline = true,
  disabled,
  className = '',
}: {
  value: string;
  onSave: (v: string) => Promise<unknown> | void;
  placeholder?: string;
  label: string;
  multiline?: boolean;
  disabled?: boolean;
  className?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [shown, setShown] = useState(value);
  const ref = useRef<HTMLTextAreaElement>(null);
  // what the server holds now replaces what is shown - only when it changes, so a saved text is not
  // put back to the one before while the screen catches up
  const known = useRef(value);
  useEffect(() => {
    if (value === known.current || editing) return;
    known.current = value;
    setShown(value);
    setDraft(value);
  }, [value, editing]);
  useEffect(() => {
    if (!editing) return;
    const el = ref.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, [editing]);
  const fit = () => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  };
  useEffect(fit, [editing, draft]);
  const commit = async () => {
    setEditing(false);
    const next = draft.trim();
    if (next === shown.trim()) return;
    const was = shown;
    setShown(next);
    try {
      // a save that did not go through (false, or an error) puts back what was there
      if ((await onSave(next)) === false) setShown(was);
    } catch {
      setShown(was);
    }
  };
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      setDraft(shown);
      setEditing(false);
    } else if (e.key === 'Enter' && (!multiline || !e.shiftKey)) {
      e.preventDefault();
      void commit();
    }
  };
  if (editing)
    return (
      <textarea
        ref={ref}
        className={`tk-edit-field ${className}`}
        value={draft}
        rows={1}
        aria-label={label}
        maxLength={2000}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => void commit()}
        onKeyDown={onKey}
      />
    );
  return (
    <button type="button" className={`tk-edit ${shown ? '' : 'is-empty'} ${className}`} disabled={disabled} onClick={() => setEditing(true)} aria-label={`${label}: ${shown || 'ריק'}`} title={disabled ? undefined : 'לחיצה לעריכה'}>
      {shown || <span className="tk-placeholder">{placeholder ?? '+'}</span>}
    </button>
  );
}

const STATUS_ICON: Record<StageStatus, string> = { done: 'check', set: 'clock', unset: 'x' };

/** a stage's status, as the spreadsheet's list says it */
export function StatusPill({ status, small }: { status: StageStatus | null; small?: boolean }) {
  if (!status) return <span className={`tk-status is-none${small ? ' sm' : ''}`}>-</span>;
  return (
    <span className={`tk-status is-${status}${small ? ' sm' : ''}`}>
      <Icon name={STATUS_ICON[status]} size={small ? 11 : 13} />
      {STATUS_LABELS[status]}
    </span>
  );
}

/** "everything is kept": what is being saved now, or when the last change was kept */
export function SaveState({ saving, savedAt }: { saving: number; savedAt: string | null }) {
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 30_000);
    return () => clearInterval(t);
  }, []);
  if (saving) return <span className="tk-save is-saving" role="status">שומר...</span>;
  if (!savedAt) return null;
  return (
    <span className="tk-save" role="status">
      <Icon name="check" size={13} /> נשמר {formatAgo(savedAt)}
    </span>
  );
}
