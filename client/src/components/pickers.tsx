// Picking from a list, a time and a date - the same way on every screen and every device. A click opens
// the whole list (or the calendar) and typing narrows it, with the keyboard working throughout. The
// browser's own controls follow the device's language - AM/PM, month before day, left to right - so these
// are Hebrew and right to left, with 24-hour times and day.month.year dates, everywhere.

import {
  Children,
  Fragment,
  isValidElement,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
} from 'react';
import { createPortal } from 'react-dom';
import { WEEKDAY_NAMES } from '@shared/constants';
import { addDays, fmtDateIL, parseDateIL, parseTime, shapeDate, shapeTime, weekdayOf } from '@shared/dates';
import { searchKey } from '@shared/search';
import { todayKey } from '../lib/format';
import { Icon } from './Icon';

// ---------------- the floating layer ----------------

/** under its field - above it when there is no room below - with the right edges aligned, as the page reads */
/**
 * The highlighted option is brought into view inside its list only - never by moving the page (the
 * browser's own scrollIntoView would scroll the page too, to wherever the list stands at that moment)
 */
function revealOption(el: HTMLElement | null): void {
  const box = el?.closest<HTMLElement>('.pop');
  if (!el || !box) return;
  const top = el.getBoundingClientRect().top - box.getBoundingClientRect().top + box.scrollTop;
  const bottom = top + el.offsetHeight;
  if (top < box.scrollTop) box.scrollTop = top;
  else if (bottom > box.scrollTop + box.clientHeight) box.scrollTop = bottom - box.clientHeight;
}

function usePlacement(anchor: RefObject<HTMLElement | null>, open: boolean, want: number, width?: number): CSSProperties {
  const [style, setStyle] = useState<CSSProperties>({ visibility: 'hidden' });
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const el = anchor.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const vw = document.documentElement.clientWidth;
      const vh = window.innerHeight;
      const below = vh - r.bottom - 10;
      const above = r.top - 10;
      // open upward when the whole of it fits better there
      const up = below < want && above > below;
      const w = Math.min(width ?? Math.max(r.width, 200), vw - 16);
      const right = Math.min(Math.max(8, vw - r.right), vw - w - 8);
      setStyle({ position: 'fixed', right, width: w, maxHeight: Math.max(140, Math.min(want, up ? above : below)), ...(up ? { bottom: vh - r.top + 4 } : { top: r.bottom + 4 }) });
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open, anchor, want, width]);
  return style;
}

function Layer({
  anchor,
  open,
  onDismiss,
  want = 300,
  width,
  className,
  children,
  keepFocus = true,
}: {
  anchor: RefObject<HTMLElement | null>;
  open: boolean;
  onDismiss: () => void;
  want?: number;
  width?: number;
  className: string;
  children: ReactNode;
  /** a click inside leaves the focus where it is (in the field) */
  keepFocus?: boolean;
}) {
  const style = usePlacement(anchor, open, want, width);
  const ref = useRef<HTMLDivElement>(null);
  const dismiss = useRef(onDismiss);
  dismiss.current = onDismiss;
  useEffect(() => {
    if (!open) return;
    const down = (e: Event) => {
      const t = e.target as Node;
      if (ref.current?.contains(t) || anchor.current?.contains(t)) return;
      dismiss.current();
    };
    document.addEventListener('mousedown', down, true);
    document.addEventListener('touchstart', down, true);
    return () => {
      document.removeEventListener('mousedown', down, true);
      document.removeEventListener('touchstart', down, true);
    };
  }, [open, anchor]);
  if (!open) return null;
  return createPortal(
    <div ref={ref} className={`pop ${className}`} style={style} dir="rtl" tabIndex={0} onMouseDown={keepFocus ? (e) => e.preventDefault() : undefined}>
      {children}
    </div>,
    document.body,
  );
}

const CHEVRON = 'combo-input';

// ---------------- a list to pick from ----------------

type Opt = { value: string; label: string; disabled: boolean; group?: string };

const textOf = (n: ReactNode): string => {
  if (n === null || n === undefined || typeof n === 'boolean') return '';
  if (typeof n === 'string' || typeof n === 'number') return String(n);
  if (Array.isArray(n)) return n.map(textOf).join('');
  if (isValidElement(n)) return textOf((n.props as { children?: ReactNode }).children);
  return '';
};

/** the <option>s written inside, as a browser's <select> would read them */
function optionsOf(children: ReactNode, group?: string, out: Opt[] = []): Opt[] {
  Children.forEach(children, (ch) => {
    if (!isValidElement(ch)) return;
    const props = ch.props as { children?: ReactNode; value?: unknown; disabled?: boolean; label?: string };
    if (ch.type === Fragment) optionsOf(props.children, group, out);
    else if (ch.type === 'optgroup') optionsOf(props.children, props.label, out);
    else if (ch.type === 'option') {
      const label = textOf(props.children).replace(/\s+/g, ' ').trim();
      out.push({ value: props.value === undefined || props.value === null ? label : String(props.value), label, disabled: !!props.disabled, group });
    }
  });
  return out;
}

export interface SelectProps {
  value: string | number | null | undefined;
  /** shaped like a <select>'s change event, so `e.target.value` reads the same */
  onChange?: (e: { target: { value: string } }) => void;
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
  disabled?: boolean;
  required?: boolean;
  id?: string;
  title?: string;
  'aria-label'?: string;
  'aria-invalid'?: boolean;
  'data-autofocus'?: boolean;
  /** as wide as the choice shown (a pill), not the whole row */
  fit?: boolean;
  /**
   * typing narrows the list (the default for a long list); a short one (up to six choices, like a
   * status) is only tapped - no keyboard comes up on a phone
   */
  searchable?: boolean;
}

/**
 * Instead of a <select>, with the same <option>s inside: a click opens the whole list, typing narrows it
 * (מפק"צ, מפק״צ and מפקצ find the same), arrows and Enter pick, Escape closes - even inside a dialog.
 */
export function Select({ value, onChange, children, className = 'select', style, disabled, required, id, title, 'aria-label': ariaLabel, 'aria-invalid': ariaInvalid, 'data-autofocus': autofocus, fit, searchable }: SelectProps) {
  const opts = useMemo(() => optionsOf(children), [children]);
  const typing = searchable ?? opts.length > 6;
  const current = value === null || value === undefined ? '' : String(value);
  const chosen = opts.find((o) => o.value === current);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState<string | null>(null);
  const [active, setActive] = useState(-1);
  const field = useRef<HTMLElement>(null);
  const listId = useId();
  const shown = useMemo(() => {
    const words = query ? searchKey(query).split(/\s+/).filter(Boolean) : [];
    if (!words.length) return opts;
    return opts.filter((o) => {
      const k = searchKey(`${o.label} ${o.group ?? ''}`);
      return words.every((w) => k.includes(w));
    });
  }, [opts, query]);
  const firstEnabled = (list: Opt[], from = 0, dir = 1) => {
    for (let i = from, n = 0; n < list.length; i = (i + dir + list.length) % list.length, n++) if (!list[i].disabled) return i;
    return -1;
  };
  useEffect(() => {
    if (open && query !== null) setActive(firstEnabled(shown));
  }, [query, open, shown]);
  useEffect(() => {
    if (open && active >= 0) revealOption(document.getElementById(`${listId}-${active}`));
  }, [open, active, listId]);

  const openAll = () => {
    if (disabled || open) return;
    setQuery(null);
    setActive(Math.max(0, opts.findIndex((o) => o.value === current)));
    setOpen(true);
  };
  const close = () => {
    setOpen(false);
    setQuery(null);
  };
  const choose = (o: Opt) => {
    if (o.disabled) return;
    if (o.value !== current) onChange?.({ target: { value: o.value } });
    close();
  };
  const onKey = (e: KeyboardEvent<HTMLElement>) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!open) return openAll();
      const dir = e.key === 'ArrowDown' ? 1 : -1;
      setActive((a) => firstEnabled(shown, a < 0 ? 0 : (a + dir + shown.length) % shown.length, dir));
    } else if (open && (e.key === 'Home' || e.key === 'End') && query === null) {
      e.preventDefault();
      setActive(e.key === 'Home' ? firstEnabled(shown) : firstEnabled(shown, shown.length - 1, -1));
    } else if (e.key === 'Enter') {
      if (!open) return;
      e.preventDefault();
      if (shown[active]) choose(shown[active]);
      else close();
    } else if (e.key === 'Escape') {
      if (!open) return;
      // only the list closes - not the dialog around it
      e.preventDefault();
      e.stopPropagation();
      close();
    } else if (e.key === 'Tab') {
      if (open && query && shown[active]) choose(shown[active]);
      else close();
    }
  };

  let lastGroup: string | undefined;
  const common = {
    id,
    style,
    role: 'combobox' as const,
    'aria-expanded': open,
    'aria-controls': listId,
    'aria-activedescendant': open && active >= 0 && shown[active] ? `${listId}-${active}` : undefined,
    'aria-label': ariaLabel,
    'aria-invalid': ariaInvalid || undefined,
    'data-autofocus': autofocus || undefined,
    title: title ?? (chosen && chosen.label.length > 28 ? chosen.label : undefined),
    disabled,
    onKeyDown: onKey,
    onBlur: close,
  };
  return (
    <>
      {!typing ? (
        // a short list: a button that opens it - nothing to type, so no keyboard on a phone
        <button
          {...common}
          ref={field as RefObject<HTMLButtonElement>}
          type="button"
          className={`${className} ${CHEVRON} select-button`}
          aria-haspopup="listbox"
          onClick={() => (open ? close() : openAll())}
        >
          <span className="select-button-label">{chosen?.label ?? ''}</span>
        </button>
      ) : (
      <input
        ref={field as RefObject<HTMLInputElement>}
        id={id}
        className={`${className} ${CHEVRON}`}
        style={style}
        type="text"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={open && active >= 0 && shown[active] ? `${listId}-${active}` : undefined}
        aria-label={ariaLabel}
        aria-invalid={ariaInvalid || undefined}
        data-autofocus={autofocus || undefined}
        title={title ?? (chosen && chosen.label.length > 28 ? chosen.label : undefined)}
        autoComplete="off"
        spellCheck={false}
        disabled={disabled}
        required={required}
        size={fit ? Math.max(4, (query ?? chosen?.label ?? '').length + 2) : undefined}
        value={query ?? chosen?.label ?? ''}
        placeholder={query !== null ? (chosen?.label ?? 'חיפוש...') : undefined}
        onMouseDown={() => {
          if (open) return;
          openAll();
          // what is typed now replaces the choice shown
          requestAnimationFrame(() => (field.current as HTMLInputElement | null)?.select());
        }}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onKeyDown={onKey}
        onBlur={close}
      />
      )}
      <Layer anchor={field} open={open} onDismiss={close} className="combo-list" want={320}>
        <div id={listId} role="listbox" aria-label={ariaLabel ?? 'אפשרויות'}>
          {shown.length === 0 && <div className="combo-empty">אין תוצאות ל"{query}"</div>}
          {shown.map((o, i) => {
            const head = o.group !== lastGroup && o.group ? o.group : null;
            lastGroup = o.group;
            return (
              <Fragment key={`${o.value}-${i}`}>
                {head && (
                  <div className="combo-group" role="presentation">
                    {head}
                  </div>
                )}
                <div
                  id={`${listId}-${i}`}
                  role="option"
                  aria-selected={o.value === current}
                  aria-disabled={o.disabled || undefined}
                  className={`combo-option${i === active ? ' is-active' : ''}${o.value === current ? ' is-chosen' : ''}`}
                  onMouseMove={() => i !== active && !o.disabled && setActive(i)}
                  onClick={() => choose(o)}
                >
                  <span className="grow">{o.label || ' '}</span>
                  {o.value === current && <Icon name="check" size={14} />}
                </div>
              </Fragment>
            );
          })}
        </div>
      </Layer>
    </>
  );
}

// ---------------- free text, with suggestions ----------------

/** Free text with suggestions that a click opens and typing narrows - anything else can still be typed. */
export function SuggestInput({
  value,
  onChange,
  options,
  className = 'input',
  placeholder,
  maxLength,
  'aria-label': ariaLabel,
  'data-autofocus': autofocus,
}: {
  value: string;
  onChange: (v: string) => void;
  options: readonly string[];
  className?: string;
  placeholder?: string;
  maxLength?: number;
  'aria-label'?: string;
  'data-autofocus'?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState(false);
  const [active, setActive] = useState(-1);
  const field = useRef<HTMLInputElement>(null);
  const listId = useId();
  const shown = useMemo(() => {
    const words = typed ? searchKey(value).split(/\s+/).filter(Boolean) : [];
    return words.length ? options.filter((o) => words.every((w) => searchKey(o).includes(w))) : [...options];
  }, [options, value, typed]);
  useEffect(() => {
    if (open && active >= 0) revealOption(document.getElementById(`${listId}-${active}`));
  }, [open, active, listId]);
  const close = () => {
    setOpen(false);
    setTyped(false);
    setActive(-1);
  };
  const pick = (o: string) => {
    onChange(o);
    close();
  };
  return (
    <>
      <input
        ref={field}
        className={className}
        type="text"
        role="combobox"
        aria-expanded={open && shown.length > 0}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={open && active >= 0 && shown[active] ? `${listId}-${active}` : undefined}
        aria-label={ariaLabel}
        data-autofocus={autofocus || undefined}
        autoComplete="off"
        placeholder={placeholder}
        maxLength={maxLength}
        value={value}
        onMouseDown={() => !open && setOpen(true)}
        onChange={(e) => {
          onChange(e.target.value);
          setTyped(true);
          setOpen(true);
          setActive(-1);
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            if (!open) return setOpen(true);
            const dir = e.key === 'ArrowDown' ? 1 : -1;
            setActive((a) => (shown.length ? (a + dir + shown.length) % shown.length : -1));
          } else if (e.key === 'Enter' && open && shown[active]) {
            e.preventDefault();
            pick(shown[active]);
          } else if (e.key === 'Escape' && open) {
            e.preventDefault();
            e.stopPropagation();
            close();
          } else if (e.key === 'Tab') close();
        }}
        onBlur={close}
      />
      <Layer anchor={field} open={open && shown.length > 0} onDismiss={close} className="combo-list" want={260}>
        <div id={listId} role="listbox" aria-label={ariaLabel ?? 'הצעות'}>
          {shown.map((o, i) => (
            <div key={o} id={`${listId}-${i}`} role="option" aria-selected={o === value} className={`combo-option${i === active ? ' is-active' : ''}${o === value ? ' is-chosen' : ''}`} onMouseMove={() => i !== active && setActive(i)} onClick={() => pick(o)}>
              <span className="grow">{o}</span>
              {o === value && <Icon name="check" size={14} />}
            </div>
          ))}
        </div>
      </Layer>
    </>
  );
}

// ---------------- a time of day ----------------

const pad = (n: number) => String(n).padStart(2, '0');
/** every half hour of the day */
const HALF_HOURS = Array.from({ length: 48 }, (_, i) => `${pad(Math.floor(i / 2))}:${i % 2 ? '30' : '00'}`);

/**
 * A time of day as Israel writes it - 14:00, never 2:00 PM - whatever language the device is set to.
 * Typed ("1430", "930"), or picked from every half hour of the day, which a click opens and typing narrows.
 * `value` and `onChange` use "HH:MM", or "" for none.
 */
export function TimeInput({
  value,
  onChange,
  className = 'input',
  style,
  required,
  id,
  'aria-label': ariaLabel,
}: {
  value: string;
  onChange: (v: string) => void;
  className?: string;
  style?: CSSProperties;
  required?: boolean;
  id?: string;
  'aria-label'?: string;
}) {
  const [draft, setDraft] = useState(value);
  const [typing, setTyping] = useState(false);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const sent = useRef(value);
  const field = useRef<HTMLInputElement>(null);
  const listId = useId();
  // a new value from outside (a parsed sentence, a reset) replaces what is shown
  useEffect(() => {
    if (value !== sent.current) {
      sent.current = value;
      setDraft(value);
    }
  }, [value]);
  const send = (t: string) => {
    if (t === sent.current) return;
    sent.current = t;
    onChange(t);
  };
  const time = parseTime(draft);
  const invalid = draft.trim() !== '' && !time;
  const digits = draft.replace(/\D/g, '');
  const shown = useMemo(
    () => (typing && digits ? HALF_HOURS.filter((t) => t.replace(':', '').startsWith(digits) || t.replace(':', '').replace(/^0/, '').startsWith(digits)) : HALF_HOURS),
    [typing, digits],
  );
  useEffect(() => {
    if (open && active >= 0) revealOption(document.getElementById(`${listId}-${active}`));
  }, [open, active, listId]);
  useEffect(() => {
    if (open && typing) setActive(shown.length ? 0 : -1);
  }, [open, typing, shown]);

  const openList = () => {
    if (open) return;
    setTyping(false);
    // the time chosen, or the next half hour after it
    const at = time ? HALF_HOURS.findIndex((t) => t >= time) : HALF_HOURS.indexOf('08:00');
    setActive(at < 0 ? HALF_HOURS.length - 1 : at);
    setOpen(true);
  };
  const close = () => {
    setOpen(false);
    setTyping(false);
  };
  const pick = (t: string) => {
    setDraft(t);
    send(t);
    close();
  };
  return (
    <>
      <input
        ref={field}
        id={id}
        className={`${className}${invalid ? ' missing' : ''} time-input`}
        style={style}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        dir="ltr"
        maxLength={5}
        placeholder="14:00"
        required={required}
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={open && active >= 0 && shown[active] ? `${listId}-${active}` : undefined}
        aria-label={ariaLabel}
        aria-invalid={invalid || undefined}
        title={invalid ? 'שעה בפורמט 24 שעות, למשל 14:00' : undefined}
        value={draft}
        onMouseDown={() => {
          if (open) return;
          openList();
          requestAnimationFrame(() => field.current?.select());
        }}
        onChange={(e) => {
          const next = shapeTime(e.target.value);
          setDraft(next);
          setTyping(true);
          setOpen(true);
          const t = next === '' ? '' : parseTime(next);
          if (t !== null) send(t);
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            if (!open) return openList();
            const dir = e.key === 'ArrowDown' ? 1 : -1;
            setActive((a) => (a < 0 ? 0 : (a + dir + shown.length) % shown.length));
          } else if (e.key === 'Enter') {
            if (!open) return;
            e.preventDefault();
            // a time typed in full stays as typed (14:15); otherwise the one marked in the list
            if (typing && time && digits.length >= 3) pick(time);
            else if (shown[active]) pick(shown[active]);
            else close();
          } else if (e.key === 'Escape') {
            if (!open) return;
            e.preventDefault();
            e.stopPropagation();
            close();
          } else if (e.key === 'Tab') close();
        }}
        onBlur={() => {
          close();
          if (time && time !== draft) setDraft(time);
        }}
      />
      <Layer anchor={field} open={open} onDismiss={close} className="combo-list time-list" want={260} width={Math.max(field.current?.offsetWidth ?? 0, 120)}>
        <div id={listId} role="listbox" aria-label={ariaLabel ? `שעות - ${ariaLabel}` : 'שעות'}>
          {shown.length === 0 && <div className="combo-empty">אין חצי שעה כזו - ההקלדה נשמרת כמו שהיא</div>}
          {shown.map((t, i) => (
            <div
              key={t}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={t === time}
              className={`combo-option mono${i === active ? ' is-active' : ''}${t === time ? ' is-chosen' : ''}`}
              onMouseMove={() => i !== active && setActive(i)}
              onClick={() => pick(t)}
            >
              <span className="grow">{t}</span>
              {t === time && <Icon name="check" size={14} />}
            </div>
          ))}
        </div>
      </Layer>
    </>
  );
}

// ---------------- a date ----------------

const MONTHS = ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני', 'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'];
const DAY_LETTERS = ['א׳', 'ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳', 'ש׳'];
const monthOf = (key: string) => key.slice(0, 7);
const firstOf = (month: string) => `${month}-01`;
const shiftMonth = (month: string, n: number) => {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`;
};
const dayLabel = (key: string) => {
  const [y, m, d] = key.split('-').map(Number);
  return `יום ${WEEKDAY_NAMES[weekdayOf(key)]}, ${d} ב${MONTHS[m - 1]} ${y}`;
};

/** A month on a page, as a Hebrew calendar reads: Sunday on the right, right to left. */
function Calendar({ id, value, min, max, onPick, onClose, focusInside }: { id: string; value: string; min?: string; max?: string; onPick: (key: string) => void; onClose: () => void; focusInside: boolean }) {
  const today = todayKey();
  const [cursor, setCursor] = useState(value || today);
  const [month, setMonth] = useState(monthOf(value || today));
  const grid = useRef<HTMLDivElement>(null);
  const allowed = (k: string) => (!min || k >= min) && (!max || k <= max);
  // six weeks from the Sunday on or before the 1st: the same height every month
  const start = addDays(firstOf(month), -weekdayOf(firstOf(month)));
  const days = Array.from({ length: 42 }, (_, i) => addDays(start, i));
  const move = (k: string) => {
    setCursor(k);
    if (monthOf(k) !== month) setMonth(monthOf(k));
  };
  useEffect(() => {
    if (focusInside) grid.current?.querySelector<HTMLButtonElement>(`[data-day="${cursor}"]`)?.focus();
  }, [cursor, month, focusInside]);
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const step: Record<string, number> = { ArrowRight: -1, ArrowLeft: 1, ArrowUp: -7, ArrowDown: 7 };
    if (step[e.key] !== undefined) {
      e.preventDefault();
      move(addDays(cursor, step[e.key]));
    } else if (e.key === 'PageUp' || e.key === 'PageDown') {
      e.preventDefault();
      const m = shiftMonth(monthOf(cursor), e.key === 'PageUp' ? -1 : 1);
      const day = Math.min(Number(cursor.slice(8)), new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5)), 0)).getUTCDate());
      move(`${m}-${pad(day)}`);
    } else if (e.key === 'Home' || e.key === 'End') {
      e.preventDefault();
      move(addDays(cursor, e.key === 'Home' ? -weekdayOf(cursor) : 6 - weekdayOf(cursor)));
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      onClose();
    }
  };
  const [y, m] = month.split('-').map(Number);
  return (
    <div className="dp" id={id} role="dialog" aria-label="לוח שנה">
      <div className="dp-head">
        <button type="button" className="icon-btn dp-nav" onClick={() => setMonth(shiftMonth(month, -1))} aria-label="החודש הקודם" tabIndex={focusInside ? 0 : -1}>
          <Icon name="chevronRight" size={18} />
        </button>
        <div className="dp-title" aria-live="polite">
          {MONTHS[m - 1]} <span className="mono">{y}</span>
        </div>
        <button type="button" className="icon-btn dp-nav" onClick={() => setMonth(shiftMonth(month, 1))} aria-label="החודש הבא" tabIndex={focusInside ? 0 : -1}>
          <Icon name="chevronLeft" size={18} />
        </button>
      </div>
      <div className="dp-grid" ref={grid} onKeyDown={onKey}>
        {DAY_LETTERS.map((d, i) => (
          <div key={d} className={`dp-dow${i === 6 ? ' is-shabbat' : ''}`} aria-hidden="true">
            {d}
          </div>
        ))}
        {days.map((k) => {
          // the days of the months around it stay blank: the month reads at a glance
          if (monthOf(k) !== month) return <span key={k} className="dp-blank" aria-hidden="true" />;
          const ok = allowed(k);
          return (
            <button
              key={k}
              type="button"
              data-day={k}
              className={`dp-day${k === today ? ' is-today' : ''}${k === value ? ' is-chosen' : ''}${weekdayOf(k) === 6 ? ' is-shabbat' : ''}`}
              disabled={!ok}
              tabIndex={focusInside && k === cursor ? 0 : -1}
              aria-label={dayLabel(k)}
              aria-pressed={k === value}
              aria-current={k === today ? 'date' : undefined}
              onClick={() => onPick(k)}
            >
              {Number(k.slice(8))}
            </button>
          );
        })}
      </div>
      <div className="dp-foot">
        {[
          ['היום', today],
          ['מחר', addDays(today, 1)],
          ['בעוד שבוע', addDays(today, 7)],
        ].map(([label, k]) => (
          <button key={label} type="button" className="btn btn-sm btn-ghost" disabled={!allowed(k)} onClick={() => onPick(k)} tabIndex={focusInside ? 0 : -1}>
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * A date as Israel writes it - 06.10.2026, never 10/06/2026 - whatever language the device is set to.
 * Typed (the dots come by themselves), or picked from a Hebrew right-to-left calendar that a click on
 * the field or on the calendar button opens. `value` and `onChange` use "YYYY-MM-DD", or "" for none.
 */
export function DateInput({
  value,
  onChange,
  min,
  max,
  className = 'input',
  style,
  required,
  id,
  'aria-label': ariaLabel,
  'aria-invalid': ariaInvalid,
  'data-autofocus': autofocus,
  onBlur,
}: {
  value: string;
  onChange: (v: string) => void;
  min?: string;
  max?: string;
  'aria-invalid'?: boolean;
  'data-autofocus'?: boolean;
  className?: string;
  style?: CSSProperties;
  required?: boolean;
  id?: string;
  'aria-label'?: string;
  onBlur?: () => void;
}) {
  const [draft, setDraft] = useState(fmtDateIL(value));
  const [open, setOpen] = useState<null | 'field' | 'button'>(null);
  const sent = useRef(value ?? '');
  const field = useRef<HTMLInputElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const wrap = useRef<HTMLSpanElement>(null);
  const calId = useId();
  // a new value from outside (a parsed sentence, a reset) replaces what is shown
  useEffect(() => {
    if ((value ?? '') !== sent.current) {
      sent.current = value ?? '';
      setDraft(fmtDateIL(value));
    }
  }, [value]);
  const send = (v: string) => {
    if (v === sent.current) return;
    sent.current = v;
    onChange(v);
  };
  const date = parseDateIL(draft, true);
  const problem =
    draft.trim() === '' ? '' : !date ? 'תאריך כמו 06.10.2026 - יום, חודש, שנה' : min && date < min ? `התאריך מוקדם מ-${fmtDateIL(min)}` : max && date > max ? `התאריך מאוחר מ-${fmtDateIL(max)}` : '';
  // a form will not go out with a date that is not one
  useEffect(() => {
    field.current?.setCustomValidity(problem);
  }, [problem]);
  const close = (back?: boolean) => {
    if (back && open === 'button') button.current?.focus();
    setOpen(null);
  };
  const pick = (k: string) => {
    setDraft(fmtDateIL(k));
    send(k);
    setOpen(null);
    field.current?.focus();
  };
  return (
    <span className="date-input" style={style} ref={wrap}>
      <input
        ref={field}
        id={id}
        className={`${className}${problem ? ' missing' : ''}`}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        dir="ltr"
        maxLength={10}
        placeholder="dd.mm.yyyy"
        required={required}
        aria-label={ariaLabel}
        aria-invalid={problem || ariaInvalid ? true : undefined}
        role="combobox"
        aria-haspopup="dialog"
        aria-expanded={!!open}
        aria-controls={calId}
        data-autofocus={autofocus || undefined}
        title={problem || undefined}
        value={draft}
        onMouseDown={() => !open && setOpen('field')}
        onChange={(e) => {
          const next = shapeDate(e.target.value);
          setDraft(next);
          if (next === '') send('');
          else {
            const d = parseDateIL(next);
            if (d) send(d);
          }
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape' && open) {
            e.preventDefault();
            e.stopPropagation();
            close();
          } else if (e.key === 'ArrowDown' && e.altKey) {
            e.preventDefault();
            setOpen('button');
          } else if (e.key === 'Tab' || e.key === 'Enter') close();
        }}
        onBlur={(e) => {
          if (open === 'field' && !wrap.current?.contains(e.relatedTarget as Node)) setOpen(null);
          // a short year counts once the field is left: 06.10.26 is 06.10.2026
          if (date) {
            setDraft(fmtDateIL(date));
            send(date);
          }
          onBlur?.();
        }}
      />
      <button
        ref={button}
        type="button"
        className="date-input-pick"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => (open ? close() : setOpen('button'))}
        aria-label={ariaLabel ? `בחירה בלוח השנה - ${ariaLabel}` : 'בחירה בלוח השנה'}
        aria-haspopup="dialog"
        aria-expanded={!!open}
        title="בחירה בלוח השנה"
      >
        <Icon name="calendar" size={16} />
      </button>
      <Layer anchor={wrap} open={!!open} onDismiss={() => close()} className="dp-pop" want={380} width={292} keepFocus={open !== 'button'}>
        <Calendar id={calId} value={date ?? ''} min={min} max={max} onPick={pick} onClose={() => close(true)} focusInside={open === 'button'} />
      </Layer>
    </span>
  );
}
