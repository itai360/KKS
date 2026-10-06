import { createContext, useCallback, useContext, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { useNavigate } from 'react-router';
import type { Tone } from '@shared/constants';
import { onNotification } from '../lib/realtime';
import { Icon } from './Icon';

interface Toast {
  id: number;
  title: string;
  body?: string;
  tone?: Tone;
  link?: string | null;
  /** a button on the message - "ביטול" right after an action */
  action?: { label: string; run: () => void };
}

const Ctx = createContext<(t: Omit<Toast, 'id'>) => void>(() => undefined);

export function useToast() {
  return useContext(Ctx);
}

let seq = 0;

let lastShown = { key: '', at: 0 };

/** how long a message stays: longer for an error, and for one with a button to press */
const lifetime = (t: Omit<Toast, 'id'>) => (t.action ? 8000 : t.tone === 'red' ? 7000 : 4500);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const navigate = useNavigate();

  const push = useCallback((t: Omit<Toast, 'id'>) => {
    // the same message twice in a moment (a double click that was sent once) shows once
    const key = `${t.tone ?? ''}|${t.title}|${t.body ?? ''}`;
    const now = Date.now();
    if (lastShown.key === key && now - lastShown.at < 1500) return;
    lastShown = { key, at: now };
    const id = ++seq;
    setToasts((list) => [...list.slice(-3), { ...t, id }]);
  }, []);
  const remove = useCallback((id: number) => setToasts((list) => list.filter((x) => x.id !== id)), []);

  useEffect(
    () =>
      onNotification((n) => {
        push({
          title: n.title,
          body: n.body,
          link: n.link,
          tone: n.category === 'exception' ? 'red' : n.category === 'action' ? 'blue' : 'green',
        });
        // when the tab is in the background, surface it as a system notification (if allowed)
        if (document.hidden && 'Notification' in window && Notification.permission === 'granted') {
          const sys = new Notification(n.title, { body: n.body, lang: 'he', dir: 'rtl', tag: `kks-${n.id}`, icon: '/icon-192.png' });
          sys.onclick = () => {
            window.focus();
            if (n.link) navigate(n.link);
            sys.close();
          };
        }
      }),
    [push, navigate],
  );

  return (
    <Ctx.Provider value={push}>
      {children}
      <div className="toasts no-print" aria-live="polite">
        {toasts.map((t) => (
          <ToastItem key={t.id} toast={t} onGone={() => remove(t.id)} onOpen={(link) => navigate(link)} />
        ))}
      </div>
    </Ctx.Provider>
  );
}

/**
 * One message: it waits while the pointer rests on it (or a button in it has the focus), leaves
 * smoothly, and on a phone is swiped away sideways.
 */
function ToastItem({ toast: t, onGone, onOpen }: { toast: Toast; onGone: () => void; onOpen: (link: string) => void }) {
  const [leaving, setLeaving] = useState<'' | 'out' | 'swipe'>('');
  const [paused, setPaused] = useState(false);
  const [dx, setDx] = useState(0);
  const left = useRef(lifetime(t));
  const startedAt = useRef(Date.now());
  const drag = useRef<{ x: number; id: number; moved: boolean } | null>(null);

  const leave = useCallback((how: 'out' | 'swipe' = 'out') => setLeaving((l) => l || how), []);
  // gone from the list once its way out has played
  useEffect(() => {
    if (!leaving) return;
    const timer = setTimeout(onGone, 220);
    return () => clearTimeout(timer);
  }, [leaving, onGone]);
  useEffect(() => {
    if (paused || leaving) return;
    startedAt.current = Date.now();
    const timer = setTimeout(() => leave(), left.current);
    return () => {
      clearTimeout(timer);
      left.current = Math.max(800, left.current - (Date.now() - startedAt.current));
    };
  }, [paused, leaving, leave]);

  const onPointerDown = (e: ReactPointerEvent) => {
    if (e.pointerType === 'mouse' || (e.target as HTMLElement).closest('button')) return;
    drag.current = { x: e.clientX, id: e.pointerId, moved: false };
    setPaused(true);
  };
  const onPointerMove = (e: ReactPointerEvent) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    const delta = e.clientX - d.x;
    if (Math.abs(delta) > 6) d.moved = true;
    setDx(delta);
  };
  const endDrag = (e: ReactPointerEvent) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    drag.current = null;
    setPaused(false);
    if (Math.abs(e.clientX - d.x) > 70) leave('swipe');
    else setDx(0);
  };

  return (
    <div
      className={`toast t-${t.tone ?? 'gray'}${leaving ? ` is-leaving${leaving === 'swipe' ? ' is-swiped' : ''}` : ''}${t.action ? ' has-action' : ''}`}
      style={
        leaving === 'swipe'
          ? { transform: `translateX(${dx >= 0 ? 110 : -110}%)`, opacity: 0 }
          : dx
            ? { transform: `translateX(${dx}px)`, opacity: Math.max(0.35, 1 - Math.abs(dx) / 220), transition: 'none' }
            : undefined
      }
      role="status"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onClick={() => {
        if (drag.current?.moved) return;
        leave();
        if (t.link) onOpen(t.link);
      }}
    >
      <div className="grow">
        <div className="t-title">{t.title}</div>
        {t.body && <div className="t-body">{t.body}</div>}
      </div>
      {t.action && (
        <button
          type="button"
          className="toast-action"
          onClick={(e) => {
            e.stopPropagation();
            t.action!.run();
            leave();
          }}
        >
          {t.action.label}
        </button>
      )}
      <button
        type="button"
        className="toast-close"
        aria-label="סגירת ההודעה"
        onClick={(e) => {
          e.stopPropagation();
          leave();
        }}
      >
        <Icon name="x" size={14} />
      </button>
      {/* how long is left, for a message with a button: it stops while the pointer rests on it */}
      {t.action && <span className="toast-time" style={{ animationDuration: `${lifetime(t)}ms`, animationPlayState: paused || leaving ? 'paused' : 'running' }} aria-hidden="true" />}
    </div>
  );
}
