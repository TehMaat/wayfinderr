# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

### Added - Torrent cleanup
- **Clients** page: qBittorrent WebUI clients (login, API key or auth bypass; category filter; automatic or manual removal; keep or delete the downloaded files) with a connection test
- After an upload completes, the source torrent is matched by name: MKV file and folder names against the torrent name, its content folder and, with a TMDB key, all its TMDB titles (original, translations, alternative titles), so Italian disc names match English release names
- Automatic removal only for a certain (95+), unambiguous match, after a 5-minute delay and only when no other file of the same disc is still uploading and no MKV is being written; otherwise the upload shows the suggested torrent with a "Remove torrent now" button
- TMDB key in the UI (or `TMDB_API_KEY`), pending removals resume after a restart
- `torrent-updated` WebSocket event; `extra_hosts: host.docker.internal` in Docker Compose

## [1.0.0] - 2026-10-04

### Added - Phase 1: Backend Foundation
- Express.js API server with TypeScript
- Chokidar file watcher for MKV detection
- FFprobe media information extraction
- Prisma ORM with SQLite database
- Database schema for Servers and Uploads
- Pino logger with development/production modes

### Added - Phase 2: Core Features
- Ultra.cc API integration for server space monitoring
- SSH/SCP file transfer with ssh2 library
- Job queue with p-queue for concurrency control (max 2 global, max 1 per server)
- Automatic retry logic with exponential/linear backoff (max 3 attempts)
- WebSocket real-time progress updates
- Server space caching (60-second TTL)
- Italian media verification (audio/subtitle detection)

### Added - Phase 3: Frontend UI
- Next.js 14 frontend with React
- Zustand state management
- WebSocket integration for real-time updates
- Dashboard page with stats and current upload
- Upload history page with filtering
- Upload detail page with retry functionality
- Server management page with CRUD operations
- Modal forms for server configuration
- Responsive dark theme with Tailwind CSS
- API client utilities for backend communication

### Added - Phase 3: Enhancements
- ServerForm component for add/edit operations
- Modal component for dialogs
- API utilities (servers, uploads, space)
- Error handling and loading states
- Retry mechanism for failed uploads
- Complete documentation

### Added - Project Setup
- Comprehensive README.md
- Docker & Docker Compose configuration
- Multiple Dockerfile for multi-stage builds
- Helper scripts (start.sh, stop.sh, setup.sh)
- .gitignore and .env.example
- MIT License
- Contributing guidelines

### Added - Documentation
- QUICK-START.md - 5-minute setup guide
- SETUP.md - Detailed installation
- ARCHITECTURE.md - System design
- API.md - REST API documentation
- TESTING.md - Testing procedures
- DEPLOYMENT.md - Production deployment
- TROUBLESHOOTING.md - Common issues
- CONTRIBUTING.md - Contribution guidelines
- This CHANGELOG.md

## Future Releases

### [1.1.0] - Planned
- [ ] User authentication (JWT/OAuth)
- [ ] Email/webhook notifications
- [ ] Advanced analytics and charts
- [ ] Multi-language support (i18n)
- [ ] Server health indicators
- [ ] Upload preview functionality
- [ ] Scheduled uploads
- [ ] Database migration to PostgreSQL

### [1.2.0] - Planned
- [ ] Kubernetes deployment
- [ ] Helm charts
- [ ] CI/CD pipeline (GitHub Actions)
- [ ] Automated tests (Jest/Playwright)
- [ ] API rate limiting
- [ ] Database encryption
- [ ] Log aggregation integration

### [2.0.0] - Planned
- [ ] Horizontal scaling support
- [ ] Multi-node deployment
- [ ] Admin dashboard
- [ ] User roles and permissions
- [ ] API v2 with versioning
- [ ] Mobile app support
- [ ] Webhook integrations

## Version History

### v1.0.0
**Release Date:** October 4, 2026

Complete implementation of core functionality:
- Automated MKV detection and upload
- Intelligent server selection
- Real-time web dashboard
- Full API and WebSocket support
- Production-ready Docker setup

**What's Included:**
- Backend (Express, Prisma, TypeScript)
- Frontend (Next.js, React, Zustand)
- Database (SQLite with migrations)
- Docker Compose orchestration
- Comprehensive documentation

**Known Limitations:**
- No authentication layer
- SQLite limited to ~100k records
- Single-process deployment
- No horizontal scaling

## Contributing

When adding changes:

1. Update version number in `package.json` files
2. Add entry to this CHANGELOG.md
3. Follow commit message conventions
4. Update documentation if needed

## Versioning

This project follows [Semantic Versioning](https://semver.org/):
- MAJOR.MINOR.PATCH
- MAJOR: Breaking changes
- MINOR: New features (backward compatible)
- PATCH: Bug fixes

## Release Process

1. Update version in package.json files
2. Update CHANGELOG.md with changes
3. Commit with message: "release: v1.x.x"
4. Create git tag: `git tag v1.x.x`
5. Push tag: `git push origin v1.x.x`
6. Create release on GitHub

---

For detailed information about releases, see GitHub Releases.
