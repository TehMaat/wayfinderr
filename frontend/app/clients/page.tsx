'use client';

import { useState } from 'react';
import {
  Activity,
  Clapperboard,
  FolderOpen,
  KeyRound,
  Link2,
  Magnet,
  MoreHorizontal,
  Pencil,
  Plus,
  ShieldCheck,
  Tag,
  Trash2,
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
import { ClientDialog } from '@/components/client-dialog';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { EmptyState } from '@/components/empty-state';
import { PageHeader } from '@/components/page-header';
import { deleteClient, testClient } from '@/lib/actions';
import { useAppStore, type TorrentClient } from '@/lib/store';
import { cn } from '@/lib/utils';

function Detail({ icon: Icon, children }: { icon: typeof Magnet; children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
      <Icon className="h-3.5 w-3.5 shrink-0" />
      <span className="truncate">{children}</span>
    </div>
  );
}

function ClientCard({ client, onEdit }: { client: TorrentClient; onEdit: () => void }) {
  const [testing, setTesting] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const auth = client.hasApiKey ? 'API key' : client.username ? `login as ${client.username}` : 'no login';

  return (
    <Card className="flex flex-col">
      <div className="flex items-start justify-between gap-3 p-4 pb-3">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-primary/15 text-primary">
            <Magnet className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <p className="truncate font-semibold">{client.name}</p>
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <span
                className={cn(
                  'h-1.5 w-1.5 rounded-full',
                  client.enabled ? 'bg-success shadow-[0_0_6px_hsl(var(--success))]' : 'bg-muted-foreground/40'
                )}
              />
              qBittorrent · {client.enabled ? 'Enabled' : 'Disabled'}
            </p>
          </div>
        </div>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" aria-label="Client actions">
              <MoreHorizontal />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={onEdit}>
              <Pencil />
              Edit
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem destructive onSelect={() => setConfirmOpen(true)}>
              <Trash2 />
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className="grid gap-2 border-t px-4 py-3">
        <Detail icon={Link2}>{client.url}</Detail>
        <Detail icon={KeyRound}>{auth}</Detail>
        <Detail icon={Tag}>{client.category ? `Category "${client.category}"` : 'All finished torrents'}</Detail>
        <Detail icon={ShieldCheck}>
          {client.autoRemove ? 'Removes automatically when the match is certain' : 'Only suggests, you remove'}
        </Detail>
        <Detail icon={FolderOpen}>{client.deleteFiles ? 'Deletes the downloaded files too' : 'Keeps the downloaded files'}</Detail>
      </div>

      <div className="mt-auto flex gap-2 border-t p-3">
        <Button
          variant="secondary"
          size="sm"
          className="flex-1"
          disabled={testing}
          onClick={async () => {
            setTesting(true);
            await testClient(client.id);
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
        title={`Delete ${client.name}?`}
        description="Wayfinderr stops removing torrents from this client. Nothing in qBittorrent is touched."
        onConfirm={() => deleteClient(client.id)}
      />
    </Card>
  );
}

// The TMDB key is the ripper's (TMDB_API_KEY): shown here because matching uses it too
function TmdbCard() {
  const ripStatus = useAppStore((s) => s.ripStatus);
  const configured = ripStatus?.tmdbConfigured;

  return (
    <Card className="p-4">
      <div className="flex min-w-0 items-start gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-primary/15 text-primary">
          <Clapperboard className="h-4 w-4" />
        </div>
        <div className="min-w-0 space-y-1">
          <p className="flex items-center gap-2 font-semibold">
            TMDB
            {ripStatus === null ? null : configured ? (
              <Badge variant="success">Configured</Badge>
            ) : (
              <Badge variant="warning">TMDB_API_KEY not set</Badge>
            )}
          </p>
          <p className="text-xs text-muted-foreground">
            Matches an MKV to its torrent across languages: &quot;IL_PADRINO&quot; and
            &quot;The.Godfather.1972.BluRay&quot; are the same film. Without it only names in the same language match.
            Discs ripped by Wayfinderr are matched by their download, TMDB or not. The key is the one the ripper uses:
            set <code className="font-mono">TMDB_API_KEY</code> (free from themoviedb.org → Settings → API).
          </p>
        </div>
      </div>
    </Card>
  );
}

export default function ClientsPage() {
  const clients = useAppStore((s) => s.clients);
  const loaded = useAppStore((s) => s.clientsLoaded);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<TorrentClient | undefined>(undefined);

  const openAdd = () => {
    setEditing(undefined);
    setDialogOpen(true);
  };

  return (
    <div className="mx-auto max-w-7xl space-y-6 p-4 md:p-6">
      <PageHeader
        title="Clients"
        description="Once an MKV is uploaded, the torrent it was ripped from is found (by its download, or by name and TMDB titles) and removed."
        actions={
          <Button onClick={openAdd}>
            <Plus />
            Add client
          </Button>
        }
      />

      <TmdbCard />

      {!loaded ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          <Skeleton className="h-64" />
        </div>
      ) : clients.length === 0 ? (
        <Card>
          <EmptyState
            icon={Magnet}
            title="No download client configured"
            description="Add qBittorrent: after each upload Wayfinderr removes the source torrent, so finished rips don't pile up."
            action={
              <Button onClick={openAdd}>
                <Plus />
                Add client
              </Button>
            }
          />
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {clients.map((client) => (
            <ClientCard
              key={client.id}
              client={client}
              onEdit={() => {
                setEditing(client);
                setDialogOpen(true);
              }}
            />
          ))}
        </div>
      )}

      <ClientDialog open={dialogOpen} onOpenChange={setDialogOpen} client={editing} />
    </div>
  );
}
