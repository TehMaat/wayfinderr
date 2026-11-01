import { config } from '../../config/index.js';
import { DyadrrJobs } from './jobs.js';

/**
 * Merging the Italian audio of one rip into the better video of another (Dyadrr),
 * off by default (MERGE_ENABLED). Dyadrr runs in its own container, the `dyadrr`
 * service of docker-compose.yml (profile `merge`): Wayfinderr hands it jobs
 * through the watch folder (see jobs.ts).
 */
export const dyadrr = new DyadrrJobs(config.MERGE.JOBS_DIR, config.MERGE.FOLDERS);

// Dyadrr only works with Italian: the merge needs the kept language to be Italian
const languageSupported = () => config.RIP.LANGUAGE.toLowerCase() === 'it';

export const mergeStatus = async () => {
  const enabled = config.MERGE.ENABLED;
  const lastSeen = enabled ? await dyadrr.lastSeen() : null;
  return {
    enabled,
    languageSupported: languageSupported(),
    language: config.RIP.LANGUAGE,
    // The Dyadrr container: seconds since its runner last checked in (null: never)
    runnerAlive: enabled ? await dyadrr.alive() : false,
    runnerLastSeen: lastSeen,
  };
};
