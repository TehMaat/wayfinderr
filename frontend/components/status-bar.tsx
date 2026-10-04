'use client';

import { ArrowUp, Layers, Server as ServerIcon, Wifi, WifiOff } from 'lucide-react';
import { selectTotalSpeed, useAppStore } from '@/lib/store';
import { cn, formatBytes, formatSpeed } from '@/lib/utils';

export function StatusBar() {
  const connected = useAppStore((s) => s.connected);
  const speed = useAppStore(selectTotalSpeed);
  const stats = useAppStore((s) => s.stats);
  const servers = useAppStore((s) => s.servers);
  const uploading = useAppStore((s) => s.uploads.filter((u) => u.status === 'UPLOADING').length);
  const waiting = useAppStore((s) => s.uploads.filter((u) => u.status === 'QUEUED' || u.status === 'PENDING').length);
  const online = servers.filter((s) => s.reachable).length;

  return (
    <footer className="flex h-8 shrink-0 items-center gap-4 border-t bg-sidebar px-4 text-[11px] text-muted-foreground">
      <span className="hidden sm:inline">
        {stats ? `${stats.total} uploads · ${formatBytes(stats.completedBytes)} transferred` : 'Loading…'}
      </span>
      <div className="ml-auto flex items-center gap-4">
        <span className="flex items-center gap-1.5 tabular">
          <ArrowUp className={cn('h-3 w-3', uploading > 0 && 'text-primary')} />
          {formatSpeed(speed)}
        </span>
        <span className="hidden items-center gap-1.5 tabular sm:flex">
          <Layers className="h-3 w-3" />
          {waiting} in queue
        </span>
        <span className="flex items-center gap-1.5 tabular">
          <ServerIcon className="h-3 w-3" />
          {online}/{servers.length} online
        </span>
        <span className={cn('flex items-center gap-1.5', connected ? 'text-success' : 'text-destructive')}>
          {connected ? <Wifi className="h-3 w-3" /> : <WifiOff className="h-3 w-3" />}
          {connected ? 'Live' : 'Reconnecting…'}
        </span>
      </div>
    </footer>
  );
}
