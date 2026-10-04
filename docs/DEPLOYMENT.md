# Deployment Guide

Production deployment strategies and best practices.

## Pre-Deployment Checklist

- [ ] Docker images tested locally
- [ ] Environment variables configured
- [ ] Database backups enabled
- [ ] SSH keys set up for servers
- [ ] HTTPS certificate obtained
- [ ] Reverse proxy (nginx) configured
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

# Build images
docker-compose build

# Start services
docker-compose up -d

# Verify
docker-compose ps
```

### Production Configuration

Edit `docker-compose.yml`:

```yaml
version: '3.8'

services:
  wayfinderr-backend:
    build: ./backend
    restart: always
    ports:
      - "127.0.0.1:3001:3001"  # Bind to localhost only
    environment:
      NODE_ENV: production
      LOG_LEVEL: info
      DATABASE_URL: file:./data/wayfinderr.db
    volumes:
      - wayfinderr-data:/app/data
      - makemkv-output:/makemkv-output:ro
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3001/api/space"]
      interval: 30s
      timeout: 10s
      retries: 3
    depends_on:
      - makemkv

  wayfinderr-frontend:
    build: ./frontend
    restart: always
    ports:
      - "127.0.0.1:3000:3000"  # Bind to localhost only
    environment:
      NEXT_PUBLIC_API_URL: https://api.wayfinderr.com
    depends_on:
      - wayfinderr-backend

  makemkv:
    image: jlesage/makemkv:latest
    restart: always
    volumes:
      - makemkv-output:/output
      - /mnt/bluray:/mnt/video:ro
    environment:
      VNC_PASSWORD: change-me

volumes:
  wayfinderr-data:
  makemkv-output:
```

## HTTPS with Nginx Reverse Proxy

### Nginx Configuration

Create `/etc/nginx/sites-available/wayfinderr.conf`:

```nginx
upstream backend {
  server 127.0.0.1:3001;
}

upstream frontend {
  server 127.0.0.1:3000;
}

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

  client_max_body_size 5G;

  # Frontend
  location / {
    proxy_pass http://frontend;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }

  # API
  location /api {
    proxy_pass http://backend;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_read_timeout 300s;
  }

  # WebSocket
  location /ws {
    proxy_pass http://backend;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "Upgrade";
    proxy_set_header Host $host;
    proxy_read_timeout 86400;
  }
}
```

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
# Check services
curl https://wayfinderr.example.com/api/space

# Check database
docker-compose exec wayfinderr-backend \
  sqlite3 /app/data/wayfinderr.db "SELECT COUNT(*) FROM Upload;"
```

### Uptime Monitoring

Service like UptimeRobot:
- Monitor: `https://wayfinderr.example.com`
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

2. **Use environment variables:**
```bash
# Instead of hardcoding in files
NEXT_PUBLIC_API_URL=${API_URL}
```

3. **Rotate credentials regularly:**
```bash
# Update SSH keys, API tokens every 90 days
```

4. **Network security:**
```bash
# Firewall - only allow needed ports
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
# Pull latest code
git pull origin main

# Rebuild images
docker-compose build

# Down and restart
docker-compose down
docker-compose up -d
```

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
