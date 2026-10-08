// Which of a list's items were already there when it was first shown: the ones added since (here, or by
// someone else meanwhile) are marked, so they can come in - the weekly's items, a meeting's new tasks,
// the latest orders.

import { useRef } from 'react';

export function useFresh(ids: readonly number[] | undefined): (id: number) => boolean {
  const seen = useRef<Set<number> | null>(null);
  if (!seen.current && ids) seen.current = new Set(ids);
  return (id) => !!seen.current && !seen.current.has(id);
}
