'use client';

import { Trash2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import type { Selection } from '@/lib/selection';
import { cn } from '@/lib/utils';

/** A row's box: the whole cell toggles it, and does not open the row */
export function SelectCell({
  id,
  selection,
  label,
  disabledReason,
  className,
}: {
  id: string;
  selection: Selection;
  label: string;
  disabledReason: string;
  className?: string;
}) {
  const enabled = selection.canSelect(id);
  return (
    <td data-select className={cn('w-10 !pl-3 !pr-0', className)} title={enabled ? undefined : disabledReason}>
      <label className={cn('flex items-center py-2', enabled && 'cursor-pointer')}>
        <Checkbox
          checked={selection.has(id)}
          disabled={!enabled}
          // React fires a checkbox's change on click: shift-click selects the rows in between
          onChange={(e) => selection.toggle(id, (e.nativeEvent as MouseEvent).shiftKey)}
          aria-label={`Select ${label}`}
        />
      </label>
    </td>
  );
}

export function SelectAllCell({ selection, className }: { selection: Selection; className?: string }) {
  return (
    <th className={cn('w-10 !pl-3 !pr-0', className)}>
      <Checkbox
        checked={selection.allSelected}
        indeterminate={selection.someSelected}
        disabled={!selection.allSelected && !selection.canSelectAny}
        onChange={selection.toggleAll}
        aria-label="Select all"
        className="align-middle"
      />
    </th>
  );
}

/** Shown while rows are selected: how many, and what to do with all of them */
export function SelectionBar({
  count,
  noun,
  actionLabel,
  onAction,
  onClear,
}: {
  count: number;
  noun: [string, string];
  actionLabel: string;
  onAction: () => void;
  onClear: () => void;
}) {
  return (
    <div className="flex items-center gap-2 border-b bg-primary/[0.06] px-3 py-1.5">
      <span className="text-[13px] font-medium tabular">
        {count} {count === 1 ? noun[0] : noun[1]} selected
      </span>
      <Button variant="ghost" size="sm" className="h-7 px-2 text-muted-foreground" onClick={onClear}>
        <X />
        Clear
      </Button>
      <Button variant="destructive" size="sm" className="ml-auto h-7 px-2.5" onClick={onAction}>
        <Trash2 />
        {actionLabel}
      </Button>
    </div>
  );
}
