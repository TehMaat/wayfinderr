'use strict';

// HTTPS in front of `next start`, in the same container: every request and WebSocket
// that arrives on HTTPS goes to Next.js on localhost as plain HTTP, and Next.js goes
// on proxying /api, /health and /ws to the backend as it always does.
//
// Here the frontend is the first hop, so the client could send its own X-Forwarded-*
// headers: they are dropped and set again from the connection. The backend trusts
// one proxy and reads X-Forwarded-For (the login limiter), X-Forwarded-Proto (the
// Secure cookie) and X-Forwarded-Host (the cross-site check).

const http = require('node:http');

// Headers about one connection only (RFC 9110, 7.6.1), never forwarded as they are
const HOP_BY_HOP = [
  'connection',
  'keep-alive',
  'proxy-connection',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
];

// Headers a client could send to pass for another address, protocol or host
const CLIENT_FORWARDED = /^(?:x-forwarded-.+|forwarded|x-real-ip)$/;

/** The client address as the backend should see it (no IPv4-mapped IPv6 prefix) */
function clientAddress(socket) {
  const address = socket.remoteAddress || '';
  return address.startsWith('::ffff:') && address.includes('.') ? address.slice(7) : address;
}

/** The headers without the hop-by-hop ones (and those the Connection header names) */
function withoutHopByHop(headers) {
  const named = String(headers.connection || '')
    .toLowerCase()
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const out = { ...headers };
  for (const name of [...HOP_BY_HOP, ...named]) delete out[name];
  return out;
}

/**
 * The headers of a request forwarded to Next.js: the client's own X-Forwarded-*,
 * Forwarded and X-Real-IP dropped, X-Forwarded-For/Proto/Host set from the connection.
 */
function forwardedHeaders(headers, socket) {
  const out = {};
  for (const [name, value] of Object.entries(headers)) {
    if (!CLIENT_FORWARDED.test(name)) out[name] = value;
  }
  out['x-forwarded-for'] = clientAddress(socket);
  out['x-forwarded-proto'] = 'https';
  if (headers.host) out['x-forwarded-host'] = headers.host;
  return out;
}

/** Raw header lines (name: value) for a response written on a socket */
function headerLines(rawHeaders, skip = []) {
  let lines = '';
  for (let i = 0; i < rawHeaders.length; i += 2) {
    if (!skip.includes(rawHeaders[i].toLowerCase())) lines += `${rawHeaders[i]}: ${rawHeaders[i + 1]}\r\n`;
  }
  return lines;
}

/**
 * Request handler that forwards to Next.js at target ({ host, port }). No timeout of
 * its own: Next.js and the backend have theirs (a server test can take minutes).
 */
function createRequestProxy(target) {
  const agent = new http.Agent({ keepAlive: true });
  const handler = (req, res) => {
    const upstream = http.request(
      {
        host: target.host,
        port: target.port,
        method: req.method,
        path: req.url,
        headers: withoutHopByHop(forwardedHeaders(req.headers, req.socket)),
        agent,
      },
      (upstreamRes) => {
        res.writeHead(upstreamRes.statusCode, upstreamRes.statusMessage, withoutHopByHop(upstreamRes.headers));
        upstreamRes.pipe(res);
        upstreamRes.on('error', () => res.destroy());
      },
    );
    upstream.on('error', () => {
      if (!res.headersSent) {
        res.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' });
        res.end('Bad gateway: the frontend is not answering\n');
      } else {
        res.destroy();
      }
    });
    // The client went away before the end: stop the request upstream too
    res.on('close', () => {
      if (!res.writableFinished) upstream.destroy();
    });
    req.pipe(upstream);
  };
  handler.close = () => agent.destroy();
  return handler;
}

/** Upgrade handler (the /ws WebSocket) that forwards to Next.js at target */
function createUpgradeProxy(target) {
  return (req, socket, head) => {
    const headers = withoutHopByHop(forwardedHeaders(req.headers, socket));
    headers.connection = 'Upgrade';
    headers.upgrade = req.headers.upgrade;
    const upstream = http.request({ host: target.host, port: target.port, method: req.method, path: req.url, headers });

    upstream.on('upgrade', (upstreamRes, upstreamSocket, upstreamHead) => {
      socket.write(`HTTP/1.1 101 ${upstreamRes.statusMessage || 'Switching Protocols'}\r\n${headerLines(upstreamRes.rawHeaders)}\r\n`);
      if (upstreamHead && upstreamHead.length) socket.write(upstreamHead);
      if (head && head.length) upstreamSocket.write(head);
      const closeBoth = () => {
        socket.destroy();
        upstreamSocket.destroy();
      };
      socket.on('error', closeBoth);
      upstreamSocket.on('error', closeBoth);
      socket.on('close', () => upstreamSocket.destroy());
      upstreamSocket.on('close', () => socket.destroy());
      upstreamSocket.pipe(socket).pipe(upstreamSocket);
    });
    // Upgrade refused (e.g. 401 without a session): pass the answer on, then close
    upstream.on('response', (upstreamRes) => {
      const skip = ['connection', 'transfer-encoding', 'keep-alive'];
      socket.write(
        `HTTP/1.1 ${upstreamRes.statusCode} ${upstreamRes.statusMessage}\r\n${headerLines(upstreamRes.rawHeaders, skip)}connection: close\r\n\r\n`,
      );
      upstreamRes.pipe(socket);
    });
    upstream.on('error', () => socket.destroy());
    socket.on('error', () => upstream.destroy());
    upstream.end();
  };
}

module.exports = { clientAddress, withoutHopByHop, forwardedHeaders, createRequestProxy, createUpgradeProxy };
