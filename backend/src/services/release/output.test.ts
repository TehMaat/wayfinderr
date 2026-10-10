import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appendOutput, detectPrompt, exitCode, EXIT_MARKER, IDLE_PROMPT_MS, parseOutcome, withoutMarker } from './output.js';
import { shellQuote, trackerCommandFor } from './index.js';

test('progress bars rewrite their line, escape codes go', () => {
  let log = appendOutput('', 'Hashing\n\x1b[32m 10%\x1b[0m');
  log = appendOutput(log, '\r 55%');
  log = appendOutput(log, '\r100%\r\nDone\n');
  assert.equal(log, 'Hashing\n100%\nDone\n');
});

test('only the end of a long log is kept', () => {
  const log = appendOutput('', 'x'.repeat(70 * 1024));
  assert.equal(log.length, 64 * 1024);
});

test("Unit3Dup's questions, as soon as they are printed", () => {
  const tmdb = detectPrompt('Title not found\nPlease digit a valid TMDB ID (0=skip)-> ', 0);
  assert.deepEqual(tmdb, { kind: 'tmdb', text: 'Please digit a valid TMDB ID (0=skip)->' });
  assert.equal(detectPrompt('\nPress (C) to continue, (S) to SKIP.. (Q) Quit - ', 0)?.kind, 'duplicate');
  assert.equal(detectPrompt('Sorry trailer not found. Please digit a valid Youtube ID (0=skip)-> ', 0)?.kind, 'trailer');
  // Answered: the line is finished
  assert.equal(detectPrompt('Please digit a valid TMDB ID (0=skip)-> 603\n', 0), null);
});

test('any other question only after a silence', () => {
  const log = 'Working\nOverwrite the file? ';
  assert.equal(detectPrompt(log, 1000), null);
  assert.deepEqual(detectPrompt(log, IDLE_PROMPT_MS), { kind: 'text', text: 'Overwrite the file?' });
  assert.equal(detectPrompt('Uploading screenshots', IDLE_PROMPT_MS), null);
});

test('exit code from the wrapper line', () => {
  const log = `done\n${EXIT_MARKER} 0\n`;
  assert.equal(exitCode(log), 0);
  assert.equal(exitCode('running'), null);
  assert.equal(withoutMarker(log), 'done\n');
});

test('outcome from the tracker answer, not the exit code', () => {
  assert.deepEqual(parseOutcome("[RESPONSE]-> 'ITT'.....TORRENT UPLOADED SUCCESSFULLY.\n", 0, false), {
    status: 'DONE',
    message: 'ITT: TORRENT UPLOADED SUCCESSFULLY.',
  });
  assert.deepEqual(parseOutcome("\n[RESPONSE]-> 'Itt - The name has already been taken. : \n", 0, false), {
    status: 'FAILED',
    message: 'Itt - The name has already been taken. :',
  });
  assert.equal(parseOutcome('Itt HTTP 403 Upload right disabled\n', 0, false).status, 'FAILED');
  assert.deepEqual(parseOutcome('bash: unit3dup: command not found\n', 127, false), {
    status: 'FAILED',
    message: 'bash: unit3dup: command not found',
  });
  assert.equal(parseOutcome('', 2, false).status, 'FAILED');
  assert.equal(parseOutcome('Press (C) to continue, (S) to SKIP.. (Q) Quit - s\n', 0, true).status, 'SKIPPED');
  assert.equal(parseOutcome('Nothing happened\n', 0, false).status, 'UNKNOWN');
});

test('the command gets the path quoted for the shell', () => {
  assert.equal(shellQuote("it's"), `'it'\\''s'`);
  const file = "/home/u/downloads/qbittorrent/L'Uomo.1972/L'Uomo.1972.mkv";
  assert.equal(trackerCommandFor('unit3dup -u {path}', file), `unit3dup -u '/home/u/downloads/qbittorrent/L'\\''Uomo.1972/L'\\''Uomo.1972.mkv'`);
  assert.equal(trackerCommandFor('unit3dup -u {folder}', file), `unit3dup -u '/home/u/downloads/qbittorrent/L'\\''Uomo.1972'`);
  assert.equal(trackerCommandFor('unit3dup -u', '/a b.mkv'), `unit3dup -u '/a b.mkv'`);
});
