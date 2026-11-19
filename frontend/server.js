'use strict';

// Starts the frontend: `next start` as always (port 3000, PORT), and with HTTPS_DOMAIN
// set also HTTPS in front of it in the same container (issue #96): the HTTPS port with
// the certificate of HTTPS_CERT_DIR, reloaded without a restart when it changes, and
// the HTTP port that sends everything to HTTPS. See docs/DEPLOYMENT.md, "Built-in HTTPS".
//
// Next.js runs unchanged in its own process: a custom Next.js server does not proxy
// the /ws WebSocket by itself, so HTTPS stays a thin layer in front of it.

const { spawn } = require('node:child_process');
const { readConfig } = require('./https/config');
const { startHttps } = require('./https/server');
const { AcmeManager } = require('./https/acme');

function line(level, message) {
  const text = `${new Date().toISOString()} [https] ${level}: ${message}`;
  if (level === 'info') console.log(text);
  else console.error(text);
}
const log = {
  info: (m) => line('info', m),
  warn: (m) => line('warn', m),
  error: (m) => line('error', m),
};

let config;
try {
  config = readConfig(process.env, __dirname);
} catch (err) {
  log.error(err.message);
  process.exit(1);
}

const next = spawn(process.execPath, [require.resolve('next/dist/bin/next'), 'start'], {
  stdio: 'inherit',
  env: process.env,
});

let httpsLayer = null;
let acmeManager = null;
let stopping = false;
let exitCode = null; // 1 when HTTPS failed: the container stops and restarts

async function stop(signal) {
  if (stopping) return;
  stopping = true;
  if (acmeManager) acmeManager.stop();
  if (httpsLayer) await httpsLayer.close();
  if (next.exitCode === null && next.signalCode === null) next.kill(signal);
}

function fail(message) {
  log.error(message);
  exitCode = 1;
  stop('SIGTERM');
}

next.on('exit', async (code, signal) => {
  if (!stopping) {
    stopping = true;
    if (acmeManager) acmeManager.stop();
    if (httpsLayer) await httpsLayer.close();
  }
  process.exit(exitCode ?? code ?? (signal === 'SIGTERM' || signal === 'SIGINT' ? 0 : 1));
});
next.on('error', (err) => fail(`cannot start Next.js: ${err.message}`));

for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => stop(signal));

if (config.https) {
  // Let's Encrypt (HTTPS_CERT_SOURCE=acme): its challenges are answered on the HTTP port
  const challenges = config.https.acme ? new Map() : null;
  startHttps({
    ...config.https,
    target: { host: '127.0.0.1', port: config.nextPort },
    log,
    challenges,
    onFatal: (err) => fail(err.message),
  })
    .then((layer) => {
      httpsLayer = layer;
      if (stopping) {
        layer.close();
        return;
      }
      if (config.https.acme) {
        const { directoryUrl, email, staging } = config.https.acme;
        log.info(
          `Let's Encrypt${staging ? ' (staging: test certificates, not trusted by browsers)' : ''} for ${config.https.domain}: ${directoryUrl}`,
        );
        acmeManager = new AcmeManager({
          domain: config.https.domain,
          certDir: config.https.certDir,
          directoryUrl,
          email,
          challenges,
          log,
          onCertificate: () => layer.reload(),
        });
        acmeManager.start();
      }
    })
    .catch((err) =>
      fail(
        err.code === 'EADDRINUSE' || err.code === 'EACCES'
          ? `HTTPS not started: the HTTP port ${config.https.httpPort} is taken or not allowed (${err.code})`
          : `HTTPS not started: ${err.message}`,
      ),
    );
}
