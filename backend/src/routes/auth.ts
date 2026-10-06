import { CookieOptions, NextFunction, Request, Response, Router } from 'express';
import {
  authenticate,
  changePassword,
  checkSetupCode,
  createAccount,
  ensureSetupCode,
  getAccount,
  issueSessionToken,
  revokeAllSessions,
  SESSION_COOKIE,
  SESSION_TTL_MS,
  validateCredentials,
  verifyLogin,
  verifyPassword,
} from '../services/auth.js';
import * as loginLimiter from '../services/loginLimiter.js';
import { requireAuth } from '../middleware/security.js';
import logger from '../config/logger.js';

/**
 * Never behind requireAuth as a whole (nobody could ever log in): each endpoint
 * protects itself. Setup only works while there is no account and with the
 * setup code from the log; login checks the password hash.
 */
const router = Router();

type Handler = (req: Request, res: Response) => Promise<void>;
const handle = (handler: Handler) => (req: Request, res: Response, next: NextFunction) =>
  handler(req, res).catch(next);

// Secure when the page is on HTTPS (X-Forwarded-Proto from the reverse proxy)
const cookieOptions = (req: Request): CookieOptions => ({
  httpOnly: true,
  sameSite: 'lax',
  secure: req.secure,
  path: '/',
});

const startSession = async (req: Request, res: Response, account: { username: string; tokenVersion: string }) => {
  res.cookie(SESSION_COOKIE, await issueSessionToken(account), { ...cookieOptions(req), maxAge: SESSION_TTL_MS });
};

const clientKey = (req: Request) => req.ip || 'unknown';

/** Sends 429 and returns true when the client made too many failed attempts. */
const limited = (req: Request, res: Response): boolean => {
  const wait = loginLimiter.retryAfter(clientKey(req));
  if (wait === null) return false;
  res.set('Retry-After', String(wait));
  res.status(429).json({ error: `Too many attempts: try again in ${Math.ceil(wait / 60)} min`, code: 'auth_too_many_attempts' });
  return true;
};

const fail = (req: Request, res: Response, status: number, error: string, code: string) => {
  loginLimiter.failed(clientKey(req));
  res.status(status).json({ error, code });
};

router.get(
  '/status',
  handle(async (req, res) => {
    const account = await getAccount();
    if (!account) ensureSetupCode();
    res.json({
      configured: account !== null,
      username: account ? await authenticate(req.headers, account) : null,
    });
  })
);

// Two setups at once: only one wins
let setupInProgress: Promise<void> = Promise.resolve();

router.post(
  '/setup',
  handle(async (req, res) => {
    if (limited(req, res)) return;
    const run = setupInProgress.then(async () => {
      if (await getAccount()) {
        res.status(409).json({ error: 'The account already exists', code: 'auth_already_configured' });
        return;
      }
      if (!checkSetupCode(req.body?.setupCode)) {
        fail(req, res, 403, 'Wrong setup code: copy it from the backend log', 'auth_setup_code_invalid');
        return;
      }
      const invalid = validateCredentials(req.body?.username, req.body?.password);
      if (invalid) {
        res.status(400).json({ error: invalid, code: 'auth_invalid_input' });
        return;
      }
      const account = await createAccount(req.body.username.trim(), req.body.password);
      loginLimiter.succeeded(clientKey(req));
      logger.info({ username: account.username }, 'Account created');
      await startSession(req, res, account);
      res.status(201).json({ username: account.username });
    });
    setupInProgress = run.catch(() => undefined);
    await run;
  })
);

router.post(
  '/login',
  handle(async (req, res) => {
    if (limited(req, res)) return;
    const { username, password } = req.body ?? {};
    const account =
      typeof username === 'string' && typeof password === 'string' ? await verifyLogin(username, password) : null;
    if (!account) {
      logger.warn({ client: clientKey(req) }, 'Failed login');
      fail(req, res, 401, 'Wrong username or password', 'auth_invalid_credentials');
      return;
    }
    loginLimiter.succeeded(clientKey(req));
    await startSession(req, res, account);
    res.json({ username: account.username });
  })
);

router.post('/logout', (req, res) => {
  res.clearCookie(SESSION_COOKIE, cookieOptions(req));
  res.status(204).end();
});

router.post(
  '/change-password',
  requireAuth,
  handle(async (req, res) => {
    if (limited(req, res)) return;
    const account = await getAccount();
    const { currentPassword, newPassword } = req.body ?? {};
    if (!account || typeof currentPassword !== 'string' || !(await verifyPassword(currentPassword, account.passwordHash))) {
      fail(req, res, 400, 'The current password is wrong', 'auth_wrong_current_password');
      return;
    }
    const invalid = validateCredentials(account.username, newPassword);
    if (invalid) {
      res.status(400).json({ error: invalid, code: 'auth_invalid_input' });
      return;
    }
    // Every other session ends; this one continues with a new token
    const tokenVersion = await changePassword(newPassword);
    loginLimiter.succeeded(clientKey(req));
    logger.info('Password changed, other sessions signed out');
    await startSession(req, res, { username: account.username, tokenVersion });
    res.status(204).end();
  })
);

router.post(
  '/logout-everywhere',
  requireAuth,
  handle(async (req, res) => {
    await revokeAllSessions();
    logger.info('Signed out of every session');
    res.clearCookie(SESSION_COOKIE, cookieOptions(req));
    res.status(204).end();
  })
);

export default router;
