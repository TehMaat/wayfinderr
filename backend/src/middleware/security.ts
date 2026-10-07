import { IncomingHttpHeaders } from 'http';
import { NextFunction, Request, Response } from 'express';
import { authenticate, ensureSetupCode, getAccount } from '../services/auth.js';

const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * True for a browser request sent by another site (CSRF, cross-site WebSocket).
 * The UI is always same-origin; scripts and curl send no Origin and pass.
 * Behind the frontend proxy the Host header is the backend's own, so the
 * page's host comes from X-Forwarded-Host (set by the Next.js proxy).
 */
export const isCrossSite = (headers: IncomingHttpHeaders): boolean => {
  const site = headers['sec-fetch-site'];
  if (typeof site === 'string') return site !== 'same-origin' && site !== 'none';
  const origin = headers.origin;
  if (!origin) return false;
  const forwardedHost = headers['x-forwarded-host'];
  const host = (typeof forwardedHost === 'string' ? forwardedHost.split(',')[0] : headers.host)?.trim();
  try {
    return !host || new URL(origin).host.toLowerCase() !== host.toLowerCase();
  } catch {
    return true; // "null" or malformed
  }
};

export const securityMiddleware = (req: Request, res: Response, next: NextFunction) => {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'no-store',
  });
  if (UNSAFE_METHODS.has(req.method) && isCrossSite(req.headers)) {
    res.status(403).json({ error: 'Cross-site request refused', code: 'cross_site_request' });
    return;
  }
  next();
};

/** Applied to every /api route except /api/auth. */
export const requireAuth = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const account = await getAccount();
    if (!account) {
      ensureSetupCode();
      res.status(401).json({ error: 'No account yet: create it first', code: 'auth_setup_required' });
      return;
    }
    if (!(await authenticate(req.headers, account))) {
      res.status(401).json({ error: 'Login required', code: 'auth_required' });
      return;
    }
    next();
  } catch (error) {
    next(error);
  }
};
