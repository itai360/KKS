import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { changesSettled } from '../lib/api';
import { Icon } from './Icon';

/** a field typed or picked in: not a checkbox, a file or a search box */
function editable(el: Element): el is HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement {
  if (el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) return true;
  return el instanceof HTMLInputElement && !['checkbox', 'radio', 'file', 'hidden', 'button', 'submit', 'search'].includes(el.type) && !el.readOnly;
}

/**
 * A screen that saves each field as it is left (a discussion's points and actions, the placement tables)
 * marks its area with data-autosave. While a field there is being edited, a floating "שמירה" is in sight,
 * above the phone's bar and the keyboard: it saves that field now - leaving the field is what saves it - and
 * says "נשמר" once the server answered. Leaving the field any other way says so too. Dialogs have their own
 * footer (Modal's autosave).
 */
export function FloatingSave() {
  const [state, setState] = useState<'idle' | 'editing' | 'saving' | 'saved' | 'failed'>('idle');
  const field = useRef<HTMLElement | null>(null);
  const was = useRef('');
  const hide = useRef(0);
  const run = useRef(0);

  useEffect(() => {
    const settle = async () => {
      const mine = ++run.current;
      setState('saving');
      const { failed } = await changesSettled();
      if (mine !== run.current) return;
      setState(failed ? 'failed' : 'saved');
      window.clearTimeout(hide.current);
      hide.current = window.setTimeout(() => mine === run.current && setState('idle'), failed ? 3200 : 1600);
    };
    const onIn = (e: FocusEvent) => {
      const el = e.target as Element;
      if (!editable(el) || el.matches('[data-transient]') || !el.closest('[data-autosave]') || el.closest('.modal')) return;
      window.clearTimeout(hide.current);
      run.current++;
      field.current = el;
      was.current = el.value;
      setState('editing');
    };
    const onOut = (e: FocusEvent) => {
      const el = e.target as HTMLInputElement;
      if (el !== field.current) return;
      field.current = null;
      // its own handler saves it as it is left (synchronously starting the request): wait for the answer
      setTimeout(() => {
        if (el.value !== was.current) void settle();
        else if (!field.current) setState('idle');
      }, 0);
    };
    document.addEventListener('focusin', onIn);
    document.addEventListener('focusout', onOut);
    return () => {
      document.removeEventListener('focusin', onIn);
      document.removeEventListener('focusout', onOut);
      window.clearTimeout(hide.current);
    };
  }, []);

  if (state === 'idle') return null;
  return createPortal(
    <div className={`save-bar floating-save no-print${state === 'editing' ? '' : ' is-done'}`} role="status" aria-live="polite">
      {state === 'editing' ? (
        <>
          <span className="small">נשמר גם ביציאה מהשדה</span>
          <button
            type="button"
            className="btn btn-sm save-bar-save"
            // the field keeps the focus until the tap is done: leaving it is what saves it
            onPointerDown={(e) => e.preventDefault()}
            onClick={() => field.current?.blur()}
          >
            <Icon name="check" size={15} /> שמירה
          </button>
        </>
      ) : state === 'saving' ? (
        <span className="save-bar-saved small">
          <span className="spinner" aria-hidden="true" /> שומר...
        </span>
      ) : state === 'saved' ? (
        <span className="save-bar-saved small">
          <Icon name="check" size={15} /> נשמר
        </span>
      ) : (
        <span className="save-bar-saved small">
          <Icon name="alert" size={15} /> השמירה נכשלה - הפרטים על המסך
        </span>
      )}
    </div>,
    document.body,
  );
}
