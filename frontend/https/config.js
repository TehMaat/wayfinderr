'use strict';

// Settings of the frontend server (server.js), from the environment. HTTPS is on only
// with HTTPS_DOMAIN set: without it the frontend is `next start` on PORT as always.
// With it, PORT itself speaks HTTPS (the certificate copied by hand into HTTPS_CERT_DIR)
// and Next.js runs on an inner port, on 127.0.0.1 only (issue #107).

const path = require('node:path');

// A host name with at least two labels (wayfinderr.example.com), no wildcard, no port
const DOMAIN = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

// Settings of earlier versions (Let's Encrypt, the ports 443 and 80): said in the log, ignored
const GONE = ['HTTPS_CERT_SOURCE', 'ACME_EMAIL', 'ACME_STAGING', 'ACME_DIRECTORY_URL', 'HTTPS_PORT', 'HTTP_PORT'];

function port(env, name, fallback) {
  const raw = env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const value = Number(raw.trim());
  if (!Number.isInteger(value) || value < 1 || value > 65535) {
    throw new Error(`${name} must be a port number, not "${raw}"`);
  }
  return value;
}

/**
 * Reads the settings. Throws on a wrong value, so a mistake stops the frontend with a
 * clear message instead of serving something else.
 * @param {NodeJS.ProcessEnv} env
 * @param {string} baseDir the frontend folder (/app in the image)
 * @returns {{ port: number, https: null | { domain: string, certDir: string, nextPort: number }, ignored: string[] }}
 */
function readConfig(env, baseDir) {
  // The app's port (3000 by default): plain HTTP, or HTTPS with HTTPS_DOMAIN
  const appPort = port(env, 'PORT', 3000);
  const ignored = GONE.filter((name) => (env[name] || '').trim() !== '');
  const rawDomain = (env.HTTPS_DOMAIN || '').trim().toLowerCase().replace(/\.$/, '');
  if (!rawDomain) return { port: appPort, https: null, ignored };

  if (rawDomain.includes('*')) {
    throw new Error(`HTTPS_DOMAIN is the address of the app (wayfinderr.example.com), not a wildcard: "${env.HTTPS_DOMAIN}"`);
  }
  if (!DOMAIN.test(rawDomain)) {
    throw new Error(`HTTPS_DOMAIN must be a host name like wayfinderr.example.com, not "${env.HTTPS_DOMAIN}"`);
  }
  const certDir = (env.HTTPS_CERT_DIR || '').trim() || path.join(baseDir, 'certs');
  return {
    port: appPort,
    ignored,
    https: {
      domain: rawDomain,
      certDir: path.resolve(baseDir, certDir),
      // Next.js behind HTTPS, reachable from this container only
      nextPort: appPort === 3100 ? 3101 : 3100,
    },
  };
}

module.exports = { readConfig };
