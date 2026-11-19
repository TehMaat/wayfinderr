'use strict';

// Settings of the frontend server (server.js), from the environment. HTTPS is on only
// with HTTPS_DOMAIN set: without it the frontend is `next start` as always.

const path = require('node:path');

// A host name with at least two labels (wayfinderr.example.com), no wildcard, no port
const DOMAIN = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

function port(env, name, fallback, { allowZero = false } = {}) {
  const raw = env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const value = Number(raw.trim());
  if (!Number.isInteger(value) || value < (allowZero ? 0 : 1) || value > 65535) {
    throw new Error(`${name} must be a port number${allowZero ? ' (0: off)' : ''}, not "${raw}"`);
  }
  return value;
}

/**
 * Reads the settings. Throws on a wrong value, so a mistake stops the frontend with a
 * clear message instead of serving something else.
 * @param {NodeJS.ProcessEnv} env
 * @param {string} baseDir the frontend folder (/app in the image)
 */
function readConfig(env, baseDir) {
  // Next.js reads PORT itself (3000 by default): the HTTPS server forwards there
  const nextPort = port(env, 'PORT', 3000);
  const rawDomain = (env.HTTPS_DOMAIN || '').trim().toLowerCase().replace(/\.$/, '');
  if (!rawDomain) return { https: null, nextPort };

  if (rawDomain.includes('*')) {
    throw new Error(`HTTPS_DOMAIN is the address of the app (wayfinderr.example.com), not a wildcard: "${env.HTTPS_DOMAIN}"`);
  }
  if (!DOMAIN.test(rawDomain)) {
    throw new Error(`HTTPS_DOMAIN must be a host name like wayfinderr.example.com, not "${env.HTTPS_DOMAIN}"`);
  }
  const certDir = (env.HTTPS_CERT_DIR || '').trim() || path.join(baseDir, 'certs');
  return {
    nextPort,
    https: {
      domain: rawDomain,
      certDir: path.resolve(baseDir, certDir),
      httpsPort: port(env, 'HTTPS_PORT', 443),
      // 0: no HTTP port (no redirect)
      httpPort: port(env, 'HTTP_PORT', 80, { allowZero: true }) || null,
    },
  };
}

module.exports = { readConfig };
