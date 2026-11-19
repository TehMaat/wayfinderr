import { config } from '../../config/index.js';
import logger from '../../config/logger.js';
import { CertFetcher } from './fetcher.js';

// With Let's Encrypt (HTTPS_CERT_SOURCE=acme) the frontend writes the certificate itself:
// fetching another one into the same files would replace it
const fetchOverSsh = Boolean(config.HTTPS.SSH.HOST) && config.HTTPS.CERT_SOURCE !== 'acme';
if (config.HTTPS.SSH.HOST && !fetchOverSsh) {
  logger.error(
    { host: config.HTTPS.SSH.HOST },
    "HTTPS certificate: HTTPS_CERT_SSH_HOST is ignored with HTTPS_CERT_SOURCE=acme (Let's Encrypt writes the certificate): keep one of the two"
  );
}

/** The certificate of the built-in HTTPS, fetched over SSH: on only with HTTPS_CERT_SSH_HOST */
export const httpsCertFetcher = fetchOverSsh
  ? new CertFetcher({
      domain: config.HTTPS.DOMAIN,
      certDir: config.HTTPS.CERT_DIR,
      host: config.HTTPS.SSH.HOST,
      port: config.HTTPS.SSH.PORT,
      user: config.HTTPS.SSH.USER,
      hostKey: config.HTTPS.SSH.HOST_KEY,
      keyDir: config.HTTPS.SSH.KEY_DIR,
      log: {
        debug: (obj, msg) => logger.debug(obj, msg),
        info: (obj, msg) => logger.info(obj, msg),
        warn: (obj, msg) => logger.warn(obj, msg),
        error: (obj, msg) => logger.error(obj, msg),
      },
    })
  : null;
