'use strict';

// A small ACME server for the tests of the built-in Let's Encrypt (https/acme.test.js):
// directory, nonces, account, order, HTTP-01 challenge (it fetches the key authorization
// from the HTTP port, as Let's Encrypt does), finalize, certificate, and ARI's
// renewalInfo. JWS signatures are not checked: it only stands in for the CA in tests.
// Certificates are issued by a throwaway CA made at start (@peculiar/x509, which
// acme-client already uses).

const http = require('node:http');
const crypto = require('node:crypto');
const x509 = require('@peculiar/x509');

x509.cryptoProvider.set(crypto.webcrypto);
const ALG = { name: 'ECDSA', namedCurve: 'P-256', hash: 'SHA-256' };

const b64u = (buf) => Buffer.from(buf).toString('base64url');
const fromB64u = (s) => Buffer.from(s, 'base64url');

/** RFC 7638 thumbprint of an EC or RSA JWK */
function thumbprint(jwk) {
  const members = jwk.kty === 'EC' ? { crv: jwk.crv, kty: jwk.kty, x: jwk.x, y: jwk.y } : { e: jwk.e, kty: jwk.kty, n: jwk.n };
  return b64u(crypto.createHash('sha256').update(JSON.stringify(members)).digest());
}

/**
 * Starts the server.
 * @param {object} options
 * @param {(domain: string) => number} options.httpPortOf where the challenge is checked (127.0.0.1)
 * @param {number} [options.validDays] life of the certificates issued
 */
async function startFakeAcme({ httpPortOf, validDays = 90 }) {
  const caKeys = await crypto.webcrypto.subtle.generateKey(ALG, true, ['sign', 'verify']);
  const caCert = await x509.X509CertificateGenerator.createSelfSigned({
    serialNumber: '01',
    name: 'CN=Made-up Test CA',
    notBefore: new Date(Date.now() - 3_600_000),
    notAfter: new Date(Date.now() + 3650 * 86_400_000),
    keys: caKeys,
    signingAlgorithm: ALG,
    extensions: [
      new x509.BasicConstraintsExtension(true, undefined, true),
      await x509.SubjectKeyIdentifierExtension.create(caKeys.publicKey),
    ],
  });

  const state = {
    accounts: new Map(), // url → jwk
    orders: new Map(),
    authzs: new Map(),
    challenges: new Map(),
    certs: new Map(),
    ordersReceived: [], // payloads of newOrder, for the tests
    renewalInfoAsked: [],
    renewalWindow: null, // (certId) => { start, end } or null for 404
    retryAfter: '21600',
    failValidation: false,
    serial: 100,
  };
  let base = '';
  let nextId = 1;
  const id = () => String(nextId++);

  const send = (res, status, body, headers = {}) => {
    res.writeHead(status, { 'replay-nonce': b64u(crypto.randomBytes(16)), 'content-type': 'application/json', ...headers });
    res.end(typeof body === 'string' ? body : JSON.stringify(body));
  };
  const problem = (res, status, type, detail) => send(res, status, { type: `urn:ietf:params:acme:error:${type}`, detail }, { 'content-type': 'application/problem+json' });

  const orderView = (order) => ({
    status: order.status,
    identifiers: order.identifiers,
    authorizations: order.authzs.map((a) => `${base}/authz/${a}`),
    finalize: `${base}/order/${order.id}/finalize`,
    ...(order.cert ? { certificate: `${base}/cert/${order.cert}` } : {}),
    expires: new Date(Date.now() + 86_400_000).toISOString(),
  });
  const challengeView = (ch) => ({
    type: 'http-01',
    url: `${base}/chall/${ch.id}`,
    token: ch.token,
    status: ch.status,
    ...(ch.error ? { error: ch.error } : {}),
  });
  const authzView = (authz) => ({
    status: authz.status,
    identifier: authz.identifier,
    challenges: [challengeView(state.challenges.get(authz.challenge))],
    expires: new Date(Date.now() + 86_400_000).toISOString(),
  });

  async function validate(ch) {
    const authz = state.authzs.get(ch.authz);
    const domain = authz.identifier.value;
    const expected = `${ch.token}.${thumbprint(state.accounts.get(ch.account))}`;
    let body = '';
    try {
      body = await new Promise((resolve, reject) => {
        http
          .get({ host: '127.0.0.1', port: httpPortOf(domain), path: `/.well-known/acme-challenge/${ch.token}`, headers: { host: domain } }, (r) => {
            let data = '';
            r.on('data', (c) => (data += c));
            r.on('end', () => resolve(r.statusCode === 200 ? data : `HTTP ${r.statusCode}`));
          })
          .on('error', reject);
      });
    } catch (err) {
      body = err.message;
    }
    if (!state.failValidation && body.trim() === expected) {
      ch.status = 'valid';
      authz.status = 'valid';
    } else {
      ch.status = 'invalid';
      authz.status = 'invalid';
      ch.error = { type: 'urn:ietf:params:acme:error:unauthorized', detail: `Invalid response from http://${domain}/.well-known/acme-challenge/${ch.token}: "${body.slice(0, 40)}"` };
    }
    for (const order of state.orders.values()) {
      if (order.authzs.includes(ch.authz)) order.status = order.authzs.every((a) => state.authzs.get(a).status === 'valid') ? 'ready' : 'invalid';
    }
  }

  async function issue(order, csrDer) {
    const csr = new x509.Pkcs10CertificateRequest(csrDer);
    state.serial += 1;
    const leaf = await x509.X509CertificateGenerator.create({
      serialNumber: state.serial.toString(16).padStart(4, '0'),
      subject: `CN=${order.identifiers[0].value}`,
      issuer: caCert.subject,
      notBefore: new Date(Date.now() - 60_000),
      notAfter: new Date(Date.now() + validDays * 86_400_000),
      signingAlgorithm: ALG,
      publicKey: await csr.publicKey.export(),
      signingKey: caKeys.privateKey,
      extensions: [
        new x509.SubjectAlternativeNameExtension(order.identifiers.map((i) => ({ type: 'dns', value: i.value }))),
        await x509.AuthorityKeyIdentifierExtension.create(caCert),
      ],
    });
    const certId = id();
    state.certs.set(certId, `${leaf.toString('pem')}\n${caCert.toString('pem')}\n`);
    order.cert = certId;
    order.status = 'valid';
  }

  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', async () => {
      try {
        const url = new URL(req.url, base);
        if (url.pathname === '/dir') {
          return send(res, 200, {
            newNonce: `${base}/nonce`,
            newAccount: `${base}/account`,
            newOrder: `${base}/order`,
            renewalInfo: `${base}/renewal-info`,
            revokeCert: `${base}/revoke`,
            keyChange: `${base}/key-change`,
          });
        }
        if (url.pathname === '/nonce') return send(res, req.method === 'HEAD' ? 200 : 204, '');
        if (url.pathname.startsWith('/renewal-info/')) {
          const certId = url.pathname.slice('/renewal-info/'.length);
          state.renewalInfoAsked.push(certId);
          const window = state.renewalWindow && state.renewalWindow(certId);
          if (!window) return problem(res, 404, 'malformed', 'unknown certificate');
          return send(res, 200, { suggestedWindow: { start: window.start.toISOString(), end: window.end.toISOString() } }, { 'retry-after': state.retryAfter });
        }

        // Everything else is a JWS POST
        const jws = JSON.parse(raw || '{}');
        const header = JSON.parse(fromB64u(jws.protected || 'e30').toString());
        const payload = jws.payload ? JSON.parse(fromB64u(jws.payload).toString()) : null;
        const account = header.kid || null;

        if (url.pathname === '/account') {
          const thumb = thumbprint(header.jwk);
          const acctUrl = `${base}/acct/${thumb.slice(0, 12)}`;
          const existed = state.accounts.has(acctUrl);
          state.accounts.set(acctUrl, header.jwk);
          return send(res, existed ? 200 : 201, { status: 'valid', contact: payload && payload.contact }, { location: acctUrl });
        }
        if (url.pathname.startsWith('/acct/')) return send(res, 200, { status: 'valid' }, { location: url.href });
        if (url.pathname === '/order') {
          state.ordersReceived.push(payload);
          const order = { id: id(), status: 'pending', identifiers: payload.identifiers, authzs: [], account };
          for (const identifier of payload.identifiers) {
            const authzId = id();
            const ch = { id: id(), token: b64u(crypto.randomBytes(24)), status: 'pending', authz: authzId, account };
            state.challenges.set(ch.id, ch);
            state.authzs.set(authzId, { status: 'pending', identifier, challenge: ch.id });
            order.authzs.push(authzId);
          }
          state.orders.set(order.id, order);
          return send(res, 201, orderView(order), { location: `${base}/order/${order.id}` });
        }
        let m;
        if ((m = /^\/authz\/(\d+)$/.exec(url.pathname))) return send(res, 200, authzView(state.authzs.get(m[1])));
        if ((m = /^\/chall\/(\d+)$/.exec(url.pathname))) {
          const ch = state.challenges.get(m[1]);
          if (payload && ch.status === 'pending') {
            ch.status = 'processing';
            setTimeout(() => validate(ch), 50);
          }
          return send(res, 200, challengeView(ch));
        }
        if ((m = /^\/order\/(\d+)\/finalize$/.exec(url.pathname))) {
          const order = state.orders.get(m[1]);
          if (order.status !== 'ready') return problem(res, 403, 'orderNotReady', `order is ${order.status}`);
          await issue(order, fromB64u(payload.csr));
          return send(res, 200, orderView(order), { location: `${base}/order/${order.id}` });
        }
        if ((m = /^\/order\/(\d+)$/.exec(url.pathname))) return send(res, 200, orderView(state.orders.get(m[1])));
        if ((m = /^\/cert\/(\d+)$/.exec(url.pathname))) {
          return send(res, 200, state.certs.get(m[1]), { 'content-type': 'application/pem-certificate-chain' });
        }
        return problem(res, 404, 'malformed', `no ${url.pathname}`);
      } catch (err) {
        return problem(res, 500, 'serverInternal', err.stack);
      }
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  return {
    directoryUrl: `${base}/dir`,
    caPem: caCert.toString('pem'),
    state,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

module.exports = { startFakeAcme };
