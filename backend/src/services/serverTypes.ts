import type { Server } from '@prisma/client';

/**
 * Kinds of upload server (issue #68):
 * - ULTRA: an Ultra.cc slot. Space from its Ultra-API (endpoint + token), over SSH while
 *   the API is unreachable; the Ultra-API can be restarted from the UI.
 * - SEEDBOX: another seedbox (Whatbox, Feral...). No storage API: space over SSH.
 * - SSH: a plain server (VPS, NAS, a machine on the LAN). Space over SSH.
 * Over SSH the space is the user's quota, else the disk of the upload folder (sshSpace.ts).
 */
export const SERVER_TYPES = ['ULTRA', 'SEEDBOX', 'SSH'] as const;
export type ServerType = (typeof SERVER_TYPES)[number];

export const isServerType = (value: unknown): value is ServerType =>
  typeof value === 'string' && (SERVER_TYPES as readonly string[]).includes(value);

/** Only Ultra.cc servers have a storage API (and its restart) */
export const hasUltraApi = (server: Pick<Server, 'type'>) => server.type === 'ULTRA';

const validUrl = (value: unknown) => typeof value === 'string' && /^https?:\/\/\S+$/i.test(value);

/** What a server still lacks for its type (null: complete) */
export const serverFieldsError = (server: Record<string, unknown>): string | null => {
  if (!isServerType(server.type)) return `Unknown server type: use ${SERVER_TYPES.join(', ')}`;
  const missing = [
    !server.name && 'name',
    !server.sshHost && 'SSH host',
    !server.sshUsername && 'SSH username',
    server.type === 'ULTRA' && !server.apiEndpoint && 'Ultra-API endpoint',
    server.type === 'ULTRA' && !server.apiToken && 'Ultra-API token',
  ].filter(Boolean);
  if (missing.length) return `Missing: ${missing.join(', ')}`;
  if (server.type === 'ULTRA' && !validUrl(server.apiEndpoint)) return 'The Ultra-API endpoint must be a http(s) URL';
  return null;
};

/** The fields a type does not use, emptied: a server that stops being Ultra.cc loses its API settings */
export const unusedFields = (type: ServerType) =>
  type === 'ULTRA'
    ? {}
    : { apiEndpoint: null, apiToken: null, autoRestartApi: false, apiRestartAt: null, apiRestartError: null };
