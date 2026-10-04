import { Progress } from '@/components/ui/progress';
import { cn, formatBytes } from '@/lib/utils';
import type { Server } from '@/lib/store';

/** Used/total bar; falls back to free space only when the total is unknown */
export function StorageBar({ server, compact }: { server: Server; compact?: boolean }) {
  const free = Number(server.freeSpaceBytes ?? 0);
  const total = Number(server.totalSpaceBytes ?? 0);
  const used = total > 0 ? Math.max(total - free, Number(server.usedSpaceBytes ?? 0)) : 0;
  const pct = total > 0 ? (used / total) * 100 : 0;
  const color = pct >= 90 ? 'bg-destructive' : pct >= 75 ? 'bg-warning' : 'bg-primary';

  if (server.reachable === undefined) {
    return <div className={cn('h-1.5 w-full animate-pulse rounded-full bg-muted', compact ? '' : 'mt-1')} />;
  }

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
      <Progress value={total > 0 ? pct : server.reachable ? 100 : 0} indicatorClassName={total > 0 ? color : 'bg-muted-foreground/30'} />
    </div>
  );
}
