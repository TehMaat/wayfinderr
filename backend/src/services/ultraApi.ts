import { Client as SSHClient } from 'ssh2';

/**
 * Restarting the Ultra-API (the service behind the storage endpoint) on an Ultra.cc server.
 *
 * Ultra's unofficial Ultra-API script is interactive: it prints a menu
 * (1) Install, 2) Uninstall, 3) Restart, 4) Get API Token) and asks
 * "Enter your operation choice '[1-4]'". It runs in a pseudo-terminal, as in an SSH
 * login, and the number of the "Restart" entry is read from the menu itself, so a
 * renumbered menu does not run the wrong operation.
 */
export const RESTART_SCRIPT_URL = 'https://scripts.ultra.cc/util-v2/Ultra-API/main.sh';
export const RESTART_COMMAND = `bash -c 'bash <(wget -qO- ${RESTART_SCRIPT_URL})'`;

// One automatic restart per server in this window, worked or not
export const AUTO_RESTART_COOLDOWN_MS = 15 * 60_000;
const SCRIPT_TIMEOUT_MS = 3 * 60_000;
const MAX_OUTPUT = 64 * 1024;

const PROMPT = /Enter your operation choice/i;
const RESTART_ENTRY = /^\s*(\d+)\)\s*Restart\b/im;

export class UltraApiError extends Error {
  constructor(message: string, readonly output = '') {
    super(message);
  }
}

/** Terminal output as text: without colors and cursor codes, with plain line ends */
export const cleanOutput = (raw: string): string =>
  raw
    // eslint-disable-next-line no-control-regex
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]|\x1b[()][0-9A-Za-z]|\x1b[=>]/g, '')
    .replace(/\r\n?/g, '\n');

/** The number of the "Restart" entry once the menu asks for a choice, null before that */
export const restartChoice = (output: string): string | null | undefined => {
  if (!PROMPT.test(output)) return undefined;
  return RESTART_ENTRY.exec(output)?.[1] ?? null;
};

/** 401/403: the token is wrong, a restart does not help */
export const isTokenError = (status: number | undefined) => status === 401 || status === 403;

/** True when an automatic restart may run: none in the last AUTO_RESTART_COOLDOWN_MS */
export const autoRestartDue = (lastRestartAt: Date | null | undefined, now = Date.now()) =>
  !lastRestartAt || now - lastRestartAt.getTime() >= AUTO_RESTART_COOLDOWN_MS;

export const tail = (text: string, max = 4000) => (text.length > max ? `…${text.slice(-max)}` : text);

/**
 * Runs the script on an open SSH connection and picks "Restart".
 * Resolves with the script output when it ends (or shows its menu again).
 */
export const runRestartScript = (ssh: SSHClient, timeoutMs = SCRIPT_TIMEOUT_MS): Promise<{ output: string }> =>
  new Promise((resolve, reject) => {
    ssh.exec(RESTART_COMMAND, { pty: { term: 'dumb', cols: 160, rows: 50 } }, (err, stream) => {
      if (err) return reject(err);

      let raw = '';
      // Where the output after the answer starts
      let answeredAt: number | null = null;
      let settled = false;
      const output = () => cleanOutput(raw).trim();
      const finish = (error: UltraApiError | null) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (error) reject(error);
        else resolve({ output: output() });
      };

      const timer = setTimeout(() => {
        finish(
          new UltraApiError(
            answeredAt === null
              ? 'The Ultra-API script did not show its menu in time'
              : 'The Ultra-API script did not finish in time',
            output()
          )
        );
        stream.close();
      }, timeoutMs);

      stream.on('data', (data: Buffer) => {
        raw += data.toString();
        if (raw.length > MAX_OUTPUT) {
          const cut = raw.length - MAX_OUTPUT;
          raw = raw.slice(cut);
          if (answeredAt !== null) answeredAt = Math.max(0, answeredAt - cut);
        }

        if (answeredAt === null) {
          const choice = restartChoice(cleanOutput(raw));
          if (choice === undefined) return;
          if (choice === null) {
            finish(new UltraApiError('The Ultra-API script menu has no "Restart" entry', output()));
            stream.close();
            return;
          }
          answeredAt = raw.length;
          stream.write(`${choice}\n`);
        } else if (PROMPT.test(cleanOutput(raw.slice(answeredAt)))) {
          // Back to the menu after the restart: leave without choosing again
          finish(null);
          stream.close();
        }
      });

      stream.on('close', () => {
        if (answeredAt === null) {
          finish(new UltraApiError('The Ultra-API script ended without showing its menu', output()));
        } else {
          finish(null);
        }
      });
    });
  });
