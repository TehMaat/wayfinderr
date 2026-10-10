'use client';

import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input, Label, Select } from '@/components/ui/input';
import { clientsApi } from '@/lib/api';
import { useAppStore, type TorrentClient } from '@/lib/store';
import { errorMessage } from '@/lib/utils';

const emptyForm = (client?: TorrentClient) => ({
  name: client?.name ?? '',
  url: client?.url ?? '',
  username: client?.username ?? '',
  password: '',
  apiKey: '',
  category: client?.category ?? '',
  enabled: client?.enabled ?? true,
  autoRemove: client?.autoRemove ?? true,
  deleteFiles: client?.deleteFiles ?? false,
});

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      {children}
      {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

export function ClientDialog({
  open,
  onOpenChange,
  client,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  client?: TorrentClient;
}) {
  const isEdit = Boolean(client);
  const [form, setForm] = useState(emptyForm(client));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setForm(emptyForm(client));
      setError(null);
    }
  }, [open, client]);

  const update = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }));
  // Booleans are edited with selects: "true" / "false"
  const updateFlag = (e: React.ChangeEvent<HTMLSelectElement>) =>
    setForm((prev) => ({ ...prev, [e.target.name]: e.target.value === 'true' }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      if (client) {
        await clientsApi.updateClient(client.id, form);
      } else {
        await clientsApi.createClient(form);
      }
      await useAppStore.getState().loadClients();
      toast.success(isEdit ? 'Client updated' : 'Client added', { description: form.name });
      onOpenChange(false);
    } catch (err) {
      setError(errorMessage(err, 'Failed to save client'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{isEdit ? `Edit ${client?.name}` : 'Add qBittorrent client'}</DialogTitle>
          <DialogDescription>
            After an upload, the torrent the MKV was ripped from is found here and removed.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="space-y-5">
          {error && (
            <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </div>
          )}

          <Field label="Name">
            <Input name="name" value={form.name} onChange={update} placeholder="qBittorrent" required autoFocus />
          </Field>

          <div className="space-y-3">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">WebUI</p>
            <Field
              label="URL"
              hint="From Docker use http://host.docker.internal:8080 to reach qBittorrent on this PC"
            >
              <Input
                name="url"
                type="url"
                value={form.url}
                onChange={update}
                placeholder="http://localhost:8080"
                required
              />
            </Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Username" hint="Blank if the WebUI skips login for this host">
                <Input name="username" value={form.username} onChange={update} autoComplete="off" />
              </Field>
              <Field label="Password">
                <Input
                  name="password"
                  type="password"
                  value={form.password}
                  onChange={update}
                  autoComplete="new-password"
                  placeholder={isEdit && client?.hasPassword ? 'Unchanged' : ''}
                />
              </Field>
            </div>
            <Field label="API key" hint="qBittorrent 5.2+: replaces username and password">
              <Input
                name="apiKey"
                type="password"
                value={form.apiKey}
                onChange={update}
                autoComplete="new-password"
                placeholder={isEdit && client?.hasApiKey ? 'Unchanged' : 'Optional'}
              />
            </Field>
          </div>

          <div className="space-y-3">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Cleanup</p>
            <Field label="Category" hint="Only torrents in this category are considered. Blank = all finished torrents">
              <Input name="category" value={form.category} onChange={update} placeholder="rip" />
            </Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="When matched">
                <Select name="autoRemove" value={String(form.autoRemove)} onChange={updateFlag}>
                  <option value="true">Remove automatically if 100% certain</option>
                  <option value="false">Only suggest, I remove it</option>
                </Select>
              </Field>
              <Field label="Downloaded files">
                <Select name="deleteFiles" value={String(form.deleteFiles)} onChange={updateFlag}>
                  <option value="false">Keep (remove the torrent only)</option>
                  <option value="true">Delete with the torrent</option>
                </Select>
              </Field>
            </div>
            <Field label="Status">
              <Select name="enabled" value={String(form.enabled)} onChange={updateFlag}>
                <option value="true">Enabled</option>
                <option value="false">Disabled</option>
              </Select>
            </Field>
          </div>

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving && <Loader2 className="animate-spin" />}
              {isEdit ? 'Save changes' : 'Add client'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
