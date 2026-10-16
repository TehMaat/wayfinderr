import { useCallback, useMemo, useRef, useState } from 'react';

export type Selection = {
  /** The selected ids still in the list and still selectable */
  ids: string[];
  has: (id: string) => boolean;
  canSelect: (id: string) => boolean;
  /** Shift extends from the last row clicked */
  toggle: (id: string, shift?: boolean) => void;
  allSelected: boolean;
  canSelectAny: boolean;
  someSelected: boolean;
  toggleAll: () => void;
  clear: () => void;
};

/** Rows picked for an action on many at once: rows that leave the list or stop being selectable drop out */
export function useSelection<T extends { id: string }>(items: T[], selectable: (item: T) => boolean): Selection {
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const anchor = useRef<string | null>(null);

  const allowed = useMemo(() => items.filter(selectable).map((i) => i.id), [items, selectable]);
  const allowedSet = useMemo(() => new Set(allowed), [allowed]);
  const ids = useMemo(() => allowed.filter((id) => picked.has(id)), [allowed, picked]);

  const toggle = useCallback(
    (id: string, shift = false) => {
      const from = shift && anchor.current ? items.findIndex((i) => i.id === anchor.current) : -1;
      const to = items.findIndex((i) => i.id === id);
      setPicked((prev) => {
        const next = new Set(prev);
        const on = !prev.has(id);
        // The rows between the last one clicked and this one get this one's new state
        const range =
          from >= 0 && to >= 0 ? items.slice(Math.min(from, to), Math.max(from, to) + 1).map((i) => i.id) : [id];
        for (const r of range) if (allowedSet.has(r)) on ? next.add(r) : next.delete(r);
        return next;
      });
      anchor.current = id;
    },
    [items, allowedSet]
  );

  const allSelected = allowed.length > 0 && ids.length === allowed.length;
  const toggleAll = useCallback(() => {
    setPicked(allSelected ? new Set() : new Set(allowed));
    anchor.current = null;
  }, [allSelected, allowed]);
  const clear = useCallback(() => {
    setPicked(new Set());
    anchor.current = null;
  }, []);

  return {
    ids,
    has: (id) => allowedSet.has(id) && picked.has(id),
    canSelect: (id) => allowedSet.has(id),
    toggle,
    allSelected,
    canSelectAny: allowed.length > 0,
    someSelected: ids.length > 0 && !allSelected,
    toggleAll,
    clear,
  };
}
