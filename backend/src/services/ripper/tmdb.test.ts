import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.TMDB_API_KEY = 'test-key';

type Movie = { id: number; title: string; original_title: string; original_language: string; release_date: string };

// Fake TMDB: search results by query, details by id
const respondWith = (results: Movie[]) => {
  globalThis.fetch = (async (input: string | URL) => {
    const url = new URL(String(input));
    const id = url.pathname.match(/\/movie\/(\d+)$/)?.[1];
    if (id) {
      return new Response(JSON.stringify(results.find((m) => m.id === Number(id))), { status: 200 });
    }
    const year = url.searchParams.get('year');
    const filtered = year ? results.filter((m) => m.release_date.startsWith(year)) : results;
    assert.equal(url.searchParams.get('api_key'), 'test-key');
    return new Response(JSON.stringify({ results: filtered }), { status: 200 });
  }) as typeof fetch;
};

const movie = (id: number, title: string, original: string, year: number, lang = 'en'): Movie => ({
  id,
  title,
  original_title: original,
  original_language: lang,
  release_date: `${year}-05-01`,
});

test('one film with the same title and year: matched', async () => {
  const { matchMovie } = await import('./tmdb.js');
  respondWith([movie(603, 'Matrix', 'The Matrix', 1999), movie(604, 'Matrix Reloaded', 'The Matrix Reloaded', 2003)]);
  const match = await matchMovie({ title: 'The Matrix', year: 1999 });
  assert.equal(match.movie?.id, 603);
  assert.equal(match.movie?.title, 'Matrix');
  assert.equal(match.movie?.originalLanguage, 'en');
});

test('localized title matches too, accents and case ignored', async () => {
  const { matchMovie } = await import('./tmdb.js');
  respondWith([movie(11216, 'Nuovo Cinema Paradiso', 'Nuovo Cinema Paradiso', 1988, 'it')]);
  const match = await matchMovie({ title: 'nuovo cinema paradiso', year: 1988 });
  assert.equal(match.movie?.id, 11216);
});

test('remakes with the same title and no year: ask', async () => {
  const { matchMovie } = await import('./tmdb.js');
  respondWith([movie(841, 'Dune', 'Dune', 1984), movie(438631, 'Dune', 'Dune', 2021)]);
  const match = await matchMovie({ title: 'Dune', year: null });
  assert.equal(match.movie, null);
  assert.equal(match.candidates.length, 2);
});

test('the year picks one of the remakes', async () => {
  const { matchMovie } = await import('./tmdb.js');
  respondWith([movie(841, 'Dune', 'Dune', 1984), movie(438631, 'Dune', 'Dune', 2021)]);
  assert.equal((await matchMovie({ title: 'Dune', year: 2021 })).movie?.id, 438631);
});

test('no exact title: ask, with the candidates', async () => {
  const { matchMovie } = await import('./tmdb.js');
  respondWith([movie(1, 'Something Else', 'Something Else', 2010)]);
  const match = await matchMovie({ title: 'Somthing Els', year: 2010 });
  assert.equal(match.movie, null);
  assert.equal(match.candidates.length, 1);
});

test('apostrophes and possessives: however the release name writes them', async () => {
  const { matchMovie } = await import('./tmdb.js');
  respondWith([movie(95610, "Bridget Jones's Baby", "Bridget Jones's Baby", 2016), movie(634, 'Il diario di Bridget Jones', "Bridget Jones's Diary", 2001)]);
  for (const title of ['Bridget Jones Baby', 'Bridget Joness Baby', 'Bridget Jones s Baby', "Bridget Jones's Baby", 'Bridget Jones’s Baby']) {
    assert.equal((await matchMovie({ title, year: 2016 })).movie?.id, 95610, title);
  }
  respondWith([movie(406, "L'odio", 'La Haine', 1995, 'fr')]);
  for (const title of ['L Odio', 'LOdio', 'L’Odio']) {
    assert.equal((await matchMovie({ title, year: 1995 })).movie?.id, 406, title);
  }
});

test('signs and spaces ignored: hyphens, dots, colons, &, superscripts', async () => {
  const { matchMovie } = await import('./tmdb.js');
  const cases: [Movie, string][] = [
    [movie(557, 'Spider-Man', 'Spider-Man', 2002), 'Spiderman'],
    [movie(2152, 'S.W.A.T. - Squadra speciale anticrimine', 'S.W.A.T.', 2003), 'SWAT'],
    [movie(11, 'Guerre stellari', 'Star Wars: Episode IV - A New Hope', 1977), 'Star Wars Episode IV A New Hope'],
    [movie(13804, 'Fast & Furious - Solo parti originali', 'Fast & Furious', 2009), 'Fast and Furious'],
    [movie(13804, 'Fast & Furious - Solo parti originali', 'Fast & Furious', 2009), 'Fast Furious'],
    [movie(394117, 'Stanlio & Ollio', 'Stan & Ollie', 2018), 'Stanlio e Ollio'],
    [movie(454, 'Romeo + Giulietta di William Shakespeare', "William Shakespeare's Romeo + Juliet", 1996), 'William Shakespeares Romeo and Juliet'],
    [movie(8077, 'Alien³', 'Alien³', 1992), 'Alien 3'],
  ];
  for (const [film, title] of cases) {
    respondWith([film]);
    assert.equal((await matchMovie({ title, year: Number(film.release_date.slice(0, 4)) })).movie?.id, film.id, title);
  }
});

test('normalizeTitle keeps only letters and digits', async () => {
  const { normalizeTitle } = await import('./tmdb.js');
  assert.equal(normalizeTitle("L'Odio"), 'lodio');
  assert.equal(normalizeTitle('Amélie'), 'amelie');
  assert.equal(normalizeTitle('Æon Flux'), 'aeonflux');
  assert.equal(normalizeTitle('Der Untergang™'), 'deruntergang');
  assert.equal(normalizeTitle('8½'), '812');
});

test('apostrophe look-alikes and ordinal signs in the TMDB title', async () => {
  const { matchMovie } = await import('./tmdb.js');
  for (const apostrophe of ['′', '＇', 'ʼ', 'ʹ', '‛']) {
    respondWith([movie(95610, `Bridget Jones${apostrophe}s Baby`, `Bridget Jones${apostrophe}s Baby`, 2016)]);
    for (const title of ['Bridget Jones Baby', 'Bridget Joness Baby']) {
      assert.equal((await matchMovie({ title, year: 2016 })).movie?.id, 95610, `${apostrophe} ${title}`);
    }
  }
  respondWith([movie(9776, 'Lʼultimo imperatore', 'The Last Emperor', 1987)]);
  assert.equal((await matchMovie({ title: 'L Ultimo Imperatore', year: 1987 })).movie?.id, 9776);
  respondWith([movie(11506, 'Amici miei - Atto IIº', 'Amici miei - Atto IIº', 1982, 'it')]);
  assert.equal((await matchMovie({ title: 'Amici Miei Atto II', year: 1982 })).movie?.id, 11506);
});

test('the release year first, then the same words over the same letters', async () => {
  const { matchMovie } = await import('./tmdb.js');
  respondWith([movie(380124, 'I.T.', 'I.T.', 2016), movie(346364, 'It', 'It', 2017)]);
  assert.equal((await matchMovie({ title: 'I T', year: 2016 })).movie?.id, 380124);
  assert.equal((await matchMovie({ title: 'It', year: 2017 })).movie?.id, 346364);
  // Same letters in the release year, same words a year off: ask
  assert.equal((await matchMovie({ title: 'IT', year: 2016 })).movie, null);
  assert.equal((await matchMovie({ title: 'I T', year: 2017 })).movie, null);
  respondWith([movie(557, 'Spider-Man', 'Spider-Man', 2002), movie(77777, 'Spiderman', 'Spiderman', 2001)]);
  assert.equal((await matchMovie({ title: 'Spiderman', year: 2002 })).movie, null);
  assert.equal((await matchMovie({ title: 'Spider Man', year: 2002 })).movie?.id, 557);
  // Without a year the same words win
  respondWith([movie(380124, 'I.T.', 'I.T.', 2016), movie(346364, 'It', 'It', 2017)]);
  assert.equal((await matchMovie({ title: 'It', year: null })).movie?.id, 346364);
});

test('ordinals and a dollar for an s, spelled out or left out', async () => {
  const { matchMovie } = await import('./tmdb.js');
  respondWith([movie(1592, 'La 25ª ora', '25th Hour', 2002)]);
  for (const title of ['La 25a Ora', 'La 25 Ora']) assert.equal((await matchMovie({ title, year: 2002 })).movie?.id, 1592, title);
  respondWith([movie(11506, 'Amici miei - Atto IIº', 'Amici miei - Atto IIº', 1982, 'it')]);
  for (const title of ['Amici Miei Atto IIo', 'Amici Miei Atto II']) assert.equal((await matchMovie({ title, year: 1982 })).movie?.id, 11506, title);
  respondWith([movie(41210, 'Ca$h', 'Ca$h', 2010)]);
  for (const title of ['Cash', 'Ca$h']) assert.equal((await matchMovie({ title, year: 2010 })).movie?.id, 41210, title);
});

test('the film is found past the first ten results', async () => {
  const { matchMovie } = await import('./tmdb.js');
  const others = Array.from({ length: 12 }, (_, i) => movie(1000 + i, `Baby ${i}`, `Baby ${i}`, 2016));
  respondWith([...others, movie(95610, "Bridget Jones's Baby", "Bridget Jones's Baby", 2016)]);
  const match = await matchMovie({ title: 'Bridget Jones Baby', year: 2016 });
  assert.equal(match.movie?.id, 95610);
  assert.equal(match.candidates.length, 10);
});
