import type { Server, SpaceSource } from './store';

/**
 * A server's state from /api/space: online (space from its storage API), online via
 * SSH (API unreachable, space read over SSH: still takes uploads), or unreachable.
 */
export type ServerState = 'checking' | 'online' | 'ssh' | 'unreachable';

export const serverState = (server: Pick<Server, 'reachable' | 'apiReachable'>): ServerState =>
  server.reachable === undefined
    ? 'checking'
    : !server.reachable
      ? 'unreachable'
      : server.apiReachable === false
        ? 'ssh'
        : 'online';

export const SERVER_STATES: Record<ServerState, { label: string; dot: string }> = {
  checking: { label: 'Checking', dot: 'bg-muted-foreground/40' },
  online: { label: 'Online', dot: 'bg-success shadow-[0_0_6px_hsl(var(--success))]' },
  ssh: { label: 'Online via SSH', dot: 'bg-warning' },
  unreachable: { label: 'Unreachable', dot: 'bg-destructive' },
};

/** How the space was read over SSH (null: from the API, or not read) */
export const sshSpaceLabel = (source: SpaceSource | null | undefined) =>
  source === 'quota' ? 'over SSH (quota)' : source === 'disk' ? 'over SSH (disk)' : null;
