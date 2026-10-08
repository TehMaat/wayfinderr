import { Progress } from '@/components/ui/progress';
import { cn, formatBytes } from '@/lib/utils';
import type { Server } from '@/lib/store';

interface UsageBarProps {
  free: number;
  used: number;
  total: number;
  compact?: boolean;
  /** Bar fill when the total is unknown */
  unknownFill?: number;
}

/** Free space, used/total and a bar that turns amber at 75% and red at 90% */
export function UsageBar({ free, used, total, compact, unknownFill = 0 }: UsageBarProps) {
  const pct = total > 0 ? (used / total) * 100 : 0;
  const color = pct >= 90 ? 'bg-destructive' : pct >= 75 ? 'bg-warning' : 'bg-primary';

  return (
    <div className="space-y-1.5">
      {!compact && (
        <div className="flex items-baseline justify-between text-xs">
          <span className="tabular font-medium text-foreground">
            {formatBytes(free)} <span className="font-normal text-muted-foreground">free</span>
          </span>
          {total > 0 && (
            <span className="tabular text-muted-foreground">
              {formatBytes(used)} / {formatBytes(total)}
            </span>
          )}
        </div>
      )}
      <Progress value={total > 0 ? pct : unknownFill} indicatorClassName={total > 0 ? color : 'bg-muted-foreground/30'} />
    </div>
  );
}

/** Used/total bar; falls back to free space only when the total is unknown */
export function StorageBar({ server, compact }: { server: Server; compact?: boolean }) {
  const free = Number(server.freeSpaceBytes ?? 0);
  const total = Number(server.totalSpaceBytes ?? 0);
  const used = total > 0 ? Math.max(total - free, Number(server.usedSpaceBytes ?? 0)) : 0;

  if (server.reachable === undefined) {
    return <div className={cn('h-1.5 w-full animate-pulse rounded-full bg-muted', compact ? '' : 'mt-1')} />;
  }

  return <UsageBar free={free} used={used} total={total} compact={compact} unknownFill={server.reachable ? 100 : 0} />;
}
