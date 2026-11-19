# Development

How to work on Wayfinderr: run it from source, test it, and keep the documentation and the
screenshots in step with the code. The rules for pull requests are in
[CONTRIBUTING.md](../CONTRIBUTING.md).

## Run from source

Node.js 20+ and ffmpeg/ffprobe on the `PATH`.

```bash
cd backend
cp .env.example .env        # WATCH_DIR: any folder to watch
npm install
npm run db:deploy
npm run dev                 # http://localhost:3001, restarts on changes

cd frontend                 # second terminal
npm install
npm run dev                 # http://localhost:3000
```

A change to `backend/prisma/schema.prisma` needs a migration: `npm run prisma:migrate` (from
`backend/`) creates it in `prisma/migrations`. Commit it with the change.

## Checks

```bash
cd backend
npm run typecheck
npm test                    # node:test, the *.test.ts files next to the services

cd frontend
npx tsc --noEmit
npm test                    # node:test, the built-in HTTPS (https/https.test.js)
npm run build
```

`npm start` runs `server.js`: `next start`, plus the [built-in HTTPS](DEPLOYMENT.md#built-in-https)
when `HTTPS_DOMAIN` is set. To try it locally without administrator rights, with a self-signed
certificate for a made-up name:

```bash
cd frontend
mkdir -p certs
openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:P-256 -nodes -days 30 \
  -subj /CN=wayfinderr.example.com -addext subjectAltName=DNS:wayfinderr.example.com \
  -keyout certs/privkey.pem -out certs/fullchain.pem
npm run build
HTTPS_DOMAIN=wayfinderr.example.com HTTPS_PORT=8443 HTTP_PORT=8080 npm start
curl --resolve wayfinderr.example.com:8443:127.0.0.1 --cacert certs/fullchain.pem \
  https://wayfinderr.example.com:8443/health
```

`frontend/certs` is ignored by git and by the Docker build.

The [`Docker images`](../.github/workflows/docker-publish.yml) workflow builds the three images on
every pull request to `main`.

## Documentation and screenshots

**Every change updates the documentation and the screenshots it touches, in the same pull
request.** A pull request that changes what the user sees or does is not done until:

- the pages in `docs/` (and the README) that describe it say what the code now does: a new or
  changed setting in [CONFIGURATION.md](CONFIGURATION.md), `.env.example` and the compose file; a
  new or changed endpoint in [API.md](API.md); a feature or behavior in [USAGE.md](USAGE.md);
  a new service or module in [ARCHITECTURE.md](ARCHITECTURE.md) (and its diagram); a fix worth
  knowing in [TROUBLESHOOTING.md](TROUBLESHOOTING.md);
- the screenshots are taken again when the UI changed (below), and a new page or dialog gets its
  own shot in `scripts/screenshots/shots.mjs` and its place in the docs;
- [CHANGELOG.md](CHANGELOG.md) has the change under the new version.

Names in the docs, the screenshots and the demo data are made up: never real films, torrents,
release groups or trackers (`example.invalid` hosts, invented titles).

### Screenshots

`docs/assets/screenshots/*.png` are taken from the real app, filled with made-up data:

```bash
node scripts/screenshots/run.mjs              # all of them
node scripts/screenshots/run.mjs rips         # only the ones whose name contains "rips"
```

It needs the backend and frontend dependencies installed and Playwright with Chromium
(`npm i -g playwright && npx playwright install chromium`, or the Chromium already on the machine).
It then:

1. creates a throwaway database in a temporary folder, migrates it and fills it with
   [`seed.ts`](../scripts/screenshots/seed.ts) (servers, uploads, rips, clients, merge pairs);
2. starts the backend and a production build of the frontend (in `frontend/.next-screenshots`,
   removed at the end) on free ports;
3. signs in with Chromium (1440×900, dark theme unless a shot says otherwise) and saves every page
   listed in [`shots.mjs`](../scripts/screenshots/shots.mjs).

What only a live setup has (server space, the disks of the machine, an upload or rip running, the
MakeMKV and Dyadrr runners online) comes from [`fixtures.mjs`](../scripts/screenshots/fixtures.mjs).
When the API changes shape, update the seed and the fixtures with it; look at every PNG before
committing it.

### Diagrams

`docs/assets/diagrams/*.svg` are drawn by hand (no ASCII art in the docs). Each one carries its
light and dark colors (`prefers-color-scheme`), so it reads on GitHub in both themes. Edit the SVG
when the flow or the architecture changes, and check it in a browser in both themes.

## Versioning

Every pull request to `main` raises the version in `backend/package.json` and
`frontend/package.json`: see [CONTRIBUTING.md](../CONTRIBUTING.md#versioning).

## Branches

The [`Branch cleanup`](../.github/workflows/branch-cleanup.yml) workflow deletes:

- the branch of a pull request as soon as it is merged (unless it got new commits after);
- every Monday: branches whose last commit was merged, branches whose pull request was closed
  without merging more than 14 days ago, and branches with no pull request and no commit for 90 days.

It never deletes the default branch, protected branches, branches with an open pull request, or
names matching `KEEP` (`main release/* keep/* gh-pages`). Run it by hand from **Actions** → **Branch
cleanup** → **Run workflow**: by default it only lists what it would delete (*dry run*). Every
deleted branch is in the run summary with its last commit; restore one with
`git push origin <sha>:refs/heads/<branch>`.
