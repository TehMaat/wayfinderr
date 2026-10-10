/**
 * The tracker command's output (Unit3Dup, https://github.com/31December99/Unit3Dup):
 * cleaned for display, read for the questions it asks and for its outcome.
 * Its questions are plain input() lines printed without a newline, so the
 * last, unfinished line of the output is the question it waits on.
 */

export type PromptKind = 'tmdb' | 'duplicate' | 'trailer' | 'text';

export interface Prompt {
  kind: PromptKind;
  text: string;
}

export type Outcome = { status: 'DONE' | 'FAILED' | 'UNKNOWN' | 'SKIPPED'; message: string };

// Printed by the wrapper script once the command ends, with its exit code
export const EXIT_MARKER = '__WAYFINDERR_EXIT__';

// Only the end of the output is kept (and sent to the browser)
export const MAX_LOG_CHARS = 64 * 1024;

// Without an answer for this long, an unfinished line ending like a question is one
export const IDLE_PROMPT_MS = 15_000;

const KNOWN_PROMPTS: [RegExp, PromptKind][] = [
  [/Please digit a valid TMDB ID/i, 'tmdb'],
  [/Press \(C\) to continue, \(S\) to SKIP/i, 'duplicate'],
  [/Please digit a valid Youtube ID/i, 'trailer'],
];

const ANSI = /\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(\x07|\x1b\\)|\x1b[@-Z\\-_]/g;

/**
 * Appends output to the log: escape codes dropped, a carriage return (progress
 * bars) rewrites its line, only the last MAX_LOG_CHARS are kept.
 */
export const appendOutput = (log: string, chunk: string): string => {
  const text = chunk.replace(ANSI, '').replace(/\r\n/g, '\n');
  let out = log;
  for (const piece of text.split(/(\r|\n)/)) {
    if (piece === '\n') out += '\n';
    else if (piece === '\r') out = out.slice(0, out.lastIndexOf('\n') + 1);
    else if (piece) out += piece.replace(/[\x00-\x08\x0b-\x1f\x7f]/g, '');
  }
  return out.length > MAX_LOG_CHARS ? out.slice(out.length - MAX_LOG_CHARS) : out;
};

/** The unfinished last line (what is printed before input() waits) */
const pendingLine = (log: string) => log.slice(log.lastIndexOf('\n') + 1);

/**
 * The question the command waits on: a known Unit3Dup one as soon as it is
 * printed, any other unfinished line ending like a question after idleMs of silence.
 */
export const detectPrompt = (log: string, idleMs: number): Prompt | null => {
  const line = pendingLine(log).trim();
  if (!line) return null;
  for (const [pattern, kind] of KNOWN_PROMPTS) {
    if (pattern.test(line)) return { kind, text: line };
  }
  if (idleMs >= IDLE_PROMPT_MS && /[?:>\-)\]]$/.test(line)) return { kind: 'text', text: line };
  return null;
};

/** The exit code written by the wrapper, once the command has ended */
export const exitCode = (log: string): number | null => {
  const match = new RegExp(`${EXIT_MARKER} (\\d+)`).exec(log);
  return match ? Number(match[1]) : null;
};

/** The log without the wrapper's exit line */
export const withoutMarker = (log: string) => log.replace(new RegExp(`\\n?${EXIT_MARKER} \\d+\\n?`), '\n');

// Unit3Dup prints the tracker's answer as "[RESPONSE]-> 'ITT'.....TORRENT UPLOADED"
const SUCCESS = /\[RESPONSE\]->\s*'([^'\n]+)'\.{2,}\s*([^\n]*)/g;
const ERRORS = [
  /\[RESPONSE\]->\s*'(?![^'\n]+'\.{2,})([^\n]*)/,
  /HTTP [45]\d{2}[^\n]*/,
  /Path not found[^\n]*/,
  /Permission denied[^\n]*/,
  /There are no (?:Media|Files) to process[^\n]*/,
  /Traceback \(most recent call last\)/,
  /[^\n]*command not found[^\n]*/,
  /[^\n]*No such file or directory[^\n]*/,
];

/**
 * DONE when a tracker accepted the upload (an error elsewhere is only noted);
 * FAILED on an error or a failed exit; SKIPPED when the duplicate question was
 * answered with S; UNKNOWN when it ended without any of these.
 * Unit3Dup exits with 0 after a tracker error too, so its output decides.
 */
export const parseOutcome = (log: string, code: number, skipped: boolean): Outcome => {
  const accepted = [...log.matchAll(SUCCESS)].map((m) => `${m[1]}: ${m[2].trim() || 'uploaded'}`);
  const match = ERRORS.map((p) => p.exec(log)).find(Boolean);
  const error = match ? (match[1] ?? match[0]).trim() : null;

  if (accepted.length) {
    return { status: 'DONE', message: accepted.join(' · ') + (error ? ` (also printed: ${error})` : '') };
  }
  if (error) return { status: 'FAILED', message: error };
  if (code !== 0) {
    return { status: 'FAILED', message: code === 127 ? 'Command not found on the server' : `Exited with code ${code}` };
  }
  if (skipped) return { status: 'SKIPPED', message: 'Skipped: already on the tracker' };
  return { status: 'UNKNOWN', message: 'Ended without an answer from the tracker' };
};
