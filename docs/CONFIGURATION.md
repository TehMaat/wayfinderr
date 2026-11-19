# Configuration

Wayfinderr is configured with environment variables, and everything else (servers, download clients,
rip exclusions, merge choices) from the web UI.

Where they go:

- **Docker Compose**: in `.env` next to `docker-compose.yml` (copy `.env.example`). The compose file
  passes them to the containers; the ones marked *fixed in compose* are set there and should stay as
  they are, since they are paths inside the containers.
- **Local run**: the backend reads `backend/.env` (copy `backend/.env.example`), the frontend
  `frontend/.env` (copy `frontend/.env.example`).

Restart the backend after a change (`docker compose up -d` recreates the containers whose settings
changed). The frontend settings are compiled in by `npm run build`: rebuild it after a change; only
its [HTTPS settings](#frontend-https) are read at start.

## Docker Compose

| Variable | Default | Description |
|---|---|---|
| `MAKEMKV_OUTPUT_DIR` | `./makemkv-output` | Host folder with the `.mkv` files (the watch folder), mounted as `/makemkv-output` in the backend, `/output` in MakeMKV, `/data/watch` in Dyadrr |
| `DOWNLOADS_DIR` | `./downloads` | Host folder with the downloads (discs, RAR archives): read-only in the backend (`/downloads`, but for its `.wayfinderr` folder where archives are unpacked), MakeMKV (`/storage`) and Dyadrr (`/data/downloads`) |
| `SEEDING_DIR` | `./seeding` | Host folder where the films released locally seed (the **release folder** of the download client on this machine, **Clients** page): read-only in the backend (`/seeding`) and Dyadrr (`/data/seeding`), so a film released locally can still be merged where it seeds. Wayfinderr never writes or deletes there |
| `WAYFINDERR_TAG` | `latest` | Image version: `latest` (last commit on `main`), a release like `0.32.1`, or `sha-<commit>` |
| `WAYFINDERR_REGISTRY` | `ghcr.io/tehmaat` | Where the Wayfinderr images come from (a fork's registry, a mirror) |
| `DYADRR_TAG` | `latest` | Dyadrr image version: `latest`, a release like `0.21.0`, or `sha-<commit>` |
| `DYADRR_REGISTRY` | `ghcr.io/tehmaat` | Where the Dyadrr image comes from |
| `COMPOSE_PROFILES` | – | Optional services started by plain `docker compose up -d`: `makemkv`, `merge`, or both (`makemkv,merge`) |
| `COMPOSE_FILE` | – | `docker-compose.yml:docker-compose.https.yml` (`;` on Windows) for the [built-in HTTPS](DEPLOYMENT.md#built-in-https): every `docker compose` command then includes the HTTPS file |
| `HTTPS_DOMAIN` | – | With `docker-compose.https.yml`: the app's domain, passed to the frontend ([Frontend (HTTPS)](#frontend-https)) and the backend. Required there: compose stops without it |
| `HTTPS_CERT_SSH_HOST`, `HTTPS_CERT_SSH_PORT`, `HTTPS_CERT_SSH_USER`, `HTTPS_CERT_SSH_HOST_KEY` | – | With `docker-compose.https.yml`: passed to the backend, to fetch Pangolin's wildcard ([HTTPS certificate from Pangolin](#https-certificate-from-pangolin)) |
| `HTTPS_CERT_SOURCE`, `ACME_EMAIL`, `ACME_STAGING` | `files`, –, `false` | With `docker-compose.https.yml`: passed to the frontend, for [Let's Encrypt](DEPLOYMENT.md#lets-encrypt) ([Frontend (HTTPS)](#frontend-https)) |

## Backend

| Variable | Default | Description |
|---|---|---|
| `WATCH_DIR` | `/makemkv-output` | Folder watched for new `.mkv` files, subfolders included. *Fixed in compose* |
| `WATCH_USE_POLLING` | `false` | Poll the folder instead of using file events: needed on Docker Desktop (Windows/macOS) and network shares |
| `DATABASE_URL` | `file:./data/wayfinderr.db` | SQLite file, relative to `backend/prisma/` (`file:../data/wayfinderr.db` in `backend/.env.example`). *Fixed in compose*: `/app/data`, the `wayfinderr-data` volume |
| `PORT` | `3001` | Backend port. *Fixed in compose* (not published) |
| `NODE_ENV` | `development` | `production` in the Docker image |
| `MAX_CONCURRENT_UPLOADS` | `2` | Uploads running at the same time (never more than one per server) |
| `DELETE_AFTER_UPLOAD` | `false` | Delete the local `.mkv` once it is on the server |
| `SSH_PRIVATE_KEY_PATH` | – | SSH private key for the servers and download clients saved without a password. With Docker, add it to the backend's `environment` and mount the key file read-only |
| `WAYFINDERR_SETUP_CODE` | random | Fixed setup code for creating the account, instead of the one printed in the log |

### Logs

| Variable | Default | Description |
|---|---|---|
| `LOG_LEVEL` | `info` | `trace`, `debug`, `info`, `warn`, `error`, `fatal` |
| `LOG_RETENTION_DAYS` | `30` | Days of log history kept on disk (the **Logs** page), today included. `0`: forever |
| `LOG_MAX_SIZE_MB` | `500` | Most space of the whole log folder; past it the oldest days go first. `0`: no limit |
| `LOG_DIR` | `<database folder>/logs` | Where the log history is kept |

### HTTPS certificate from Pangolin

The backend fetches the certificate of the [built-in HTTPS](DEPLOYMENT.md#wildcard-from-pangolin)
over SSH from the host where Pangolin keeps a wildcard, writes it for the frontend, and follows its
renewals (every 6 hours). Off without `HTTPS_CERT_SSH_HOST`.

| Variable | Default | Description |
|---|---|---|
| `HTTPS_CERT_SSH_HOST` | – | SSH address of Pangolin's host. Set: the certificate is fetched at start and every 6 hours |
| `HTTPS_CERT_SSH_PORT` | `22` | Its SSH port |
| `HTTPS_CERT_SSH_USER` | `wayfinderr-cert` | The user `pangolin-cert-setup.sh` creates there |
| `HTTPS_CERT_SSH_HOST_KEY` | – | Fingerprint of the host's key (`SHA256:…`). Empty: the key seen at the first connection is kept and checked from then on |
| `HTTPS_DOMAIN` | – | The app's domain: the certificate must cover it. *Set by `docker-compose.https.yml`* |
| `HTTPS_CERT_SOURCE` | `files` | With `acme` (Let's Encrypt writes the certificate) nothing is fetched, and the log says so. *Set by `docker-compose.https.yml`* |
| `HTTPS_CERT_DIR` | `/app/certs` | Where `fullchain.pem` and `privkey.pem` are written: the folder the frontend reads. *Fixed in `docker-compose.https.yml`* (the `wayfinderr-certs` volume); for a local run, the frontend's `certs` folder |

Wayfinderr's own SSH key and the host key it keeps are in `https/` next to the database.

### Automatic ripping

See [Automatic ripping](USAGE.md#automatic-ripping). Needs the `makemkv` service.

| Variable | Default | Description |
|---|---|---|
| `RIP_ENABLED` | `false` | Rip the film discs that finish downloading in the downloads folder |
| `RIP_SOURCE_DIR` | `/downloads` | The downloads folder, as the backend sees it. *Fixed in compose* |
| `RIP_WORK_DIR` | `<WATCH_DIR>/.wayfinderr` | Folder shared with the MakeMKV runner (jobs, rips in progress) |
| `RIP_EXISTING` | `false` | Also rip the downloads already there when ripping is first turned on |
| `RIP_QUIET_MINUTES` | `10` | A download is complete when nothing in it changed for this long |
| `RIP_MIN_LENGTH` | `2700` | Seconds: shorter titles are never the film |
| `RIP_LANGUAGE` | `it` | Language always kept (ISO 639-1), besides the film's original one. Merging needs `it` |
| `TMDB_API_KEY` | – | themoviedb.org API key (v3) or read access token. Without it every rip waits for a choice, and torrents are matched only by names in the same language |
| `TMDB_LANGUAGE` | `it-IT` | Language of the title used for the file name |
| `TMDB_API_URL` | `https://api.themoviedb.org/3` | TMDB API address (a proxy, tests) |

### Tools

All of them are in the Docker image; for a local run install them, or point these at them.

| Variable | Default | Description |
|---|---|---|
| `UNRAR_PATH` | `unrar` | unrar, for RAR archives (Windows: `C:/Program Files/WinRAR/UnRAR.exe`) |
| `MKVMERGE_PATH` | `mkvmerge` | mkvmerge (MKVToolNix): rip a Blu-ray without MakeMKV, join discs |
| `SEVENZIP_PATH` | `7zz` | 7-Zip: read an ISO without MakeMKV |
| `FFMPEG_PATH` | `ffmpeg` | ffmpeg 7+ with the `dvdvideo` input: rip a DVD without MakeMKV |
| `FFPROBE_PATH` | `ffprobe` | ffprobe: the tracks of every file |

### Merge

| Variable | Default | Description |
|---|---|---|
| `MERGE_ENABLED` | `false` | Merge two rips of a film with Dyadrr (needs the `dyadrr` service and `RIP_LANGUAGE=it`). See [Merge with Dyadrr](USAGE.md#merge-with-dyadrr) |
| `LOCAL_RELEASE_DIR` | – | The release folder of a local release (`SEEDING_DIR`), as the backend sees it, read only: a film released locally is paired where it seeds, and Dyadrr reads it as `/data/seeding`. Empty: not mounted. *Fixed in compose* (`/seeding`) |

## Frontend (build time)

Compiled in by `next build` (`npm run build`, or the Docker build arguments): changing them means
rebuilding.

| Variable | Default | Description |
|---|---|---|
| `BACKEND_URL` | `http://wayfinderr-backend:3001` (Docker image), `http://localhost:3001` (local run) | Where the frontend server proxies `/api`, `/health` and `/ws` |
| `APP_VERSION` | `package.json` version | Version shown in the sidebar (CI passes the release tag) |
| `GIT_COMMIT` | `git rev-parse HEAD` | Commit shown next to the version |
| `NEXT_DIST_DIR` | `.next` | Build folder (the screenshots script builds into its own) |

## Frontend (HTTPS)

Read when the frontend starts (`npm start`, the Docker image). Without `HTTPS_DOMAIN` the frontend
serves the app on port 3000 over plain HTTP, as always. See [Built-in HTTPS](DEPLOYMENT.md#built-in-https).

| Variable | Default | Description |
|---|---|---|
| `HTTPS_DOMAIN` | – | The app's domain, e.g. `wayfinderr.example.com` (a host name, no wildcard, no port): turns HTTPS on. The certificate must cover it, and port 80 redirects there. A wrong value stops the frontend with the reason in the log |
| `HTTPS_CERT_DIR` | `certs` in the frontend folder (`/app/certs`, the `wayfinderr-certs` volume, in the image) | Folder with `fullchain.pem` and `privkey.pem`, reloaded when they change |
| `HTTPS_CERT_SOURCE` | `files` | Where the certificate comes from: `files` (put in the folder by hand, or by the backend from Pangolin's host) or `acme` ([Let's Encrypt](DEPLOYMENT.md#lets-encrypt): got and renewed by the frontend, needs `HTTP_PORT`) |
| `ACME_EMAIL` | – | With `acme`: contact of the Let's Encrypt account (optional) |
| `ACME_STAGING` | `false` | With `acme`: Let's Encrypt's staging, for tries (certificates browsers do not trust) |
| `ACME_DIRECTORY_URL` | Let's Encrypt | With `acme`: another ACME server's directory (another CA, a test server). Wins over `ACME_STAGING` |
| `HTTPS_PORT` | `443` | HTTPS port inside the container (or of a local run) |
| `HTTP_PORT` | `80` | Port that redirects to HTTPS. `0`: none |
| `PORT` | `3000` | Port of the app over plain HTTP (Next.js), where HTTPS forwards |

## MakeMKV container

The `makemkv` service: [jlesage/makemkv](https://github.com/jlesage/docker-makemkv) plus the rip
runner. Its own settings (`USER_ID`, `GROUP_ID`, `TZ`, the GUI password…) are in jlesage's
documentation; set `USER_ID`/`GROUP_ID` to the owner of the watch folder.

| Variable | Default | Description |
|---|---|---|
| `MAKEMKV_KEY` | `BETA` | Registration key, or `BETA` for the free beta key |
| `WAYFINDERR_RUNNER` | `1` | `0` turns the rip runner off (MakeMKV's GUI only) |
| `WAYFINDERR_CACHE_MB` | `1024` | Read cache of a rip |
| `WAYFINDERR_POLL_SECONDS` | `3` | How often the runner looks for new jobs |

## In the web UI

| Where | What |
|---|---|
| **Servers** | Upload servers: type, SSH login, remote folder, media policy (skip files without Italian, or always upload), Ultra-API token, tracker release settings |
| **Clients** | qBittorrent clients: WebUI login, category, removal rules, low-space pause, local release |
| **Rips** → *Exclusions* | Paths never ripped, folders never searched, "downloads arrive complete" |
| **Merge** → *Choices* | Dyadrr's choices (fixed or asked each time), what happens to the two files after a merge |
| Account menu | Change password, API key (`X-Api-Key`), sign out everywhere |
| Sidebar | Theme and accent color (kept in the browser) |
