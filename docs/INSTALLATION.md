# Installation

Three ways to run Wayfinderr. Pick one, then [create the account](#create-the-account)
and [add the servers](#add-the-servers).

| Method | For | Builds anything? |
|---|---|---|
| [A. Docker Compose, prebuilt images](#a-docker-compose-prebuilt-images) | a Linux server or NAS, Docker Desktop | no: images from `ghcr.io` |
| [B. Docker Compose, built from source](#b-docker-compose-built-from-source) | changes of your own, an architecture without images | yes, locally |
| [C. Local run, no Docker](#c-local-run-no-docker) | the Windows PC where MakeMKV runs, development | `npm` only |

Every setting is listed in [Configuration](CONFIGURATION.md). To publish it on a domain with
HTTPS, see [Deployment](DEPLOYMENT.md#reverse-proxy-https).

## Requirements

- **Upload servers** reachable over SSH/SFTP: Ultra.cc slots, other seedboxes (Whatbox, Feral…) or
  any SSH server (VPS, NAS, a machine on the LAN). A password or an SSH key for each.
- **Docker** with Compose v2 (methods A and B), or **Node.js 20+** and **ffmpeg/ffprobe** on the
  `PATH` (method C).
- Optional: **MakeMKV** (a registration key, or the free `BETA` key) to rip discs, **qBittorrent**
  with its WebUI to clean up torrents, a **TMDB** API key to name the rips, **Dyadrr** to merge two
  rips of a film.

## A. Docker Compose, prebuilt images

The images are built by GitHub Actions for `linux/amd64` and `linux/arm64` (Raspberry Pi 4/5, ARM
NAS) and published on `ghcr.io` (see [Docker images](#docker-images)).

```bash
git clone https://github.com/TehMaat/wayfinderr.git
cd wayfinderr
cp .env.example .env
```

Edit `.env`: at least `MAKEMKV_OUTPUT_DIR`, the folder where the `.mkv` files land (the watch
folder). On Windows/macOS (Docker Desktop) or a network share also set `WATCH_USE_POLLING=true`:
file events do not reach the container from there.

```bash
docker compose pull
docker compose up -d
docker compose logs -f wayfinderr-backend
```

Open http://localhost:3000, or `http://<host-ip>:3000` from the LAN. The browser talks only to the
frontend, which proxies `/api`, `/health` and the `/ws` WebSocket to the backend over the compose
network; the backend publishes no port. Migrations run by themselves at every start.

The data (servers, history, login account, logs) lives in the `wayfinderr-data` volume and survives
updates. `./scripts/setup.sh`, `./scripts/start.sh` and `./scripts/stop.sh` wrap the same commands.

### Optional services

| Profile | Service | Start it with | What it does |
|---|---|---|---|
| `makemkv` | `makemkv` | `docker compose --profile makemkv up -d` | MakeMKV ([jlesage/makemkv](https://github.com/jlesage/docker-makemkv), web GUI on port 5800) plus the runner of the [automatic rips](USAGE.md#automatic-ripping) |
| `merge` | `dyadrr` | `docker compose --profile merge up -d` | [Dyadrr](https://github.com/TehMaat/dyadrr), for [merging](USAGE.md#merge-with-dyadrr) two rips of a film |

Or set `COMPOSE_PROFILES=makemkv,merge` in `.env`, and plain `docker compose up -d` starts them too.
To rip a physical disc with the MakeMKV container (Linux host with an optical drive), uncomment the
`devices` section of the `makemkv` service. Set its `USER_ID`/`GROUP_ID` to the owner of the watch
folder.

### Update

```bash
docker compose pull
docker compose up -d
```

(with `--profile …` on both commands for the optional services, unless `COMPOSE_PROFILES` is set).
To stay on a release, set `WAYFINDERR_TAG=0.32.1` in `.env` instead of `latest`.

## B. Docker Compose, built from source

Same as A, but the images are built on this machine:

```bash
docker compose -f docker-compose.yml -f docker-compose.build.yml up -d --build
```

To reach the backend at another address than `http://wayfinderr-backend:3001`, the frontend image
needs the `BACKEND_URL` build argument (it is compiled in):

```bash
docker build --build-arg BACKEND_URL=http://my-backend:3001 -t wayfinderr-frontend:local ./frontend
```

## C. Local run (no Docker)

The simplest on the Windows PC where MakeMKV runs. Requirements: [Node.js 20+](https://nodejs.org)
and ffmpeg/ffprobe on the `PATH`.

```bash
# 1. Backend
cd backend
cp .env.example .env        # then set WATCH_DIR to your MakeMKV output folder
npm install
npm run db:deploy           # creates the SQLite database
npm run dev                 # API on http://localhost:3001

# 2. Frontend (second terminal)
cd frontend
npm install
npm run dev                 # http://localhost:3000
```

Open http://localhost:3000. The frontend proxies `/api`, `/health` and `/ws` to the backend on
`http://localhost:3001`; for another address set `BACKEND_URL` in `frontend/.env` (see
`frontend/.env.example`).

For an always-on install use `npm run build && npm start` in both folders instead of
`npm run dev`. `BACKEND_URL` is compiled in by `npm run build`: rebuild after changing it. After an
update (`git pull`), run `npm install`, `npm run db:deploy` (backend) and the build again.

The optional tools are not bundled here: install `unrar` for RAR archives, MKVToolNix, 7-Zip and
ffmpeg 7+ to rip without MakeMKV, or point `UNRAR_PATH`, `MKVMERGE_PATH`, `SEVENZIP_PATH`,
`FFMPEG_PATH`, `FFPROBE_PATH` at them ([Configuration](CONFIGURATION.md#tools)).

## Create the account

Wayfinderr stays closed until its single account exists.

1. Open the app: the first visit shows the setup screen.
2. Copy the one-time **setup code** from the backend log:
   ```bash
   docker compose logs wayfinderr-backend | grep "setup code"
   ```
   (for a local run, the backend terminal). To choose it yourself, set `WAYFINDERR_SETUP_CODE`.
3. Choose a username and a password (at least 8 characters).

Anyone with the setup code can create the account: create it **before** exposing the app outside the
LAN. Forgotten password and the account menu: see the [User guide](USAGE.md#create-the-account).

## Add the servers

**Servers** → **Add server**, pick the type (Ultra.cc, other seedbox, plain SSH server), fill in the
SSH login and the remote folder, then **Test**. Every field is explained in the
[User guide](USAGE.md#servers). From then on every new `.mkv` in the watch folder is uploaded.

## Check that it works

```bash
curl http://localhost:3000/health
# {"status":"ok","queue":0}
```

Then copy a small `.mkv` with an Italian audio track into the watch folder: within a minute it shows
on the dashboard and uploads. Something wrong? See [Troubleshooting](TROUBLESHOOTING.md).

## Docker images

The [`Docker images`](../.github/workflows/docker-publish.yml) workflow builds them on every push to
`main` and on every `v*` tag:

| Image | Tags |
|---|---|
| `ghcr.io/tehmaat/wayfinderr-backend` | `latest`, `sha-<commit>`, `1.2.3` / `1.2` for git tags `v1.2.3` |
| `ghcr.io/tehmaat/wayfinderr-frontend` | same |
| `ghcr.io/tehmaat/wayfinderr-makemkv` | same (jlesage/makemkv + the rip runner) |

**Private packages.** New packages on GitHub are private. To pull a private image, log in once with
a [personal access token (classic)](https://github.com/settings/tokens/new?scopes=read:packages) with
the `read:packages` scope:

```bash
docker login ghcr.io -u <github-user>
```

To make an image public: GitHub → your profile → **Packages** → the image → **Package settings** →
**Change visibility** → Public. This cannot be undone.
