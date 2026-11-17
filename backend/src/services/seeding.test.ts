import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { describeMiss, fileOfUpload, isSeedingPath, lookupUploadFile, releaseOfTorrent, seedingDirState, seedingPathOf } from './seeding.js';

const release = (id: string, fields: { hash?: string; client?: string; name?: string }) => ({
  id,
  releaseTorrentHash: fields.hash ?? null,
  localClientId: fields.client ?? null,
  releaseName: fields.name ?? null,
});

test('a released file sits in the release folder as its last <folder>/<file>', () => {
  const remote = '/srv/seeding/Lago.Ferro.1998.1080p.REMUX-NOI/Lago.Ferro.1998.1080p.REMUX-NOI.mkv';
  assert.equal(
    seedingPathOf(remote, '/seeding'),
    path.join('/seeding', 'Lago.Ferro.1998.1080p.REMUX-NOI', 'Lago.Ferro.1998.1080p.REMUX-NOI.mkv')
  );
  assert.equal(seedingPathOf('C:\\seed\\Film\\Film.mkv', '/seeding'), path.join('/seeding', 'Film', 'Film.mkv'));
  assert.equal(seedingPathOf(remote, ''), null); // not mounted
  assert.equal(seedingPathOf('Film.mkv', '/seeding'), null);
  assert.equal(seedingPathOf('/srv/seeding/../Film.mkv', '/seeding'), null);
  assert.equal(seedingPathOf(null, '/seeding'), null);
});

test('the file of an upload: its own path, or where it seeds once released locally (same size)', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'seeding-'));
  try {
    const watch = path.join(root, 'watch');
    const seeding = path.join(root, 'seeding');
    mkdirSync(watch);
    mkdirSync(path.join(seeding, 'Lago.Ferro.1998-NOI'), { recursive: true });
    const own = path.join(watch, 'Notte sul Lago Ferro (1998).mkv');
    const seeded = path.join(seeding, 'Lago.Ferro.1998-NOI', 'Lago.Ferro.1998-NOI.mkv');
    writeFileSync(seeded, 'x'.repeat(10));

    const kept = { filepath: own, localClientId: null, remotePath: null, size: 10n };
    assert.equal(fileOfUpload(kept, seeding), null);
    writeFileSync(own, 'x'.repeat(10));
    assert.deepEqual(fileOfUpload(kept, seeding), { path: own, seeding: false });

    // Released locally: only where it seeds, even with a file at its old path (a merged one, say)
    const released = { ...kept, localClientId: 'c1', remotePath: '/mnt/seed/Lago.Ferro.1998-NOI/Lago.Ferro.1998-NOI.mkv' };
    assert.deepEqual(fileOfUpload(released, seeding), { path: seeded, seeding: true });
    assert.equal(fileOfUpload({ ...released, size: 11n }, seeding), null); // another file
    assert.equal(fileOfUpload(released, ''), null); // release folder not mounted
    assert.equal(isSeedingPath(seeded, seeding), true);
    assert.equal(isSeedingPath(own, seeding), false);
    assert.equal(isSeedingPath(seeded, ''), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a torrent is the release of an upload by its info hash, or by its name on the same client', () => {
  const releases = [
    release('a', { hash: 'ABCDEF0123456789ABCDEF0123456789ABCDEF01' }),
    release('b', { client: 'c1', name: 'Lago.Ferro.1998.1080p.REMUX-NOI.mkv' }),
    release('c', { hash: '1111111111111111111111111111111111111111', client: 'c1', name: 'Altro.Film.2001-NOI.mkv' }),
  ];
  assert.equal(releaseOfTorrent({ hash: 'abcdef0123456789abcdef0123456789abcdef01', name: 'whatever' }, 'c9', releases)?.id, 'a');
  // Before its hash is known: the file, or the folder named after it
  assert.equal(releaseOfTorrent({ hash: 'f'.repeat(40), name: 'Lago.Ferro.1998.1080p.REMUX-NOI.mkv' }, 'c1', releases)?.id, 'b');
  assert.equal(releaseOfTorrent({ hash: 'f'.repeat(40), name: 'x', topLevel: 'Lago.Ferro.1998.1080p.REMUX-NOI' }, 'c1', releases)?.id, 'b');
  // Another client, or a name when the hash is known and different: not the release
  assert.equal(releaseOfTorrent({ hash: 'f'.repeat(40), name: 'Lago.Ferro.1998.1080p.REMUX-NOI.mkv' }, 'c2', releases), null);
  assert.equal(releaseOfTorrent({ hash: 'f'.repeat(40), name: 'Altro.Film.2001-NOI.mkv' }, 'c1', releases), null);
  assert.equal(releaseOfTorrent({ hash: 'f'.repeat(40), name: 'Lago.Ferro.1998.2160p-ALTRI' }, 'c1', releases), null);
});

test('a film released locally that is not where it seeds says why', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'seeding-'));
  try {
    const seeding = path.join(root, 'seeding');
    mkdirSync(path.join(seeding, 'Lago.Ferro.1998-NOI'), { recursive: true });
    writeFileSync(path.join(seeding, 'Lago.Ferro.1998-NOI', 'Lago.Ferro.1998-NOI.mkv'), 'x'.repeat(10));
    const released = {
      filepath: path.join(root, 'watch', 'Notte sul Lago Ferro (1998).mkv'),
      localClientId: 'c1',
      remotePath: '/mnt/seed/Lago.Ferro.1998-NOI/Lago.Ferro.1998-NOI.mkv',
      size: 10n,
    };
    const reason = (u: typeof released, dir = seeding) => lookupUploadFile(u, dir).miss?.reason;
    assert.equal(reason(released), undefined);
    assert.equal(reason(released, ''), 'NOT_MOUNTED');
    assert.equal(reason({ ...released, remotePath: null }), 'NO_REMOTE_PATH');
    assert.equal(reason({ ...released, remotePath: '/mnt/seed/Lago.Ferro.1998-NOI/Renamed.mkv' }), 'NOT_FOUND');
    const other = lookupUploadFile({ ...released, size: 11n }, seeding).miss!;
    assert.equal(other.reason, 'SIZE_MISMATCH');
    assert.equal(other.sizeThere, '10');
    assert.match(describeMiss(other), /^SIZE_MISMATCH: .*\(.*Lago\.Ferro\.1998-NOI\.mkv, 10 bytes there, 11 uploaded\)$/);
    assert.match(describeMiss(lookupUploadFile(released, '').miss!), /^NOT_MOUNTED: the release folder is not mounted \(LOCAL_RELEASE_DIR is not set\)$/);
    // A file kept in the watch folder: nothing to explain when it is gone
    assert.equal(lookupUploadFile({ ...released, localClientId: null }, seeding).miss, undefined);

    assert.deepEqual(seedingDirState(''), { state: 'NOT_SET' });
    assert.deepEqual(seedingDirState(seeding), { state: 'READABLE', entries: 1 });
    assert.deepEqual(seedingDirState(path.join(root, 'missing')), { state: 'UNREADABLE', error: 'ENOENT' });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
