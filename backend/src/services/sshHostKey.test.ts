import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync } from 'crypto';
import { AddressInfo } from 'net';
import { Server, utils as sshUtils } from 'ssh2';
import { hostKeyFingerprint } from './sshHostKey.js';
import { HostKeyChangedError, HostKeyStore, UploadManager } from './uploadManager.js';

// SSH host keys of servers and clients (issue #102): kept at the first connection,
// checked at every other one. Against SSH servers started in the test.

/** A throwaway host key (ECDSA, a format ssh2 reads) */
const newHostKey = () =>
  generateKeyPairSync('ec', { namedCurve: 'prime256v1' }).privateKey.export({ type: 'sec1', format: 'pem' }).toString();

test('host key fingerprints are written as OpenSSH does', () => {
  const blob = Buffer.from('made-up host key');
  const expected = createHash('sha256').update(blob).digest('base64').replace(/=+$/, '');
  assert.equal(hostKeyFingerprint(blob), `SHA256:${expected}`);
});

const startHost = async (hostKey = newHostKey()) => {
  const passwords: string[] = [];
  const server = new Server({ hostKeys: [hostKey] }, (client) => {
    client.on('authentication', (ctx) => {
      if (ctx.method === 'password') {
        passwords.push(ctx.password);
        return ctx.accept();
      }
      ctx.reject(['password']);
    });
    client.on('error', () => {});
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const parsed = sshUtils.parseKey(hostKey);
  if (parsed instanceof Error) throw parsed;
  const fingerprint = hostKeyFingerprint((Array.isArray(parsed) ? parsed[0] : parsed).getPublicSSH());
  return {
    port: (server.address() as AddressInfo).port,
    fingerprint,
    passwords,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
};

/** The database, in memory: one key per server or client */
const memoryStore = () => {
  const keys = new Map<string, string>();
  const store: HostKeyStore = {
    get: async (kind, id) => keys.get(`${kind}:${id}`) ?? null,
    keep: async (kind, id, fingerprint) => {
      if (keys.has(`${kind}:${id}`)) return false;
      keys.set(`${kind}:${id}`, fingerprint);
      return true;
    },
  };
  return { keys, store };
};

const login = (port: number, local = false) => ({
  id: 'srv1',
  sshHost: '127.0.0.1',
  sshPort: port,
  sshUsername: 'uploader',
  sshPassword: 'made-up-password',
  local,
});

test('the first connection keeps the host key, the next ones check it', async (t) => {
  const host = await startHost();
  t.after(() => host.close());
  const { keys, store } = memoryStore();
  const manager = new UploadManager(store);

  const first = await manager.connect(login(host.port));
  first.end();
  assert.equal(keys.get('server:srv1'), host.fingerprint);

  const again = await manager.connect(login(host.port));
  again.end();
  assert.equal(host.passwords.length, 2);
});

test('another host key is refused before the password is sent', async (t) => {
  const original = await startHost();
  const { keys, store } = memoryStore();
  const manager = new UploadManager(store);
  (await manager.connect(login(original.port))).end();
  const kept = keys.get('server:srv1');
  await original.close();

  // Another machine answers on the same address
  const impostor = await startHost();
  t.after(() => impostor.close());
  await assert.rejects(manager.connect(login(impostor.port)), (error: Error) => {
    assert.ok(error instanceof HostKeyChangedError);
    assert.match(error.message, new RegExp(`expected ${kept!.replace(/[+/]/g, '\\$&')}, got ${impostor.fingerprint.replace(/[+/]/g, '\\$&')}`));
    assert.match(error.message, /Nothing was sent\. If the server was reinstalled, forget the old key in its settings \(Servers page\)/);
    return true;
  });
  assert.deepEqual(impostor.passwords, [], 'the password never reached it');
  assert.equal(keys.get('server:srv1'), kept, 'the kept key is not replaced');
});

test('once forgotten, the new key is kept', async (t) => {
  const first = await startHost();
  const { keys, store } = memoryStore();
  const manager = new UploadManager(store);
  (await manager.connect(login(first.port))).end();
  await first.close();

  const reinstalled = await startHost();
  t.after(() => reinstalled.close());
  await assert.rejects(manager.connect(login(reinstalled.port)), HostKeyChangedError);
  keys.delete('server:srv1'); // "Forget" in the UI
  (await manager.connect(login(reinstalled.port))).end();
  assert.equal(keys.get('server:srv1'), reinstalled.fingerprint);
});

test("a download client's key is kept apart from the servers'", async (t) => {
  const host = await startHost();
  t.after(() => host.close());
  const { keys, store } = memoryStore();
  const manager = new UploadManager(store);
  (await manager.connect(login(host.port, true))).end();
  assert.equal(keys.get('client:srv1'), host.fingerprint);
  assert.equal(keys.has('server:srv1'), false);

  keys.set('client:srv1', 'SHA256:somethingElse');
  await assert.rejects(manager.connect(login(host.port, true)), /forget the old key in its settings \(Clients page\)/);
});
