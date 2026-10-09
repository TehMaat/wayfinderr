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
import { serversApi } from '@/lib/api';
import { useAppStore, type Server } from '@/lib/store';
import { errorMessage } from '@/lib/utils';

const emptyForm = (server?: Server) => ({
  name: server?.name ?? '',
  apiEndpoint: server?.apiEndpoint ?? '',
  apiToken: '',
  sshHost: server?.sshHost ?? '',
  sshPort: String(server?.sshPort ?? 22),
  sshUsername: server?.sshUsername ?? '',
  sshPassword: '',
  sshPath: server?.sshPath ?? '',
  mediaCheckPolicy: server?.mediaCheckPolicy ?? 'SKIP_NO_ITA',
  maxRetries: String(server?.maxRetries ?? 3),
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

export function ServerDialog({
  open,
  onOpenChange,
  server,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  server?: Server;
}) {
  const isEdit = Boolean(server);
  const [form, setForm] = useState(emptyForm(server));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setForm(emptyForm(server));
      setError(null);
    }
  }, [open, server]);

  const update = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    const payload = {
      ...form,
      sshPort: parseInt(form.sshPort, 10) || 22,
      maxRetries: parseInt(form.maxRetries, 10) || 3,
    };
    try {
      if (server) {
        await serversApi.updateServer(server.id, payload);
      } else {
        await serversApi.createServer(payload);
      }
      await useAppStore.getState().loadServers();
      toast.success(isEdit ? 'Server updated' : 'Server added', { description: form.name });
      onOpenChange(false);
    } catch (err) {
      setError(errorMessage(err, 'Failed to save server'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{isEdit ? `Edit ${server?.name}` : 'Add server'}</DialogTitle>
          <DialogDescription>Ultra.cc storage API and SSH login used for the uploads.</DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="space-y-5">
          {error && (
            <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </div>
          )}

          <Field label="Name">
            <Input name="name" value={form.name} onChange={update} placeholder="Server 1" required autoFocus />
          </Field>

          <div className="space-y-3">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Storage API</p>
            <Field label="Endpoint" hint="From the Ultra.cc Storage/Traffic API script">
              <Input
                name="apiEndpoint"
                type="url"
                value={form.apiEndpoint}
                onChange={update}
                placeholder="https://user.host.usbx.me/ultra-api/get_diskquota"
                required
              />
            </Field>
            <Field label="Token">
              <Input
                name="apiToken"
                type="password"
                value={form.apiToken}
                onChange={update}
                autoComplete="new-password"
                placeholder={isEdit && server?.hasApiToken ? 'Unchanged' : undefined}
                required={!isEdit}
              />
            </Field>
          </div>

          <div className="space-y-3">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">SSH / SFTP</p>
            <div className="grid grid-cols-[1fr_6rem] gap-3">
              <Field label="Host">
                <Input name="sshHost" value={form.sshHost} onChange={update} placeholder="host.usbx.me" required />
              </Field>
              <Field label="Port">
                <Input name="sshPort" type="number" value={form.sshPort} onChange={update} required />
              </Field>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Username">
                <Input name="sshUsername" value={form.sshUsername} onChange={update} required />
              </Field>
              <Field label="Password">
                <Input
                  name="sshPassword"
                  type="password"
                  value={form.sshPassword}
                  onChange={update}
                  autoComplete="new-password"
                  placeholder={isEdit && server?.hasSshPassword ? 'Unchanged' : 'Blank = SSH key'}
                />
              </Field>
            </div>
            <Field label="Remote folder" hint="Created if missing">
              <Input
                name="sshPath"
                value={form.sshPath}
                onChange={update}
                placeholder="/home/username/media/movies"
                required
              />
            </Field>
          </div>

          <div className="grid gap-3 sm:grid-cols-[1fr_6rem]">
            <Field label="Media policy">
              <Select name="mediaCheckPolicy" value={form.mediaCheckPolicy} onChange={update}>
                <option value="SKIP_NO_ITA">Skip files without Italian audio/subs</option>
                <option value="ALWAYS_UPLOAD">Always upload</option>
              </Select>
            </Field>
            <Field label="Retries">
              <Input name="maxRetries" type="number" min={1} max={10} value={form.maxRetries} onChange={update} />
            </Field>
          </div>

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving && <Loader2 className="animate-spin" />}
              {isEdit ? 'Save changes' : 'Add server'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
