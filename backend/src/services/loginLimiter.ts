/**
 * Limits failed attempts at login, setup code and current password (on password
 * change): 5 in 15 minutes per client, then 429 until the oldest one leaves the
 * window. A success clears the client's count. In memory: a restart resets it.
 *
 * Behind a reverse proxy the client is the address it forwards (X-Forwarded-For,
 * see `trust proxy` in index.ts). Without one, a client could fake that header,
 * so a global cap also stops a brute force that rotates addresses.
 */

export const MAX_FAILURES = 5;
export const MAX_GLOBAL_FAILURES = 50;
export const WINDOW_MS = 15 * 60 * 1000;

const GLOBAL = '*';
const failures = new Map<string, number[]>();

const recent = (key: string, now: number): number[] => {
  const attempts = (failures.get(key) ?? []).filter((time) => time > now - WINDOW_MS);
  if (attempts.length) failures.set(key, attempts);
  else failures.delete(key);
  return attempts;
};

/** Seconds to wait if the limit is reached, otherwise null. */
export const retryAfter = (client: string, now = Date.now()): number | null => {
  const waits = [
    [recent(client, now), MAX_FAILURES],
    [recent(GLOBAL, now), MAX_GLOBAL_FAILURES],
  ] as const;
  let wait: number | null = null;
  for (const [attempts, max] of waits) {
    if (attempts.length >= max) {
      const seconds = Math.ceil((attempts[attempts.length - max] + WINDOW_MS - now) / 1000);
      wait = Math.max(wait ?? 0, seconds, 1);
    }
  }
  return wait;
};

export const failed = (client: string, now = Date.now()): void => {
  // Clients that never come back would otherwise stay in memory
  if (failures.size > 1000) {
    for (const key of [...failures.keys()]) recent(key, now);
  }
  for (const key of [client, GLOBAL]) {
    failures.set(key, [...recent(key, now), now]);
  }
};

export const succeeded = (client: string): void => {
  failures.delete(client);
};
