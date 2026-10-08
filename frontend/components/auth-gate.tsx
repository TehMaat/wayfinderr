'use client';

import { useCallback, useEffect, useState } from 'react';
import { Compass, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input, Label } from '@/components/ui/input';
import { authApi, checkSession } from '@/lib/api';
import { MIN_PASSWORD_LENGTH, useAuthStore } from '@/lib/auth';
import { errorMessage } from '@/lib/utils';

function AuthCard({ description, children }: { description: string; children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <div className="w-full max-w-sm rounded-lg border bg-card p-6 text-card-foreground shadow-2xl">
        <div className="mb-1 flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary/15 text-primary">
            <Compass className="h-4 w-4" />
          </div>
          <span className="text-lg font-semibold tracking-tight">wayfinderr</span>
        </div>
        <p className="mb-5 text-sm text-muted-foreground">{description}</p>
        {children}
      </div>
    </div>
  );
}

function Field({
  id,
  label,
  hint,
  error,
  children,
}: {
  id: string;
  label: string;
  hint?: React.ReactNode;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {error ? (
        <p className="text-[11px] text-destructive">{error}</p>
      ) : (
        hint && <p className="text-[11px] text-muted-foreground">{hint}</p>
      )}
    </div>
  );
}

function FormError({ error }: { error: string | null }) {
  if (!error) return null;
  return (
    <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
      {error}
    </div>
  );
}

function LoginScreen() {
  const sessionEnded = useAuthStore((s) => s.sessionEnded);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { data } = await authApi.login({ username, password });
      useAuthStore.getState().signedIn(data.username);
    } catch (err) {
      setError(errorMessage(err, 'Login failed'));
      setPassword('');
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthCard description={sessionEnded ? 'Your session has ended: sign in again.' : 'Sign in to continue.'}>
      <form onSubmit={submit} className="space-y-4">
        <FormError error={error} />
        <Field id="login-username" label="Username">
          <Input
            id="login-username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
            autoFocus
            required
          />
        </Field>
        <Field id="login-password" label="Password">
          <Input
            id="login-password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            required
          />
        </Field>
        <Button type="submit" className="w-full" disabled={busy || !username || !password}>
          {busy && <Loader2 className="animate-spin" />}
          Sign in
        </Button>
      </form>
    </AuthCard>
  );
}

function SetupScreen() {
  const [form, setForm] = useState({ setupCode: '', username: '', password: '', confirm: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const update = (e: React.ChangeEvent<HTMLInputElement>) => setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }));
  const mismatch = form.confirm !== '' && form.confirm !== form.password;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { data } = await authApi.setup({ setupCode: form.setupCode, username: form.username, password: form.password });
      useAuthStore.getState().signedIn(data.username);
    } catch (err) {
      setError(errorMessage(err, 'Could not create the account'));
      // Created meanwhile (another tab): the login screen
      const code = (err as { response?: { data?: { code?: string } } })?.response?.data?.code;
      if (code === 'auth_already_configured') checkSession();
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthCard description="Create the account that protects this Wayfinderr.">
      <form onSubmit={submit} className="space-y-4">
        <FormError error={error} />
        <Field
          id="setup-code"
          label="Setup code"
          hint={
            <>
              Printed in the backend log: <code className="font-mono">docker compose logs wayfinderr-backend</code>
            </>
          }
        >
          <Input
            id="setup-code"
            name="setupCode"
            value={form.setupCode}
            onChange={update}
            autoComplete="off"
            spellCheck={false}
            className="font-mono"
            autoFocus
            required
          />
        </Field>
        <Field id="setup-username" label="Username">
          <Input id="setup-username" name="username" value={form.username} onChange={update} autoComplete="username" required />
        </Field>
        <Field id="setup-password" label="Password" hint={`At least ${MIN_PASSWORD_LENGTH} characters`}>
          <Input
            id="setup-password"
            name="password"
            type="password"
            value={form.password}
            onChange={update}
            autoComplete="new-password"
            minLength={MIN_PASSWORD_LENGTH}
            required
          />
        </Field>
        <Field id="setup-confirm" label="Confirm password" error={mismatch ? 'The passwords do not match' : undefined}>
          <Input
            id="setup-confirm"
            name="confirm"
            type="password"
            value={form.confirm}
            onChange={update}
            autoComplete="new-password"
            required
          />
        </Field>
        <Button
          type="submit"
          className="w-full"
          disabled={
            busy || !form.setupCode.trim() || !form.username.trim() || form.password.length < MIN_PASSWORD_LENGTH || form.confirm !== form.password
          }
        >
          {busy && <Loader2 className="animate-spin" />}
          Create account
        </Button>
      </form>
    </AuthCard>
  );
}

/** Shows the setup or login screen until there is a valid session, then the app. */
export function AuthGate({ children }: { children: React.ReactNode }) {
  const status = useAuthStore((s) => s.status);

  const check = useCallback(async () => {
    const store = useAuthStore.getState();
    store.setStatus('loading');
    try {
      const { data } = await authApi.status();
      if (data.username) store.signedIn(data.username);
      else store.signedOut(!data.configured);
    } catch {
      store.setStatus('unreachable');
    }
  }, []);

  useEffect(() => {
    check();
  }, [check]);

  if (status === 'loading') {
    return (
      <div className="flex min-h-screen items-center justify-center text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    );
  }
  if (status === 'unreachable') {
    return (
      <AuthCard description="The backend is not reachable right now.">
        <Button className="w-full" onClick={check}>
          Retry
        </Button>
      </AuthCard>
    );
  }
  if (status === 'setup') return <SetupScreen />;
  if (status === 'login') return <LoginScreen />;
  return <>{children}</>;
}
