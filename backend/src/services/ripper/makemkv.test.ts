import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  describeExit,
  languageCodes,
  parseDuration,
  parseInfo,
  parseProgress,
  parseRipResult,
  parseRobotLine,
  selectionRule,
} from './makemkv.js';

// Robot output in the documented format (TINFO:title,attr,code,"value"; SINFO:title,stream,attr,code,"value")
const INFO = `MSG:1005,0,1,"MakeMKV v2.0.0 linux(x64-release) started","%1 started","MakeMKV v2.0.0 linux(x64-release)"
DRV:0,256,999,0,"","",""
TCOUNT:2
CINFO:1,6209,"Blu-ray disc"
CINFO:2,0,"THE_MATRIX"
CINFO:32,0,"THE_MATRIX"
TINFO:0,2,0,"The Matrix"
TINFO:0,8,0,"39"
TINFO:0,9,0,"2:16:17"
TINFO:0,11,0,"32212254720"
TINFO:0,16,0,"00800.mpls"
TINFO:0,26,0,"1-5,7"
TINFO:0,27,0,"The_Matrix_t00.mkv"
SINFO:0,0,1,6201,"Video"
SINFO:0,0,6,0,"Mpeg4"
SINFO:0,1,1,6202,"Audio"
SINFO:0,1,3,0,"eng"
SINFO:0,1,4,0,"English"
SINFO:0,1,6,0,"TrueHD"
SINFO:0,1,14,0,"8"
SINFO:0,2,1,6202,"Audio"
SINFO:0,2,3,0,"ita"
SINFO:0,2,6,0,"DTS"
SINFO:0,2,22,0,"1"
SINFO:0,3,1,6203,"Subtitles"
SINFO:0,3,3,0,"ita"
SINFO:0,3,22,0,"4096"
TINFO:1,9,0,"0:48:02"
TINFO:1,11,0,"5368709120"
SINFO:1,0,1,6201,"Video"
MSG:5011,0,0,"Operation successfully completed","Operation successfully completed"
`;

test('parseRobotLine handles quotes, escapes and commas inside strings', () => {
  assert.deepEqual(parseRobotLine('MSG:5036,0,1,"Copy complete. 1 titles saved.","%1",\"a\\"b, c\"'), {
    key: 'MSG',
    fields: ['5036', '0', '1', 'Copy complete. 1 titles saved.', '%1', 'a"b, c'],
  });
});

test('parseDuration', () => {
  assert.equal(parseDuration('2:16:17'), 8177);
  assert.equal(parseDuration('0:48:02'), 2882);
});

test('parseInfo reads titles, streams and flags', () => {
  const info = parseInfo(INFO);
  assert.equal(info.name, 'THE_MATRIX');
  assert.equal(info.titles.length, 2);
  const [main] = info.titles;
  assert.equal(main.durationSec, 8177);
  assert.equal(main.sizeBytes, 32212254720);
  assert.equal(main.chapters, 39);
  assert.equal(main.segmentsMap, '1-5,7');
  assert.equal(main.outputFileName, 'The_Matrix_t00.mkv');
  assert.deepEqual(
    main.streams.map((s) => [s.type, s.lang, s.forced, s.commentary]),
    [
      ['video', undefined, false, false],
      ['audio', 'eng', false, false],
      ['audio', 'ita', false, true],
      ['subtitle', 'ita', true, false],
    ]
  );
  assert.deepEqual(info.errors, []);
});

test('parseInfo reports a disc that cannot be opened, even with exit code 0', () => {
  const info = parseInfo('MSG:5010,0,0,"Failed to open disc","Failed to open disc"\nTCOUNT:0\n');
  assert.equal(info.titles.length, 0);
  assert.deepEqual(info.errors, ['Failed to open disc']);
});

test('parseProgress uses the total progress of the last PRGV line', () => {
  assert.equal(parseProgress('PRGV:100,0,65536\nPRGV:500,16384,65536\n'), 25);
  assert.equal(parseProgress('PRGV:65536,65536,65536'), 100);
  assert.equal(parseProgress('MSG:1,0,0,"x","x"'), null);
});

test('parseRipResult needs 5036 without 5037', () => {
  assert.deepEqual(parseRipResult('MSG:5036,260,1,"Copy complete. 1 titles saved.","%1"\n', 0), { ok: true });
  assert.equal(parseRipResult('MSG:5037,516,2,"Copy complete. 0 titles saved, 1 failed.","%1"\n', 0).ok, false);
  assert.equal(parseRipResult('', 0).ok, false);
  assert.match(parseRipResult('', 143).error ?? '', /143/);
});

test('languageCodes maps ISO 639-1 to the codes MakeMKV reports', () => {
  assert.deepEqual(languageCodes('it'), ['ita']);
  assert.deepEqual(languageCodes('fr'), ['fre', 'fra']);
  assert.deepEqual(languageCodes('xx'), []);
  assert.deepEqual(languageCodes(null), []);
});

test('selectionRule keeps the given languages, the first one first', () => {
  const rule = selectionRule([['ita'], ['eng']]);
  assert.match(rule, /^-sel:all,/);
  assert.match(rule, /\+sel:\(ita\|eng\|nolang\|single\)/);
  assert.match(rule, /-10:ita$/);
});

test('selectionRule keeps every language when the original one is unknown', () => {
  const rule = selectionRule([['ita']], true);
  assert.equal(rule, '-sel:all,+sel:all,-sel:(havemulti|havecore),-sel:mvcvideo,=100:all,-10:ita');
});

test('describeExit names the signal that killed makemkvcon', () => {
  assert.equal(describeExit(139), 'makemkvcon crashed (segmentation fault, exit code 139)');
  assert.equal(describeExit(1), 'makemkvcon exited with code 1');
  assert.match(describeExit(143), /signal 15, exit code 143/);
  assert.equal(describeExit(253), 'makemkvcon exited with code 253');
});
