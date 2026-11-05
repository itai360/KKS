// A search field with an X at its end: what was typed goes in one tap, and the field keeps the focus to type
// again. The X shows only while there is something to clear.

import { useRef, type CSSProperties, type InputHTMLAttributes } from 'react';
import { Icon } from './Icon';

/** The X itself, for a field that lays itself out (the search in the top bar). */
export function ClearX({ show, onClear, label = 'ניקוי החיפוש' }: { show: boolean; onClear: () => void; label?: string }) {
  if (!show) return null;
  return (
    <button
      type="button"
      className="clear-x"
      aria-label={label}
      title={label}
      // pressed without taking the focus from the field: a list open under it stays open
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClear}
    >
      <Icon name="x" size={12} />
    </button>
  );
}

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'style'> & {
  value: string;
  onValue: (value: string) => void;
  /** the outer box's style (its width in a row) */
  style?: CSSProperties;
};

export function SearchInput({ value, onValue, className = 'input', style, ...rest }: Props) {
  const field = useRef<HTMLInputElement>(null);
  // a field that grows in its row: the box around it grows instead
  const grow = /(^|\s)grow(\s|$)/.test(className);
  return (
    <span className={`search-field${grow ? ' grow' : ''}`} style={style}>
      <input
        ref={field}
        type="search"
        {...rest}
        className={className.replace(/(^|\s)grow(?=\s|$)/g, ' ').trim()}
        value={value}
        onChange={(e) => onValue(e.target.value)}
      />
      <ClearX
        show={!!value}
        onClear={() => {
          onValue('');
          field.current?.focus();
        }}
      />
    </span>
  );
}
