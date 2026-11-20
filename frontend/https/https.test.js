'use strict';

// Tests of the frontend's HTTPS (issue #96): node --test https/
// The certificates in fixtures/ are self-signed, made up for these tests only
// (wayfinderr.example.com, *.example.com, other.example.net): their keys protect nothing.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const https = require('node:https');
const tls = require('node:tls');

const { readConfig } = require('./config');
const { checkCertificate, readCertificate, daysLeft } = require('./certificate');
const { clientAddress, withoutHopByHop, forwardedHeaders } = require('./proxy');
const { startHttps } = require('./server');

const fixture = (name) => fs.readFileSync(path.join(__dirname, 'fixtures', name), 'utf8');
const SITE = { cert: fixture('site.crt'), key: fixture('site.key') };
const WILDCARD = { cert: fixture('wildcard.crt'), key: fixture('wildcard.key') };
const OTHER = { cert: fixture('other.crt'), key: fixture('other.key') };
const DOMAIN = 'wayfinderr.example.com';

const quietLog = () => {
  const lines = [];
  const push = (level) => (message) => lines.push({ level, message });
  return { lines, info: push('info'), warn: push('warn'), error: push('error') };
};

/** Writes a certificate into a folder as a writer should: whole files, by a rename */
function install(dir, { cert, key }) {
  for (const [file, content] of [
    ['fullchain.pem', cert],
    ['privkey.pem', key],
  ]) {
    const tmp = path.join(dir, `.${file}.tmp`);
    fs.writeFileSync(tmp, content);
    fs.renameSync(tmp, path.join(dir, file));
  }
}

// --- settings ---

test('without HTTPS_DOMAIN there is no HTTPS: the app on PORT, as always', () => {
  assert.deepEqual(readConfig({}, '/app'), { port: 3000, https: null, ignored: [] });
  assert.deepEqual(readConfig({ HTTPS_DOMAIN: '  ', PORT: '3200' }, '/app'), { port: 3200, https: null, ignored: [] });
});

test('with HTTPS_DOMAIN the app port speaks HTTPS, Next.js on an inner port', () => {
  const settings = readConfig({ HTTPS_DOMAIN: ' Wayfinderr.Example.com. ' }, '/app');
  assert.deepEqual(settings, { port: 3000, ignored: [], https: { domain: DOMAIN, certDir: '/app/certs', nextPort: 3100 } });
  const custom = readConfig({ HTTPS_DOMAIN: DOMAIN, HTTPS_CERT_DIR: 'my-certs', PORT: '3100' }, '/app');
  assert.equal(custom.https.certDir, '/app/my-certs');
  assert.equal(custom.port, 3100);
  assert.equal(custom.https.nextPort, 3101, 'never the same port as the app');
});

test('settings of earlier versions are reported, not used', () => {
  const settings = readConfig(
    { HTTPS_DOMAIN: DOMAIN, HTTPS_CERT_SOURCE: 'acme', ACME_EMAIL: 'admin@example.com', HTTPS_PORT: '443', HTTP_PORT: '80' },
    '/app',
  );
  assert.deepEqual(settings.ignored, ['HTTPS_CERT_SOURCE', 'ACME_EMAIL', 'HTTPS_PORT', 'HTTP_PORT']);
  assert.equal(settings.port, 3000);
});

test('wrong HTTPS settings stop the start with a clear message', () => {
  assert.throws(() => readConfig({ HTTPS_DOMAIN: '*.example.com' }, '/app'), /not a wildcard/);
  assert.throws(() => readConfig({ HTTPS_DOMAIN: 'https://wayfinderr.example.com' }, '/app'), /host name/);
  assert.throws(() => readConfig({ HTTPS_DOMAIN: 'wayfinderr' }, '/app'), /host name/);
  assert.throws(() => readConfig({ HTTPS_DOMAIN: 'wayfinderr.example.com:8443' }, '/app'), /host name/);
  assert.throws(() => readConfig({ HTTPS_DOMAIN: DOMAIN, PORT: '70000' }, '/app'), /PORT/);
});

// --- certificate checks ---

test('a certificate for the domain is accepted, with what the log says about it', () => {
  const info = checkCertificate(SITE.cert, SITE.key, DOMAIN);
  assert.deepEqual(info.names, [DOMAIN]);
  assert.equal(info.issuer, DOMAIN); // self-signed: its issuer is itself
  assert.ok(info.validTo > new Date());
  assert.match(info.fingerprint, /^[0-9A-F:]+$/);
});

test('a wildcard covers one level only', () => {
  assert.deepEqual(checkCertificate(WILDCARD.cert, WILDCARD.key, DOMAIN).names, ['*.example.com', 'example.com']);
  assert.throws(() => checkCertificate(WILDCARD.cert, WILDCARD.key, 'a.wayfinderr.example.com'), /not a\.wayfinderr/);
});

test('a certificate for another domain, a wrong key or a broken file is refused', () => {
  assert.throws(() => checkCertificate(OTHER.cert, OTHER.key, DOMAIN), /for other\.example\.net, not wayfinderr\.example\.com/);
  assert.throws(() => checkCertificate(SITE.cert, OTHER.key, DOMAIN), /not the key of the certificate/);
  assert.throws(() => checkCertificate('not a certificate', SITE.key, DOMAIN), /not a PEM certificate/);
  assert.throws(() => checkCertificate(SITE.cert, 'not a key', DOMAIN), /not a PEM private key/);
});

test('a certificate out of its dates is refused', () => {
  const { validFrom, validTo } = checkCertificate(SITE.cert, SITE.key, DOMAIN);
  assert.throws(() => checkCertificate(SITE.cert, SITE.key, DOMAIN, new Date(validTo.getTime() + 1000)), /expired on/);
  assert.throws(() => checkCertificate(SITE.cert, SITE.key, DOMAIN, new Date(validFrom.getTime() - 1000)), /valid only from/);
  const info = checkCertificate(SITE.cert, SITE.key, DOMAIN);
  assert.equal(daysLeft(info, new Date(validTo.getTime() - 3.5 * 86_400_000)), 3);
});

test('a missing certificate says which file is missing', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-certs-'));
  assert.throws(() => readCertificate(dir, DOMAIN), /no certificate yet: .*fullchain\.pem not found/);
  install(dir, SITE);
  assert.equal(readCertificate(dir, DOMAIN).info.names[0], DOMAIN);
});

// --- headers ---

test("the client's own forwarding headers are replaced by the connection's", () => {
  const headers = forwardedHeaders(
    {
      host: DOMAIN,
      cookie: 'a=b',
      'x-forwarded-for': '203.0.113.9',
      'x-forwarded-proto': 'http',
      'x-forwarded-host': 'elsewhere.example.org',
      'x-forwarded-port': '80',
      forwarded: 'for=203.0.113.9',
      'x-real-ip': '203.0.113.9',
    },
    { remoteAddress: '::ffff:192.0.2.10' },
  );
  assert.deepEqual(headers, {
    host: DOMAIN,
    cookie: 'a=b',
    'x-forwarded-for': '192.0.2.10',
    'x-forwarded-proto': 'https',
    'x-forwarded-host': DOMAIN,
  });
  assert.equal(clientAddress({ remoteAddress: '2001:db8::1' }), '2001:db8::1');
});

test('hop-by-hop headers are not forwarded', () => {
  assert.deepEqual(
    withoutHopByHop({ connection: 'keep-alive, x-custom', 'keep-alive': 'timeout=5', 'x-custom': '1', 'transfer-encoding': 'chunked', accept: '*/*' }),
    { accept: '*/*' },
  );
});

// --- the server, end to end ---

/** A stand-in for Next.js: answers with the headers it got, and echoes a WebSocket-like upgrade */
async function fakeNext() {
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      res.setHeader('set-cookie', ['wf_session=x; HttpOnly', 'other=y']);
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ method: req.method, url: req.url, headers: req.headers, body }));
    });
  });
  server.on('upgrade', (req, socket) => {
    if (req.url !== '/ws') {
      socket.end('HTTP/1.1 401 Unauthorized\r\ncontent-length: 0\r\n\r\n');
      return;
    }
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nupgrade: websocket\r\nconnection: Upgrade\r\nx-seen-for: ${req.headers['x-forwarded-for']}\r\n\r\n`);
    socket.on('data', (data) => socket.write(`echo:${data}`));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return server;
}

function get(port, { path: urlPath = '/api/x', method = 'GET', headers = {}, body, ca = SITE.cert } = {}) {
  return new Promise((resolve, reject) => {
    const req = https.request(
      { host: '127.0.0.1', port, servername: DOMAIN, ca, method, path: urlPath, headers: { host: DOMAIN, ...headers }, agent: false },
      (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => resolve({ res, data }));
      },
    );
    req.on('error', reject);
    req.end(body);
  });
}

function servedCertificate(port) {
  return new Promise((resolve, reject) => {
    const socket = tls.connect({ host: '127.0.0.1', port, servername: DOMAIN, rejectUnauthorized: false }, () => {
      const cn = socket.getPeerCertificate().subject.CN;
      socket.end();
      resolve(cn);
    });
    socket.on('error', reject);
  });
}

test('HTTPS end to end: proxy, headers, WebSocket, reload', async (t) => {
  const next = await fakeNext();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-certs-'));
  const log = quietLog();
  const fatal = [];
  const layer = await startHttps({
    domain: DOMAIN,
    certDir: dir,
    port: 0,
    target: { host: '127.0.0.1', port: next.address().port },
    log,
    onFatal: (err) => fatal.push(err),
    watch: false,
  });
  t.after(async () => {
    await layer.close();
    next.close();
  });

  await t.test('without a certificate HTTPS waits, and says why once', async () => {
    assert.equal(layer.port(), null);
    await layer.reload();
    const waiting = log.lines.filter((l) => l.message.includes('not started yet'));
    assert.equal(waiting.length, 1);
    assert.match(waiting[0].message, /fullchain\.pem not found/);
  });

  await t.test('the certificate arrives: HTTPS starts without a restart', async () => {
    install(dir, SITE);
    await layer.reload();
    assert.ok(layer.port() > 0);
    assert.equal(await servedCertificate(layer.port()), DOMAIN);
    assert.deepEqual(fatal, []);
  });

  await t.test('requests reach Next.js with trusted forwarding headers', async () => {
    const { res, data } = await get(layer.port(), {
      method: 'POST',
      path: '/api/auth/login?x=1',
      headers: { 'x-forwarded-for': '203.0.113.9', 'x-forwarded-proto': 'http', 'content-type': 'application/json' },
      body: '{"password":"made-up"}',
    });
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.headers['set-cookie'], ['wf_session=x; HttpOnly', 'other=y']);
    const seen = JSON.parse(data);
    assert.equal(seen.method, 'POST');
    assert.equal(seen.url, '/api/auth/login?x=1');
    assert.equal(seen.body, '{"password":"made-up"}');
    assert.equal(seen.headers['x-forwarded-for'], '127.0.0.1');
    assert.equal(seen.headers['x-forwarded-proto'], 'https');
    assert.equal(seen.headers['x-forwarded-host'], DOMAIN);
    assert.equal(seen.headers.host, DOMAIN);
  });

  await t.test('the WebSocket upgrade goes through both ways', async () => {
    const reply = await new Promise((resolve, reject) => {
      const socket = tls.connect({ host: '127.0.0.1', port: layer.port(), servername: DOMAIN, ca: SITE.cert }, () => {
        socket.write(
          `GET /ws HTTP/1.1\r\nhost: ${DOMAIN}\r\nupgrade: websocket\r\nconnection: Upgrade\r\nx-forwarded-for: 203.0.113.9\r\n\r\n`,
        );
      });
      let data = '';
      socket.on('data', (chunk) => {
        data += chunk;
        if (data.includes('\r\n\r\n') && !data.includes('echo:')) socket.write('ping');
        if (data.includes('echo:ping')) {
          socket.end();
          resolve(data);
        }
      });
      socket.on('error', reject);
    });
    assert.match(reply, /^HTTP\/1\.1 101 /);
    assert.match(reply, /x-seen-for: 127\.0\.0\.1/);
    assert.match(reply, /echo:ping$/);
  });

  await t.test('a refused upgrade is passed on', async () => {
    const reply = await new Promise((resolve, reject) => {
      const socket = tls.connect({ host: '127.0.0.1', port: layer.port(), servername: DOMAIN, ca: SITE.cert }, () => {
        socket.write(`GET /other HTTP/1.1\r\nhost: ${DOMAIN}\r\nupgrade: websocket\r\nconnection: Upgrade\r\n\r\n`);
      });
      let data = '';
      socket.on('data', (chunk) => (data += chunk));
      socket.on('end', () => resolve(data));
      socket.on('close', () => resolve(data));
      socket.on('error', reject);
    });
    assert.match(reply, /^HTTP\/1\.1 401 /);
  });

  await t.test('a wrong certificate is not used: the one in service stays', async () => {
    install(dir, OTHER);
    await layer.reload();
    assert.equal(await servedCertificate(layer.port()), DOMAIN);
    assert.ok(log.lines.some((l) => l.level === 'warn' && /not used \(the certificate is for other\.example\.net/.test(l.message)));
  });

  await t.test('a new certificate is served without a restart, open connections untouched', async () => {
    install(dir, WILDCARD);
    await layer.reload();
    assert.equal(await servedCertificate(layer.port()), '*.example.com');
    assert.equal(layer.certificate().names[0], '*.example.com');
    assert.ok(log.lines.some((l) => l.message.startsWith('new certificate in use, without a restart')));
    const { res } = await get(layer.port(), { ca: WILDCARD.cert });
    assert.equal(res.statusCode, 200);
  });
});

test('a certificate close to its end is said in the log, once a day', async () => {
  const next = await fakeNext();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-certs-'));
  install(dir, SITE);
  const { validTo } = checkCertificate(SITE.cert, SITE.key, DOMAIN);
  let clock = new Date(validTo.getTime() - 10 * 86_400_000);
  const log = quietLog();
  const layer = await startHttps({
    domain: DOMAIN,
    certDir: dir,
    port: 0,
    target: { host: '127.0.0.1', port: next.address().port },
    log,
    onFatal: () => {},
    now: () => clock,
    watch: false,
  });
  try {
    const warnings = () => log.lines.filter((l) => l.level === 'warn' && l.message.includes('expires in'));
    assert.equal(warnings().length, 1);
    assert.match(warnings()[0].message, /expires in 10 days/);
    clock = new Date(clock.getTime() + 3_600_000);
    await layer.reload();
    assert.equal(warnings().length, 1);
    clock = new Date(clock.getTime() + 24 * 3_600_000);
    await layer.reload();
    assert.equal(warnings().length, 2);
  } finally {
    await layer.close();
    next.close();
  }
});
