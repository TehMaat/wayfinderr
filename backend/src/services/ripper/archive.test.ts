import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ArchiveEntry, classifyArchive, findFilms, parseListing, pickUnpackTarget, unpackNeeds } from './archive.js';

const GB = 1024 ** 3;

// `unrar lt -v -c- -p- -idc` of a two-volume archive: the split file is listed in both
const LISTING = `
Archive: Film.2001.part1.rar
Details: RAR 5, volume 1

        Name: Film.2001.1080p.BluRay.x264-GRP/film.mkv
        Type: File
        Size: 3000000
 Packed size: 1048396
       Ratio: -->
       mtime: 2026-10-09 13:33:20,324263881
  Attributes: -rw-r--r--
  Pack-CRC32: 730AA49B
     Host OS: Unix
 Compression: RAR 5.0(v50) -m0 -md=128k
       Flags: split_after

Archive: Film.2001.part2.rar
Details: RAR 5, volume 2

        Name: Film.2001.1080p.BluRay.x264-GRP/film.mkv
        Type: File
        Size: 3000000
 Packed size: 1951604
       Flags: split_before

        Name: Film.2001.1080p.BluRay.x264-GRP/Città: è.nfo
        Type: File
        Size: 4

        Name: Film.2001.1080p.BluRay.x264-GRP
        Type: Directory
       mtime: 2026-10-09 13:33:20,324263881
`;

const file = (path: string, size = 1): ArchiveEntry => ({ path, size, kind: 'file', encrypted: false });

test('parseListing: one entry per file, with the whole size of a split file', () => {
  assert.deepEqual(parseListing(LISTING), [
    { path: 'Film.2001.1080p.BluRay.x264-GRP/film.mkv', size: 3000000, kind: 'file', encrypted: false },
    { path: 'Film.2001.1080p.BluRay.x264-GRP/Città: è.nfo', size: 4, kind: 'file', encrypted: false },
    { path: 'Film.2001.1080p.BluRay.x264-GRP', size: 0, kind: 'folder', encrypted: false },
  ]);
});

test('parseListing: links and encrypted files', () => {
  const entries = parseListing(`
        Name: Film/link
        Type: Unix symbolic link
      Target: film.nfo
        Size: 8
        Name: Film\\secret.mkv
        Type: File
        Size: 10
       Flags: encrypted 
`);
  assert.deepEqual(entries, [
    { path: 'Film/link', size: 8, kind: 'link', encrypted: false },
    { path: 'Film/secret.mkv', size: 10, kind: 'file', encrypted: true },
  ]);
});

test('findFilms: discs, ISO and MKV files; samples and disc contents are not films', () => {
  assert.deepEqual(findFilms(['Film/BDMV/index.bdmv', 'Film/BDMV/BACKUP/index.bdmv', 'Film/BDMV/STREAM/00800.m2ts']), [
    { type: 'BDMV', path: 'Film' },
  ]);
  assert.deepEqual(findFilms(['BDMV/index.bdmv', 'BDMV/STREAM/00001.mkv', 'CERTIFICATE/id.bdmv']), [{ type: 'BDMV', path: '.' }]);
  assert.deepEqual(findFilms(['Film.DVD9/VIDEO_TS/VIDEO_TS.IFO', 'Film.DVD9/VIDEO_TS/VTS_01_1.VOB']), [
    { type: 'DVD', path: 'Film.DVD9' },
  ]);
  assert.deepEqual(findFilms(['film.iso', 'film.nfo']), [{ type: 'ISO', path: 'film.iso' }]);
  assert.deepEqual(findFilms(['Film/grp-film.mkv', 'Film/Sample/grp-film.mkv', 'Film/grp-film.sample.mkv', 'sample-grp.mkv']), [
    { type: 'MKV', path: 'Film/grp-film.mkv' },
  ]);
  // "Sample" in the title is not a sample
  assert.deepEqual(findFilms(['The.Sample.Movie.2010.mkv']), [{ type: 'MKV', path: 'The.Sample.Movie.2010.mkv' }]);
});

test('classifyArchive: one film, with the size of every file', () => {
  assert.deepEqual(classifyArchive([file('Film/film.mkv', 40 * GB), file('Film/film.nfo', 4), { ...file('Film'), kind: 'folder' }]), {
    film: { type: 'MKV', path: 'Film/film.mkv' },
    size: 40 * GB + 4,
  });
});

test('classifyArchive: no film, several films, or an archive not to unpack', () => {
  assert.deepEqual(classifyArchive([file('grp-film.subs.idx'), file('grp-film.subs.rar')]), {
    film: null,
    reason: 'No film in the archive: grp-film.subs.idx, grp-film.subs.rar',
  });
  assert.deepEqual(classifyArchive([]), { film: null, reason: 'The archive is empty' });
  assert.equal(classifyArchive([file('a.mkv'), file('b.iso')]).film, null);
  assert.equal(
    (classifyArchive([file('Show/E01.mkv'), file('Show/E02.mkv'), file('Show/E03.mkv'), file('Show/E04.mkv')]) as { reason: string }).reason,
    'The archive holds 4 films (E01.mkv, E02.mkv, E03.mkv and 1 more): unpack it by hand'
  );
  assert.equal(
    (classifyArchive([{ ...file('film.mkv'), encrypted: true }]) as { reason: string }).reason,
    'Password-protected archive'
  );
  assert.equal(
    (classifyArchive([file('film.mkv'), { ...file('link'), kind: 'link' }]) as { reason: string }).reason,
    'The archive holds links: unpack it by hand'
  );
  for (const unsafe of ['../film.mkv', '/etc/film.mkv', 'C:/film.mkv', 'Film/../../film.mkv']) {
    assert.equal(
      (classifyArchive([file(unsafe)]) as { reason: string }).reason,
      'The archive holds paths outside its folder: unpack it by hand',
      unsafe
    );
  }
});

test('pickUnpackTarget: the disk with the most space left afterwards', () => {
  const targets = [
    { disk: 'watch' as const, freeBytes: 100 * GB },
    { disk: 'downloads' as const, freeBytes: 60 * GB },
  ];
  // An .mkv takes its size on either disk
  assert.equal(pickUnpackTarget(targets, 40 * GB, false, 2 * GB)?.disk, 'watch');
  // A disc next to the watch folder is ripped there too: 100 - 2 * 45 < 60 - 45
  assert.equal(pickUnpackTarget(targets, 45 * GB, true, 2 * GB)?.disk, 'downloads');
  // 100 - 2 * 30 > 60 - 30
  assert.equal(pickUnpackTarget(targets, 30 * GB, true, 2 * GB)?.disk, 'watch');
  // Only the watch folder disk is free enough
  assert.equal(pickUnpackTarget(targets, 70 * GB, false, 2 * GB)?.disk, 'watch');
  // The margin stays free
  assert.equal(pickUnpackTarget(targets, 99 * GB, false, 2 * GB), null);
  assert.equal(pickUnpackTarget([{ disk: 'watch', freeBytes: 100 * GB }], 50 * GB, true, 2 * GB), null);
  assert.equal(pickUnpackTarget([], 1, false, 0), null);
  // Equal: the first (the watch folder)
  assert.equal(
    pickUnpackTarget([{ disk: 'watch', freeBytes: GB * 10 }, { disk: 'downloads', freeBytes: GB * 10 }], GB, false, 0)?.disk,
    'watch'
  );
});

test('unpackNeeds: twice the size for a disc next to the watch folder', () => {
  assert.equal(unpackNeeds('watch', 10, true), 20);
  assert.equal(unpackNeeds('watch', 10, false), 10);
  assert.equal(unpackNeeds('downloads', 10, true), 10);
});
