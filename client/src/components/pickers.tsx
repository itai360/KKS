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
  useSyncExternalStore,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
  type TouchEvent,
} from 'react';
import { createPortal } from 'react-dom';
import { WEEKDAY_NAMES } from '@shared/constants';
import { addDays, fmtDateIL, parseDateIL, parseTime, shapeDate, shapeTime, weekdayOf } from '@shared/dates';
import { searchKey } from '@shared/search';
import { todayKey } from '../lib/format';
import { Icon } from './Icon';
import { useSheetGesture } from './sheetGesture';

// ---------------- the floating layer ----------------

/** under its field - above it when there is no room below - with the right edges aligned, as the page reads */
/**
 * The highlighted option is brought into view inside its list only - never by moving the page (the
 * browser's own scrollIntoView would scroll the page too, to wherever the list stands at that moment)
 */
function revealOption(el: HTMLElement | null, center = false): void {
  const box = el?.closest<HTMLElement>('.pop, .pick-sheet-body');
  if (!el || !box) return;
  const top = el.getBoundingClientRect().top - box.getBoundingClientRect().top + box.scrollTop;
  const bottom = top + el.offsetHeight;
  // a sheet opens with the choice in its middle, the ones around it in sight
  if (center) {
    box.scrollTop = top - (box.clientHeight - el.offsetHeight) / 2;
    return;
  }
  if (top < box.scrollTop) box.scrollTop = top;
  else if (bottom > box.scrollTop + box.clientHeight) box.scrollTop = bottom - box.clientHeight;
}

/** the part of the screen in sight: above a phone's keyboard when it is up (the page does not shrink for it) */
function visibleArea() {
  const vv = window.visualViewport;
  const top = vv ? vv.offsetTop : 0;
  const height = vv ? vv.height : window.innerHeight;
  return { top, height, bottom: top + height };
}

function onVisibleAreaChange(fn: () => void): () => void {
  const vv = window.visualViewport;
  window.addEventListener('resize', fn);
  vv?.addEventListener('resize', fn);
  vv?.addEventListener('scroll', fn);
  return () => {
    window.removeEventListener('resize', fn);
    vv?.removeEventListener('resize', fn);
    vv?.removeEventListener('scroll', fn);
  };
}

function usePlacement(anchor: RefObject<HTMLElement | null>, open: boolean, want: number, width?: number): CSSProperties {
  const [style, setStyle] = useState<CSSProperties>({ visibility: 'hidden' });
  useLayoutEffect(() => {
    if (!open) return;
    // the side it opened to holds while it is open - a keyboard rising or the page scrolling under it
    // does not flip it back and forth
    let side: 'up' | 'down' | null = null;
    const place = () => {
      const el = anchor.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const vw = document.documentElement.clientWidth;
      const vh = window.innerHeight;
      const seen = visibleArea();
      const below = seen.bottom - r.bottom - 10;
      const above = r.top - seen.top - 10;
      // open upward when the whole of it fits better there
      if (!side || (side === 'down' ? below < 140 && above > below : above < 140 && below > above)) side = below < want && above > below ? 'up' : 'down';
      const up = side === 'up';
      const w = Math.min(width ?? Math.max(r.width, 200), vw - 16);
      const right = Math.min(Math.max(8, vw - r.right), vw - w - 8);
      setStyle({
        position: 'fixed',
        right,
        width: w,
        maxHeight: Math.max(140, Math.min(want, up ? above : below)),
        // it grows out of the field's edge it opened from
        transformOrigin: up ? 'bottom right' : 'top right',
        ...(up ? { bottom: vh - r.top + 4 } : { top: r.bottom + 4 }),
      });
    };
    place();
    const off = onVisibleAreaChange(place);
    window.addEventListener('scroll', place, true);
    return () => {
      off();
      window.removeEventListener('scroll', place, true);
    };
  }, [open, anchor, want, width]);
  return style;
}

// ---------------- on a phone: a sheet from the bottom ----------------

const PHONE = '(pointer: coarse) and (max-width: 860px), (pointer: coarse) and (max-height: 500px)';

/**
 * A phone (a finger, a small screen): a list with a search, a calendar and a time open in a sheet that
 * rises from the bottom, as wide as the screen - not a small box beside a field that brings the keyboard
 * up and sends the page jumping.
 */
export function usePhonePicker(): boolean {
  return useSyncExternalStore(
    (changed) => {
      const m = typeof matchMedia === 'function' ? matchMedia(PHONE) : null;
      m?.addEventListener('change', changed);
      return () => m?.removeEventListener('change', changed);
    },
    () => typeof matchMedia === 'function' && matchMedia(PHONE).matches,
    () => false,
  );
}

/**
 * A tap on a field opens its sheet instead of focusing it: no keyboard, and the page stays where it is.
 * A finger that scrolled the page and lifted over the field is not a tap.
 */
function useTapToOpen(on: boolean, open: () => void) {
  const start = useRef({ x: 0, y: 0 });
  if (!on) return {};
  return {
    onTouchStart: (e: TouchEvent<HTMLElement>) => {
      start.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
    },
    onTouchEnd: (e: TouchEvent<HTMLElement>) => {
      const t = e.changedTouches[0];
      if (Math.abs(t.clientX - start.current.x) > 10 || Math.abs(t.clientY - start.current.y) > 10) return;
      e.preventDefault();
      open();
    },
  };
}

/** Mounted while open and for its slide down after: the sheet itself */
function Sheet({ open, ...rest }: { open: boolean } & SheetBodyProps) {
  const [shown, setShown] = useState(open);
  useEffect(() => {
    if (open) return setShown(true);
    const t = setTimeout(() => setShown(false), matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 200);
    return () => clearTimeout(t);
  }, [open]);
  return open || shown ? <SheetBody {...rest} leaving={!open} /> : null;
}

interface SheetBodyProps {
  title: string;
  onClose: () => void;
  children: ReactNode;
  /** where the focus goes back to once it closes (the field) */
  back: RefObject<HTMLElement | null>;
  /** a long list: as tall as the screen allows from the start, so typing in its search does not resize it */
  tall?: boolean;
  className?: string;
  head?: ReactNode;
}

function SheetBody({ title, onClose, children, back, tall, className = '', head, leaving }: SheetBodyProps & { leaving: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const [area, setArea] = useState(visibleArea);
  const backdrop = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  // glued to the bottom of what is in sight: above the keyboard while the search is typed in
  useLayoutEffect(() => onVisibleAreaChange(() => setArea(visibleArea())), []);
  // the focus goes back to the field once it closes only if it was there (a keyboard opened it): after a
  // tap, focusing a date or time field would bring up the phone's bar over the keyboard area for nothing
  const opener = useRef<Element | null>(null);
  useLayoutEffect(() => {
    opener.current = document.activeElement;
  }, []);
  useEffect(() => {
    // the focus comes inside (the day chosen, or the sheet itself) - not to a field, which would bring the keyboard up
    if (!ref.current?.contains(document.activeElement)) ref.current?.focus({ preventScroll: true });
    const was = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = was;
    };
  }, []);
  useEffect(() => {
    if (!leaving) return;
    if (back.current && opener.current === back.current) back.current.focus({ preventScroll: true });
    else if (ref.current?.contains(document.activeElement)) (document.activeElement as HTMLElement).blur();
  }, [leaving, back]);
  // pulled down it follows the finger, and let go it closes or comes back (sheetGesture.ts)
  useSheetGesture(ref, { enabled: true, canLeave: () => true, leave: () => close.current(), backdrop, handle: '.pick-sheet-top', scroller: '.pick-sheet-body' });
  const room = Math.max(220, area.height - 10);
  const style: CSSProperties = {
    bottom: Math.max(0, window.innerHeight - area.bottom),
    maxHeight: room,
    ...(tall ? { height: Math.min(room, Math.round(window.innerHeight * 0.8)) } : {}),
  };
  return createPortal(
    <div ref={backdrop} className={`sheet-backdrop${leaving ? ' is-leaving' : ''}`} onMouseDown={(e) => e.target === e.currentTarget && close.current()} onTouchEnd={(e) => e.target === e.currentTarget && (e.preventDefault(), close.current())}>
      <div
        ref={ref}
        className={`pick-sheet ${className}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        dir="rtl"
        style={style}
        inert={leaving || undefined}
        onKeyDown={(e) => {
          if (e.key !== 'Escape') return;
          // only the sheet closes - not the dialog it was opened from
          e.preventDefault();
          e.stopPropagation();
          close.current();
        }}
      >
        <div className="pick-sheet-top">
          <div className="pick-sheet-grab" aria-hidden="true" />
          <div className="pick-sheet-head">
            <h2>{title}</h2>
            <button type="button" className="icon-btn" onClick={() => close.current()} aria-label="סגירה">
              <Icon name="x" />
            </button>
          </div>
          {head}
        </div>
        {children}
      </div>
    </div>,
    document.body,
  );
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

/** what a field is called on screen - its own name, or the label it sits in - to head its sheet */
function labelOf(el: HTMLElement | null, ariaLabel?: string): string | undefined {
  if (ariaLabel) return ariaLabel;
  const label = el?.closest('label') ?? (el?.id ? document.querySelector(`label[for="${CSS.escape(el.id)}"]`) : null);
  const text = label?.querySelector(':scope > span')?.textContent?.replace(/\*/g, '').trim();
  return text || undefined;
}

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
  // on a phone a list with a search opens in a sheet: the field itself is a button, so tapping it does
  // not bring the keyboard up or move the page - the search is in the sheet
  const sheet = usePhonePicker() && typing;
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
  const centered = useRef(false);
  useEffect(() => {
    if (!open) centered.current = false;
    else if (active >= 0) {
      revealOption(document.getElementById(`${listId}-${active}`), sheet && !centered.current);
      centered.current = true;
    }
  }, [open, active, listId, sheet]);

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
    } else if (e.key === 'Tab' && !sheet) {
      if (open && query && shown[active]) choose(shown[active]);
      else close();
    }
  };

  let lastGroup: string | undefined;
  const activeId = open && active >= 0 && shown[active] ? `${listId}-${active}` : undefined;
  const list = (
    <div id={listId} role="listbox" aria-label={ariaLabel ?? 'אפשרויות'} className={sheet ? 'pick-sheet-body pick-sheet-options' : undefined}>
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
              <span className="grow">{o.label || ' '}</span>
              {o.value === current && <Icon name="check" size={sheet ? 18 : 14} />}
            </div>
          </Fragment>
        );
      })}
    </div>
  );
  const common = {
    id,
    style,
    role: 'combobox' as const,
    'aria-expanded': open,
    'aria-controls': listId,
    'aria-activedescendant': sheet ? undefined : activeId,
    'aria-label': ariaLabel,
    'aria-invalid': ariaInvalid || undefined,
    'data-autofocus': autofocus || undefined,
    title: title ?? (chosen && chosen.label.length > 28 ? chosen.label : undefined),
    disabled,
    onKeyDown: onKey,
    // the sheet takes the focus while it is open - that is not leaving the field
    onBlur: sheet ? undefined : close,
  };
  return (
    <>
      {!typing || sheet ? (
        // a short list (or any list, on a phone): a button that opens it - no keyboard comes up
        <button
          {...common}
          ref={field as RefObject<HTMLButtonElement>}
          type="button"
          className={`${className} ${CHEVRON} select-button`}
          aria-haspopup={sheet ? 'dialog' : 'listbox'}
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
        aria-activedescendant={activeId}
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
      {sheet ? (
        <Sheet
          open={open}
          title={labelOf(field.current, ariaLabel) ?? 'בחירה מהרשימה'}
          onClose={close}
          back={field}
          tall={opts.length > 8}
          className="pick-sheet-list"
          head={
            <div className="pick-sheet-search" role="search">
              <Icon name="search" size={18} />
              <input
                className="input"
                type="search"
                role="combobox"
                aria-expanded={open}
                aria-controls={listId}
                aria-autocomplete="list"
                aria-activedescendant={activeId}
                aria-label="חיפוש ברשימה"
                autoComplete="off"
                spellCheck={false}
                enterKeyHint="search"
                placeholder="חיפוש..."
                value={query ?? ''}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={onKey}
              />
            </div>
          }
        >
          {list}
        </Sheet>
      ) : (
        <Layer anchor={field} open={open} onDismiss={close} className="combo-list" want={320}>
          {list}
        </Layer>
      )}
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
  // on a phone: the half hours in a sheet, with a box for an exact time (14:15) above them
  const phone = usePhonePicker();
  const [exact, setExact] = useState('');
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
  const centered = useRef(false);
  useEffect(() => {
    if (!open) centered.current = false;
    else if (active >= 0) {
      revealOption(document.getElementById(`${listId}-${active}`), phone && !centered.current);
      centered.current = true;
    }
  }, [open, active, listId, phone]);
  useEffect(() => {
    if (open && typing) setActive(shown.length ? 0 : -1);
  }, [open, typing, shown]);

  const openList = () => {
    if (open) return;
    setTyping(false);
    // the time chosen, or the next half hour after it
    const at = time ? HALF_HOURS.findIndex((t) => t >= time) : HALF_HOURS.indexOf('08:00');
    setActive(at < 0 ? HALF_HOURS.length - 1 : at);
    setExact(time && !HALF_HOURS.includes(time) ? time : '');
    setOpen(true);
  };
  const tap = useTapToOpen(phone, openList);
  const exactTime = parseTime(exact);
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
        inputMode={phone ? 'none' : 'numeric'}
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
        {...tap}
        onMouseDown={() => {
          if (open) return;
          openList();
          if (!phone) requestAnimationFrame(() => field.current?.select());
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
          // the sheet taking the focus is not leaving the field
          if (!phone) close();
          if (time && time !== draft) setDraft(time);
        }}
      />
      {phone ? (
        <Sheet
          open={open}
          title={labelOf(field.current, ariaLabel) ?? 'שעה'}
          onClose={close}
          back={field}
          tall
          className="pick-sheet-time"
          head={
            <div className="pick-sheet-exact">
              <input
                className="input mono"
                type="text"
                inputMode="numeric"
                maxLength={5}
                autoComplete="off"
                enterKeyHint="done"
                placeholder="או הקלדה, למשל 14:15"
                aria-label="שעה מדויקת"
                value={exact}
                onChange={(e) => setExact(shapeTime(e.target.value))}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && exactTime) {
                    e.preventDefault();
                    pick(exactTime);
                  }
                }}
              />
              <button type="button" className="btn btn-sm" disabled={!exactTime} onClick={() => exactTime && pick(exactTime)}>
                {exactTime ? `קביעה ל-${exactTime}` : 'קביעה'}
              </button>
            </div>
          }
        >
          <div id={listId} role="listbox" aria-label={ariaLabel ? `שעות - ${ariaLabel}` : 'שעות'} className="pick-sheet-body time-grid">
            {HALF_HOURS.map((t, i) => (
              <div
                key={t}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={t === time}
                className={`combo-option mono${i === active ? ' is-active' : ''}${t === time ? ' is-chosen' : ''}${t.endsWith(':00') ? ' is-hour' : ''}`}
                onClick={() => pick(t)}
              >
                {t}
              </div>
            ))}
          </div>
        </Sheet>
      ) : (
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
      )}
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
function Calendar({
  id,
  value,
  min,
  max,
  onPick,
  onClose,
  onClear,
  focusInside,
}: {
  id: string;
  value: string;
  min?: string;
  max?: string;
  onPick: (key: string) => void;
  onClose: () => void;
  /** a date that may stay empty: on a phone, where nothing is typed, it is cleared from here */
  onClear?: () => void;
  focusInside: boolean;
}) {
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
    if (focusInside) grid.current?.querySelector<HTMLButtonElement>(`[data-day="${cursor}"]`)?.focus({ preventScroll: true });
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
        {onClear && (
          <button type="button" className="btn btn-sm btn-ghost dp-clear" onClick={onClear} tabIndex={focusInside ? 0 : -1}>
            ניקוי
          </button>
        )}
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
  // on a phone the calendar is a sheet as wide as the screen, and the field brings no keyboard up
  const phone = usePhonePicker();
  const tap = useTapToOpen(phone, () => setOpen('button'));
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
    if (back && open === 'button' && !phone) button.current?.focus();
    setOpen(null);
  };
  const pick = (k: string) => {
    setDraft(fmtDateIL(k));
    send(k);
    setOpen(null);
    // the sheet gives the focus back by itself
    if (!phone) field.current?.focus();
  };
  return (
    <span className="date-input" style={style} ref={wrap}>
      <input
        ref={field}
        id={id}
        className={`${className}${problem ? ' missing' : ''}`}
        type="text"
        inputMode={phone ? 'none' : 'numeric'}
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
        {...tap}
        onMouseDown={() => !open && setOpen(phone ? 'button' : 'field')}
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
      {phone ? (
        <Sheet open={!!open} title={labelOf(field.current, ariaLabel) ?? 'בחירת תאריך'} onClose={() => close()} back={field} className="pick-sheet-date">
          <div className="pick-sheet-body">
            <Calendar
              id={calId}
              value={date ?? ''}
              min={min}
              max={max}
              onPick={pick}
              onClose={() => close()}
              onClear={
                !required && draft
                  ? () => {
                      setDraft('');
                      send('');
                      setOpen(null);
                    }
                  : undefined
              }
              focusInside
            />
          </div>
        </Sheet>
      ) : (
        <Layer anchor={wrap} open={!!open} onDismiss={() => close()} className="dp-pop" want={380} width={292} keepFocus={open !== 'button'}>
          <Calendar id={calId} value={date ?? ''} min={min} max={max} onPick={pick} onClose={() => close(true)} focusInside={open === 'button'} />
        </Layer>
      )}
    </span>
  );
}
