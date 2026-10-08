'use client';

import { useState } from 'react';
import Link from 'next/link';
import {
  ArrowRight,
  ArrowUpFromLine,
  CheckCircle2,
  Clock,
  Disc3,
  FolderInput,
  HardDrive,
  Plus,
  Server as ServerIcon,
  Square,
  XCircle,
  type LucideIcon,
} from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/empty-state';
import { PageHeader } from '@/components/page-header';
import { StatusBadge } from '@/components/status-badge';
import { StorageBar } from '@/components/storage-bar';
import { StopUploadDialog, canStop } from '@/components/upload-actions';
import { UploadTable } from '@/components/upload-table';
import { Tooltip } from '@/components/ui/tooltip';
import { selectTotalSpeed, useAppStore, type Upload } from '@/lib/store';
import { cn, formatBytes, formatDuration, formatSpeed, timeAgo } from '@/lib/utils';

function StatCard({
  label,
  value,
  sub,
  icon: Icon,
  tone,
  href,
}: {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  icon: LucideIcon;
  tone: string;
  href?: string;
}) {
  const body = (
    <Card className={cn('relative overflow-hidden p-4 transition-colors', href && 'hover:border-primary/40')}>
      <div className="flex items-start justify-between">
        <div className="space-y-1">
          <p className="text-xs font-medium text-muted-foreground">{label}</p>
          <p className="text-2xl font-semibold tabular tracking-tight">{value}</p>
        </div>
        <div className={cn('flex h-8 w-8 items-center justify-center rounded-md', tone)}>
          <Icon className="h-4 w-4" />
        </div>
      </div>
      {sub && <p className="mt-2 text-xs text-muted-foreground">{sub}</p>}
    </Card>
  );
  return href ? <Link href={href}>{body}</Link> : body;
}

function ActiveTransfer({ upload }: { upload: Upload }) {
  const transfer = useAppStore((s) => s.transfers[upload.id]);
  const remaining = Number(upload.size) - Number(upload.progressBytes);
  const eta = transfer?.speed ? remaining / transfer.speed : null;
  const uploading = upload.status === 'UPLOADING';
  const [stopOpen, setStopOpen] = useState(false);

  // The filename link covers the whole row (after:inset-0); the stop button sits above it
  return (
    <div className="relative space-y-2 rounded-md p-2 -mx-2 transition-colors hover:bg-accent/50">
      <div className="flex items-center justify-between gap-3">
        <Link href={`/uploads/${upload.id}`} className="truncate text-sm font-medium after:absolute after:inset-0">
          {upload.filename}
        </Link>
        <div className="flex shrink-0 items-center gap-1">
          <StatusBadge status={upload.status} />
          {canStop(upload) && (
            <Tooltip content="Stop">
              <Button
                variant="ghost"
                size="icon"
                className="relative h-6 w-6 text-muted-foreground hover:text-foreground [&_svg]:size-3.5"
                aria-label="Stop"
                onClick={() => setStopOpen(true)}
              >
                <Square className="fill-current" />
              </Button>
            </Tooltip>
          )}
        </div>
      </div>
      <Progress value={uploading ? upload.progress : 0} animated={uploading} className="h-2" />
      <div className="flex items-center justify-between text-xs text-muted-foreground tabular">
        <span>
          {uploading
            ? `${formatBytes(upload.progressBytes)} of ${formatBytes(upload.size)}`
            : formatBytes(upload.size)}
          {upload.server && <> · {upload.server.name}</>}
        </span>
        {uploading && (
          <span>
            {formatSpeed(transfer?.speed ?? 0)} · ETA {formatDuration(eta)}
          </span>
        )}
      </div>
      <StopUploadDialog upload={upload} open={stopOpen} onOpenChange={setStopOpen} />
    </div>
  );
}

export default function Dashboard() {
  const uploads = useAppStore((s) => s.uploads);
  const loaded = useAppStore((s) => s.uploadsLoaded);
  const servers = useAppStore((s) => s.servers);
  const serversLoaded = useAppStore((s) => s.serversLoaded);
  const stats = useAppStore((s) => s.stats);
  const speed = useAppStore(selectTotalSpeed);
  const ripsToChoose = useAppStore((s) => s.rips.filter((r) => r.status === 'NEEDS_ATTENTION').length);

  const active = uploads
    .filter((u) => u.status === 'UPLOADING' || u.status === 'QUEUED' || u.status === 'PENDING')
    .sort((a, b) => (a.status === 'UPLOADING' ? -1 : b.status === 'UPLOADING' ? 1 : 0));
  const uploadingCount = uploads.filter((u) => u.status === 'UPLOADING').length;
  const by = stats?.byStatus ?? {};

  return (
    <div className="mx-auto max-w-7xl space-y-6 p-4 md:p-6">
      <PageHeader title="Dashboard" description="MakeMKV rips are sent to the server with the most free space." />

      {ripsToChoose > 0 && (
        <Link
          href="/rips?filter=attention"
          className="flex items-center gap-3 rounded-lg border border-warning/40 bg-warning/10 px-4 py-3 transition-colors hover:bg-warning/15"
        >
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-warning/15 text-warning">
            <Disc3 className="h-4 w-4" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-warning">
              {ripsToChoose === 1 ? '1 rip needs a choice' : `${ripsToChoose} rips need a choice`}
            </p>
            <p className="truncate text-xs text-muted-foreground">Pick the title on the disc or the film, and the rip goes on.</p>
          </div>
          <ArrowRight className="h-4 w-4 shrink-0 text-warning" />
        </Link>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          label="Completed"
          value={stats ? by.COMPLETED ?? 0 : '–'}
          sub={stats ? `${formatBytes(stats.completedBytes)} transferred` : undefined}
          icon={CheckCircle2}
          tone="bg-success/15 text-success"
          href="/uploads"
        />
        <StatCard
          label="Uploading"
          value={uploadingCount}
          sub={uploadingCount > 0 ? formatSpeed(speed) : 'Idle'}
          icon={ArrowUpFromLine}
          tone="bg-primary/15 text-primary"
        />
        <StatCard
          label="In queue"
          value={stats ? (by.QUEUED ?? 0) + (by.PENDING ?? 0) : '–'}
          sub={stats ? `${by.SKIPPED ?? 0} skipped (no ITA)` : undefined}
          icon={Clock}
          tone="bg-info/15 text-info"
        />
        <StatCard
          label="Failed"
          value={stats ? by.FAILED ?? 0 : '–'}
          sub={(by.FAILED ?? 0) > 0 ? 'Open uploads to retry' : 'All good'}
          icon={XCircle}
          tone="bg-destructive/15 text-destructive"
          href="/uploads"
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <div className="space-y-1.5">
              <CardTitle>Active transfers</CardTitle>
              <CardDescription>Live progress over SFTP</CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            {!loaded ? (
              <div className="space-y-3">
                <Skeleton className="h-12 w-full" />
                <Skeleton className="h-12 w-full" />
              </div>
            ) : active.length === 0 ? (
              <EmptyState
                icon={FolderInput}
                title="Waiting for new files"
                description="When MakeMKV finishes writing a .mkv in the watch folder, it is checked and uploaded automatically."
                className="py-8"
              />
            ) : (
              <div className="space-y-2">
                {active.slice(0, 6).map((u) => (
                  <ActiveTransfer key={u.id} upload={u} />
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="space-y-1.5">
              <CardTitle>Storage</CardTitle>
              <CardDescription>Free space on each server</CardDescription>
            </div>
            <Button variant="ghost" size="sm" asChild>
              <Link href="/servers">
                Manage
                <ArrowRight />
              </Link>
            </Button>
          </CardHeader>
          <CardContent className="space-y-4">
            {!serversLoaded ? (
              <Skeleton className="h-10 w-full" />
            ) : servers.length === 0 ? (
              <EmptyState
                icon={HardDrive}
                title="No servers"
                description="Add your Ultra.cc servers to start uploading."
                action={
                  <Button size="sm" asChild>
                    <Link href="/servers?add=1">
                      <Plus />
                      Add server
                    </Link>
                  </Button>
                }
                className="py-6"
              />
            ) : (
              servers.map((server) => (
                <div key={server.id} className="space-y-1.5">
                  <div className="flex items-center justify-between text-sm">
                    <span className="flex items-center gap-2 font-medium">
                      <ServerIcon className="h-3.5 w-3.5 text-muted-foreground" />
                      {server.name}
                    </span>
                    <span
                      className={cn(
                        'text-[11px]',
                        server.reachable === false ? 'text-destructive' : 'text-muted-foreground'
                      )}
                    >
                      {server.reachable === false ? 'unreachable' : timeAgo(server.lastSpaceCheckAt)}
                    </span>
                  </div>
                  <StorageBar server={server} />
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <div className="space-y-1.5">
            <CardTitle>Recent activity</CardTitle>
            <CardDescription>Last files detected in the watch folder</CardDescription>
          </div>
          <Button variant="ghost" size="sm" asChild>
            <Link href="/uploads">
              View all
              <ArrowRight />
            </Link>
          </Button>
        </CardHeader>
        <div className="border-t">
          {!loaded ? (
            <div className="space-y-2 p-4">
              <Skeleton className="h-9 w-full" />
              <Skeleton className="h-9 w-full" />
            </div>
          ) : uploads.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-muted-foreground">Nothing yet.</p>
          ) : (
            <UploadTable uploads={uploads.slice(0, 8)} compact />
          )}
        </div>
      </Card>
    </div>
  );
}
