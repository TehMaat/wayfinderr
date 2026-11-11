import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'events';
import type { Client as SSHClient } from 'ssh2';
import {
  AUTO_RESTART_COOLDOWN_MS,
  autoRestartDue,
  cleanOutput,
  isTokenError,
  restartChoice,
  runRestartScript,
} from './ultraApi.js';

// What the script prints in a terminal, colors included
const MENU = [
  '\x1b[1;32m[[ Welcome to the unofficial Ultra-API script ]]\x1b[0m\r',
  '\r',
  "\x1b[33m[WARNING]\x1b[0m Disclaimer: This is an unofficial script and is not supported by Ultra.cc staff.\r",
  '\r',
  '[LIST] Operations available for Ultra-API:\r',
  '1) Install\r',
  '2) Uninstall\r',
  '3) Restart\r',
  '4) Get API Token\r',
  '\r',
  "\x1b[36m[INPUT REQUIRED]\x1b[0m Enter your operation choice '[1-4]': ",
].join('\n');

test('cleans colors and carriage returns', () => {
  const text = cleanOutput(MENU);
  assert.doesNotMatch(text, /\x1b|\r/);
  assert.match(text, /^\[INPUT REQUIRED\] Enter your operation choice/m);
});

test('picks the Restart entry once the menu asks for a choice', () => {
  assert.equal(restartChoice(cleanOutput(MENU)), '3');
  // Menu still arriving: no answer yet
  assert.equal(restartChoice(cleanOutput(MENU.slice(0, MENU.indexOf('[INPUT')))), undefined);
});

test('follows a renumbered menu and refuses one without Restart', () => {
  const renumbered = cleanOutput(MENU).replace('3) Restart', '5) Restart');
  assert.equal(restartChoice(renumbered), '5');
  const without = cleanOutput(MENU).replace('3) Restart', '3) Reinstall');
  assert.equal(restartChoice(without), null);
});

test('a wrong token is not a reason to restart', () => {
  assert.equal(isTokenError(401), true);
  assert.equal(isTokenError(403), true);
  assert.equal(isTokenError(502), false);
  assert.equal(isTokenError(undefined), false);
});

test('one automatic restart per cooldown', () => {
  const now = Date.now();
  assert.equal(autoRestartDue(null, now), true);
  assert.equal(autoRestartDue(new Date(now - 60_000), now), false);
  assert.equal(autoRestartDue(new Date(now - AUTO_RESTART_COOLDOWN_MS), now), true);
});

// An SSH exec channel driven by the test: `play` gets the stream and what is typed into it
class FakeStream extends EventEmitter {
  typed: string[] = [];
  closed = false;
  onTyped: (text: string) => void = () => undefined;
  write(text: string) {
    this.typed.push(text);
    this.onTyped(text);
  }
  close() {
    if (this.closed) return;
    this.closed = true;
    this.emit('close', 0);
  }
}
const fakeSsh = (play: (stream: FakeStream) => void) => {
  const stream = new FakeStream();
  const ssh = {
    exec: (_command: string, options: { pty?: unknown }, cb: (err: Error | undefined, s: FakeStream) => void) => {
      assert.ok(options.pty, 'runs in a pseudo-terminal');
      cb(undefined, stream);
      play(stream);
    },
  } as unknown as SSHClient;
  return { ssh, stream };
};
const say = (stream: FakeStream, text: string) => stream.emit('data', Buffer.from(text));

test('answers Restart after the prompt, even when it arrives in pieces', async () => {
  const { ssh, stream } = fakeSsh((s) => {
    s.onTyped = () => {
      say(s, '3\r\n[INFO] Restarting Ultra-API...\r\n[SUCCESS] Ultra-API restarted.\r\n');
      s.close();
    };
    const half = MENU.indexOf('3) Restart');
    say(s, MENU.slice(0, half));
    say(s, MENU.slice(half));
  });
  const { output } = await runRestartScript(ssh, 1000);
  assert.deepEqual(stream.typed, ['3\n']);
  assert.match(output, /Ultra-API restarted\.$/);
});

test('leaves without choosing again when the menu comes back', async () => {
  const { ssh, stream } = fakeSsh((s) => {
    s.onTyped = () => say(s, '3\r\nDone\r\n' + MENU);
    say(s, MENU);
  });
  await runRestartScript(ssh, 1000);
  assert.deepEqual(stream.typed, ['3\n']);
  assert.equal(stream.closed, true);
});

test('fails without typing anything when the menu never shows up', async () => {
  const { ssh, stream } = fakeSsh((s) => {
    say(s, 'bash: wget: command not found\r\n');
    s.close();
  });
  await assert.rejects(runRestartScript(ssh, 1000), /ended without showing its menu/);
  assert.deepEqual(stream.typed, []);

  const stuck = fakeSsh((s) => say(s, MENU.replace('3) Restart', '3) Reinstall')));
  await assert.rejects(runRestartScript(stuck.ssh, 1000), /no "Restart" entry/);
  assert.deepEqual(stuck.stream.typed, []);
});

test('gives up when the script hangs', async () => {
  const { ssh } = fakeSsh((s) => say(s, MENU));
  await assert.rejects(runRestartScript(ssh, 50), /did not finish in time/);
});
