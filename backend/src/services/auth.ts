import { createHash, createHmac, randomBytes, scrypt, timingSafeEqual } from 'crypto';
import { EventEmitter } from 'events';
import { IncomingHttpHeaders } from 'http';
import { db } from './database.js';
import logger from '../config/logger.js';

/**
 * One admin account (username + password hash) stored in the Setting table.
 * Login is mandatory: until the account exists everything is closed except
 * /api/auth/*, and creating it takes the one-time setup code printed in the log.
 *
 * Sessions are HMAC-signed tokens in an HttpOnly cookie. The token carries the
 * account's token version: changing the password or "sign out everywhere" bumps
 * it, so every token issued before stops working at once.
 */

const KEYS = {
  username: 'auth_username',
  passwordHash: 'auth_password_hash',
  tokenVersion: 'auth_token_version',
  sessionSecret: 'auth_session_secret',
};

export const SESSION_COOKIE = 'wayfinderr_session';
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
export const MIN_PASSWORD_LENGTH = 8;
const MAX_FIELD_LENGTH = 256;

// Emitted when every session is revoked: open WebSockets must be closed too
export const authEvents = new EventEmitter();

// --- Passwords (scrypt) ---

const SCRYPT = { N: 32768, r: 8, p: 1, keyLength: 64, maxmem: 64 * 1024 * 1024 };

const scryptAsync = (password: string, salt: Buffer, N: number, r: number, p: number, keyLength: number) =>
  new Promise<Buffer>((resolve, reject) => {
    scrypt(password, salt, keyLength, { N, r, p, maxmem: SCRYPT.maxmem }, (error, key) =>
      error ? reject(error) : resolve(key)
    );
  });

export const hashPassword = async (password: string): Promise<string> => {
  const salt = randomBytes(16);
  const key = await scryptAsync(password, salt, SCRYPT.N, SCRYPT.r, SCRYPT.p, SCRYPT.keyLength);
  return ['scrypt', SCRYPT.N, SCRYPT.r, SCRYPT.p, salt.toString('hex'), key.toString('hex')].join('$');
};

export const verifyPassword = async (password: string, stored: string): Promise<boolean> => {
  try {
    const [algorithm, N, r, p, salt, hash] = stored.split('$');
    if (algorithm !== 'scrypt') return false;
    const expected = Buffer.from(hash, 'hex');
    const key = await scryptAsync(password, Buffer.from(salt, 'hex'), Number(N), Number(r), Number(p), expected.length);
    return timingSafeEqual(key, expected);
  } catch {
    return false;
  }
};

// Compares strings in constant time, whatever their lengths
export const safeEqual = (a: string, b: string): boolean =>
  timingSafeEqual(createHash('sha256').update(a).digest(), createHash('sha256').update(b).digest());

// Verified anyway when there is no account, so the response takes the same time
let dummyHash: Promise<string> | null = null;
const getDummyHash = () => (dummyHash ??= hashPassword('wayfinderr-no-account'));

// --- Account ---

interface Account {
  username: string;
  passwordHash: string;
  tokenVersion: string;
}

export const getAccount = async (): Promise<Account | null> => {
  const settings = await db.getSettings([KEYS.username, KEYS.passwordHash, KEYS.tokenVersion]);
  if (!settings[KEYS.username] || !settings[KEYS.passwordHash]) return null;
  return {
    username: settings[KEYS.username],
    passwordHash: settings[KEYS.passwordHash],
    tokenVersion: settings[KEYS.tokenVersion] ?? '1',
  };
};

export const validateCredentials = (username: unknown, password: unknown): string | null => {
  if (typeof username !== 'string' || !username.trim()) return 'Username is required';
  if (username.trim().length > MAX_FIELD_LENGTH) return 'Username is too long';
  if (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH) {
    return `Password must be at least ${MIN_PASSWORD_LENGTH} characters`;
  }
  if (password.length > MAX_FIELD_LENGTH) return 'Password is too long';
  return null;
};

export const createAccount = async (username: string, password: string): Promise<Account> => {
  if (await getAccount()) throw new Error('Account already exists');
  const passwordHash = await hashPassword(password);
  // A new token version: the tokens of a reset account stay invalid
  const tokenVersion = await db.incrementSetting(KEYS.tokenVersion, {
    [KEYS.username]: username,
    [KEYS.passwordHash]: passwordHash,
  });
  setupCode = null;
  return { username, passwordHash, tokenVersion };
};

/** The account if the credentials are right, otherwise null. */
export const verifyLogin = async (username: string, password: string): Promise<Account | null> => {
  const account = await getAccount();
  // Always check a password, even for a wrong username: same timing either way
  const passwordOk = await verifyPassword(password, account?.passwordHash ?? (await getDummyHash()));
  const usernameOk = account !== null && safeEqual(username, account.username);
  return account && usernameOk && passwordOk ? account : null;
};

/** Every session issued so far stops working; returns the new token version. */
export const revokeAllSessions = async (values: Record<string, string> = {}): Promise<string> => {
  const tokenVersion = await db.incrementSetting(KEYS.tokenVersion, values);
  authEvents.emit('revoked');
  return tokenVersion;
};

/** Sets the new password and revokes every session, in one transaction. */
export const changePassword = async (newPassword: string): Promise<string> =>
  revokeAllSessions({ [KEYS.passwordHash]: await hashPassword(newPassword) });

/** Deletes the account (CLI recovery): the setup screen opens again. */
export const resetAccount = async (): Promise<void> => {
  await revokeAllSessions();
  await db.deleteSettings([KEYS.username, KEYS.passwordHash]);
};

// --- Session tokens ---

// Created on first use and never changed: cached for the life of the process
let sessionSecret: Promise<string> | null = null;
const getSessionSecret = () => {
  if (!sessionSecret) {
    sessionSecret = db.getOrCreateSetting(KEYS.sessionSecret, () => randomBytes(32).toString('hex'));
    sessionSecret.catch(() => {
      sessionSecret = null; // retry on the next request
    });
  }
  return sessionSecret;
};

const sign = (payload: string, secret: string) => createHmac('sha256', secret).update(payload).digest('base64url');

export const issueSessionToken = async (account: Pick<Account, 'username' | 'tokenVersion'>): Promise<string> => {
  const payload = Buffer.from(
    JSON.stringify({ sub: account.username, ver: account.tokenVersion, exp: Date.now() + SESSION_TTL_MS })
  ).toString('base64url');
  return `${payload}.${sign(payload, await getSessionSecret())}`;
};

const readCookie = (cookieHeader: string | undefined, name: string): string | undefined => {
  for (const part of cookieHeader?.split(';') ?? []) {
    const index = part.indexOf('=');
    if (index > 0 && part.slice(0, index).trim() === name) {
      return part.slice(index + 1).trim();
    }
  }
  return undefined;
};

/** The username of a valid session cookie, otherwise null. */
export const authenticate = async (headers: IncomingHttpHeaders, account?: Account | null): Promise<string | null> => {
  const token = readCookie(headers.cookie, SESSION_COOKIE);
  if (!token) return null;
  const [payload, signature] = token.split('.');
  if (!payload || !signature) return null;
  if (!safeEqual(signature, sign(payload, await getSessionSecret()))) return null;

  const current = account === undefined ? await getAccount() : account;
  if (!current) return null;
  try {
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (typeof claims.exp !== 'number' || claims.exp < Date.now()) return null;
    if (claims.sub !== current.username || String(claims.ver) !== current.tokenVersion) return null;
    return current.username;
  } catch {
    return null;
  }
};

// --- Setup code ---

let setupCode: string | null = null;

/**
 * The one-time code for creating the account, printed in the log once. Called
 * whenever someone finds there is no account (startup, status, any /api call),
 * so a code exists again after `reset-auth`.
 */
export const ensureSetupCode = (): string => {
  if (!setupCode) {
    setupCode = process.env.WAYFINDERR_SETUP_CODE || randomBytes(9).toString('base64url');
    logger.warn({ setupCode }, `No account yet: open Wayfinderr and create it with the setup code ${setupCode}`);
  }
  return setupCode;
};

export const checkSetupCode = (code: unknown): boolean =>
  typeof code === 'string' && setupCode !== null && safeEqual(code.trim(), setupCode);
