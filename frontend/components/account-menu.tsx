'use client';

import { useEffect, useState } from 'react';
import { Check, Copy, KeyRound, KeySquare, Loader2, LogOut, MonitorX, RefreshCw, UserRound } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/confirm-dialog';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input, Label } from '@/components/ui/input';
import { authApi } from '@/lib/api';
import { MIN_PASSWORD_LENGTH, useAuthStore } from '@/lib/auth';
import { errorMessage } from '@/lib/utils';

function ChangePasswordDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const username = useAuthStore((s) => s.username);
  const [form, setForm] = useState({ currentPassword: '', newPassword: '', confirm: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setForm({ currentPassword: '', newPassword: '', confirm: '' });
      setError(null);
    }
  }, [open]);

  const update = (e: React.ChangeEvent<HTMLInputElement>) => setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }));
  const mismatch = form.confirm !== '' && form.confirm !== form.newPassword;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await authApi.changePassword({ currentPassword: form.currentPassword, newPassword: form.newPassword });
      toast.success('Password changed', { description: 'Other devices have been signed out' });
      onOpenChange(false);
    } catch (err) {
      setError(errorMessage(err, 'Could not change the password'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Change password</DialogTitle>
          <DialogDescription>Every other device is signed out; this one stays signed in.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          {/* Lets password managers update the right account */}
          <input type="text" name="username" value={username ?? ''} autoComplete="username" readOnly hidden />
          {error && (
            <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </div>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="current-password">Current password</Label>
            <Input
              id="current-password"
              name="currentPassword"
              type="password"
              value={form.currentPassword}
              onChange={update}
              autoComplete="current-password"
              autoFocus
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="new-password">New password</Label>
            <Input
              id="new-password"
              name="newPassword"
              type="password"
              value={form.newPassword}
              onChange={update}
              autoComplete="new-password"
              minLength={MIN_PASSWORD_LENGTH}
              required
            />
            <p className="text-[11px] text-muted-foreground">At least {MIN_PASSWORD_LENGTH} characters</p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="confirm-password">Confirm new password</Label>
            <Input
              id="confirm-password"
              name="confirm"
              type="password"
              value={form.confirm}
              onChange={update}
              autoComplete="new-password"
              required
            />
            {mismatch && <p className="text-[11px] text-destructive">The passwords do not match</p>}
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={
                busy ||
                !form.currentPassword ||
                form.newPassword.length < MIN_PASSWORD_LENGTH ||
                form.confirm !== form.newPassword
              }
            >
              {busy && <Loader2 className="animate-spin" />}
              Change password
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ApiKeyDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const [apiKey, setApiKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [confirmRegenerate, setConfirmRegenerate] = useState(false);

  useEffect(() => {
    if (!open) return;
    setApiKey(null);
    setError(null);
    setCopied(false);
    authApi
      .getApiKey()
      .then(({ data }) => setApiKey(data.apiKey))
      .catch((err) => setError(errorMessage(err, 'Could not read the API key')));
  }, [open]);

  const copy = async () => {
    if (!apiKey) return;
    try {
      await navigator.clipboard.writeText(apiKey);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error('Could not copy: select the key and copy it by hand');
    }
  };

  const regenerate = async () => {
    try {
      const { data } = await authApi.regenerateApiKey();
      setApiKey(data.apiKey);
      toast.success('New API key', { description: 'The old one no longer works: update it in bookrr and your scripts' });
    } catch (err) {
      toast.error('Could not regenerate the API key', { description: errorMessage(err) });
    }
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>API key</DialogTitle>
            <DialogDescription>
              For other services, such as bookrr, and scripts: sent in the <code className="font-mono">X-Api-Key</code> header it
              works like a login on every API. Keep it secret.
            </DialogDescription>
          </DialogHeader>
          {error ? (
            <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div>
          ) : (
            <div className="flex items-center gap-2">
              <Input readOnly value={apiKey ?? ''} placeholder="Loading…" className="font-mono text-xs" onFocus={(e) => e.target.select()} />
              <Button type="button" size="icon" variant="outline" disabled={!apiKey} onClick={copy} aria-label="Copy the API key">
                {copied ? <Check /> : <Copy />}
              </Button>
            </div>
          )}
          <DialogFooter>
            <Button type="button" variant="ghost" disabled={!apiKey} onClick={() => setConfirmRegenerate(true)}>
              <RefreshCw />
              Regenerate
            </Button>
            <Button type="button" onClick={() => onOpenChange(false)}>
              Done
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <ConfirmDialog
        open={confirmRegenerate}
        onOpenChange={setConfirmRegenerate}
        title="Regenerate the API key?"
        description="The current key stops working at once: bookrr and every script using it must be given the new one."
        confirmLabel="Regenerate"
        onConfirm={regenerate}
      />
    </>
  );
}

export function AccountMenu() {
  const username = useAuthStore((s) => s.username);
  const [changing, setChanging] = useState(false);
  const [showingKey, setShowingKey] = useState(false);
  const [confirmEverywhere, setConfirmEverywhere] = useState(false);

  const logout = async () => {
    try {
      await authApi.logout();
      useAuthStore.getState().signedOut();
    } catch (err) {
      toast.error('Could not sign out', { description: errorMessage(err) });
    }
  };

  const logoutEverywhere = async () => {
    try {
      await authApi.logoutEverywhere();
      useAuthStore.getState().signedOut();
    } catch (err) {
      toast.error('Could not sign out everywhere', { description: errorMessage(err) });
    }
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button className="flex min-w-0 items-center gap-2 rounded-md px-2 py-1 text-left text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <UserRound className="h-4 w-4 shrink-0" />
            <span className="truncate">{username}</span>
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent side="top" align="start">
          <DropdownMenuItem onSelect={() => setChanging(true)}>
            <KeyRound />
            Change password
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setShowingKey(true)}>
            <KeySquare />
            API key
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setConfirmEverywhere(true)}>
            <MonitorX />
            Sign out everywhere
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={logout}>
            <LogOut />
            Sign out
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <ChangePasswordDialog open={changing} onOpenChange={setChanging} />
      <ApiKeyDialog open={showingKey} onOpenChange={setShowingKey} />
      <ConfirmDialog
        open={confirmEverywhere}
        onOpenChange={setConfirmEverywhere}
        title="Sign out everywhere?"
        description="Every device signed in to Wayfinderr, this one included, will have to sign in again."
        confirmLabel="Sign out everywhere"
        onConfirm={logoutEverywhere}
      />
    </>
  );
}
