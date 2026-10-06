import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router';
import type { Tone } from '@shared/constants';
import { Icon } from './Icon';
import { usePageTitle } from '../lib/title';
import { ask } from './Confirm';

// the pickers live in their own module; every screen imports them from here as before
export { DateInput, Select, SuggestInput, TimeInput } from './pickers';

/**
 * A row or card that opens on click is also reached with Tab and opened with
 * Enter, like a link. Enter on a button inside it stays that button's.
 * Table rows keep their row role ({ role: false }).
 */
export function openable(open: () => void, opts: { role?: boolean } = {}) {
  return {
    onClick: open,
    tabIndex: 0,
    ...(opts.role === false ? {} : { role: 'link' as const }),
    onKeyDown: (e: ReactKeyboardEvent) => {
      if (e.key !== 'Enter' || e.target !== e.currentTarget) return;
      e.preventDefault();
      open();
    },
  };
}

function fieldValue(el: Element): string {
  if (el instanceof HTMLInputElement && (el.type === 'checkbox' || el.type === 'radio')) return String(el.checked);
  return (el as HTMLInputElement).value.trim();
}

export function Modal({
  title,
  onClose,
  children,
  footer,
  wide,
  narrow,
  closable = true,
  readOnly,
}: {
  title: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
  /** a short question (the confirmation dialog) */
  narrow?: boolean;
  /** false: no close button, Escape or outside click - the dialog's own buttons answer it */
  closable?: boolean;
  /** only text to read: the body itself takes focus, so it scrolls from the keyboard */
  readOnly?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(closable ? onClose : () => undefined);
  onCloseRef.current = closable ? onClose : () => undefined;
  // what each field held when first touched: closing by Escape, a click outside or the X
  // after typing asks first, so a long text is not lost to a stray click
  const initial = useRef(new Map<Element, string>());
  const tryClose = useRef(async () => {
    const changed = [...initial.current].some(([el, was]) => el.isConnected && fieldValue(el) !== was);
    if (!changed || (await ask({ title: 'לסגור בלי לשמור?', body: 'מה שהוקלד בחלון הזה יימחק.', confirm: 'סגירה בלי שמירה', cancel: 'המשך עריכה', danger: true }))) onCloseRef.current();
  });
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      // with nested dialogs only the topmost one closes
      const all = document.querySelectorAll('.modal');
      if (all[all.length - 1] === ref.current) void tryClose.current();
    };
    document.addEventListener('keydown', onKey);
    const touched = (e: FocusEvent) => {
      const el = e.target as Element;
      if (el.matches('input, textarea, select') && !el.matches('[data-transient], [type=hidden], [type=file]') && !initial.current.has(el)) initial.current.set(el, fieldValue(el));
    };
    ref.current?.addEventListener('focusin', touched);
    // prefer an explicit autofocus target, then the first field - never the close button
    const body = ref.current?.querySelector('.modal-body');
    const first =
      ref.current?.querySelector<HTMLElement>('[data-autofocus]') ??
      body?.querySelector<HTMLElement>('input:not([type=hidden]):not([type=checkbox]), textarea, select') ??
      body?.querySelector<HTMLElement>('button');
    first?.focus();
    document.body.style.overflow = 'hidden';
    const box = ref.current;
    return () => {
      document.removeEventListener('keydown', onKey);
      box?.removeEventListener('focusin', touched);
      if (document.querySelectorAll('.modal').length === 0) document.body.style.overflow = '';
      prev?.focus?.();
    };
    // once per opening: re-running on every parent render would steal focus mid-typing
  }, []);
  // on the page body: a dialog opened inside an animated card or a sticky column would otherwise
  // stay inside that box's layer, under the phone's bottom bar
  return createPortal(
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && void tryClose.current()}>
      <div className={`modal${wide ? ' wide' : narrow ? ' narrow' : ''}`} role="dialog" aria-modal="true" ref={ref}>
        <div className="modal-head">
          <h2>{title}</h2>
          {closable && (
            <button className="icon-btn" onClick={() => void tryClose.current()} aria-label="סגירה" type="button">
              <Icon name="x" />
            </button>
          )}
        </div>
        <div className="modal-body" tabIndex={readOnly ? 0 : undefined}>
          {children}
        </div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
      {/* a screen opened over a screen has the floating back arrow too: it closes this one */}
      {closable && !narrow && (
        <button type="button" className="modal-back no-print" onClick={() => void tryClose.current()} aria-label="חזרה" title="חזרה">
          <Icon name="arrowRight" size={19} />
        </button>
      )}
    </div>,
    document.body,
  );
}

export function Field({ label, required, hint, children, className }: { label: ReactNode; required?: boolean; hint?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <label className={`field ${className ?? ''}`}>
      <span>
        {label}
        {required && <span className="req"> *</span>}
      </span>
      {children}
      {hint && <span className="hint">{hint}</span>}
    </label>
  );
}

export function Empty({ title, text, icon = 'check' }: { title: string; text?: ReactNode; icon?: string }) {
  return (
    <div className="empty">
      <Icon name={icon} />
      <div className="big">{title}</div>
      {text && <div className="small">{text}</div>}
    </div>
  );
}

export function Loading({ rows = 3 }: { rows?: number }) {
  return (
    <div className="list" role="status" aria-busy="true" aria-label="טוען">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="skeleton" />
      ))}
    </div>
  );
}

/**
 * A screen whose item could not be loaded: one that does not exist (or was
 * deleted while the screen was open) says so and leads back to its list.
 */
export function PageError({
  error,
  status,
  what,
  feminine,
  back,
  backLabel,
}: {
  error: string | null;
  status: number | null;
  what: string;
  feminine?: boolean;
  back: string;
  backLabel: string;
}) {
  const missing = `${what} ${feminine ? 'לא נמצאה' : 'לא נמצא'}`;
  usePageTitle(status === 404 ? missing : null);
  if (status !== 404) return <ErrorBox error={error} />;
  return (
    <Empty
      icon="search"
      title={missing}
      text={
        <>
          {feminine ? 'ייתכן שנמחקה' : 'ייתכן שנמחק'}, או שהקישור שגוי. <Link to={back}>{backLabel}</Link>
        </>
      }
    />
  );
}

export function ErrorBox({ error }: { error: string | null | undefined }) {
  if (!error) return null;
  return (
    <div className="error-box" role="alert">
      {error}
    </div>
  );
}

export function readinessTone(p: number, total = 1): Tone {
  if (total === 0) return 'gray';
  if (p >= 90) return 'green';
  if (p >= 70) return 'yellow';
  if (p >= 40) return 'orange';
  return 'red';
}

export function Ring({ value, size = 92, tone }: { value: number; size?: number; tone?: Tone }) {
  return (
    <div className={`ring t-${tone ?? readinessTone(value)}`} style={{ ['--p' as string]: value, ['--size' as string]: `${size}px` }}>
      <span>{value}%</span>
    </div>
  );
}

export function Bar({ value, tone, label }: { value: number; tone?: Tone; label: string }) {
  return (
    <div className={`bar t-${tone ?? readinessTone(value)}`} role="progressbar" aria-label={label} aria-valuenow={Math.round(value)} aria-valuemin={0} aria-valuemax={100}>
      <div className="bar-fill" style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
    </div>
  );
}

export function Seg<T extends string>({
  value,
  options,
  onChange,
  wrap,
}: {
  value: T;
  options: { value: T; label: ReactNode; icon?: string }[];
  onChange: (v: T) => void;
  /** options that are sentences: they wrap and share the width */
  wrap?: boolean;
}) {
  // the highlight slides from the option chosen before to the one chosen now
  const ref = useRef<HTMLDivElement>(null);
  const [pill, setPill] = useState<CSSProperties | null>(null);
  const optionKey = options.map((o) => o.value).join('|');
  useLayoutEffect(() => {
    const box = ref.current;
    if (!box) return;
    const measure = () => {
      const on = box.querySelector<HTMLElement>(':scope > button.on');
      setPill(
        on
          ? ({ '--pill-x': `${on.offsetLeft}px`, '--pill-y': `${on.offsetTop}px`, '--pill-w': `${on.offsetWidth}px`, '--pill-h': `${on.offsetHeight}px` } as CSSProperties)
          : null,
      );
    };
    measure();
    const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : null;
    ro?.observe(box);
    return () => ro?.disconnect();
  }, [value, optionKey]);
  return (
    <div className={`seg${wrap ? ' seg-wrap' : ''}${pill ? ' has-pill' : ''}`} role="tablist" ref={ref} style={pill ?? undefined}>
      {pill && <span className="seg-pill" aria-hidden="true" />}
      {options.map((o) => (
        <button key={o.value} type="button" className={value === o.value ? 'on' : ''} onClick={() => onChange(o.value)} role="tab" aria-selected={value === o.value}>
          {o.icon && <Icon name={o.icon} />}
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function PageHead({ eyebrow, title, sub, actions, docTitle }: { eyebrow?: ReactNode; title: ReactNode; sub?: ReactNode; actions?: ReactNode; docTitle?: string }) {
  usePageTitle(docTitle ?? (typeof title === 'string' ? title : null));
  return (
    <div className="page-head">
      <div className="titles">
        {eyebrow && <div className="eyebrow">{eyebrow}</div>}
        <h1 className="page-title">{title}</h1>
        {sub && <div className="page-sub">{sub}</div>}
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </div>
  );
}

export function initials(name: string): string {
  const clean = name.replace(/["'״׳]/g, '').trim();
  const parts = clean.split(/\s+/);
  if (parts.length >= 2 && /\d/.test(parts[parts.length - 1])) return parts[parts.length - 1].slice(0, 2);
  return parts
    .slice(0, 2)
    .map((p) => p[0])
    .join('');
}

/** a number that counts up to its value when it first shows, and moves to a new value when it changes */
export function CountUp({ value, ms = 650 }: { value: number; ms?: number }) {
  const [shown, setShown] = useState(0);
  const from = useRef(0);
  useEffect(() => {
    const start = from.current;
    from.current = value;
    if (start === value || matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setShown(value);
      return;
    }
    const t0 = performance.now();
    let frame = 0;
    const step = (t: number) => {
      const k = Math.min(1, (t - t0) / ms);
      setShown(Math.round(start + (value - start) * (1 - Math.pow(1 - k, 3))));
      if (k < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [value, ms]);
  return <>{shown}</>;
}
