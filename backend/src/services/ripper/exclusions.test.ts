import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchExclusion, normalizeExclusions, parseExclusions } from './exclusions.js';

test('a rule matches anywhere in the path, ignoring case', () => {
  assert.equal(matchExclusion(['s01'], 'Show.S01.COMPLETE.BluRay/Disc1'), 's01');
  assert.equal(matchExclusion(['Serie TV/'], 'Serie TV/Show/BDMV'), 'Serie TV/');
  assert.equal(matchExclusion(['serie tv/'], 'Film/Serie TV.iso'), null);
  assert.equal(matchExclusion(['Up'], 'Supernatural.iso'), 'Up');
});

test('* matches any text, other characters are literal', () => {
  assert.equal(matchExclusion(['S0*E'], 'Show.S03.Disc.E1.iso'), 'S0*E');
  assert.equal(matchExclusion(['*.EXTRAS.*'], 'Film.2001.Extras.Disc.iso'), '*.EXTRAS.*');
  assert.equal(matchExclusion(['Film.2001'], 'Film 2001.iso'), null);
  assert.equal(matchExclusion(['(2001)'], 'Film (2001).iso'), '(2001)');
  assert.equal(matchExclusion(['[ITA]'], 'Film I.iso'), null);
});

test('a rule with "\\" matches the "/" separators', () => {
  assert.equal(matchExclusion(['Serie TV\\'], 'Serie TV/Show.iso'), 'Serie TV\\');
});

test('the first matching rule wins', () => {
  assert.equal(matchExclusion(['nothing', 'disc', 'iso'], 'Film/Disc1.iso'), 'disc');
  assert.equal(matchExclusion([], 'Film.iso'), null);
});

test('rules are trimmed, without blanks and duplicates', () => {
  assert.deepEqual(normalizeExclusions([' S01 ', '', 's01', 'Extras', '  ']), ['S01', 'Extras']);
  assert.throws(() => normalizeExclusions('S01'));
  assert.throws(() => normalizeExclusions([1]));
  assert.throws(() => normalizeExclusions(['x'.repeat(201)]));
  assert.throws(() => normalizeExclusions(Array.from({ length: 101 }, (_, i) => `rule ${i}`)));
});

test('a broken setting counts as no rules', () => {
  assert.deepEqual(parseExclusions(undefined), []);
  assert.deepEqual(parseExclusions('not json'), []);
  assert.deepEqual(parseExclusions('["S01"]'), ['S01']);
});
