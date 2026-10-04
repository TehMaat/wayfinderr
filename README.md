# Wayfinderr 🎬

Automated MKV file transfer system with intelligent server selection and real-time monitoring.

Automatically detects new MKV files from MakeMKV, verifies Italian audio/subtitles, uploads to the server with most available space via SCP with automatic retry and exponential backoff.

**Stack**: Docker Compose • Node.js 20 • Next.js 14 • Express • SQLite • Prisma • WebSocket

---

## Features

- 🎯 **Smart Server Selection** - Automatically picks server with most free space
- 🔍 **Media Verification** - Detects Italian audio/subtitle tracks with ffprobe
- 📤 **Reliable Transfers** - SCP upload with automatic retry (max 3 attempts)
- 📊 **Real-Time Monitoring** - WebSocket-driven live dashboard
- 🔄 **Job Queue** - Concurrent uploads (max 2 global, max 1 per server)
- 💾 **Full History** - SQLite-backed persistence with upload tracking
- 🌐 **Web UI** - Clean dashboard with server management and upload history
- 🐳 **Docker-Ready** - Docker Compose setup for easy deployment

---

## Quick Start

### Prerequisites

- Docker & Docker Compose
- Two Ultra.cc servers (or compatible) with SSH access
- ~500MB disk space
- MakeMKV (runs in Docker)

### 1. Setup (2 minutes)

```bash
# Clone/Extract project
git clone <repo-url>
cd wayfinderr

# Build Docker images
docker-compose build

# Start all services
docker-compose up -d

# Verify services
docker-compose ps
```

### 2. Configure Servers (1 minute)

1. Open http://localhost:3000
2. Go to **Servers** page
3. Click **"Add New Server"**
4. Enter Ultra.cc server details
5. Click **"Test"** to verify connection
6. Repeat for second server

### 3. Start Using

Copy MKV files to the watch directory and watch them upload automatically!

---

## Project Structure

```
wayfinderr/
├── README.md
├── LICENSE
├── docker-compose.yml
├── .gitignore
├── backend/
│   ├── Dockerfile
│   ├── package.json
│   ├── src/
│   ├── prisma/
│   └── ...
├── frontend/
│   ├── Dockerfile
│   ├── package.json
│   ├── app/
│   ├── components/
│   └── ...
├── docs/
│   ├── QUICK-START.md
│   ├── SETUP.md
│   ├── ARCHITECTURE.md
│   ├── API.md
│   ├── TESTING.md
│   └── DEPLOYMENT.md
└── scripts/
    ├── setup.sh
    ├── start.sh
    └── stop.sh
```

---

## API Endpoints

### Servers
- `GET /api/servers` - List all servers
- `POST /api/servers` - Create server
- `PUT /api/servers/:id` - Update server
- `DELETE /api/servers/:id` - Delete server
- `POST /api/servers/:id/test` - Test connectivity

### Uploads
- `GET /api/uploads?limit=50` - List uploads
- `GET /api/uploads/:id` - Get upload details
- `POST /api/uploads/:id/retry` - Retry failed upload

### Space
- `GET /api/space` - All servers' space
- `POST /api/space/:id/refresh` - Refresh cache

---

## Development

### Local Setup

```bash
# Backend
cd backend
npm install
npm run dev

# Frontend (new terminal)
cd frontend
npm install
npm run dev
```

---

## Deployment

See **[docs/DEPLOYMENT.md](./docs/DEPLOYMENT.md)** for production setup.

---

## Troubleshooting

See **[docs/TROUBLESHOOTING.md](./docs/TROUBLESHOOTING.md)** for common issues.

---

## Contributing

Contributions welcome! See **[CONTRIBUTING.md](./CONTRIBUTING.md)** for guidelines.

---

## License

MIT License - see **[LICENSE](./LICENSE)** file

---

**Made with ❤️ for automated media management**
