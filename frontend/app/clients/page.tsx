'use client';

import { useState } from 'react';
import {
  Activity,
  Clapperboard,
  FolderOpen,
  KeyRound,
  Link2,
  Loader2,
  Magnet,
  MoreHorizontal,
  Pencil,
  Plus,
  ShieldCheck,
  Tag,
  Trash2,
} from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
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
import { settingsApi } from '@/lib/api';
import { useAppStore, type TorrentClient } from '@/lib/store';
import { cn, errorMessage } from '@/lib/utils';

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

function TmdbCard() {
  const settings = useAppStore((s) => s.settings);
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);

  const save = async (tmdbApiKey: string | null) => {
    setBusy(true);
    try {
      await settingsApi.updateSettings({ tmdbApiKey });
      await useAppStore.getState().loadSettings();
      setKey('');
      toast.success(tmdbApiKey ? 'TMDB key saved' : 'TMDB key removed');
    } catch (err) {
      toast.error('Could not save the TMDB key', { description: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  };

  const test = async () => {
    setBusy(true);
    try {
      await settingsApi.testTmdb();
      toast.success('TMDB is working');
    } catch (err) {
      toast.error('TMDB test failed', { description: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  };

  const configured = settings?.hasTmdbApiKey || settings?.tmdbFromEnv;

  return (
    <Card className="p-4">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-primary/15 text-primary">
            <Clapperboard className="h-4 w-4" />
          </div>
          <div className="min-w-0 space-y-1">
            <p className="flex items-center gap-2 font-semibold">
              TMDB
              {configured ? (
                <Badge variant="success">{settings?.hasTmdbApiKey ? 'Key saved' : 'Key from environment'}</Badge>
              ) : (
                <Badge variant="warning">Not configured</Badge>
              )}
            </p>
            <p className="text-xs text-muted-foreground">
              Matches the MKV to the torrent across languages: &quot;IL_PADRINO&quot; and
              &quot;The.Godfather.1972.BluRay&quot; are the same movie. Without it only names in the same language match.
              Free key from themoviedb.org → Settings → API.
            </p>
          </div>
        </div>

        <form
          className="flex shrink-0 flex-wrap gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (key.trim()) save(key.trim());
          }}
        >
          <Input
            type="password"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder={settings?.hasTmdbApiKey ? 'Replace key' : 'API key or read token'}
            autoComplete="off"
            className="w-full sm:w-56"
          />
          <Button type="submit" size="sm" className="h-9" disabled={busy || !key.trim()}>
            {busy && <Loader2 className="animate-spin" />}
            Save
          </Button>
          {configured && (
            <Button type="button" size="sm" variant="secondary" className="h-9" disabled={busy} onClick={test}>
              Test
            </Button>
          )}
          {settings?.hasTmdbApiKey && (
            <Button type="button" size="sm" variant="ghost" className="h-9" disabled={busy} onClick={() => save(null)}>
              Remove
            </Button>
          )}
        </form>
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
        description="Once an MKV is uploaded, the torrent it was ripped from is matched by name (and TMDB titles) and removed."
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
