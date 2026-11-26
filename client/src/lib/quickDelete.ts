// Deleting one item from a list at once - a swipe, the trash on its row, or the Delete key - with no
// question asked, and nothing lost to a slip: the item leaves the list now, a message offers to bring
// it back, and the deletion is sent only once that message is gone (expired, closed or swiped away).
// A tab closed while one is still waiting sends it on the way out. It goes through the same request
// and the same checks as deleting several at once (/api/bulk).

import { useSyncExternalStore } from 'react';
import { api } from './api';
import { emitLocalChange } from './realtime';

interface Waiting {
  entity: string;
  id: number;
  /** everything the row stands for (a task's copies, one for each person) - usually just the item */
  ids: number[];
  topics: string[];
}

type ToastFn = (t: { title: string; body?: string; tone?: 'gray' | 'red' | 'green'; action?: { label: string; run: () => void }; onEnd?: () => void }) => void;

const keyOf = (entity: string, id: number) => `${entity}:${id}`;
/** items out of the lists: waiting to be sent, or sent and on their way out of the data */
const hidden = new Set<string>();
const waiting = new Map<string, Waiting>();
const listeners = new Set<() => void>();
const tell = () => listeners.forEach((l) => l());
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => void listeners.delete(l);
};

/** is this item on its way out (its row folds away) */
export function useRemoving(entity: string | undefined, id: number): boolean {
  return useSyncExternalStore(
    subscribe,
    () => !!entity && hidden.has(keyOf(entity, id)),
    () => false,
  );
}

const body = (w: Waiting) => JSON.stringify({ entity: w.entity, action: 'delete', ids: w.ids });

async function send(w: Waiting, label: string, toast: ToastFn): Promise<void> {
  const k = keyOf(w.entity, w.id);
  const back = () => {
    hidden.delete(k);
    tell();
  };
  try {
    const r = await api.post<{ done: number; failed: { id: number; error: string }[] }>('/api/bulk', JSON.parse(body(w)));
    if (r.failed.length) {
      back();
      toast({ title: 'לא נמחק', body: `${label}: ${r.failed[0].error}`, tone: 'red' });
      // some of what the row stood for may have gone: the list shows what is left
      if (r.done) emitLocalChange(...w.topics);
      return;
    }
    emitLocalChange(...w.topics);
  } catch (e) {
    back();
    toast({ title: (e as Error).message, tone: 'red' });
  }
}

export function quickDelete({ entity, id, ids = [id], label, topics, toast }: { entity: string; id: number; ids?: number[]; label: string; topics: string[]; toast: ToastFn }): void {
  const k = keyOf(entity, id);
  if (hidden.has(k)) return;
  const w: Waiting = { entity, id, ids, topics };
  hidden.add(k);
  waiting.set(k, w);
  tell();
  let undone = false;
  toast({
    title: 'נמחק',
    body: label,
    tone: 'gray',
    action: {
      label: 'ביטול',
      run: () => {
        undone = true;
        waiting.delete(k);
        hidden.delete(k);
        tell();
      },
    },
    onEnd: () => {
      if (undone || !waiting.has(k)) return;
      waiting.delete(k);
      void send(w, label, toast);
    },
  });
}

if (typeof window !== 'undefined') {
  // closed with a deletion still waiting: it goes on the way out
  window.addEventListener('pagehide', () => {
    for (const w of waiting.values()) {
      void fetch('/api/bulk', { method: 'POST', keepalive: true, credentials: 'same-origin', headers: { 'x-kks': '1', 'content-type': 'application/json' }, body: body(w) }).catch(() => undefined);
    }
    waiting.clear();
  });
}
