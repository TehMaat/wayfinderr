import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

/** A status label of a setup strip (Rips, Merge): ok, warning or error */
export function Chip({
  icon: Icon,
  tone = 'neutral',
  children,
}: {
  icon: LucideIcon;
  tone?: 'neutral' | 'ok' | 'warning' | 'error';
  children: React.ReactNode;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs',
        tone === 'neutral' && 'text-muted-foreground',
        tone === 'ok' && 'text-foreground',
        tone === 'warning' && 'border-warning/40 bg-warning/10 text-warning',
        tone === 'error' && 'border-destructive/40 bg-destructive/10 text-destructive'
      )}
    >
      <Icon className={cn('h-3.5 w-3.5 shrink-0', tone === 'ok' && 'text-success')} />
      {children}
    </span>
  );
}
