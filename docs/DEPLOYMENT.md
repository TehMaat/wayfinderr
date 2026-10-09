# Deployment Guide

Production deployment strategies and best practices.

## Pre-Deployment Checklist

- [ ] Docker images tested locally
- [ ] Environment variables configured
- [ ] Account created (setup code from the backend log) before the app is exposed
- [ ] Database backups enabled
- [ ] SSH keys set up for servers
- [ ] HTTPS certificate obtained
- [ ] Reverse proxy (Pangolin/Traefik or nginx) pointing at the frontend
- [ ] Monitoring/alerting set up
- [ ] Log aggregation configured

## Docker Compose Deployment

### Basic Setup

```bash
# SSH into production server
ssh user@production.server

# Clone repository
git clone https://github.com/yourusername/wayfinderr.git
cd wayfinderr

# Configure environment
cp .env.example .env
nano .env  # Edit with production values

# Pull the images
docker compose pull

# Start services
docker compose up -d

# Verify
docker compose ps
```

Then open `http://<server>:3000` from the LAN and create the account with the setup code from `docker compose logs wayfinderr-backend` **before** exposing the app.

### Production Configuration

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

## Reverse Proxy (HTTPS)

One HTTP entry is enough: point it at the frontend (`http://<frontend>:3000`), never at the backend. WebSockets (`/ws`) go through the same entry. The proxy must:

- pass the original `Host` header (the cross-site check compares it with the page's `Origin`);
- set `X-Forwarded-For` to the client address (the login limiter counts failures per client);
- set `X-Forwarded-Proto` (on `https` the session cookie gets the `Secure` flag).

Traefik and Pangolin do all of this by default, WebSockets included. Do not let clients reach port 3000 around the proxy: they could send their own `X-Forwarded-For`. Without a reverse proxy, keep Wayfinderr on the LAN.

### Pangolin

Create an **HTTP** resource, e.g. `wayfinderr.mydomain.it`, with one target: method `http`, address `172.18.0.111` (the frontend), port `3000`. No other setting is needed.

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

Enable the site:
```bash
sudo ln -s /etc/nginx/sites-available/wayfinderr.conf /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl restart nginx
```

### Let's Encrypt Certificate

```bash
sudo apt-get install certbot python3-certbot-nginx
sudo certbot certonly --nginx -d wayfinderr.example.com
sudo systemctl restart nginx
```

## Database Backups

The database also holds the login account (password hash) and the key that signs sessions: keep backups private. Restoring one restores that account too.

### Automated Backups

Create `/usr/local/bin/backup-wayfinderr.sh`:

```bash
#!/bin/bash

BACKUP_DIR="/backups/wayfinderr"
DB_PATH="/docker/volumes/wayfinderr-data/_data/wayfinderr.db"

mkdir -p $BACKUP_DIR

# Daily backup
DATE=$(date +%Y-%m-%d)
cp $DB_PATH $BACKUP_DIR/wayfinderr-$DATE.db

# Keep only 30 days of backups
find $BACKUP_DIR -name "wayfinderr-*.db" -mtime +30 -delete

# Compress old backups
gzip -f $BACKUP_DIR/wayfinderr-*.db 2>/dev/null || true
```

Schedule with cron:
```bash
0 2 * * * /usr/local/bin/backup-wayfinderr.sh
```

### Manual Backup

```bash
docker-compose exec wayfinderr-backend \
  sqlite3 /app/data/wayfinderr.db ".backup /tmp/wayfinderr.db.backup"

docker cp wayfinderr-backend:/tmp/wayfinderr.db.backup ./backup.db
```

## Monitoring & Logging

### Docker Logs

Forward logs to external service:

```yaml
services:
  wayfinderr-backend:
    logging:
      driver: "awslogs"
      options:
        awslogs-group: "/wayfinderr/backend"
        awslogs-region: "us-east-1"
```

### Health Checks

Monitor with:
```bash
# Check services (no login needed; goes through the frontend to the backend)
curl https://wayfinderr.example.com/health

# Check database
docker-compose exec wayfinderr-backend \
  sqlite3 /app/data/wayfinderr.db "SELECT COUNT(*) FROM Upload;"
```

### Uptime Monitoring

Service like UptimeRobot:
- Monitor: `https://wayfinderr.example.com/health`
- Interval: 5 minutes
- Alert on failure

## Resource Allocation

### Minimum

- **CPU**: 1 core
- **Memory**: 1GB
- **Disk**: 10GB

### Recommended

- **CPU**: 2 cores
- **Memory**: 2GB
- **Disk**: 50GB

### High Volume

- **CPU**: 4+ cores
- **Memory**: 4GB+
- **Disk**: 500GB+

## Security Best Practices

1. **Never commit secrets:**
```bash
# Add to .gitignore
.env
.env.*
```

2. **Create the account before exposing the app:**
```bash
# Anyone with the setup code in this log line can create the account
docker compose logs wayfinderr-backend | grep "setup code"
# Forgotten password: delete the account, then reopen the page and use the new code from the log
docker compose exec wayfinderr-backend node dist/cli.js reset-auth
# (with container_name: wayfinderr-backend, as in the Pangolin example:
#  docker logs wayfinderr-backend / docker exec wayfinderr-backend ...)
```

3. **Rotate credentials regularly:**
```bash
# Update SSH keys, API tokens every 90 days
```

4. **Network security:**
```bash
# Firewall - only allow needed ports. The backend publishes none; behind a
# reverse proxy bind the frontend to 127.0.0.1 or publish no port at all
# (ports published by Docker bypass ufw)
sudo ufw allow 22/tcp
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
```

5. **HTTPS only:**
```bash
# Redirect HTTP to HTTPS
# Configure in nginx (see above)
```

## Updates & Upgrades

### Update Application

```bash
# Download the new images, then recreate the containers that changed
docker compose pull
docker compose up -d
```

`docker compose up -d` or `restart` alone keep running the images already downloaded. With the MakeMKV service add `--profile makemkv` to both commands (or set `COMPOSE_PROFILES=makemkv` in `.env`), or its image is not updated. With images built from source (`docker-compose.build.yml`), `git pull` and then `docker compose -f docker-compose.yml -f docker-compose.build.yml up -d --build` (with `--profile makemkv` too, if used).

### Update Dependencies

```bash
# Backend
cd backend
npm outdated
npm update
git commit -am "chore: update dependencies"

# Frontend
cd frontend
npm outdated
npm update
git commit -am "chore: update dependencies"
```

## Scaling

### Horizontal Scaling

For multiple machines:

1. Use database migration to PostgreSQL
2. Add Redis for caching
3. Load balance with nginx upstream groups
4. Consider Kubernetes for orchestration

### Vertical Scaling

For single machine:

1. Increase resources (CPU, RAM)
2. Optimize database indexes
3. Enable caching
4. Monitor and tune

## Disaster Recovery

### Restore from Backup

```bash
# Stop services
docker-compose down

# Restore database
rm /docker/volumes/wayfinderr-data/_data/wayfinderr.db
cp /backups/wayfinderr/wayfinderr-2026-10-04.db \
   /docker/volumes/wayfinderr-data/_data/wayfinderr.db

# Restart
docker-compose up -d
```

### Migration Between Servers

```bash
# On old server
docker-compose exec wayfinderr-backend \
  sqlite3 /app/data/wayfinderr.db ".backup /tmp/db.backup"
docker cp wayfinderr-backend:/tmp/db.backup ./wayfinderr.db

# On new server
# Run setup as normal, then
cp wayfinderr.db /docker/volumes/wayfinderr-data/_data/wayfinderr.db
docker-compose restart wayfinderr-backend
```

## Maintenance Windows

Schedule maintenance during low activity:

```bash
# Announce
# Create maintenance page

# Stop services
docker-compose down

# Maintenance tasks (updates, backups, etc)

# Start services
docker-compose up -d

# Monitor
docker-compose ps
```
