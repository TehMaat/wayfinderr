import { cn } from '@/lib/utils';

interface ProgressProps {
  value: number;
  className?: string;
  indicatorClassName?: string;
  animated?: boolean;
}

export function Progress({ value, className, indicatorClassName, animated }: ProgressProps) {
  const pct = Math.max(0, Math.min(100, value || 0));
  return (
    <div className={cn('relative h-1.5 w-full overflow-hidden rounded-full bg-muted', className)}>
      <div
        className={cn(
          'h-full rounded-full bg-primary transition-[width] duration-500 ease-out',
          animated && 'progress-striped animate-progress-stripes',
          indicatorClassName
        )}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}
