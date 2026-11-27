import { afterEach, mock, test } from 'node:test';
import assert from 'node:assert/strict';
import { Upload } from '@prisma/client';
import { db } from '../database.js';
import { followSource, releaseVersionOf } from './versionSources.js';

const upload = (fields: Partial<Upload>): Upload =>
  ({ id: 'u1', filename: 'Orbita.Silenziosa.mkv', filepath: '/watch/Orbita.Silenziosa.mkv', torrentHash: null, version: null, ...fields }) as Upload;

/** The db as the version sources read it: rips by file, source torrents by hash, plans, pairs */
const fakeDb = (data: {
  rips?: Record<string, { version: string | null; downloadName: string }[]>;
  torrents?: Record<string, { version: string | null; origin: string | null; fileName: string }>;
  plans?: Record<string, { version: string | null; origin: string | null }[]>;
  pairs?: Record<string, { id: string; uploadAId: string; uploadBId: string }[]>;
  planOfPair?: Record<string, { version: string | null; origin: string | null }>;
  uploads?: Record<string, Upload>;
}) => {
  mock.method(db, 'getRipsByOutputFile', async (f: string) => data.rips?.[f] ?? []);
  mock.method(db, 'getSourceTorrentVersion', async (h: string) => data.torrents?.[h] ?? null);
  mock.method(db, 'getMergePlansOfUpload', async (id: string) => data.plans?.[id] ?? []);
  mock.method(db, 'getMergePairsByOutputUpload', async (id: string) => data.pairs?.[id] ?? []);
  mock.method(db, 'getMergePlanByPairId', async (id: string) => data.planOfPair?.[id] ?? null);
  mock.method(db, 'getUploadById', async (id: string) => data.uploads?.[id] ?? null);
};

afterEach(() => mock.restoreAll());

test('the rip and bookrr agree: their version', async () => {
  fakeDb({
    rips: { '/watch/Orbita.Silenziosa.mkv': [{ version: 'Extended', downloadName: 'Orbita.Silenziosa.2010' }] },
    torrents: { abc: { version: 'extended', origin: 'bookrr', fileName: 'Orbita.torrent' } },
  });
  const v = await releaseVersionOf(upload({ torrentHash: 'ABC' }));
  assert.equal(v.version, 'Extended');
  assert.equal(v.origin, 'rip');
  assert.equal(v.toChoose, false);
  assert.equal(v.sources.length, 2);
});

test('the rip and bookrr disagree: to choose, unless chosen on the upload', async () => {
  fakeDb({
    rips: { '/watch/Orbita.Silenziosa.mkv': [{ version: 'Extended', downloadName: 'Orbita.Silenziosa.2010' }] },
    torrents: { abc: { version: 'Theatrical', origin: 'bookrr', fileName: 'Orbita.torrent' } },
  });
  assert.equal((await releaseVersionOf(upload({ torrentHash: 'abc' }))).toChoose, true);
  const chosen = await releaseVersionOf(upload({ torrentHash: 'abc', version: 'Extended' }));
  assert.equal(chosen.version, 'Extended');
  assert.equal(chosen.origin, 'upload');
});

test("a merged file: its plan's version and its two files'", async () => {
  const a = upload({ id: 'a', filepath: '/watch/a.mkv', torrentHash: 'aaa' });
  const b = upload({ id: 'b', filepath: '/watch/b.mkv' });
  fakeDb({
    torrents: { aaa: { version: "Director's Cut", origin: 'bookrr', fileName: 'a.torrent' } },
    pairs: { out: [{ id: 'p1', uploadAId: 'a', uploadBId: 'b' }] },
    planOfPair: { p1: { version: "Director's Cut", origin: 'bookrr' } },
    uploads: { a, b },
  });
  const v = await releaseVersionOf(upload({ id: 'out', filepath: '/watch/out.mkv' }));
  assert.equal(v.version, "Director's Cut");
  assert.equal(v.origin, 'plan');
  assert.deepEqual(
    v.sources.map((s) => s.origin),
    ['plan', 'merge']
  );
});

test('nothing chosen anywhere: no version', async () => {
  fakeDb({});
  const v = await releaseVersionOf(upload({}));
  assert.equal(v.version, null);
  assert.equal(v.toChoose, false);
});

test("followSource: a different choice on the upload goes, the same one stays", async () => {
  const updates: [string, unknown][] = [];
  fakeDb({ uploads: { x: upload({ id: 'x', version: 'Extended' }), y: upload({ id: 'y', version: 'Theatrical' }) } });
  mock.method(db, 'updateUpload', async (id: string, data: unknown) => {
    updates.push([id, data]);
    return upload({ id });
  });
  await followSource(['x', 'y', null, 'x'], 'Theatrical', 'test');
  assert.deepEqual(updates, [['x', { version: null }]]);
});
