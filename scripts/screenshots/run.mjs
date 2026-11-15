#!/usr/bin/env node
/**
 * Takes the screenshots of the documentation (docs/assets/screenshots) from the real
 * app, filled with made-up data:
 *
 *   1. a throwaway database in a temporary folder, migrated and seeded (seed.ts);
 *   2. the backend (tsx) and a production build of the frontend, on free ports;
 *   3. Chromium (Playwright) signs in and photographs every page.
 *
 * What only a live setup has (the space of the servers, the disks of this machine,
 * an upload or a rip running, the MakeMKV and Dyadrr runners online) is filled in
 * by the browser from fixtures (fixtures.mjs): the demo servers do not exist.
 *
 * Usage (backend and frontend dependencies installed, Playwright with Chromium):
 *   node scripts/screenshots/run.mjs            # every screenshot
 *   node scripts/screenshots/run.mjs dashboard  # only the ones whose name contains it
 *
 * Run it after every change to the UI and commit the PNGs it rewrites (see CONTRIBUTING.md).
 */
import { spawn, execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { fileURLToPath } from 'node:url';
import { configure, fixedResponse, liveMessages, patchResponse } from './fixtures.mjs';
import { shots } from './shots.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const backendDir = path.join(root, 'backend');
const frontendDir = path.join(root, 'frontend');
const outDir = path.join(root, 'docs/assets/screenshots');
const only = process.argv[2];

const require = createRequire(import.meta.url);
const { chromium } = (() => {
  try {
    return require('playwright');
  } catch {
    return createRequire(path.join(frontendDir, 'package.json'))('playwright');
  }
})();

const freePort = () =>
  new Promise((resolve) => {
    const server = net.createServer();
    server.listen(0, () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });

const waitFor = async (url, what, timeoutMs = 180_000) => {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    try {
      const res = await fetch(url);
      if (res.status < 500) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`${what} did not start: ${url}`);
};

const children = [];
const start = (cmd, args, opts, name) => {
  // Its own process group: npx, tsx and next start children of their own, stopped together
  const child = spawn(cmd, args, { ...opts, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  const log = fs.createWriteStream(path.join(opts.logDir, `${name}.log`));
  child.stdout.pipe(log);
  child.stderr.pipe(log);
  children.push(child);
  return child;
};
const stopAll = () => {
  for (const child of children.splice(0)) {
    try {
      process.kill(-child.pid, 'SIGTERM');
    } catch {
      // already gone
    }
  }
};
process.on('exit', stopAll);
process.on('SIGINT', () => process.exit(130));

const main = async () => {
  const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'wayfinderr-screenshots-')));
  for (const dir of ['data', 'watch', 'downloads']) fs.mkdirSync(path.join(tmp, dir));
  configure({ tmp });
  console.log(`Work folder: ${tmp} (logs there)`);

  const backendPort = await freePort();
  const frontendPort = await freePort();
  const setupCode = 'demo-setup-code';
  const env = {
    ...process.env,
    NODE_ENV: 'production',
    PORT: String(backendPort),
    LOG_LEVEL: 'warn',
    DATABASE_URL: `file:${path.join(tmp, 'data/demo.db')}`,
    WATCH_DIR: path.join(tmp, 'watch'),
    RIP_SOURCE_DIR: path.join(tmp, 'downloads'),
    RIP_ENABLED: 'true',
    MERGE_ENABLED: 'true',
    TMDB_API_KEY: '',
    TMDB_API_URL: 'http://127.0.0.1:9/3',
    WAYFINDERR_SETUP_CODE: setupCode,
  };

  console.log('Database: migrate and seed');
  execFileSync('npx', ['prisma', 'migrate', 'deploy'], { cwd: backendDir, env, stdio: 'ignore' });
  execFileSync('npx', ['tsx', '../scripts/screenshots/seed.ts'], { cwd: backendDir, env, stdio: 'inherit' });

  console.log('Backend: start');
  start('npx', ['tsx', 'src/index.ts'], { cwd: backendDir, env, logDir: tmp }, 'backend');
  await waitFor(`http://127.0.0.1:${backendPort}/health`, 'The backend');

  // Its own build folder: a build pointing at the demo backend never replaces the usual .next
  const distDir = '.next-screenshots';
  const frontendEnv = { ...env, PORT: String(frontendPort), BACKEND_URL: `http://127.0.0.1:${backendPort}`, NEXT_DIST_DIR: distDir };
  console.log('Frontend: build (a minute or two)');
  execFileSync('npx', ['next', 'build'], { cwd: frontendDir, env: frontendEnv, stdio: 'ignore' });
  start('npx', ['next', 'start', '-p', String(frontendPort)], { cwd: frontendDir, env: frontendEnv, logDir: tmp }, 'frontend');
  const base = `http://127.0.0.1:${frontendPort}`;
  await waitFor(`${base}/health`, 'The frontend');

  // The account, then a session for the browser
  const setup = await fetch(`${base}/api/auth/setup`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: base },
    body: JSON.stringify({ setupCode, username: 'demo', password: 'demo-password' }),
  });
  if (!setup.ok) throw new Error(`Account setup failed: ${setup.status} ${await setup.text()}`);
  const cookie = setup.headers.get('set-cookie')?.split(';')[0];
  if (!cookie) throw new Error('No session cookie after the setup');
  const [cookieName, cookieValue] = cookie.split('=');

  // The API as the demo account, for the shots that need an id
  const api = async (apiPath) => {
    const res = await fetch(`${base}${apiPath}`, { headers: { cookie } });
    if (!res.ok) throw new Error(`${apiPath}: ${res.status}`);
    return res.json();
  };

  const live = await liveMessages(api);

  fs.mkdirSync(outDir, { recursive: true });
  const browser = await chromium.launch();
  try {
    for (const shot of shots) {
      if (only && !shot.name.includes(only)) continue;
      const context = await browser.newContext({
        viewport: shot.viewport ?? { width: 1440, height: 900 },
        deviceScaleFactor: 1,
        colorScheme: shot.theme ?? 'dark',
        reducedMotion: 'reduce',
      });
      await context.addCookies([{ name: cookieName, value: cookieValue, url: base }]);
      await context.addInitScript(
        ({ theme, accent }) => {
          localStorage.setItem('theme', theme);
          localStorage.setItem('accent', accent);
        },
        { theme: shot.theme ?? 'dark', accent: shot.accent ?? 'violet' }
      );
      // Live data the demo cannot have: fixed answers, or the real answer adjusted
      await context.route('**/api/**', async (route) => {
        const url = new URL(route.request().url());
        const fixed = fixedResponse(url, route.request().method());
        if (fixed !== undefined) return route.fulfill({ json: fixed });
        const response = await route.fetch();
        const type = response.headers()['content-type'] ?? '';
        if (!type.includes('application/json')) return route.fulfill({ response });
        const json = patchResponse(url, await response.json());
        return route.fulfill({ response, json });
      });
      // No backend behind the WebSocket: only the progress of the running upload
      await context.routeWebSocket('**/ws', (ws) => {
        for (const { after, data } of live) setTimeout(() => ws.send(data), after);
      });

      if (shot.signedOut) await context.clearCookies();
      const page = await context.newPage();
      const target = typeof shot.path === 'function' ? await shot.path(api) : shot.path;
      await page.goto(`${base}${target}`, { waitUntil: 'networkidle' });
      await page.waitForTimeout(1500);
      if (shot.prepare) await shot.prepare(page);
      await page.mouse.move(0, 0);
      await page.screenshot({ path: path.join(outDir, `${shot.name}.png`), fullPage: shot.fullPage ?? false, animations: 'disabled' });
      console.log(`  ${shot.name}.png`);
      await context.close();
    }
  } finally {
    await browser.close();
  }
  stopAll();
  fs.rmSync(path.join(frontendDir, distDir), { recursive: true, force: true });
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(`Screenshots in ${path.relative(root, outDir)}`);
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
  stopAll();
});
