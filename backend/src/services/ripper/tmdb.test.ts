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
