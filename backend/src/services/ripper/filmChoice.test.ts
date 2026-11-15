import { test } from 'node:test';
import assert from 'node:assert/strict';
import { retryFilmFields, SAVED_REASON, savedReason } from './filmChoice.js';

test('retryFilmFields clears a film found automatically', () => {
  assert.deepEqual(retryFilmFields({ filmChosen: false }), {
    tmdbId: null,
    title: null,
    originalTitle: null,
    originalLanguage: null,
    year: null,
    secondLanguage: null,
  });
});

test('retryFilmFields keeps a film chosen by hand', () => {
  assert.deepEqual(retryFilmFields({ filmChosen: true }), {});
});

test('savedReason says the film is saved, with what is still unsure about the title', () => {
  assert.equal(savedReason([]), SAVED_REASON);
  assert.equal(
    savedReason(['Several long titles (1h52, 1h38): more than one film or cut, choose one']),
    'Film saved · Several long titles (1h52, 1h38): more than one film or cut, choose one'
  );
});
