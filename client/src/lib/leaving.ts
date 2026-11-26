// What was open on screen and is now finished does not just vanish: it stays where it was for a moment,
// done, then folds away - the bell does the same (lib/notifications.ts). A list hands its open rows and
// says, of the ones that went, which went because they were finished (and how they look done); the
// others come and go as before. The finished ones are then under the list's "done" drawer
// (components/DoneDrawer.tsx), when it has one.

import { useEffect, useRef, useState } from 'react';

export type LeavePhase = 'done' | 'fold';

/** a moment to see it done, then the fold */
const HOLD_MS = 850;
const FOLD_MS = 380;

interface Going<T> {
  item: T;
  /** where it stood, to stay there */
  at: number;
  phase: LeavePhase;
}

export function useLeaving<T, K extends string | number>(
  rows: readonly T[],
  keyOf: (x: T) => K,
  /** a row that went: finished, as it should look now (done) - or not, and it just goes */
  finished: (key: K, last: T) => T | null | undefined | false,
): { rows: T[]; phaseOf: (key: K) => LeavePhase | undefined } {
  const [prev, setPrev] = useState(rows);
  const [going, setGoing] = useState<ReadonlyMap<K, Going<T>>>(() => new Map());
  if (rows !== prev) {
    const now = new Set(rows.map(keyOf));
    let next: Map<K, Going<T>> | null = null;
    // back while it was going (opened again): it stays
    for (const k of going.keys()) if (now.has(k)) (next ??= new Map(going)).delete(k);
    prev.forEach((x, i) => {
      const k = keyOf(x);
      if (now.has(k) || going.has(k)) return;
      const done = finished(k, x);
      if (done) (next ??= new Map(going)).set(k, { item: done, at: i, phase: 'done' });
    });
    setPrev(rows);
    if (next) setGoing(next);
  }

  const timers = useRef(new Map<K, ReturnType<typeof setTimeout>>());
  useEffect(() => {
    const quick = matchMedia('(prefers-reduced-motion: reduce)').matches;
    for (const k of going.keys()) {
      if (timers.current.has(k)) continue;
      timers.current.set(
        k,
        setTimeout(
          () => {
            setGoing((m) => (m.has(k) ? new Map(m).set(k, { ...m.get(k)!, phase: 'fold' }) : m));
            timers.current.set(
              k,
              setTimeout(() => {
                timers.current.delete(k);
                setGoing((m) => {
                  if (!m.has(k)) return m;
                  const n = new Map(m);
                  n.delete(k);
                  return n;
                });
              }, quick ? 200 : FOLD_MS),
            );
          },
          quick ? 500 : HOLD_MS,
        ),
      );
    }
    // came back meanwhile: its timers stop
    for (const [k, t] of timers.current)
      if (!going.has(k)) {
        clearTimeout(t);
        timers.current.delete(k);
      }
  }, [going]);
  useEffect(() => {
    const all = timers.current;
    return () => {
      all.forEach(clearTimeout);
      all.clear();
    };
  }, []);

  if (!going.size) return { rows: rows as T[], phaseOf: () => undefined };
  const merged = [...rows];
  for (const g of [...going.values()].sort((a, b) => a.at - b.at)) merged.splice(Math.min(g.at, merged.length), 0, g.item);
  return { rows: merged, phaseOf: (k) => going.get(k)?.phase };
}

/** the classes of a row that may leave: always there (so the row is never rebuilt), done and folding when it goes */
export const leaveClass = (phase: LeavePhase | undefined) => `leave-wrap${phase ? ' is-finished' : ''}${phase === 'fold' ? ' is-folding' : ''}`;

// what was marked finished here a moment ago, by kind ("tasks"): a list it then goes from lets it go done
const marked = new Map<string, number>();
export function noteFinished(kind: string, ids: Iterable<number>): void {
  const now = Date.now();
  for (const id of ids) marked.set(`${kind}:${id}`, now);
}
export function forgetFinished(kind: string, id: number): void {
  marked.delete(`${kind}:${id}`);
}
export function finishedJustNow(kind: string, id: number): boolean {
  const at = marked.get(`${kind}:${id}`);
  return at !== undefined && Date.now() - at < 30_000;
}
