'use strict';

// Starts the frontend: `next start` on PORT (3000) as always. With HTTPS_DOMAIN set, PORT
// speaks HTTPS instead (issues #96, #107): the certificate copied by hand into
// HTTPS_CERT_DIR, reloaded without a restart when it changes; Next.js then runs on an
// inner port, on 127.0.0.1 only. See docs/DEPLOYMENT.md, "Built-in HTTPS".
//
// Next.js runs unchanged in its own process: a custom Next.js server does not proxy
// the /ws WebSocket by itself, so HTTPS stays a thin layer in front of it.

const { spawn } = require('node:child_process');
const { readConfig } = require('./https/config');
const { startHttps } = require('./https/server');

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
if (config.ignored.length) {
  log.warn(
    `${config.ignored.join(', ')}: no longer used (Let's Encrypt and the ports 443 and 80 were removed). With HTTPS_DOMAIN the app's port, ${config.port}, speaks HTTPS with the certificate copied in`,
  );
}

// With HTTPS, Next.js listens on its inner port, from this container only
const nextArgs = config.https ? ['start', '-H', '127.0.0.1', '-p', String(config.https.nextPort)] : ['start'];
const next = spawn(process.execPath, [require.resolve('next/dist/bin/next'), ...nextArgs], {
  stdio: 'inherit',
  env: config.https ? { ...process.env, PORT: String(config.https.nextPort) } : process.env,
});

let httpsLayer = null;
let stopping = false;
let exitCode = null; // 1 when HTTPS failed: the container stops and restarts

async function stop(signal) {
  if (stopping) return;
  stopping = true;
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
    if (httpsLayer) await httpsLayer.close();
  }
  process.exit(exitCode ?? code ?? (signal === 'SIGTERM' || signal === 'SIGINT' ? 0 : 1));
});
next.on('error', (err) => fail(`cannot start Next.js: ${err.message}`));

for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => stop(signal));

if (config.https) {
  startHttps({
    domain: config.https.domain,
    certDir: config.https.certDir,
    port: config.port,
    target: { host: '127.0.0.1', port: config.https.nextPort },
    log,
    onFatal: (err) => fail(err.message),
  })
    .then((layer) => {
      httpsLayer = layer;
      if (stopping) layer.close();
    })
    .catch((err) => fail(`HTTPS not started: ${err.message}`));
}
