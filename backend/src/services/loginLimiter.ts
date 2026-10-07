/**
 * Limits failed attempts at login, setup code and current password (on password
 * change): 5 in 15 minutes per client, then 429 until the oldest one leaves the
 * window. A success clears the client's count. In memory: a restart resets it.
 *
 * The client is the address the reverse proxy forwards (X-Forwarded-For, see
 * `trust proxy` in index.ts): Traefik/Pangolin set it and drop any value the
 * browser sent. Without a reverse proxy a client can send its own, so keep such
 * a setup on the LAN. There is no global cap: anyone could use it to lock the
 * owner out.
 */

export const MAX_FAILURES = 5;
export const WINDOW_MS = 15 * 60 * 1000;

const failures = new Map<string, number[]>();

const recent = (client: string, now: number): number[] => {
  const attempts = (failures.get(client) ?? []).filter((time) => time > now - WINDOW_MS);
  if (attempts.length) failures.set(client, attempts);
  else failures.delete(client);
  return attempts;
};

/** Seconds to wait if the limit is reached, otherwise null. */
export const retryAfter = (client: string, now = Date.now()): number | null => {
  const attempts = recent(client, now);
  if (attempts.length < MAX_FAILURES) return null;
  return Math.max(1, Math.ceil((attempts[attempts.length - MAX_FAILURES] + WINDOW_MS - now) / 1000));
};

export const failed = (client: string, now = Date.now()): void => {
  // Clients that never come back would otherwise stay in memory
  if (failures.size > 1000) {
    for (const key of [...failures.keys()]) recent(key, now);
  }
  failures.set(client, [...recent(client, now), now]);
};

export const succeeded = (client: string): void => {
  failures.delete(client);
};
