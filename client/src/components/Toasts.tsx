import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router';
import type { Tone } from '@shared/constants';
import { onNotification } from '../lib/realtime';

interface Toast {
  id: number;
  title: string;
  body?: string;
  tone?: Tone;
  link?: string | null;
}

const Ctx = createContext<(t: Omit<Toast, 'id'>) => void>(() => undefined);

export function useToast() {
  return useContext(Ctx);
}

let seq = 0;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const navigate = useNavigate();

  const push = useCallback((t: Omit<Toast, 'id'>) => {
    const id = ++seq;
    setToasts((list) => [...list.slice(-3), { ...t, id }]);
    setTimeout(() => setToasts((list) => list.filter((x) => x.id !== id)), t.tone === 'red' ? 7000 : 4500);
  }, []);

  useEffect(
    () =>
      onNotification((n) =>
        push({
          title: n.title,
          body: n.body,
          link: n.link,
          tone: n.category === 'exception' ? 'red' : n.category === 'action' ? 'blue' : 'green',
        }),
      ),
    [push],
  );

  return (
    <Ctx.Provider value={push}>
      {children}
      <div className="toasts" aria-live="polite">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`toast t-${t.tone ?? 'gray'}`}
            onClick={() => {
              setToasts((list) => list.filter((x) => x.id !== t.id));
              if (t.link) navigate(t.link);
            }}
          >
            <div>
              <div className="t-title">{t.title}</div>
              {t.body && <div className="t-body">{t.body}</div>}
            </div>
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}
