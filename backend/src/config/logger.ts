import pino from 'pino';
import pretty from 'pino-pretty';
import { config } from './index.js';
import { pinoFileStream } from '../services/logs/store.js';

// Never in a log, on stdout or in the files: passwords and keys, and the headers and
// body of a failed HTTP request (an axios error carries the qBittorrent cookie)
const REDACT = [
  'password',
  '*.password',
  'passphrase',
  '*.passphrase',
  'privateKey',
  '*.privateKey',
  'apiKey',
  '*.apiKey',
  'token',
  '*.token',
  '*.config.headers',
  '*.config.auth',
  '*.config.data',
  '*.request',
  '*.response.config',
  '*.response.request',
  'headers.cookie',
  'headers.authorization',
];

/**
 * The backend's log: stdout, as always (`docker logs`), and the day files of the
 * log history (services/logs), read by the Logs page. Everything on stdout also
 * goes to the file, except the setup code.
 */
export const logFile = pinoFileStream(config.LOGS.DIR);

export const logger = pino(
  {
    level: config.LOG_LEVEL,
    redact: { paths: REDACT, censor: '[redacted]' },
  },
  pino.multistream([
    {
      level: config.LOG_LEVEL as pino.Level,
      stream:
        config.NODE_ENV === 'development'
          ? pretty({ colorize: true, translateTime: 'SYS:standard', ignore: 'pid,hostname' })
          : process.stdout,
    },
    { level: config.LOG_LEVEL as pino.Level, stream: logFile },
  ])
);

export default logger;
