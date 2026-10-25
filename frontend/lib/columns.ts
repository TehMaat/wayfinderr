import { useCallback, useEffect, useMemo, useState } from 'react';

export interface Column {
  id: string;
  /** Its name in the column picker; none: always shown */
  label?: string;
  /** Width once laid out from the widths (until resized): px, or a share of the table ('26%') */
  width?: number | string;
  /** Narrowest it can be dragged to, px */
  minWidth?: number;
  /** Takes the room left: not resized itself */
  flex?: boolean;
  /** Not resized (checkboxes, actions) */
  fixed?: boolean;
  /** Hidden until picked */
  hidden?: boolean;
}

type Saved = { shown?: Record<string, boolean>; widths?: Record<string, number> };

export type ColumnLayout = {
  /** The visible columns, in order: the header cells must be these */
  visible: Column[];
  /** The columns that can be hidden, for the picker */
  pickable: Column[];
  isShown: (id: string) => boolean;
  setShown: (id: string, shown: boolean) => void;
  /** Laid out from the widths (table-layout: fixed): always, or once a column is resized; else sized to the content */
  fixed: boolean;
  resizable: boolean;
  widthOf: (column: Column) => number | string | undefined;
  /** Narrowest the table gets before it scrolls sideways */
  minWidth: number;
  /** From a header cell's handle */
  startResize: (id: string, event: React.PointerEvent<HTMLElement>) => void;
  resetWidths: () => void;
  customized: boolean;
  reset: () => void;
};

const MIN_WIDTH = 48;
const FLEX_MIN_WIDTH = 160;

const storageKey = (key: string) => `columns:${key}`;

function load(key: string): Saved {
  try {
    return JSON.parse(localStorage.getItem(storageKey(key)) ?? '{}') as Saved;
  } catch {
    return {};
  }
}

function save(key: string, saved: Saved) {
  try {
    localStorage.setItem(storageKey(key), JSON.stringify(saved));
  } catch {
    // Storage unavailable (private window): kept until the page is left
  }
}

/**
 * Which columns of a table are shown and how wide they are, kept in this browser
 * under storageKey. Widths are dragged from the header cells: the first drag fixes
 * every column at its width on screen, a double-click goes back to the starting ones.
 */
export function useColumnLayout(
  columns: Column[],
  { storageKey: key, resizable = false, alwaysFixed = false }: { storageKey?: string; resizable?: boolean; alwaysFixed?: boolean } = {}
): ColumnLayout {
  const [shown, setShownMap] = useState<Record<string, boolean>>({});
  const [widths, setWidths] = useState<Record<string, number>>({});
  const [ready, setReady] = useState(false);

  // Read after mounting: the server render has no storage
  useEffect(() => {
    if (!key) return;
    const saved = load(key);
    setShownMap(saved.shown ?? {});
    setWidths(saved.widths ?? {});
    setReady(true);
  }, [key]);

  // Saved once read, not to overwrite it with the starting layout
  useEffect(() => {
    if (key && ready) save(key, { shown, widths });
  }, [key, ready, shown, widths]);

  const isShown = useCallback(
    (id: string) => {
      const column = columns.find((c) => c.id === id);
      return Boolean(column) && (!column!.label || (shown[id] ?? !column!.hidden));
    },
    [columns, shown]
  );
  const visible = useMemo(() => columns.filter((c) => isShown(c.id)), [columns, isShown]);
  const pickable = useMemo(() => columns.filter((c) => c.label), [columns]);
  const fixed = alwaysFixed || Object.keys(widths).length > 0;

  const widthOf = useCallback(
    (column: Column) => (column.flex ? undefined : widths[column.id] ?? column.width),
    [widths]
  );
  const minWidth = visible.reduce((sum, c) => {
    const width = widthOf(c);
    return sum + (c.flex ? c.minWidth ?? FLEX_MIN_WIDTH : typeof width === 'number' ? width : c.minWidth ?? MIN_WIDTH);
  }, 0);

  const startResize = useCallback(
    (id: string, event: React.PointerEvent<HTMLElement>) => {
      if (event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      const row = event.currentTarget.closest('tr');
      const table = event.currentTarget.closest('table');
      if (!row || !table) return;

      // Start from what is on screen: every column but the flex one at its current width
      const start: Record<string, number> = {};
      Array.from(row.children).forEach((cell, i) => {
        const column = visible[i];
        if (column && !column.flex) start[column.id] = Math.round(cell.getBoundingClientRect().width);
      });
      const from = start[id];
      const column = visible.find((c) => c.id === id);
      if (from === undefined || !column) return;
      const others = visible.reduce((sum, c) => sum + (c.flex ? c.minWidth ?? FLEX_MIN_WIDTH : c.id === id ? 0 : start[c.id] ?? 0), 0);
      // Hidden columns keep their widths
      setWidths((w) => ({ ...w, ...start }));

      // While dragging the <col> is resized directly, the rows render again only at the end
      const x = event.clientX;
      let width = from;
      const move = (e: PointerEvent) => {
        width = Math.max(column.minWidth ?? MIN_WIDTH, Math.round(from + e.clientX - x));
        const col = table.querySelector<HTMLElement>(`col[data-col="${id}"]`);
        if (col) col.style.width = `${width}px`;
        table.style.minWidth = `${others + width}px`;
      };
      const up = () => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        document.body.style.removeProperty('cursor');
        document.body.style.removeProperty('user-select');
        setWidths((w) => ({ ...w, [id]: width }));
      };
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    },
    [visible]
  );

  const setShown = useCallback((id: string, value: boolean) => setShownMap((s) => ({ ...s, [id]: value })), []);
  const resetWidths = useCallback(() => setWidths({}), []);
  const reset = useCallback(() => {
    setShownMap({});
    setWidths({});
  }, []);
  const customized = Object.keys(widths).length > 0 || pickable.some((c) => isShown(c.id) === Boolean(c.hidden));

  return {
    visible,
    pickable,
    isShown,
    setShown,
    fixed,
    resizable,
    widthOf,
    minWidth,
    startResize,
    resetWidths,
    customized,
    reset,
  };
}
