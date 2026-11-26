// A field of points, one under the other: another point is added with the button under them (or Enter at
// the end of a point), and a point added can go again. Kept as one text, a point a line - so a field that
// held free text before reads as points, and nothing written is lost.

import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Icon } from './Icon';

const toRows = (v: string) => (v ? v.split('\n') : ['']);

/** the points of a text kept this way: a point a line, empty lines left out */
export const splitPoints = (v: string | undefined) => (v ?? '').split('\n').map((s) => s.trim()).filter(Boolean);

/** points kept this way, as they read: a list */
export function PointsView({ value, className = '' }: { value: string | undefined; className?: string }) {
  return (
    <ul className={`points-view ${className}`}>
      {splitPoints(value).map((p, i) => (
        <li key={i}>{p}</li>
      ))}
    </ul>
  );
}

export function PointsInput({
  value,
  onChange,
  label,
  addLabel = 'הוספת נקודה',
  placeholder,
  max = 12,
  className = '',
}: {
  value: string;
  onChange: (v: string) => void;
  /** what the points are, for each point's name ("נקודות לשיפור 2") */
  label: string;
  addLabel?: string;
  placeholder?: string;
  max?: number;
  className?: string;
}) {
  const [rows, setRows] = useState(() => toRows(value));
  const box = useRef<HTMLDivElement>(null);
  // what this field last sent: a value from elsewhere (the recording's summary) replaces the rows, its own does not
  const sent = useRef(value);
  useEffect(() => {
    if (value === sent.current) return;
    sent.current = value;
    setRows(toRows(value));
  }, [value]);
  const emit = (next: string[]) => {
    const rowsNow = next.length ? next : [''];
    setRows(rowsNow);
    const v = rowsNow.filter((r) => r.trim()).join('\n');
    sent.current = v;
    onChange(v);
  };
  const focusRow = (i: number) => requestAnimationFrame(() => box.current?.querySelectorAll<HTMLTextAreaElement>('textarea')[i]?.focus());
  const add = (at = rows.length) => {
    if (rows.length >= max) return;
    emit([...rows.slice(0, at), '', ...rows.slice(at)]);
    focusRow(at);
  };
  const remove = (i: number) => {
    emit(rows.filter((_, j) => j !== i));
    focusRow(Math.max(0, i - 1));
  };
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>, i: number) => {
    if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
      // a point is a line: Enter starts the next one
      e.preventDefault();
      if (rows[i].trim()) add(i + 1);
    } else if (e.key === 'Backspace' && !rows[i] && rows.length > 1) {
      e.preventDefault();
      remove(i);
    }
  };
  return (
    <div className={`points-input ${className}`} ref={box}>
      {rows.map((r, i) => {
        const name = rows.length > 1 ? `${label} ${i + 1}` : label;
        return (
          <div key={i} className="points-row">
            <span className="points-bullet" aria-hidden="true">
              {i + 1}
            </span>
            <PointText
              value={r}
              aria-label={name}
              placeholder={i === 0 ? placeholder : undefined}
              enterKeyHint="next"
              onChange={(e) => {
                // a few lines pasted in: a point each
                const parts = e.target.value.split('\n');
                emit(parts.length > 1 ? [...rows.slice(0, i), ...parts, ...rows.slice(i + 1)].slice(0, max) : rows.map((x, j) => (j === i ? e.target.value : x)));
              }}
              onKeyDown={(e) => onKey(e, i)}
            />
            {rows.length > 1 && (
              <button type="button" className="icon-btn points-remove" onClick={() => remove(i)} aria-label={`הסרת ${name}`} title="הסרה">
                <Icon name="x" size={14} />
              </button>
            )}
          </div>
        );
      })}
      {rows.length < max && (
        <button type="button" className="points-add" onClick={() => add()}>
          <Icon name="plus" size={15} /> {addLabel}
        </button>
      )}
    </div>
  );
}

/** a point's text: one line that grows as it wraps */
function PointText(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight + 2}px`;
  }, [props.value]);
  return <textarea ref={ref} rows={1} {...props} className="textarea points-text" />;
}
