# Deployment

Running Wayfinderr on an always-on server: on HTTPS, with backups, logs and updates. To install
it first, see [Installation](INSTALLATION.md).

## Checklist

- [ ] Account created (setup code from the backend log) **before** the app is reachable from outside
- [ ] HTTPS: [built into the frontend](#built-in-https), or through a [reverse proxy](#reverse-proxy-https)
  pointing at the frontend, never at the backend
- [ ] Port 3000 not reachable from outside around HTTPS (built-in HTTPS binds it to `127.0.0.1`)
- [ ] Database backups
- [ ] SSH keys or passwords for every server tested (**Servers** → **Test**)

## Run on a server

```bash
git clone https://github.com/TehMaat/wayfinderr.git
cd wayfinderr
cp .env.example .env        # edit: folders, ripping, merging (see CONFIGURATION.md)
docker compose pull
docker compose up -d
docker compose ps
```

Then open `http://<server>:3000` from the LAN and create the account with the setup code from
`docker compose logs wayfinderr-backend` **before** exposing the app.

## Production configuration

The frontend is the only entry point: the browser talks to it alone, and it proxies `/api`, `/health` and the `/ws` WebSocket to the backend over the compose network, by the name `wayfinderr-backend` on port 3001. The backend publishes no port.

That name is compiled into the frontend image at build time (`BACKEND_URL`, default `http://wayfinderr-backend:3001`). To reach the backend at another address, rebuild the image:

```bash
docker build --build-arg BACKEND_URL=http://my-backend:3001 -t wayfinderr-frontend:local ./frontend
```

When a reverse proxy on the same host is the only client, bind the frontend to localhost in `docker-compose.yml`:

```yaml
services:
  wayfinderr-frontend:
    ports:
      - "127.0.0.1:3000:3000"  # only the reverse proxy reaches it
```

## Built-in HTTPS

The frontend can serve HTTPS itself, with no reverse proxy and no other container: set the domain,
put the certificate in its volume, and a new certificate is taken up without a restart whenever its
files change.

You need:

- a domain for the app, e.g. `wayfinderr.example.com`, whose DNS points at this machine (a public
  record to reach it from outside; a local DNS entry is enough on the LAN);
- ports **443** and **80** free on this machine (no other web server there) and, to reach the app
  from outside, open on the router towards it;
- Docker Compose **2.24.4** or later (`docker compose version`);
- a certificate for the domain, by name or a wildcard of one level (`*.example.com` covers
  `wayfinderr.example.com`, not `a.wayfinderr.example.com`), with its private key: a wildcard that
  Pangolin keeps on another host is [fetched and renewed by itself](#wildcard-from-pangolin); any
  other certificate is copied in. Getting one from Let's Encrypt by itself is on its way
  ([#97](https://github.com/TehMaat/wayfinderr/issues/97)).

**Create the account first**, from the LAN (`http://<server>:3000`), before opening the ports. Then:

1. Add to `.env`:
   ```bash
   COMPOSE_FILE=docker-compose.yml:docker-compose.https.yml   # on Windows: ; instead of :
   HTTPS_DOMAIN=wayfinderr.example.com
   ```
   `COMPOSE_FILE` makes every `docker compose` command include `docker-compose.https.yml`, which
   publishes 443 and 80, binds 3000 to `127.0.0.1` and mounts the `wayfinderr-certs` volume.
2. Start it: `docker compose up -d`. Until the certificate is there the frontend log says what it
   waits for (`docker compose logs wayfinderr-frontend | grep https`), and the app keeps answering
   on `http://127.0.0.1:3000` from this machine.
3. The certificate. With a wildcard on Pangolin's host, let Wayfinderr fetch it and follow its
   renewals: see [Wildcard from Pangolin](#wildcard-from-pangolin), then go on with step 4.
   Otherwise copy it in: `fullchain.pem` (the certificate followed by the intermediate ones, as
   certbot names it) and `privkey.pem`, again after every renewal:
   ```bash
   docker compose cp fullchain.pem wayfinderr-frontend:/app/certs/fullchain.pem
   docker compose cp privkey.pem wayfinderr-frontend:/app/certs/privkey.pem
   ```
4. Check: the log says `HTTPS on port 443 for wayfinderr.example.com: certificate for … valid until
   …`, and
   ```bash
   curl -I https://wayfinderr.example.com/health    # HTTP/1.1 200
   curl -I http://wayfinderr.example.com/health     # 301 to https://
   ```

What the frontend does then:

| Port | What |
|---|---|
| 443 | The app over HTTPS (TLS 1.2 and 1.3), the `/ws` WebSocket included |
| 80 | Every request redirected to the same path on `https://<HTTPS_DOMAIN>` (301; 308 for other methods than GET and HEAD). The domain comes from the settings, never from the request |
| 3000 | The app over plain HTTP, from this machine only |

- **Next.js runs as always** on 3000, and HTTPS is a thin layer in front of it, in the same container.
- **The client's addresses:** the client's own `X-Forwarded-*`, `Forwarded` and `X-Real-IP`
  headers are dropped. The frontend sets `X-Forwarded-For` (the login limiter), `X-Forwarded-Proto:
  https` (the `Secure` session cookie) and `X-Forwarded-Host` (the cross-site check) itself.
- **A new certificate:** replace the two files, with `docker compose cp` as above or by writing
  them whole and renaming them into place. It is checked and taken up within a few seconds (every 5
  minutes at the latest), without a restart and without closing the connections already open.
- **A certificate that cannot be used is not taken:** the wrong domain, a key that is not its own,
  out of its dates, not PEM. The reason goes to the log, and the certificate in use stays. Swapping
  the two files one at a time can log `privkey.pem is not the key of the certificate` for an instant,
  until the second one is there.
- **Expiry warning:** from 14 days before the end, the log warns once a day that no new certificate
  has arrived.
- **No HSTS header:** going back to plain HTTP stays possible.

The certificate's state is in the frontend log only (`[https]` lines), not in the UI. The
`wayfinderr-certs` volume holds the private key: keep it, and copies of it, private.

### Wildcard from Pangolin

Pangolin (its Traefik) keeps its certificates in `acme.json` on its host, a wildcard among them
(`*.example.com`), and renews them. The Wayfinderr backend can fetch that wildcard over SSH and save
it where the frontend reads it: at start and every 6 hours, so a renewal is served within hours,
with nothing to do and no restart.

Wayfinderr reads that one certificate and nothing else. On Pangolin's host a dedicated user,
`wayfinderr-cert`, may run one command only (`restrict,command=…` in its `authorized_keys`), which
prints that certificate and its key: never the other certificates, nor Pangolin's ACME account.
Pangolin's host must be reachable over SSH from the Wayfinderr machine.

1. Add to `.env`, next to the two lines of step 1 above, the SSH address of Pangolin's host:
   ```bash
   HTTPS_CERT_SSH_HOST=pangolin.example.com
   ```
   (`HTTPS_CERT_SSH_PORT` when SSH is not on port 22.)
2. `docker compose up -d`. The backend makes its own SSH key (once, in the data volume) and logs the
   command to run on Pangolin's host, with that key:
   ```bash
   docker compose logs wayfinderr-backend | grep "HTTPS certificate from"
   ```
3. On Pangolin's host, download the setup script, read it, and run it as root with the key from
   the log, in single quotes:
   ```bash
   curl -fsSLO https://raw.githubusercontent.com/TehMaat/wayfinderr/main/scripts/https/pangolin-cert-setup.sh
   ```
   ```bash
   sudo sh pangolin-cert-setup.sh 'ecdsa-sha2-nistp256 AAAA… wayfinderr-https'
   ```
   It finds `acme.json` and the wildcard in it by itself (otherwise it says so: pass
   `--acme-json <path>` and `--domain '*.example.com'`), sets up the user, the command and the
   sudo rule, checks that they work, and prints the host's key fingerprints. `--dry-run` finds and
   checks everything without changing anything. It needs `sudo`, and `jq` or `python3`.
4. Within 15 minutes, or at once with `docker compose restart wayfinderr-backend`, the backend log
   says `HTTPS certificate fetched from pangolin.example.com and saved: for *.example.com…`, and the
   frontend log `HTTPS on port 443 for wayfinderr.example.com: certificate for *.example.com…`.

Then:

- **Renewals:** checked every 6 hours; a new certificate on the host is saved and served without a
  restart (`HTTPS certificate fetched … and saved` in the backend log, `new certificate in use` in
  the frontend's). A failure is retried after 15 minutes, then 30, up to every 6 hours, and the
  reason is logged. From 21 days before the end, the backend warns once a day if Pangolin has no
  newer certificate.
- **The host's key:** the first connection trusts it and keeps it (`/app/data/https/host-key`),
  and says so in the log with its fingerprint: compare it with the ones the setup script printed.
  After that a different key is refused, nothing is fetched and the log says why. To pin it from the
  start, set `HTTPS_CERT_SSH_HOST_KEY=SHA256:…`.
- **Wayfinderr's key** is in the data volume (`/app/data/https/ssh-key`), so in the database
  backups too. To revoke it, on Pangolin's host:
  `sudo userdel -r wayfinderr-cert && sudo rm /etc/sudoers.d/wayfinderr-cert /usr/local/bin/wayfinderr-cert`.
- The state is in the backend log (and on the **Logs** page), not in the UI.

To turn it off, remove `COMPOSE_FILE`, `HTTPS_DOMAIN` (and `HTTPS_CERT_SSH_HOST`) from `.env` and run `docker compose up -d`:
the frontend is back on port 3000 as before.

**Local run** (method C of the [Installation](INSTALLATION.md)): `npm start` in `frontend` reads the
same settings, `HTTPS_DOMAIN` and the certificate in `frontend/certs` (or `HTTPS_CERT_DIR`). Ports 443
and 80 need administrator rights; `HTTPS_PORT` and `HTTP_PORT` move them ([Configuration](CONFIGURATION.md#frontend-https)).

## Reverse Proxy (HTTPS)

Instead of the built-in HTTPS, or when another web server already uses ports 443 and 80.


One HTTP entry is enough: point it at the frontend (`http://<frontend>:3000`), never at the backend. WebSockets (`/ws`) go through the same entry. The proxy must:

- pass the original `Host` header (the cross-site check compares it with the page's `Origin`);
- set `X-Forwarded-For` to the client address (the login limiter counts failures per client);
- set `X-Forwarded-Proto` (on `https` the session cookie gets the `Secure` flag).

Traefik and Pangolin do all of this by default, WebSockets included. Do not let clients reach port 3000 around the proxy: they could send their own `X-Forwarded-For`. Without a reverse proxy or the [built-in HTTPS](#built-in-https), keep Wayfinderr on the LAN.

### Pangolin

Create an **HTTP** resource, e.g. `wayfinderr.example.com`, with one target: method `http`, address `172.18.0.111` (the frontend), port `3000`. No other setting is needed.

Example compose with fixed addresses on Pangolin's Docker network (`pangolin`, created by Pangolin's own compose). The frontend reaches the backend by its service name, `wayfinderr-backend`:

```yaml
services:
  wayfinderr-backend:
    image: ghcr.io/tehmaat/wayfinderr-backend:${WAYFINDERR_TAG:-latest}
    container_name: wayfinderr-backend
    environment:
      - NODE_ENV=production
      - PORT=3001
      - DATABASE_URL=file:/app/data/wayfinderr.db
      - WATCH_DIR=/makemkv-output
      - WATCH_USE_POLLING=${WATCH_USE_POLLING:-false}
      - MAX_CONCURRENT_UPLOADS=${MAX_CONCURRENT_UPLOADS:-2}
      - LOG_LEVEL=${LOG_LEVEL:-info}
      - LOG_RETENTION_DAYS=${LOG_RETENTION_DAYS:-30}
      - LOG_MAX_SIZE_MB=${LOG_MAX_SIZE_MB:-500}
    volumes:
      - ${MAKEMKV_OUTPUT_DIR:-./makemkv-output}:/makemkv-output:ro
      - wayfinderr-data:/app/data
    restart: unless-stopped
    networks:
      pangolin:
        ipv4_address: 172.18.0.110

  wayfinderr-frontend:
    image: ghcr.io/tehmaat/wayfinderr-frontend:${WAYFINDERR_TAG:-latest}
    container_name: wayfinderr-frontend
    # No ports: only Pangolin reaches it, at 172.18.0.111:3000
    depends_on:
      - wayfinderr-backend
    # Optional: pin the backend name to its address
    # extra_hosts:
    #   - "wayfinderr-backend:172.18.0.110"
    restart: unless-stopped
    networks:
      pangolin:
        ipv4_address: 172.18.0.111

volumes:
  wayfinderr-data:

networks:
  pangolin:
    external: true
```

The fixed addresses must be free and inside the network's subnet (`docker network inspect pangolin`).

For automatic ripping add, besides the `.env` settings in the README: the downloads folder read-only in the backend (`- /path/to/downloads:/downloads:ro`, with `RIP_ENABLED=true` and `TMDB_API_KEY`) plus its `.wayfinderr` folder writable (`- /path/to/downloads/.wayfinderr:/downloads/.wayfinderr`, so RAR archives can be unpacked on the downloads disk too), the watch folder writable in the backend (no `:ro`), and the `makemkv` service with the `ghcr.io/tehmaat/wayfinderr-makemkv` image, the same downloads folder as `/storage:ro`, the watch folder as `/output` and `MAKEMKV_KEY`. MakeMKV needs no address the backend knows: they only share the watch folder.

To merge rips with Dyadrr add `MERGE_ENABLED=true` to the backend and the `dyadrr` service with the `ghcr.io/tehmaat/dyadrr` image, `hostname: dyadrr`, `stop_grace_period: 30s`, the watch folder writable as `/data/watch`, the downloads folder as `/data/downloads:ro` and, with a local release, its release folder as `/data/seeding:ro` (mounted in the backend too, as `/seeding:ro` with `LOCAL_RELEASE_DIR=/seeding`; see `docker-compose.yml`). Like MakeMKV, it only shares the watch folder with the backend.

Create the account before the resource is public: take the setup code from `docker logs wayfinderr-backend` and open the app from the Docker host, e.g. through an SSH tunnel (`ssh -L 3000:172.18.0.111:3000 <docker-host>`, then http://localhost:3000), or keep Pangolin's own authentication on the resource until it is done.

### Nginx

Create `/etc/nginx/sites-available/wayfinderr.conf` (with the frontend bound to `127.0.0.1:3000`):

```nginx
server {
  listen 80;
  server_name wayfinderr.example.com;
  return 301 https://$server_name$request_uri;
}

server {
  listen 443 ssl http2;
  server_name wayfinderr.example.com;

  ssl_certificate /etc/letsencrypt/live/wayfinderr.example.com/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/wayfinderr.example.com/privkey.pem;
  ssl_protocols TLSv1.2 TLSv1.3;
  ssl_ciphers HIGH:!aNULL:!MD5;

  # Everything goes to the frontend: it proxies /api and /health to the backend
  location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $remote_addr;  # replace, do not append
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_read_timeout 120s;                        # testing a server can take a while
  }

  # WebSocket (live updates), also through the frontend
  location = /ws {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $remote_addr;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
  }
}
```

The backend pings WebSocket clients every 30 seconds, so the default timeouts keep live updates open.

Get the certificate **before** enabling the site: `nginx -t` fails while the files it names do not
exist. certbot answers Let's Encrypt through the nginx already running, and the deploy hook reloads
nginx after every renewal, so the renewed certificate is served (certbot's timer renews it by itself):

```bash
sudo apt-get install certbot python3-certbot-nginx
sudo certbot certonly --nginx -d wayfinderr.example.com --deploy-hook "systemctl reload nginx"
```

Then enable the site:
```bash
sudo ln -s /etc/nginx/sites-available/wayfinderr.conf /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

Check the renewal once: `sudo certbot renew --dry-run`.

## Backups

The database (`wayfinderr.db` in the `wayfinderr-data` volume) holds everything set in the UI and the
upload history, plus the login account (password hash) and the key that signs sessions: keep backups
private. Restoring one restores that account too.

Stop the backend for a consistent copy (a few seconds; running uploads resume at the start):

```bash
docker compose stop wayfinderr-backend
docker run --rm -v wayfinderr_wayfinderr-data:/data -v "$PWD":/backup alpine \
  cp /data/wayfinderr.db /backup/wayfinderr-$(date +%F).db
docker compose start wayfinderr-backend
```

The volume is named after the compose project (`<folder>_wayfinderr-data`): `docker volume ls` shows
it. Run it from cron for daily copies, and delete the old ones (`find . -name 'wayfinderr-*.db'
-mtime +30 -delete`).

**Restore**, or move to another machine: stop the backend, copy the file back into the volume, start
it again.

```bash
docker compose stop wayfinderr-backend
docker run --rm -v wayfinderr_wayfinderr-data:/data -v "$PWD":/backup alpine \
  cp /backup/wayfinderr-2026-11-15.db /data/wayfinderr.db
docker compose start wayfinderr-backend
```

A local run keeps the database in `backend/data/wayfinderr.db`: copy it while the backend is stopped.

## Logs

### Log history (the Logs page)

The backend writes its log to stdout, as always (`docker compose logs wayfinderr-backend`), and also to
one file a day in the data volume, `/app/data/logs/wayfinderr/<YYYY-MM-DD>.jsonl` (UTC days, JSON Lines:
`time`, `source`, `level`, `msg` and the structured fields). With merging on, the Dyadrr runner's log
(`dyadrr.runner.jsonl` in the jobs folder, which the runner keeps to about 1 MiB) is copied into
`logs/dyadrr-runner/`, and the log of every analysis and merge is kept in `logs/dyadrr-jobs/<day>/`
before the job's files are removed, with the pair it was for. The **Logs** page reads them all, and a
pair's page shows its own.

| Variable | Default | Meaning |
|---|---|---|
| `LOG_RETENTION_DAYS` | `30` | Days kept, today included. `0`: forever (only the size limit) |
| `LOG_MAX_SIZE_MB` | `500` | Most space of the whole `logs/` folder. Past it the oldest days go first. `0`: no limit |
| `LOG_DIR` | `<database folder>/logs` | Where the history is (rarely needed) |

Retention runs at the start and once a day and deletes whole days, never today's; each run that deletes
something says so in the log (`log retention: removed …`). A full or read-only disk never stops the
backend: the lines are lost from the file only (they are still on stdout). Passwords, keys and the
headers of failed HTTP requests are redacted from both; the setup code stays on stdout only. Requests
and WebSocket connections are logged at `debug`.

### Container logs

```bash
docker compose logs -f wayfinderr-backend
docker compose logs --since 1h wayfinderr-backend | grep -i error
```

### Health check

```bash
curl https://wayfinderr.example.com/health   # no login needed: {"status":"ok","queue":0}
```

Point an uptime monitor at it.

## Updates

```bash
docker compose pull
docker compose up -d
```

`docker compose up -d` or `restart` alone keep running the images already downloaded. With the
optional services add `--profile makemkv` / `--profile merge` to both commands (or set
`COMPOSE_PROFILES` in `.env`), or their images are not updated. With images built from source, `git
pull` and then `docker compose -f docker-compose.yml -f docker-compose.build.yml up -d --build`.
Migrations run by themselves when the backend starts. Pin a release with `WAYFINDERR_TAG`.

## Security

- Create the account before the app is reachable; anyone with the setup code in the log can create
  it. Forgotten password: `docker compose exec wayfinderr-backend node dist/cli.js reset-auth`, then
  reopen the page and use the new code from the log.
- Never commit `.env`; keep the API key secret and regenerate it if it leaks (account menu).
- Publish no port but the frontend's; behind a reverse proxy bind it to `127.0.0.1` or publish none
  (ports published by Docker bypass `ufw`). The [built-in HTTPS](#built-in-https) publishes 443 and
  80 and binds 3000 to `127.0.0.1` by itself.
- The certificate's private key is in the `wayfinderr-certs` volume (built-in HTTPS): keep it private.
- Fetching Pangolin's wildcard, Wayfinderr's SSH key may only print that certificate on Pangolin's
  host (`restrict,command=…`), and the host's key is checked: see
  [Wildcard from Pangolin](#wildcard-from-pangolin).
- Prefer SSH keys to passwords for the servers (`SSH_PRIVATE_KEY_PATH`).
- Database backups contain the password hash and the session key: keep them private.
