// The browser only talks to this server: the API and the WebSocket are proxied
// to the backend. BACKEND_URL is read at build time (next build compiles the
// rewrites into .next/routes-manifest.json): the Docker image uses the compose
// service name, a local `npm run dev` the backend on localhost.
const backendUrl = process.env.BACKEND_URL || 'http://localhost:3001';

// Version shown in the sidebar, compiled in by next build. The Docker image is
// built without .git, so CI passes the release tag and the commit as build args;
// a local build falls back to package.json and git
const { execSync } = require('child_process');
const appVersion = (process.env.APP_VERSION || require('./package.json').version).replace(/^v/, '');
const appCommit = (() => {
  if (process.env.GIT_COMMIT) return process.env.GIT_COMMIT.slice(0, 7);
  try {
    return execSync('git rev-parse --short=7 HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  } catch {
    return '';
  }
})();

// No framing by other sites (clickjacking), no MIME sniffing, no referrer to other sites
const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'same-origin' },
  { key: 'Content-Security-Policy', value: "frame-ancestors 'none'; object-src 'none'; base-uri 'self'; form-action 'self'" },
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  env: {
    NEXT_PUBLIC_APP_VERSION: appVersion,
    NEXT_PUBLIC_APP_COMMIT: appCommit,
  },
  experimental: {
    // Testing a server (SSH + API) can take longer than the 30s default
    proxyTimeout: 120_000,
  },
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
  async rewrites() {
    return [
      { source: '/api/:path*', destination: `${backendUrl}/api/:path*` },
      { source: '/health', destination: `${backendUrl}/health` },
      { source: '/ws', destination: `${backendUrl}/ws` },
    ];
  },
};

module.exports = nextConfig;
