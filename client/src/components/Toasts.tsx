import { createContext, useCallback, useContext, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { animateSpring, project, velocityOf, type SpringRun } from '../lib/spring';
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
  /** called once when it is gone - expired, closed, swiped away or pushed out by newer ones */
  onEnd?: () => void;
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
  const shown = useRef<Toast[]>([]);
  const navigate = useNavigate();
  // a message's end is told once, however it goes (a deletion waits for it to be sent)
  const ended = useRef(new Set<number>());
  const end = (t: Toast) => {
    if (ended.current.has(t.id)) return;
    ended.current.add(t.id);
    t.onEnd?.();
  };

  const push = useCallback((t: Omit<Toast, 'id'>) => {
    // the same message twice in a moment (a double click that was sent once) shows once
    const key = `${t.tone ?? ''}|${t.title}|${t.body ?? ''}`;
    const now = Date.now();
    if (lastShown.key === key && now - lastShown.at < 1500) return;
    lastShown = { key, at: now };
    const id = ++seq;
    // four at most: the oldest makes room
    const next = [...shown.current, { ...t, id }];
    const out = next.slice(0, Math.max(0, next.length - 4));
    shown.current = next.slice(-4);
    setToasts(shown.current);
    out.forEach(end);
  }, []);
  const remove = useCallback((id: number) => {
    const gone = shown.current.find((x) => x.id === id);
    shown.current = shown.current.filter((x) => x.id !== id);
    setToasts(shown.current);
    if (gone) end(gone);
  }, []);

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
  const [leaving, setLeaving] = useState<'' | 'out'>('');
  const [paused, setPaused] = useState(false);
  const left = useRef(lifetime(t));
  const startedAt = useRef(Date.now());
  const drag = useRef<{ x: number; id: number; moved: boolean; points: { y: number; t: number }[] } | null>(null);
  // swiped: it follows the finger, and let go it flies off with the finger's speed or springs back
  const box = useRef<HTMLDivElement>(null);
  const run = useRef<SpringRun | null>(null);
  const x = useRef(0);
  const swiped = useRef(false);
  const paint = (v: number) => {
    x.current = v;
    const el = box.current;
    if (!el) return;
    el.style.transform = v ? `translate3d(${v}px, 0, 0)` : '';
    el.style.opacity = v ? String(Math.max(0.25, 1 - Math.abs(v) / 260)) : '';
    el.style.transition = v ? 'none' : '';
  };
  useEffect(() => {
    return () => void run.current?.stop();
  }, []);

  const leave = useCallback(() => setLeaving((l) => l || 'out'), []);
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
    if (e.pointerType === 'mouse' || swiped.current || (e.target as HTMLElement).closest('button')) return;
    // caught while springing back: it is taken from where it is
    if (run.current) x.current = run.current.stop().value;
    run.current = null;
    // its entrance still running: it stops on the frame it is at, and the finger takes it from there
    for (const a of box.current?.getAnimations() ?? []) a.cancel();
    drag.current = { x: e.clientX - x.current, id: e.pointerId, moved: false, points: [{ y: e.clientX, t: e.timeStamp }] };
    setPaused(true);
  };
  const onPointerMove = (e: ReactPointerEvent) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    const delta = e.clientX - d.x;
    if (Math.abs(delta) > 6) d.moved = true;
    paint(delta);
    d.points.push({ y: e.clientX, t: e.timeStamp });
    if (d.points.length > 12) d.points.shift();
  };
  const endDrag = (e: ReactPointerEvent) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    drag.current = null;
    const v = velocityOf(d.points);
    // where the flick is heading (a snappier deceleration than a scroll), not where the finger stopped
    const heading = x.current + project(v, 0.99);
    if (Math.abs(heading) > 110) {
      swiped.current = true;
      const dir = Math.sign(heading);
      run.current = animateSpring(x.current, dir * ((box.current?.offsetWidth ?? 320) + 40), { response: 0.26, velocity: v, onUpdate: paint, onDone: onGone });
    } else {
      setPaused(false);
      run.current = animateSpring(x.current, 0, { response: 0.3, velocity: v, onUpdate: paint, onDone: () => (run.current = null) });
    }
  };

  return (
    <div
      ref={box}
      className={`toast t-${t.tone ?? 'gray'}${leaving ? ' is-leaving' : ''}${t.action ? ' has-action' : ''}`}
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
