import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createHash } from 'crypto';
import { AddressInfo } from 'net';
import { Server, utils as sshUtils } from 'ssh2';
import {
  checkCertificate,
  generateSshKey,
  hostKeyFingerprint,
  parseFetched,
  publicKeyOf,
  retryDelayMs,
} from './certificate.js';
import { CertFetcher, FetcherLog } from './fetcher.js';

// The self-signed certificates of the frontend's tests, made up (wayfinderr.example.com,
// *.example.com, other.example.net): their keys protect nothing
const FIXTURES = path.resolve(__dirname, '../../../../frontend/https/fixtures');
const fixture = (name: string) => fs.readFileSync(path.join(FIXTURES, name), 'utf8');
const WILDCARD = { cert: fixture('wildcard.crt'), key: fixture('wildcard.key') };
const SITE = { cert: fixture('site.crt'), key: fixture('site.key') };
const OTHER = { cert: fixture('other.crt'), key: fixture('other.key') };
const DOMAIN = 'wayfinderr.example.com';

/** What the command on the Pangolin host prints: base64 of the PEM, as in acme.json */
const answer = ({ cert, key }: { cert: string; key: string }) =>
  JSON.stringify({ certificate: Buffer.from(cert).toString('base64'), key: Buffer.from(key).toString('base64') });

const tmpDir = (prefix: string) => fs.mkdtempSync(path.join(os.tmpdir(), prefix));

const recordingLog = () => {
  const lines: { level: string; msg: string; obj: object }[] = [];
  const at = (level: string) => (obj: object, msg: string) => lines.push({ level, msg, obj });
  const log: FetcherLog = { debug: at('debug'), info: at('info'), warn: at('warn'), error: at('error') };
  return { lines, log };
};

// --- pure parts ---

test('the answer of the host: base64 of the PEM, or plain PEM', () => {
  assert.deepEqual(parseFetched(answer(WILDCARD)), { cert: WILDCARD.cert, key: WILDCARD.key });
  const plain = parseFetched(JSON.stringify({ certificate: WILDCARD.cert.trim(), key: WILDCARD.key }));
  assert.equal(plain.cert, WILDCARD.cert);
});

test('an answer without the certificate says why', () => {
  assert.throws(() => parseFetched(''), /answered nothing/);
  assert.throws(() => parseFetched('jq: error: no certificate for *.example.com'), /did not answer with the certificate: "jq: error/);
  assert.throws(() => parseFetched('null'), /no certificate for the domain/);
  assert.throws(() => parseFetched('{"certificate":null,"key":null}'), /sent no certificate/);
  assert.throws(() => parseFetched(JSON.stringify({ certificate: 'aGVsbG8=', key: 'aGVsbG8=' })), /certificate that is not PEM/);
});

test('the certificate must cover the domain and match its key', () => {
  assert.deepEqual(checkCertificate(WILDCARD.cert, WILDCARD.key, DOMAIN).names, ['*.example.com', 'example.com']);
  assert.throws(() => checkCertificate(WILDCARD.cert, WILDCARD.key, 'a.wayfinderr.example.com'), /not a\.wayfinderr/);
  assert.throws(() => checkCertificate(OTHER.cert, OTHER.key, DOMAIN), /for other\.example\.net/);
  assert.throws(() => checkCertificate(WILDCARD.cert, SITE.key, DOMAIN), /not the certificate’s own/);
  const { validTo } = checkCertificate(SITE.cert, SITE.key, DOMAIN);
  assert.throws(() => checkCertificate(SITE.cert, SITE.key, DOMAIN, new Date(validTo.getTime() + 1)), /expired/);
});

test('retries: 15 minutes, doubled, at most 6 hours', () => {
  assert.deepEqual([1, 2, 3, 4, 5, 6, 10].map((n) => retryDelayMs(n) / 60_000), [15, 30, 60, 120, 240, 360, 360]);
});

test("Wayfinderr's SSH key: one ssh2 reads, with its authorized_keys line", () => {
  const key = generateSshKey();
  assert.match(key.publicKey, /^ecdsa-sha2-nistp256 [A-Za-z0-9+/=]+ wayfinderr-https$/);
  assert.equal(publicKeyOf(key.privateKey), key.publicKey);
  const parsed = sshUtils.parseKey(key.privateKey);
  assert.ok(!(parsed instanceof Error));
});

test('host key fingerprints are written as OpenSSH does', () => {
  const blob = Buffer.from('made-up host key');
  const expected = createHash('sha256').update(blob).digest('base64').replace(/=+$/, '');
  assert.equal(hostKeyFingerprint(blob), `SHA256:${expected}`);
  assert.doesNotMatch(hostKeyFingerprint(blob), /=$/);
});

// --- end to end, against an SSH server in the test ---

interface FakeHost {
  port: number;
  hostKeyFingerprint: string;
  setAnswer: (out: string, code?: number, stderr?: string) => void;
  authorize: (publicKey: string | null) => void;
  commands: string[];
  close: () => Promise<void>;
}

const startFakeHost = async (): Promise<FakeHost> => {
  const hostKey = generateSshKey('host').privateKey;
  const parsedHost = sshUtils.parseKey(hostKey);
  if (parsedHost instanceof Error) throw parsedHost;
  const hostPublic = (Array.isArray(parsedHost) ? parsedHost[0] : parsedHost).getPublicSSH();
  let allowed: ReturnType<typeof sshUtils.parseKey> | null = null;
  let reply = { out: '', code: 0, stderr: '' };
  const commands: string[] = [];

  const server = new Server({ hostKeys: [hostKey] }, (client) => {
    client.on('authentication', (ctx) => {
      const key = allowed && !(allowed instanceof Error) ? (Array.isArray(allowed) ? allowed[0] : allowed) : null;
      if (ctx.method === 'publickey' && key && ctx.key.algo === key.type && ctx.key.data.equals(key.getPublicSSH())) {
        if (!ctx.signature) return ctx.accept();
        return key.verify(ctx.blob!, ctx.signature, ctx.hashAlgo) === true ? ctx.accept() : ctx.reject();
      }
      ctx.reject(['publickey']);
    });
    client.on('ready', () => {
      client.on('session', (acceptSession) => {
        const session = acceptSession();
        session.on('exec', (acceptExec, _reject, info) => {
          commands.push(info.command);
          const stream = acceptExec();
          if (reply.stderr) stream.stderr.write(reply.stderr);
          stream.write(reply.out);
          stream.exit(reply.code);
          stream.end();
        });
      });
    });
    client.on('error', () => {});
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  return {
    port: (server.address() as AddressInfo).port,
    hostKeyFingerprint: hostKeyFingerprint(hostPublic),
    setAnswer: (out, code = 0, stderr = '') => {
      reply = { out, code, stderr };
    },
    authorize: (publicKey) => {
      // An authorized_keys line: the key is its second field
      allowed = publicKey ? sshUtils.parseKey(`${publicKey.split(' ')[0]} ${publicKey.split(' ')[1]}`) : null;
    },
    commands,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
};

test('fetching the wildcard over SSH, end to end', async (t) => {
  const host = await startFakeHost();
  const certDir = tmpDir('wf-certs-');
  const keyDir = tmpDir('wf-https-');
  const { lines, log } = recordingLog();
  const options = { domain: DOMAIN, certDir, host: '127.0.0.1', port: host.port, user: 'wayfinderr-cert', hostKey: '', keyDir, log };
  const fetcher = new CertFetcher(options);
  t.after(() => host.close());

  const { publicKey } = fetcher.ensureKey();
  assert.equal(fs.statSync(path.join(keyDir, 'ssh-key')).mode & 0o777, 0o600);
  assert.equal(fetcher.ensureKey().publicKey, publicKey, 'the key is made once, then kept');

  await t.test('a host not set up yet refuses the key: said in the log', async () => {
    host.setAnswer(answer(WILDCARD));
    assert.equal(await fetcher.runOnce(), 'failed');
    assert.match(lines.at(-1)!.msg, /refused Wayfinderr's SSH key: the host is not set up for it yet/);
    assert.equal(fs.existsSync(path.join(certDir, 'fullchain.pem')), false);
  });

  await t.test('set up: the certificate is saved, the host key kept', async () => {
    host.authorize(publicKey);
    assert.equal(await fetcher.runOnce(), 'saved');
    assert.equal(fs.readFileSync(path.join(certDir, 'fullchain.pem'), 'utf8'), WILDCARD.cert);
    assert.equal(fs.readFileSync(path.join(certDir, 'privkey.pem'), 'utf8'), WILDCARD.key);
    assert.equal(fs.statSync(path.join(certDir, 'privkey.pem')).mode & 0o777, 0o600);
    assert.equal(fs.readdirSync(certDir).filter((f) => f.endsWith('.tmp')).length, 0);
    const kept = JSON.parse(fs.readFileSync(path.join(keyDir, 'host-key'), 'utf8'));
    assert.equal(kept[`127.0.0.1:${host.port}`], host.hostKeyFingerprint);
    assert.ok(lines.some((l) => l.msg.includes('first connection to 127.0.0.1')));
    assert.ok(lines.some((l) => l.level === 'info' && l.msg.startsWith('HTTPS certificate fetched from 127.0.0.1 and saved: for *.example.com')));
    assert.equal(host.commands.at(-1), 'wayfinderr-cert');
    // The private key never goes to the log
    assert.ok(lines.every((l) => !JSON.stringify(l).includes('PRIVATE KEY')));
  });

  await t.test('the same certificate again: nothing written', async () => {
    const before = fs.statSync(path.join(certDir, 'fullchain.pem')).mtimeMs;
    assert.equal(await fetcher.runOnce(), 'unchanged');
    assert.equal(fs.statSync(path.join(certDir, 'fullchain.pem')).mtimeMs, before);
  });

  await t.test('renewed on the host: the new one is saved', async () => {
    host.setAnswer(answer(SITE));
    assert.equal(await fetcher.runOnce(), 'saved');
    assert.equal(fs.readFileSync(path.join(certDir, 'fullchain.pem'), 'utf8'), SITE.cert);
  });

  await t.test('a certificate for another domain is not written', async () => {
    host.setAnswer(answer(OTHER));
    assert.equal(await fetcher.runOnce(), 'failed');
    assert.match(lines.at(-1)!.msg, /for other\.example\.net, not wayfinderr\.example\.com\. Next try in 15 min/);
    assert.equal(fs.readFileSync(path.join(certDir, 'fullchain.pem'), 'utf8'), SITE.cert);
  });

  await t.test('the command failing on the host: its error in the log', async () => {
    host.setAnswer('', 5, 'jq: error (at acme.json:0): no certificate for *.example.com\n');
    assert.equal(await fetcher.runOnce(), 'failed');
    assert.match(lines.at(-1)!.msg, /the command on 127\.0\.0\.1 failed: jq: error .*no certificate for \*\.example\.com\. Next try in 30 min/);
  });

  await t.test('another host key: refused, nothing fetched', async () => {
    host.setAnswer(answer(WILDCARD));
    const pinned = new CertFetcher({ ...options, hostKey: 'SHA256:somethingElse' });
    assert.equal(await pinned.runOnce(), 'failed');
    assert.equal(lines.at(-1)!.level, 'error');
    assert.match(lines.at(-1)!.msg, /host key of 127\.0\.0\.1 is not the expected one/);
    assert.equal(fs.readFileSync(path.join(certDir, 'fullchain.pem'), 'utf8'), SITE.cert);
  });

  await t.test('the pinned host key, when right, is accepted', async () => {
    const pinned = new CertFetcher({ ...options, hostKey: host.hostKeyFingerprint });
    assert.equal(await pinned.runOnce(), 'saved');
    assert.equal(fs.readFileSync(path.join(certDir, 'fullchain.pem'), 'utf8'), WILDCARD.cert);
  });
});

test('a host key that changes after the first connection is refused', async (t) => {
  const first = await startFakeHost();
  const keyDir = tmpDir('wf-https-');
  const certDir = tmpDir('wf-certs-');
  const { lines, log } = recordingLog();
  const fetcher = new CertFetcher({ domain: DOMAIN, certDir, host: '127.0.0.1', port: first.port, user: 'u', hostKey: '', keyDir, log });
  first.authorize(fetcher.ensureKey().publicKey);
  first.setAnswer(answer(WILDCARD));
  assert.equal(await fetcher.runOnce(), 'saved');
  await first.close();

  // Another machine answers on the same address
  const second = await startFakeHost();
  t.after(() => second.close());
  const kept = JSON.parse(fs.readFileSync(path.join(keyDir, 'host-key'), 'utf8'));
  kept[`127.0.0.1:${second.port}`] = first.hostKeyFingerprint;
  fs.writeFileSync(path.join(keyDir, 'host-key'), JSON.stringify(kept));
  second.authorize(fetcher.ensureKey().publicKey);
  second.setAnswer(answer(SITE));
  const moved = new CertFetcher({ domain: DOMAIN, certDir, host: '127.0.0.1', port: second.port, user: 'u', hostKey: '', keyDir, log });
  assert.equal(await moved.runOnce(), 'failed');
  assert.match(lines.at(-1)!.msg, /not the expected one .* delete .*host-key/);
  assert.equal(fs.readFileSync(path.join(certDir, 'fullchain.pem'), 'utf8'), WILDCARD.cert);
});

test('a certificate close to its end, with no newer one on the host, is said once a day', async (t) => {
  const host = await startFakeHost();
  t.after(() => host.close());
  const certDir = tmpDir('wf-certs-');
  const { validTo } = checkCertificate(SITE.cert, SITE.key, DOMAIN);
  let clock = new Date(validTo.getTime() - 10 * 86_400_000);
  const { lines, log } = recordingLog();
  const fetcher = new CertFetcher({
    domain: DOMAIN,
    certDir,
    host: '127.0.0.1',
    port: host.port,
    user: 'u',
    hostKey: '',
    keyDir: tmpDir('wf-https-'),
    log,
    now: () => clock,
  });
  host.authorize(fetcher.ensureKey().publicKey);
  host.setAnswer(answer(SITE));
  await fetcher.runOnce();
  const warnings = () => lines.filter((l) => l.msg.includes('expires in'));
  assert.equal(warnings().length, 1);
  assert.match(warnings()[0].msg, /expires in 10 days and 127\.0\.0\.1 has no newer one/);
  clock = new Date(clock.getTime() + 3_600_000);
  await fetcher.runOnce();
  assert.equal(warnings().length, 1);
  clock = new Date(clock.getTime() + 24 * 3_600_000);
  await fetcher.runOnce();
  assert.equal(warnings().length, 2);
});

test('without HTTPS_DOMAIN nothing is fetched', () => {
  const { lines, log } = recordingLog();
  const fetcher = new CertFetcher({ domain: '', certDir: tmpDir('c-'), host: 'pangolin.example.com', port: 22, user: 'u', hostKey: '', keyDir: tmpDir('k-'), log });
  fetcher.start();
  fetcher.stop();
  assert.equal(lines[0].level, 'error');
  assert.match(lines[0].msg, /without HTTPS_DOMAIN/);
});
