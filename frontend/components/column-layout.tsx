'use client';

import { Check, Columns3, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Tooltip } from '@/components/ui/tooltip';
import type { ColumnLayout } from '@/lib/columns';
import { cn } from '@/lib/utils';

/** The column widths of a fixed layout (nothing while sized to the content) */
export function ColGroup({ layout }: { layout: ColumnLayout }) {
  if (!layout.fixed) return null;
  return (
    <colgroup>
      {layout.visible.map((column) => (
        <col key={column.id} data-col={column.id} style={{ width: layout.widthOf(column) }} />
      ))}
    </colgroup>
  );
}

/** A header cell, with a handle on its right edge to drag its width */
export function ColumnHeader({
  layout,
  id,
  className,
  children,
}: {
  layout: ColumnLayout;
  id: string;
  className?: string;
  children?: React.ReactNode;
}) {
  const column = layout.visible.find((c) => c.id === id);
  const handle = layout.resizable && column && !column.flex && !column.fixed;
  return (
    <th className={cn('relative', layout.fixed && 'overflow-hidden text-ellipsis', className)}>
      {children}
      {handle && (
        <span
          role="separator"
          aria-orientation="vertical"
          title="Drag to resize · double-click to reset the widths"
          onPointerDown={(e) => layout.startResize(id, e)}
          onDoubleClick={layout.resetWidths}
          className="group absolute inset-y-0 right-0 flex w-2 cursor-col-resize touch-none select-none justify-center"
        >
          <span className="my-2 w-px bg-border transition-colors group-hover:bg-primary" />
        </span>
      )}
    </th>
  );
}

/** The columns to show, and back to the starting ones */
export function ColumnPicker({ layout }: { layout: ColumnLayout }) {
  return (
    <DropdownMenu>
      <Tooltip content="Columns">
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" aria-label="Columns">
            <Columns3 />
          </Button>
        </DropdownMenuTrigger>
      </Tooltip>
      <DropdownMenuContent align="end">
        {layout.pickable.map((column) => {
          const shown = layout.isShown(column.id);
          return (
            <DropdownMenuItem
              key={column.id}
              // Stays open to pick more
              onSelect={(e) => {
                e.preventDefault();
                layout.setShown(column.id, !shown);
              }}
            >
              <Check className={cn(!shown && 'invisible')} />
              {column.label}
            </DropdownMenuItem>
          );
        })}
        <DropdownMenuSeparator />
        <DropdownMenuItem disabled={!layout.customized} onSelect={layout.reset}>
          <RotateCcw />
          Reset columns
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
