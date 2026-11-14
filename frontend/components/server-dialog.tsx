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
import { parseUltra, SERVER_TYPES, serverTypeInfo, ULTRA_RELEASE_DIR, ultraFields, type ServerType } from '@/lib/server-types';
import { useAppStore, type Server } from '@/lib/store';
import { cn, errorMessage } from '@/lib/utils';

const emptyForm = (server?: Server) => ({
  type: (server?.type ?? 'ULTRA') as ServerType,
  // Ultra.cc: the username and the host the SSH login and the Ultra-API endpoint come from
  ultraUser: server ? parseUltra(server).user : '',
  ultraHost: server ? parseUltra(server).host : '',
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
  releaseDir: server?.releaseDir ?? ULTRA_RELEASE_DIR,
  releaseTag: server?.releaseTag ?? '',
  trackerCommand: server?.trackerCommand ?? '',
  releaseAuto: String(server?.releaseAuto ?? false),
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

  // Ultra.cc: typing the username or the host fills in the SSH login and the endpoint (still editable)
  const updateUltra = (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((prev) => {
      const next = { ...prev, [e.target.name]: e.target.value };
      return { ...next, ...ultraFields(next.ultraUser, next.ultraHost) };
    });

  // The Ultra.cc release folder is only a default for Ultra.cc
  const selectType = (type: ServerType) =>
    setForm((prev) => ({
      ...prev,
      type,
      releaseDir:
        type === 'ULTRA' && !prev.releaseDir
          ? ULTRA_RELEASE_DIR
          : type !== 'ULTRA' && prev.releaseDir === ULTRA_RELEASE_DIR && !isEdit
            ? ''
            : prev.releaseDir,
    }));

  const info = serverTypeInfo(form.type);
  const isUltra = form.type === 'ULTRA';
  // Leaving Ultra.cc drops the Ultra-API settings on save
  const losingApi = isEdit && server?.type === 'ULTRA' && !isUltra;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    const { ultraUser: _user, ultraHost: _host, ...fields } = form;
    const payload = {
      ...fields,
      // Ultra.cc only: blank for the other types
      apiEndpoint: isUltra ? fields.apiEndpoint : '',
      apiToken: isUltra ? fields.apiToken : '',
      sshPort: parseInt(form.sshPort, 10) || 22,
      maxRetries: parseInt(form.maxRetries, 10) || 3,
      releaseAuto: form.releaseAuto === 'true',
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
          <DialogDescription>Where the uploads go. Pick the kind of server: the form shows what it needs.</DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="space-y-5">
          {error && (
            <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </div>
          )}

          <div className="space-y-2">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Server type</p>
            <div className="grid gap-2 sm:grid-cols-3">
              {SERVER_TYPES.map((t) => {
                const selected = t.type === form.type;
                return (
                  <button
                    key={t.type}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => selectType(t.type)}
                    className={cn(
                      'flex flex-col gap-1.5 rounded-md border p-3 text-left transition-colors',
                      selected ? 'border-primary bg-primary/10' : 'hover:bg-accent/50'
                    )}
                  >
                    <span className="text-sm font-semibold">{t.label}</span>
                    <span className="text-xs text-muted-foreground">{t.description}</span>
                    <span className="mt-auto self-start rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
                      {t.space}
                    </span>
                  </button>
                );
              })}
            </div>
            {losingApi && (
              <p className="text-[11px] text-warning">Saving removes the Ultra-API endpoint, token and restart settings.</p>
            )}
          </div>

          <Field label="Name">
            <Input name="name" value={form.name} onChange={update} placeholder="Server 1" required autoFocus />
          </Field>

          {isUltra && (
            <div className="space-y-3">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Ultra.cc</p>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Username">
                  <Input name="ultraUser" value={form.ultraUser} onChange={updateUltra} placeholder="username" />
                </Field>
                <Field label="Host" hint="The part before .usbx.me">
                  <Input name="ultraHost" value={form.ultraHost} onChange={updateUltra} placeholder="host" />
                </Field>
              </div>
              <Field label="Ultra-API endpoint" hint="Filled in from username and host; from the Ultra.cc Storage/Traffic API script">
                <Input
                  name="apiEndpoint"
                  type="url"
                  value={form.apiEndpoint}
                  onChange={update}
                  placeholder="https://user.host.usbx.me/ultra-api/get_diskquota"
                  required
                />
              </Field>
              <Field label="Ultra-API token">
                <Input
                  name="apiToken"
                  type="password"
                  value={form.apiToken}
                  onChange={update}
                  autoComplete="new-password"
                  placeholder={isEdit && server?.hasApiToken ? 'Unchanged' : undefined}
                  required={!(isEdit && server?.hasApiToken)}
                />
              </Field>
            </div>
          )}

          <div className="space-y-3">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">SSH / SFTP</p>
            <div className="grid grid-cols-[1fr_6rem] gap-3">
              <Field label="Host" hint={isUltra ? 'Filled in from the Ultra.cc host' : undefined}>
                <Input name="sshHost" value={form.sshHost} onChange={update} placeholder={info.hostPlaceholder} required />
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
                placeholder={info.folderPlaceholder}
                required
              />
            </Field>
            <p className="text-[11px] text-muted-foreground">
              Free space:{' '}
              {isUltra
                ? 'from the Ultra-API; over SSH (the account quota) while it does not answer.'
                : 'over SSH, from the account quota, else from the disk of the remote folder.'}
            </p>
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

          <div className="space-y-3">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Tracker release</p>
            <div className="grid gap-3 sm:grid-cols-[1fr_9rem]">
              <Field label="Release folder" hint="Renamed files go to <folder>/<name>/; relative to the SSH home">
                <Input name="releaseDir" value={form.releaseDir} onChange={update} placeholder={info.releasePlaceholder} required />
              </Field>
              <Field label="Release tag" hint="Name ends with -TAG">
                <Input name="releaseTag" value={form.releaseTag} onChange={update} placeholder="TAG" />
              </Field>
            </div>
            <Field
              label="Tracker command"
              hint="Runs on the server in tmux after the rename; {path}, {folder}, {name} are replaced. Blank = rename only"
            >
              <Input
                name="trackerCommand"
                value={form.trackerCommand}
                onChange={update}
                placeholder="ittup -u {path}"
                className="font-mono text-xs"
              />
            </Field>
            <Field label="After each upload">
              <Select name="releaseAuto" value={form.releaseAuto} onChange={update}>
                <option value="false">Nothing: rename from the upload history</option>
                <option value="true">Ask for the release name right away</option>
              </Select>
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
