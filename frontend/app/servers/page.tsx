'use client';

import { useEffect, useState } from 'react';
import {
  Activity,
  FolderOpen,
  HardDrive,
  KeyRound,
  MoreHorizontal,
  Pencil,
  Plus,
  RefreshCw,
  Server as ServerIcon,
  ShieldCheck,
  Trash2,
  UploadCloud,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { EmptyState } from '@/components/empty-state';
import { PageHeader } from '@/components/page-header';
import { ServerDialog } from '@/components/server-dialog';
import { StorageBar } from '@/components/storage-bar';
import { deleteServer, refreshServerSpace, testServer } from '@/lib/actions';
import { useAppStore, type Server } from '@/lib/store';
import { cn, timeAgo } from '@/lib/utils';

function Detail({ icon: Icon, children }: { icon: typeof ServerIcon; children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
      <Icon className="h-3.5 w-3.5 shrink-0" />
      <span className="truncate">{children}</span>
    </div>
  );
}

function ServerCard({ server, onEdit }: { server: Server; onEdit: () => void }) {
  const stats = useAppStore((s) => s.stats);
  const uploading = useAppStore((s) => s.uploads.some((u) => u.serverId === server.id && u.status === 'UPLOADING'));
  const [testing, setTesting] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const status =
    server.reachable === undefined
      ? { label: 'Checking', className: 'bg-muted-foreground/40' }
      : server.reachable
        ? { label: 'Online', className: 'bg-success shadow-[0_0_6px_hsl(var(--success))]' }
        : { label: 'API unreachable', className: 'bg-destructive' };

  return (
    <Card className="flex flex-col">
      <div className="flex items-start justify-between gap-3 p-4 pb-3">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-primary/15 text-primary">
            <ServerIcon className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <p className="truncate font-semibold">{server.name}</p>
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <span className={cn('h-1.5 w-1.5 rounded-full', status.className)} />
              {status.label}
              {uploading && (
                <Badge className="ml-1">
                  <UploadCloud />
                  Uploading
                </Badge>
              )}
            </p>
          </div>
        </div>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" aria-label="Server actions">
              <MoreHorizontal />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={onEdit}>
              <Pencil />
              Edit
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={async () => {
                setRefreshing(true);
                await refreshServerSpace(server.id);
                setRefreshing(false);
              }}
            >
              <RefreshCw />
              Refresh space
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem destructive onSelect={() => setConfirmOpen(true)}>
              <Trash2 />
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className="px-4 pb-4">
        <StorageBar server={server} />
      </div>

      <div className="grid gap-2 border-t px-4 py-3">
        <Detail icon={KeyRound}>
          {server.sshUsername}@{server.sshHost}:{server.sshPort} · {server.hasSshPassword ? 'password' : 'SSH key'}
        </Detail>
        <Detail icon={FolderOpen}>{server.sshPath}</Detail>
        <Detail icon={ShieldCheck}>
          {server.mediaCheckPolicy === 'SKIP_NO_ITA' ? 'Only files with Italian audio/subs' : 'Uploads every file'} ·{' '}
          {server.maxRetries} retries
        </Detail>
        <Detail icon={Activity}>
          {stats?.byServer[server.id] ?? 0} uploads · space checked {timeAgo(server.lastSpaceCheckAt)}
          {refreshing && '…'}
        </Detail>
      </div>

      <div className="mt-auto flex gap-2 border-t p-3">
        <Button
          variant="secondary"
          size="sm"
          className="flex-1"
          disabled={testing}
          onClick={async () => {
            setTesting(true);
            await testServer(server.id);
            setTesting(false);
          }}
        >
          <Activity className={cn(testing && 'animate-pulse')} />
          {testing ? 'Testing…' : 'Test connection'}
        </Button>
        <Button variant="ghost" size="sm" onClick={onEdit}>
          <Pencil />
          Edit
        </Button>
      </div>

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={`Delete ${server.name}?`}
        description="The server is removed from Wayfinderr. Upload history is kept, files on the server are not touched."
        onConfirm={() => deleteServer(server.id)}
      />
    </Card>
  );
}

export default function ServersPage() {
  const servers = useAppStore((s) => s.servers);
  const loaded = useAppStore((s) => s.serversLoaded);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Server | undefined>(undefined);

  // /servers?add=1 (sidebar "+" and dashboard) opens the add dialog
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('add')) {
      setEditing(undefined);
      setDialogOpen(true);
      window.history.replaceState(null, '', '/servers');
    }
  }, []);

  const openAdd = () => {
    setEditing(undefined);
    setDialogOpen(true);
  };

  return (
    <div className="mx-auto max-w-7xl space-y-6 p-4 md:p-6">
      <PageHeader
        title="Servers"
        description="Uploads go to the reachable server with the most free space, one file per server at a time."
        actions={
          <Button onClick={openAdd}>
            <Plus />
            Add server
          </Button>
        }
      />

      {!loaded ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          <Skeleton className="h-72" />
          <Skeleton className="h-72" />
        </div>
      ) : servers.length === 0 ? (
        <Card>
          <EmptyState
            icon={HardDrive}
            title="No servers configured"
            description="Add your Ultra.cc servers: Wayfinderr checks their free space and uploads over SFTP."
            action={
              <Button onClick={openAdd}>
                <Plus />
                Add server
              </Button>
            }
          />
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {servers.map((server) => (
            <ServerCard
              key={server.id}
              server={server}
              onEdit={() => {
                setEditing(server);
                setDialogOpen(true);
              }}
            />
          ))}
        </div>
      )}

      <ServerDialog open={dialogOpen} onOpenChange={setDialogOpen} server={editing} />
    </div>
  );
}
