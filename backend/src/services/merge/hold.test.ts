import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseName } from '../nameMatch.js';
import type { FilmTitles } from '../filmLookup.js';
import { decideHold, identity, matchTwin, rankTwins, type TwinCandidate, type TwinMatch } from './hold.js';

const ARRABBIAMO: FilmTitles = {
  id: 11000,
  titles: ['altrimenti ci arrabbiamo', 'zwei wie pech und schwefel', 'watch out were mad'],
  year: 1974,
  label: 'Altrimenti ci arrabbiamo! (1974)',
};

const file = (name: string, film: FilmTitles | null = null) => identity([parseName(name)], film);
const candidate = (
  source: TwinCandidate['source'],
  name: string,
  film: FilmTitles | null = null,
  where?: string
): TwinCandidate => ({ ...identity([parseName(name)], film), source, label: name, where });

test('the same TMDB film is a certain twin, whatever the names', () => {
  const match = matchTwin(
    file('Altrimenti ci arrabbiamo (1974).mkv', ARRABBIAMO),
    candidate('torrent', 'Zwei.wie.Pech.und.Schwefel.1974.German.2160p.UHD.BluRay', ARRABBIAMO)
  );
  assert.equal(match?.certain, true);
  assert.equal(match?.score, 100);
});

test('two different TMDB films are never twins, even with the same title', () => {
  const other = { ...ARRABBIAMO, id: 99 };
  assert.equal(matchTwin(file('Altrimenti ci arrabbiamo (1974).mkv', ARRABBIAMO), candidate('torrent', 'Altrimenti ci arrabbiamo 1974', other)), null);
});

test('a film TMDB knows on one side only still matches across languages', () => {
  // The Italian file is not found on TMDB, the German torrent is: its titles include the Italian one
  const match = matchTwin(
    file('Altrimenti ci arrabbiamo (1974).mkv'),
    candidate('torrent', 'Zwei.wie.Pech.und.Schwefel.1974.German.2160p.UHD.BluRay', ARRABBIAMO)
  );
  assert.equal(match?.certain, true);
  // And the other way round
  const back = matchTwin(
    file('Zwei wie Pech und Schwefel (1974).mkv', ARRABBIAMO),
    candidate('rip', 'ALTRIMENTI CI ARRABBIAMO 1974 BluRay')
  );
  assert.equal(back?.certain, true);
});

test('without a year, or with a partial title, the twin is only doubtful', () => {
  const noYear = matchTwin(file('Altrimenti ci arrabbiamo.mkv'), candidate('torrent', 'Altrimenti.Ci.Arrabbiamo.BluRay'));
  assert.equal(noYear?.certain, false);
  assert.equal(noYear?.score, 100);
  const partial = matchTwin(file('Blade Runner (1982).mkv'), candidate('torrent', 'Blade.Runner.Final.Cut.1982.2160p'));
  assert.equal(partial?.certain, false);
  assert.ok(partial && partial.score >= 60);
});

test('another film, or the same title years apart, is no twin', () => {
  assert.equal(matchTwin(file('Il padrino (1972).mkv'), candidate('torrent', 'Dune.Part.Two.2024.2160p')), null);
  assert.equal(matchTwin(file('Dune (1984).mkv'), candidate('torrent', 'Dune.2021.2160p.UHD')), null);
});

const twin = (certain: boolean, score: number, source: TwinCandidate['source'] = 'torrent', name = 'Film.2001.2160p'): TwinMatch => ({
  candidate: candidate(source, name, null, source === 'torrent' ? 'qBittorrent' : 'ripping'),
  certain,
  score,
});

test('a file without Italian audio is always held, with its twin when there is one', () => {
  assert.deepEqual(decideHold(false, []), { kind: 'NO_ITALIAN', message: 'No Italian audio: kept as the better video of a merge' });
  const held = decideHold(false, [twin(true, 100, 'upload', 'Film (2001).mkv')]);
  assert.equal(held?.kind, 'NO_ITALIAN');
  assert.match(held!.message, /Its twin may be the held file "Film \(2001\)\.mkv"/);
});

test('a file with Italian audio is held with a certain or a doubtful twin, uploaded without', () => {
  assert.equal(decideHold(true, []), null);
  const certain = decideHold(true, [twin(false, 75), twin(true, 100)]);
  assert.equal(certain?.kind, 'TWIN');
  assert.match(certain!.message, /^Twin of the torrent "Film\.2001\.2160p" in qBittorrent/);
  const doubtful = decideHold(true, [twin(false, 75)]);
  assert.equal(doubtful?.kind, 'POSSIBLE_TWIN');
  assert.match(doubtful!.message, /75% name match\)\. Upload it if they are not the same film$/);
});

test('a client that could not be searched is a doubt: the file is held', () => {
  const held = decideHold(true, [], ['qBittorrent: connection refused']);
  assert.deepEqual(held, { kind: 'POSSIBLE_TWIN', message: 'Could not look for a twin: qBittorrent: connection refused' });
  // A twin found elsewhere says more than the error
  assert.equal(decideHold(true, [twin(true, 100)], ['qBittorrent: connection refused'])?.kind, 'TWIN');
});

test('certain twins come first, then the best names', () => {
  const ranked = rankTwins([twin(false, 95), twin(true, 100, 'rip'), twin(false, 75)]);
  assert.deepEqual(
    ranked.map((m) => [m.certain, m.score]),
    [
      [true, 100],
      [false, 95],
      [false, 75],
    ]
  );
});
