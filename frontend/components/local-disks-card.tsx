'use client';

import {
  Database,
  FolderInput,
  FolderSymlink,
  HardDrive,
  MemoryStick,
  Network,
  RefreshCw,
  TriangleAlert,
  type LucideIcon,
} from 'lucide-react';
import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Tooltip } from '@/components/ui/tooltip';
import { UsageBar } from '@/components/storage-bar';
import { useAppStore, type LocalDisk, type LocalFolder } from '@/lib/store';
import { cn } from '@/lib/utils';

const KINDS: Record<LocalDisk['kind'], { icon: LucideIcon; label?: string }> = {
  disk: { icon: HardDrive },
  network: { icon: Network, label: 'Network share' },
  shared: { icon: FolderSymlink, label: 'Host folder' },
  memory: { icon: MemoryStick, label: 'RAM' },
  other: { icon: HardDrive },
};

const FOLDER_ICONS: Record<LocalFolder['key'], LucideIcon> = {
  watch: FolderInput,
  data: Database,
};

function FolderLine({ folder, error }: { folder: LocalFolder; error?: string }) {
  const Icon = error ? TriangleAlert : FOLDER_ICONS[folder.key];
  return (
    <li
      title={folder.path}
      className={cn('flex min-w-0 items-center gap-2 text-xs', error ? 'text-destructive' : 'text-muted-foreground')}
    >
      <Icon className="h-3.5 w-3.5 shrink-0" />
      <span className={cn('shrink-0', !error && 'text-foreground')}>{folder.label}</span>
      <span className="truncate font-mono text-[11px]">{error ? `${error} · ${folder.path}` : folder.path}</span>
    </li>
  );
}

function DiskBlock({ disk }: { disk: LocalDisk }) {
  const kind = KINDS[disk.kind];
  const Icon = kind.icon;
  // tmpfs/overlay report the type as the device too
  const details = [disk.fsType, disk.device !== disk.fsType ? disk.device : null].filter(Boolean).join(' · ');

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2 text-sm">
        <span className="flex min-w-0 items-center gap-2 font-medium">
          <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <span className="truncate font-mono text-[13px]">{disk.mountPoint}</span>
          {kind.label && <Badge variant="info">{kind.label}</Badge>}
        </span>
        {details && <span className="truncate text-[11px] text-muted-foreground">{details}</span>}
      </div>
      <UsageBar free={Number(disk.freeBytes)} used={Number(disk.usedBytes)} total={Number(disk.totalBytes)} />
      <ul className="space-y-1">
        {disk.folders.map((folder) => (
          <FolderLine key={folder.key} folder={folder} />
        ))}
      </ul>
    </div>
  );
}

/** Disk space on the machine running the backend, one entry per filesystem */
export function LocalDisksCard() {
  const report = useAppStore((s) => s.disks);
  const loaded = useAppStore((s) => s.disksLoaded);
  const folderCount = report?.disks.reduce((n, disk) => n + disk.folders.length, 0) ?? 0;
  const [refreshing, setRefreshing] = useState(false);

  // The app shell also refreshes it every minute
  const refresh = async () => {
    setRefreshing(true);
    await useAppStore.getState().loadDisks().catch(() => undefined);
    setRefreshing(false);
  };

  return (
    <Card>
      <CardHeader>
        <div className="space-y-1.5">
          <CardTitle>This machine</CardTitle>
          <CardDescription>Disks holding the watch folder and database</CardDescription>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {report && report.disks.length > 1 && <Badge variant="info">{report.disks.length} disks</Badge>}
          {report && report.disks.length === 1 && folderCount > 1 && <Badge variant="success">Same disk</Badge>}
          <Tooltip content="Recheck disk space">
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={refresh}
              disabled={refreshing}
              aria-label="Recheck disk space"
            >
              <RefreshCw className={cn(refreshing && 'animate-spin')} />
            </Button>
          </Tooltip>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {!loaded ? (
          <Skeleton className="h-10 w-full" />
        ) : !report ? (
          <p className="text-xs text-muted-foreground">Could not read the disk space.</p>
        ) : (
          <>
            {report.disks.map((disk) => (
              <DiskBlock key={disk.id} disk={disk} />
            ))}
            {report.missing.length > 0 && (
              <ul className="space-y-1">
                {report.missing.map((folder) => (
                  <FolderLine key={folder.key} folder={folder} error={folder.error} />
                ))}
              </ul>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
