import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useLocation } from 'react-router';
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
 * says "נשמר" once the server answered. Leaving the field any other way says so too, and a tap elsewhere or
 * going back saves it before the screen changes. Dialogs have their own footer (Modal's autosave).
 */
export function FloatingSave() {
  const [state, setState] = useState<'idle' | 'editing' | 'saving' | 'saved' | 'failed'>('idle');
  const [problem, setProblem] = useState('');
  const field = useRef<HTMLElement | null>(null);
  const was = useRef('');
  const hide = useRef(0);
  const run = useRef(0);

  useEffect(() => {
    const settle = async () => {
      const mine = ++run.current;
      setState('saving');
      const { failed, error } = await changesSettled();
      if (mine !== run.current) return;
      setProblem(error ?? '');
      setState(failed ? 'failed' : 'saved');
      window.clearTimeout(hide.current);
      hide.current = window.setTimeout(() => mine === run.current && setState('idle'), failed ? 5000 : 1600);
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
    // A tap elsewhere - a link, the bottom bar, a button - saves the field first: on a phone such a tap does
    // not always take the focus from it, and a screen left that way would drop what was typed. A tap, not a
    // touch: scrolling the page keeps the keyboard up.
    const onTapElsewhere = (e: MouseEvent) => {
      const el = field.current;
      const target = e.target as Node | null;
      if (!el || !target || el.contains(target) || (target as Element).closest?.('.floating-save')) return;
      el.blur();
    };
    // the back gesture or button: the screen is still there while this runs, so its field still saves
    const onBack = () => field.current?.blur();
    document.addEventListener('focusin', onIn);
    document.addEventListener('focusout', onOut);
    document.addEventListener('click', onTapElsewhere, true);
    window.addEventListener('popstate', onBack);
    return () => {
      document.removeEventListener('focusin', onIn);
      document.removeEventListener('focusout', onOut);
      document.removeEventListener('click', onTapElsewhere, true);
      window.removeEventListener('popstate', onBack);
      window.clearTimeout(hide.current);
    };
  }, []);

  // another screen while a field was being edited: that field is gone (a removed field may not say it
  // lost the focus), so the "שמירה" for it goes too. A "נשמר" already on its way stays to say so.
  const { pathname } = useLocation();
  useEffect(() => {
    if (field.current && !field.current.isConnected) {
      field.current = null;
      run.current++;
      setState('idle');
    }
  }, [pathname]);

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
        <span className="save-bar-saved small" role="alert">
          <Icon name="alert" size={15} /> {problem ? `לא נשמר: ${problem}` : 'השמירה נכשלה. נסו שוב.'}
        </span>
      )}
    </div>,
    document.body,
  );
}
