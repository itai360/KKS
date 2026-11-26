// A question in the app's own dialog instead of the browser's confirm(): it
// says what will happen in words, names the button by its action ("מחיקה",
// "שחזור"), marks what cannot be undone in red, and does not block the page.

import { useEffect, useState, type ReactNode } from 'react';
import { Modal } from './ui';

export interface AskOptions {
  title: string;
  body?: ReactNode;
  /** the confirming button, named by what it does */
  confirm?: string;
  cancel?: string;
  /** destructive: a red button, and the focus starts on "cancel" */
  danger?: boolean;
}

type Pending = AskOptions & { id: number; resolve: (ok: boolean) => void };
let push: ((p: Pending) => void) | null = null;
let nextId = 1;

/** Asks; resolves true when confirmed, false when cancelled or closed. */
export function ask(options: AskOptions): Promise<boolean> {
  return new Promise((resolve) => {
    if (!push) {
      resolve(window.confirm(options.title)); // no host on the page (should not happen)
      return;
    }
    push({ ...options, id: nextId++, resolve });
  });
}

/** Mounted once at the root: shows the questions one at a time. */
export function ConfirmHost() {
  const [queue, setQueue] = useState<Pending[]>([]);
  useEffect(() => {
    push = (p) => setQueue((q) => [...q, p]);
    return () => {
      push = null;
    };
  }, []);
  const cur = queue[0];
  if (!cur) return null;
  const done = (ok: boolean) => {
    cur.resolve(ok);
    setQueue((q) => q.slice(1));
  };
  return (
    <Modal
      key={cur.id}
      title={cur.title}
      onClose={() => done(false)}
      narrow
      footer={
        <>
          <button className={`btn ${cur.danger ? 'btn-danger-solid' : 'btn-primary'}`} onClick={() => done(true)} data-autofocus={cur.danger ? undefined : true}>
            {cur.confirm ?? 'אישור'}
          </button>
          <button className="btn btn-ghost" onClick={() => done(false)} data-autofocus={cur.danger ? true : undefined}>
            {cur.cancel ?? 'ביטול'}
          </button>
        </>
      }
    >
      {cur.body ? <div className="confirm-body">{cur.body}</div> : null}
    </Modal>
  );
}
