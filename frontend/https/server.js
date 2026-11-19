'use strict';

// HTTPS of the frontend (issue #96): the HTTPS port with the certificate of the
// certificate folder, reloaded without a restart when its files change, and the HTTP
// port that sends everything to HTTPS.

const fs = require('node:fs');
const http = require('node:http');
const https = require('node:https');
const { readCertificate, daysLeft } = require('./certificate');
const { createRequestProxy, createUpgradeProxy } = require('./proxy');
const { createRedirectHandler } = require('./redirect');

const CHECK_EVERY_MS = 5 * 60_000; // fs.watch is not always told of changes on volumes
const SETTLE_MS = 1000; // a writer may replace the two files one after the other
const WARN_DAYS = 14;
const WARN_EVERY_MS = 24 * 3_600_000;
const TLS_OPTIONS = { minVersion: 'TLSv1.2' };

function listen(server, port) {
  return new Promise((resolve, reject) => {
    const onError = (err) => reject(err);
    server.once('error', onError);
    server.listen(port, () => {
      server.off('error', onError);
      resolve(server.address().port);
    });
  });
}

function describe(info, now) {
  return `certificate for ${info.names.join(', ')} by ${info.issuer}, valid until ${info.validTo.toISOString()} (${daysLeft(info, now)} days)`;
}

/**
 * Starts HTTPS. Resolves once the HTTP port listens; the HTTPS port listens as soon as
 * a valid certificate is there (now, or when it arrives).
 * @param {object} options
 * @param {string} options.domain HTTPS_DOMAIN
 * @param {string} options.certDir folder with fullchain.pem and privkey.pem
 * @param {number} options.httpsPort 443, or 0 for any (tests)
 * @param {number|null} options.httpPort 80, null for none (0: any, in tests)
 * @param {{ host: string, port: number }} options.target Next.js
 * @param {{ info: Function, warn: Function, error: Function }} options.log
 * @param {(err: Error) => void} options.onFatal the HTTPS port could not listen
 * @param {() => Date} [options.now]
 * @param {boolean} [options.watch] watch the folder and check it on a timer (off in tests)
 */
async function startHttps(options) {
  const { domain, certDir, target, log, onFatal } = options;
  const now = options.now || (() => new Date());
  const requestProxy = createRequestProxy(target);
  const upgradeProxy = createUpgradeProxy(target);

  let httpsServer = null;
  let httpsPort = null;
  let current = null; // info of the certificate served
  let lastProblem = null; // logged once until it changes
  let lastWarnAt = 0;
  let loading = Promise.resolve();
  const timers = [];
  let watcher = null;
  let closed = false;

  const warnIfExpiring = () => {
    if (!current) return;
    const left = daysLeft(current, now());
    if (left < WARN_DAYS && now().getTime() - lastWarnAt >= WARN_EVERY_MS) {
      lastWarnAt = now().getTime();
      log.warn(`the certificate expires in ${left} days (${current.validTo.toISOString()}) and no new one has arrived in ${certDir}`);
    }
  };

  const load = async () => {
    if (closed) return;
    let cert;
    try {
      cert = readCertificate(certDir, domain, now());
    } catch (err) {
      if (err.message !== lastProblem) {
        lastProblem = err.message;
        if (current) {
          log.warn(`certificate in ${certDir} not used (${err.message}): HTTPS goes on with the ${describe(current, now())}`);
        } else {
          log.warn(`HTTPS on port ${options.httpsPort} not started yet: ${err.message}. Checked again when the files change, every 5 minutes at the latest`);
        }
      }
      warnIfExpiring();
      return;
    }
    lastProblem = null;
    if (current && cert.info.fingerprint === current.fingerprint) {
      warnIfExpiring();
      return;
    }

    if (!httpsServer) {
      const server = https.createServer({ ...TLS_OPTIONS, cert: cert.cert, key: cert.key }, requestProxy);
      server.on('upgrade', upgradeProxy);
      // Handshakes that fail (scanners, old clients) are not worth a log line each
      server.on('tlsClientError', () => {});
      try {
        httpsPort = await listen(server, options.httpsPort);
      } catch (err) {
        onFatal(new Error(`HTTPS cannot listen on port ${options.httpsPort}: ${err.code || err.message}`));
        return;
      }
      httpsServer = server;
      current = cert.info;
      log.info(`HTTPS on port ${httpsPort} for ${domain}: ${describe(current, now())}`);
    } else {
      httpsServer.setSecureContext({ ...TLS_OPTIONS, cert: cert.cert, key: cert.key });
      current = cert.info;
      log.info(`new certificate in use, without a restart: ${describe(current, now())}`);
    }
    lastWarnAt = 0;
    warnIfExpiring();
  };

  // One load at a time: a change seen while loading is checked right after
  const reload = () => {
    loading = loading.then(load, load);
    return loading;
  };

  let httpServer = null;
  let httpPort = null;
  if (options.httpPort !== null) {
    httpServer = http.createServer(createRedirectHandler(domain));
    httpPort = await listen(httpServer, options.httpPort);
    log.info(`HTTP on port ${httpPort}: every request redirected to https://${domain}`);
  }

  await reload();

  if (options.watch !== false) {
    try {
      fs.mkdirSync(certDir, { recursive: true });
    } catch {
      // read-only or not there: the timer still checks it
    }
    let settle = null;
    try {
      watcher = fs.watch(certDir, () => {
        clearTimeout(settle);
        settle = setTimeout(reload, SETTLE_MS);
      });
      watcher.on('error', () => {});
      timers.push(() => clearTimeout(settle));
    } catch {
      log.warn(`cannot watch ${certDir}: a new certificate is seen within 5 minutes`);
    }
    const interval = setInterval(reload, CHECK_EVERY_MS);
    interval.unref();
    timers.push(() => clearInterval(interval));
  }

  return {
    reload,
    certificate: () => current,
    ports: () => ({ https: httpsPort, http: httpPort }),
    async close() {
      closed = true;
      timers.forEach((stop) => stop());
      if (watcher) watcher.close();
      requestProxy.close();
      const closing = [httpsServer, httpServer].filter(Boolean).map(
        (server) =>
          new Promise((resolve) => {
            server.close(() => resolve());
            server.closeIdleConnections();
          }),
      );
      await Promise.race([Promise.all(closing), new Promise((resolve) => setTimeout(resolve, 5000).unref())]);
    },
  };
}

module.exports = { startHttps };
