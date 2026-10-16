'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';

/** A native checkbox in the accent color, with the "some selected" state of a select-all box */
export const Checkbox = React.forwardRef<
  HTMLInputElement,
  Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type'> & { indeterminate?: boolean }
>(({ className, indeterminate = false, ...props }, ref) => {
  const inner = React.useRef<HTMLInputElement>(null);
  React.useImperativeHandle(ref, () => inner.current as HTMLInputElement);
  React.useEffect(() => {
    if (inner.current) inner.current.indeterminate = indeterminate;
  }, [indeterminate]);
  return (
    <input
      ref={inner}
      type="checkbox"
      className={cn('h-4 w-4 cursor-pointer accent-primary disabled:cursor-not-allowed disabled:opacity-30', className)}
      {...props}
    />
  );
});
Checkbox.displayName = 'Checkbox';
