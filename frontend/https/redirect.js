'use strict';

// Plain HTTP (port 80) with HTTPS on: every request goes to the same path on
// https://<HTTPS_DOMAIN>. The domain comes from the settings, never from the Host header,
// so a request cannot redirect anywhere else.

/** Where a request for url goes: the same path and query on https://domain */
function redirectLocation(domain, url) {
  const pathAndQuery = typeof url === 'string' && url.startsWith('/') ? url : '/';
  return `https://${domain}${pathAndQuery}`;
}

const CHALLENGE_PATH = '/.well-known/acme-challenge/';

/**
 * Request handler of the HTTP port: 301 for GET and HEAD, 308 (same method) otherwise.
 * With challenges (Let's Encrypt, token → key authorization), their path is answered
 * here instead: 200 with the key authorization of a token in progress, else 404.
 */
function createRedirectHandler(domain, challenges = null) {
  return (req, res) => {
    if (challenges && typeof req.url === 'string' && req.url.startsWith(CHALLENGE_PATH)) {
      const token = req.url.slice(CHALLENGE_PATH.length).split('?')[0];
      const keyAuthorization = challenges.get(token);
      res.writeHead(keyAuthorization ? 200 : 404, { 'content-type': 'text/plain; charset=utf-8', connection: 'close' });
      res.end(keyAuthorization || 'Unknown challenge\n');
      return;
    }
    const location = redirectLocation(domain, req.url);
    const status = req.method === 'GET' || req.method === 'HEAD' ? 301 : 308;
    res.writeHead(status, { location, 'content-type': 'text/plain; charset=utf-8', connection: 'close' });
    res.end(req.method === 'HEAD' ? undefined : `Moved to ${location}\n`);
  };
}

module.exports = { redirectLocation, createRedirectHandler };
