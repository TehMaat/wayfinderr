import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TorrentClient } from '@prisma/client';
import { hostPathOf, localTarget, ReleaseError } from './index.js';

test('a file of the watch folder, as the client machine sees it', () => {
  assert.equal(hostPathOf('/makemkv-output/Film.mkv', '/makemkv-output', '/mnt/data/extracted-mkv'), '/mnt/data/extracted-mkv/Film.mkv');
  assert.equal(
    hostPathOf('/makemkv-output/Film (2001)/title_t00.mkv', '/makemkv-output/', '/mnt/data/extracted-mkv/'),
    '/mnt/data/extracted-mkv/Film (2001)/title_t00.mkv'
  );
  // A name starting with two dots is still inside
  assert.equal(hostPathOf('/makemkv-output/..Film.mkv', '/makemkv-output', '/x'), '/x/..Film.mkv');
  // Outside the watch folder, or the folder itself
  assert.equal(hostPathOf('/downloads/Film.mkv', '/makemkv-output', '/x'), null);
  assert.equal(hostPathOf('/makemkv-output', '/makemkv-output', '/x'), null);
});

const client = (fields: Partial<TorrentClient>) =>
  ({
    id: 'c1',
    name: 'qBittorrent',
    sshHost: '172.19.19.1',
    sshPort: 22,
    sshUsername: 'root',
    sshPassword: null,
    hostWatchDir: '/mnt/data/extracted-mkv',
    releaseDir: '/mnt/data/downloads/ittup',
    releaseTag: 'TAG',
    trackerCommand: 'ittup -u {path}',
    ...fields,
  }) as TorrentClient;

test("a client's machine as release target: its watch folder stands for the upload folder", () => {
  const target = localTarget(client({}));
  assert.equal(target.local, true);
  assert.equal(target.sshPath, '/mnt/data/extracted-mkv');
  assert.equal(target.releaseDir, '/mnt/data/downloads/ittup');
  assert.equal(target.trackerCommand, 'ittup -u {path}');
});

test('a client without its SSH login or folders is no target', () => {
  assert.throws(
    () => localTarget(client({ sshHost: null, releaseDir: '' })),
    (error: Error) => error instanceof ReleaseError && /SSH host, release folder/.test(error.message)
  );
});
