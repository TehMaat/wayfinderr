import { createHash } from 'crypto';

/**
 * OpenSSH's fingerprint of an SSH host key (SHA256:…, base64 without padding): what is
 * kept for a server or a client and checked at every connection (issue #102).
 */
export const hostKeyFingerprint = (key: Buffer): string =>
  `SHA256:${createHash('sha256').update(key).digest('base64').replace(/=+$/, '')}`;
