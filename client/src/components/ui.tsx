import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router';
import type { Tone } from '@shared/constants';
import { Icon } from './Icon';

export function Modal({
  title,
  onClose,
  children,
  footer,
  wide,
}: {
  title: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      // with nested dialogs only the topmost one closes
      const all = document.querySelectorAll('.modal');
      if (all[all.length - 1] === ref.current) onCloseRef.current();
    };
    document.addEventListener('keydown', onKey);
    // prefer an explicit autofocus target, then the first field - never the close button
    const body = ref.current?.querySelector('.modal-body');
    const first =
      ref.current?.querySelector<HTMLElement>('[data-autofocus]') ??
      body?.querySelector<HTMLElement>('input:not([type=hidden]):not([type=checkbox]), textarea, select') ??
      body?.querySelector<HTMLElement>('button');
    first?.focus();
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      if (document.querySelectorAll('.modal').length === 0) document.body.style.overflow = '';
      prev?.focus?.();
    };
    // once per opening: re-running on every parent render would steal focus mid-typing
  }, []);
  // on the page body: a dialog opened inside an animated card or a sticky column would otherwise
  // stay inside that box's layer, under the phone's bottom bar
  return createPortal(
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal${wide ? ' wide' : ''}`} role="dialog" aria-modal="true" ref={ref}>
        <div className="modal-head">
          <h2>{title}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="סגירה" type="button">
            <Icon name="x" />
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
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
    <div className="list" aria-busy="true" aria-label="טוען">
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
  if (status !== 404) return <ErrorBox error={error} />;
  return (
    <Empty
      icon="search"
      title={`${what} ${feminine ? 'לא נמצאה' : 'לא נמצא'}`}
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

export function Seg<T extends string>({ value, options, onChange }: { value: T; options: { value: T; label: ReactNode; icon?: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="seg" role="tablist">
      {options.map((o) => (
        <button key={o.value} type="button" className={value === o.value ? 'on' : ''} onClick={() => onChange(o.value)} role="tab" aria-selected={value === o.value}>
          {o.icon && <Icon name={o.icon} />}
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function PageHead({ eyebrow, title, sub, actions }: { eyebrow?: ReactNode; title: ReactNode; sub?: ReactNode; actions?: ReactNode }) {
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
