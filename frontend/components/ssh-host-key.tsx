'use client';

import { useState } from 'react';
import { KeyRound, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { errorMessage } from '@/lib/utils';

/**
 * The SSH host key kept for a server or a client (issue #102): the first one seen is kept,
 * and another one is refused before anything is sent. "Forget" is for a reinstalled
 * machine: the next connection keeps the key it sees.
 */
export function SshHostKey({
  hostKey,
  moved,
  onForget,
}: {
  hostKey: string | null;
  // Host or port edited in the form: another machine, its key is kept again on save
  moved: boolean;
  onForget: () => Promise<unknown>;
}) {
  const [asking, setAsking] = useState(false);
  const [forgetting, setForgetting] = useState(false);
  // Forgotten here: the list is reloaded on save, the form keeps what was typed
  const [forgotten, setForgotten] = useState(false);
  const kept = forgotten ? null : hostKey;

  const forget = async () => {
    setForgetting(true);
    try {
      await onForget();
      setForgotten(true);
      toast.success('SSH host key forgotten', { description: 'The next connection keeps the key it sees' });
      setAsking(false);
    } catch (err) {
      toast.error(errorMessage(err, 'Could not forget the SSH host key'));
    } finally {
      setForgetting(false);
    }
  };

  return (
    <div className="space-y-1.5 rounded-md border border-border/60 px-3 py-2">
      <div className="flex items-center gap-2 text-xs">
        <KeyRound className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="font-medium">Host key</span>
        {kept && !moved ? (
          <code className="min-w-0 flex-1 truncate font-mono text-[11px] text-muted-foreground" title={kept}>
            {kept}
          </code>
        ) : (
          <span className="flex-1 text-muted-foreground">
            {moved ? 'kept again at the next connection (another host or port)' : 'kept at the first connection'}
          </span>
        )}
        {kept && !moved && !asking && (
          <Button type="button" variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={() => setAsking(true)}>
            Forget
          </Button>
        )}
      </div>
      {asking ? (
        <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
          <span className="flex-1">
            Only if the machine was reinstalled: the next connection trusts whatever key it sees.
          </span>
          <Button type="button" variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={() => setAsking(false)}>
            Cancel
          </Button>
          <Button type="button" variant="destructive" size="sm" className="h-6 px-2 text-xs" disabled={forgetting} onClick={forget}>
            {forgetting && <Loader2 className="animate-spin" />}
            Forget the key
          </Button>
        </div>
      ) : (
        <p className="text-[11px] text-muted-foreground">
          Checked at every connection: another key is refused before the password or any file is sent.
        </p>
      )}
    </div>
  );
}
