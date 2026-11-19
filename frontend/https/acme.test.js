'use strict';

// Tests of the built-in Let's Encrypt (issue #97): node --test https/acme.test.js
// Against a small ACME server in the test (fixtures/fake-acme.js), with made-up names.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const tls = require('node:tls');
const { X509Certificate } = require('node:crypto');

const { readConfig, ACME_DIRECTORIES } = require('./config');
const { createRedirectHandler } = require('./redirect');
const { startHttps } = require('./server');
const { AcmeManager, ariCertId, pickInWindow, fallbackRenewAt, retryDelayMs, retryAfterMs } = require('./acme');
const { startFakeAcme } = require('./fixtures/fake-acme');

const DOMAIN = 'wayfinderr.example.com';
const DAY = 86_400_000;

const quietLog = () => {
  const lines = [];
  const push = (level) => (message) => lines.push({ level, message });
  return { lines, info: push('info'), warn: push('warn'), error: push('error') };
};

// --- settings ---

test("Let's Encrypt settings", () => {
  const off = readConfig({ HTTPS_DOMAIN: DOMAIN }, '/app').https;
  assert.equal(off.certSource, 'files');
  assert.equal(off.acme, null);
  const on = readConfig({ HTTPS_DOMAIN: DOMAIN, HTTPS_CERT_SOURCE: 'ACME', ACME_EMAIL: 'admin@example.com' }, '/app').https;
  assert.deepEqual(on.acme, { email: 'admin@example.com', directoryUrl: ACME_DIRECTORIES.production, staging: false });
  const staging = readConfig({ HTTPS_DOMAIN: DOMAIN, HTTPS_CERT_SOURCE: 'acme', ACME_STAGING: 'true' }, '/app').https;
  assert.deepEqual(staging.acme, { email: '', directoryUrl: ACME_DIRECTORIES.staging, staging: true });
  const own = readConfig({ HTTPS_DOMAIN: DOMAIN, HTTPS_CERT_SOURCE: 'acme', ACME_DIRECTORY_URL: 'https://acme.example.org/dir' }, '/app').https;
  assert.equal(own.acme.directoryUrl, 'https://acme.example.org/dir');
});

test("wrong Let's Encrypt settings stop the start with a clear message", () => {
  assert.throws(() => readConfig({ HTTPS_DOMAIN: DOMAIN, HTTPS_CERT_SOURCE: 'letsencrypt' }, '/app'), /files or acme/);
  assert.throws(() => readConfig({ HTTPS_DOMAIN: DOMAIN, HTTPS_CERT_SOURCE: 'acme', HTTP_PORT: '0' }, '/app'), /needs the HTTP port/);
  assert.throws(() => readConfig({ HTTPS_DOMAIN: DOMAIN, HTTPS_CERT_SOURCE: 'acme', ACME_EMAIL: 'nobody' }, '/app'), /not an e-mail/);
});

// --- pure parts ---

test("ARI's certificate identifier: authority key identifier and serial", () => {
  // Values read with: openssl x509 -in fixtures/site.crt -noout -ext authorityKeyIdentifier -serial
  const aki = Buffer.from('72D1682B2CC478B3ADEAD1F675D0FA86F8615489', 'hex').toString('base64url');
  const serial = Buffer.from('641259A33E130DC2604B523C1E47DA7EBB9C08C0', 'hex').toString('base64url');
  assert.equal(ariCertId(fs.readFileSync(path.join(__dirname, 'fixtures/site.crt'), 'utf8')), `${aki}.${serial}`);
});

test('a renewal moment in the window, and the fallback at a third of the life', () => {
  const start = new Date('2026-12-01T00:00:00Z');
  const end = new Date('2026-12-03T00:00:00Z');
  assert.equal(pickInWindow(start, end, () => 0).toISOString(), start.toISOString());
  assert.equal(pickInWindow(start, end, () => 0.5).toISOString(), '2026-12-02T00:00:00.000Z');
  assert.ok(pickInWindow(start, end, () => 0.999999) < end);
  assert.equal(pickInWindow(end, start).toISOString(), end.toISOString());
  const info = { validFrom: new Date('2026-01-01T00:00:00Z'), validTo: new Date('2026-04-01T00:00:00Z') }; // 90 days
  assert.equal(fallbackRenewAt(info).toISOString(), '2026-03-02T00:00:00.000Z'); // 30 days before the end
});

test('retries: 15 minutes, doubled, at most 12 hours; Retry-After in seconds or as a date', () => {
  assert.deepEqual([1, 2, 3, 4, 5, 6, 9].map((n) => retryDelayMs(n) / 60_000), [15, 30, 60, 120, 240, 480, 720]);
  const now = new Date('2026-11-20T10:00:00Z');
  assert.equal(retryAfterMs('21600', now), 21_600_000);
  assert.equal(retryAfterMs('Fri, 20 Nov 2026 12:00:00 GMT', now), 7_200_000);
  assert.equal(retryAfterMs(undefined, now), null);
  assert.equal(retryAfterMs('soon', now), null);
});

test("the HTTP port answers Let's Encrypt's challenges, and redirects the rest", async () => {
  const challenges = new Map([['tok3n', 'tok3n.thumb']]);
  const server = http.createServer(createRedirectHandler(DOMAIN, challenges));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const get = (urlPath) =>
    new Promise((resolve, reject) => {
      http
        .get({ host: '127.0.0.1', port: server.address().port, path: urlPath }, (res) => {
          let body = '';
          res.on('data', (c) => (body += c));
          res.on('end', () => resolve({ status: res.statusCode, body, location: res.headers.location }));
        })
        .on('error', reject);
    });
  try {
    assert.deepEqual(await get('/.well-known/acme-challenge/tok3n'), { status: 200, body: 'tok3n.thumb', location: undefined });
    assert.equal((await get('/.well-known/acme-challenge/other')).status, 404);
    assert.equal((await get('/merge')).location, `https://${DOMAIN}/merge`);
  } finally {
    server.close();
  }
});

// --- end to end, against the ACME server of the test ---

function servedCertificate(port, ca) {
  return new Promise((resolve, reject) => {
    const socket = tls.connect({ host: '127.0.0.1', port, servername: DOMAIN, ca }, () => {
      const cert = socket.getPeerCertificate();
      socket.end();
      resolve({ cn: cert.subject.CN, serial: cert.serialNumber });
    });
    socket.on('error', reject);
  });
}

async function setup(t, { now } = {}) {
  const certDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-acme-'));
  const log = quietLog();
  const challenges = new Map();
  let httpPort = null;
  const ca = await startFakeAcme({ httpPortOf: () => httpPort });
  const target = http.createServer((req, res) => res.end('next'));
  await new Promise((resolve) => target.listen(0, '127.0.0.1', resolve));
  const layer = await startHttps({
    domain: DOMAIN,
    certDir,
    httpsPort: 0,
    httpPort: 0,
    target: { host: '127.0.0.1', port: target.address().port },
    log,
    challenges,
    onFatal: (err) => {
      throw err;
    },
    watch: false,
    ...(now ? { now } : {}),
  });
  httpPort = layer.ports().http;
  const manager = new AcmeManager({
    domain: DOMAIN,
    certDir,
    directoryUrl: ca.directoryUrl,
    email: 'admin@example.com',
    challenges,
    log,
    onCertificate: () => layer.reload(),
    backoff: { min: 20, max: 100 },
    random: () => 0.5,
    ...(now ? { now } : {}),
  });
  t.after(async () => {
    manager.stop();
    await layer.close();
    target.close();
    await ca.close();
  });
  return { certDir, log, challenges, ca, layer, manager };
}

test("Let's Encrypt end to end: obtained, kept, renewed in the ARI window", async (t) => {
  const { certDir, log, challenges, ca, layer, manager } = await setup(t);

  await t.test('no certificate: one is obtained over HTTP-01 and served without a restart', async () => {
    assert.equal(layer.ports().https, null);
    const next = await manager.runOnce();
    assert.equal(next, 60_000, 'the new certificate is checked again soon, for its ARI window');
    assert.equal(challenges.size, 0, 'the challenge is gone once used');
    assert.ok(layer.ports().https > 0);
    assert.equal((await servedCertificate(layer.ports().https, ca.caPem)).cn, DOMAIN);
    assert.deepEqual(ca.state.ordersReceived[0], { identifiers: [{ type: 'dns', value: DOMAIN }] });
    assert.equal(fs.statSync(path.join(certDir, 'privkey.pem')).mode & 0o777, 0o600);
    assert.equal(fs.statSync(path.join(certDir, 'acme', 'account.pem')).mode & 0o777, 0o600);
    assert.ok(log.lines.some((l) => l.message.startsWith(`Let's Encrypt: certificate of ${DOMAIN} obtained, valid until`)));
  });

  const firstPem = fs.readFileSync(path.join(certDir, 'fullchain.pem'), 'utf8');
  const firstId = ariCertId(firstPem);

  await t.test('ARI window later: nothing ordered, the moment kept', async () => {
    const start = new Date(Date.now() + 30 * DAY);
    const end = new Date(Date.now() + 32 * DAY);
    ca.state.renewalWindow = () => ({ start, end });
    const next = await manager.runOnce();
    assert.equal(ca.state.ordersReceived.length, 1);
    assert.equal(ca.state.renewalInfoAsked.at(-1), firstId);
    assert.equal(next, 21_600_000, 'asked again after Retry-After (6 hours)');
    const kept = JSON.parse(fs.readFileSync(path.join(certDir, 'acme', 'state.json'), 'utf8')).ari;
    assert.equal(kept.certId, firstId);
    assert.equal(kept.renewAt, new Date(start.getTime() + DAY).toISOString()); // random() = 0.5
    assert.ok(log.lines.some((l) => l.message.includes('renewal window') && l.message.includes(kept.renewAt)));
  });

  await t.test('ARI window moved to now (a revocation): renewed at once, naming the old certificate', async () => {
    ca.state.renewalWindow = () => ({ start: new Date(Date.now() - 2 * DAY), end: new Date(Date.now() - DAY) });
    await manager.runOnce();
    assert.equal(ca.state.ordersReceived.length, 2);
    assert.equal(ca.state.ordersReceived[1].replaces, firstId);
    const served = await servedCertificate(layer.ports().https, ca.caPem);
    assert.notEqual(served.serial, new X509Certificate(firstPem).serialNumber);
    assert.ok(log.lines.some((l) => l.message.startsWith(`Let's Encrypt: renewing the certificate of ${DOMAIN}`) && l.message.includes('(ARI window)')));
    assert.ok(log.lines.some((l) => l.message.includes('renewed, valid until')));
  });

  await t.test('a failed challenge keeps the certificate in use, and is tried again later', async () => {
    const before = fs.readFileSync(path.join(certDir, 'fullchain.pem'), 'utf8');
    ca.state.renewalWindow = () => ({ start: new Date(Date.now() - DAY), end: new Date(Date.now() - 1000) });
    ca.state.failValidation = true;
    assert.equal(await manager.runOnce(), 15 * 60_000);
    assert.equal(await manager.runOnce(), 30 * 60_000);
    const warning = log.lines.filter((l) => l.level === 'warn').at(-1).message;
    assert.match(warning, /the HTTP-01 challenge failed \(is port 80 of wayfinderr\.example\.com reaching this machine\?\)/);
    assert.match(warning, /next try in 30 min/);
    assert.equal(fs.readFileSync(path.join(certDir, 'fullchain.pem'), 'utf8'), before);
    assert.equal(fs.existsSync(path.join(certDir, 'acme', 'lock')), false, 'the lock is released');
    ca.state.failValidation = false;
  });
});

test('without ARI, renewed when a third of the life is left', async (t) => {
  let clock = new Date();
  const { ca, manager, log } = await setup(t, { now: () => clock });
  await manager.runOnce(); // obtained (90 days)
  ca.state.renewalWindow = null; // ARI answers 404
  clock = new Date(Date.now() + 50 * DAY);
  const next = await manager.runOnce();
  assert.equal(ca.state.ordersReceived.length, 1);
  assert.ok(next > 0 && next <= 6 * 3_600_000);
  assert.ok(log.lines.some((l) => l.message.includes('ARI (renewal information) not available')));
  clock = new Date(Date.now() + 61 * DAY);
  await manager.runOnce();
  assert.equal(ca.state.ordersReceived.length, 2);
  assert.equal(ca.state.ordersReceived[1].replaces, undefined);
});
