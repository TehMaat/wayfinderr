'use strict';

// Settings of the frontend server (server.js), from the environment. HTTPS is on only
// with HTTPS_DOMAIN set: without it the frontend is `next start` as always.

const path = require('node:path');

const ACME_DIRECTORIES = {
  production: 'https://acme-v02.api.letsencrypt.org/directory',
  staging: 'https://acme-staging-v02.api.letsencrypt.org/directory',
};

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
  // 0: no HTTP port (no redirect)
  const httpPort = port(env, 'HTTP_PORT', 80, { allowZero: true }) || null;

  // Where the certificate comes from: files put there (by hand, or by the backend from
  // Pangolin's host), or Let's Encrypt (acme)
  const certSource = (env.HTTPS_CERT_SOURCE || '').trim().toLowerCase() || 'files';
  if (!['files', 'acme'].includes(certSource)) {
    throw new Error(`HTTPS_CERT_SOURCE must be files or acme, not "${env.HTTPS_CERT_SOURCE}"`);
  }
  let acme = null;
  if (certSource === 'acme') {
    if (!httpPort) throw new Error('HTTPS_CERT_SOURCE=acme needs the HTTP port (HTTP_PORT): Let\'s Encrypt checks the domain on port 80');
    const email = (env.ACME_EMAIL || '').trim();
    if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error(`ACME_EMAIL is not an e-mail address: "${email}"`);
    const staging = (env.ACME_STAGING || '').trim().toLowerCase() === 'true';
    const directoryUrl = (env.ACME_DIRECTORY_URL || '').trim() || (staging ? ACME_DIRECTORIES.staging : ACME_DIRECTORIES.production);
    acme = { email, directoryUrl, staging: staging && !(env.ACME_DIRECTORY_URL || '').trim() };
  }
  return {
    nextPort,
    https: {
      domain: rawDomain,
      certDir: path.resolve(baseDir, certDir),
      httpsPort: port(env, 'HTTPS_PORT', 443),
      httpPort,
      certSource,
      acme,
    },
  };
}

module.exports = { readConfig, ACME_DIRECTORIES };
