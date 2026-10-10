# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

### Added
- Join discs: the discs of a film split over several discs ("Disc 1", "Disc 2") are joined by hand from a rip's menu ("Join discs…": tick the discs, set their order). Each disc is ripped as usual, with MakeMKV or without, and waits as `JOINING`; once every part is ripped mkvmerge appends them into one film in the watch folder, named after the film. Refused, with the reason, when the parts' tracks differ or the joined file comes out short; Retry joins again, Skip on a part skips the whole film. `POST /api/rips/join`, `joinId`/`joinPart` rip fields, `JOINING` rip status
- Rip exclusions: ignored folders, picked by browsing the downloads, are never searched (the torrent client's folder for the downloads in progress), and the rips listed from them are removed; "Downloads arrive complete" handles what appears in the downloads after a minute instead of `RIP_QUIET_MINUTES`. `folders`/`arriveComplete` in `PUT /api/rips/exclusions`, `GET /api/rips/folders`
- Rip without MakeMKV: when MakeMKV fails (crash, expired key, runner offline), "Rip without MakeMKV" in a rip's menu rips the disc in the backend: Blu-ray folders with mkvmerge on the film's playlist (languages from CLIPINF, chapters from the playlist), Blu-ray ISOs extracted with 7-Zip first, DVDs (folder or ISO) with ffmpeg's dvdvideo input. Titles read without MakeMKV, same track choice (Italian first and default, plus the original language), missing or cut clips and short results fail with the reason. `engine` rip field, `POST /api/rips/:id/remux`, `status.remux` in `GET /api/rips`, `MKVMERGE_PATH`/`SEVENZIP_PATH`/`FFMPEG_PATH`/`FFPROBE_PATH`; mkvtoolnix and 7-Zip in the backend image
- Torrent cleanup, **Clients** page: qBittorrent WebUI clients (login, API key or auth bypass; category filter; automatic or suggest-only removal; keep or delete the downloaded files) with a connection test. Once an upload completes, its source torrent is removed: found exactly for a rip of the downloads folder (the torrent holding that download), otherwise by name, the MKV file and folder names against each finished torrent's name, folder and, with `TMDB_API_KEY`, every TMDB title of its film (translations, alternative titles), so Italian disc names match English release names. Automatic only for a certain, unambiguous match, 5 minutes after the upload and once no rip or upload of the same download is still running; otherwise the upload page shows the suggested torrent and a "Remove torrent now" button. `torrentStatus`/`torrentHash`/... upload fields, `/api/clients`, `POST /api/uploads/:id/torrent/check|remove`, `torrent-updated` WebSocket event; `host.docker.internal` mapped in Docker Compose
- Rips page: remove skipped rips from the list, one at a time ("Remove from list" in its menu) or all at once ("Clear skipped" in the Skipped tab); they stay known (`hidden` rip field), so the downloads scan doesn't list them again. `DELETE /api/rips/:id`, `POST /api/rips/clear-skipped`
- RAR archives in the downloads (`.rar`, `.partN.rar`, `.rNN` volumes) are listed once downloaded and, when they hold one film, unpacked with unrar on the disk with more free space left afterwards, the downloads one or the watch folder one (a disc next to the watch folder counts twice, for its rip): a disc inside is ripped, an `.mkv` is named like a rip and uploaded (from the downloads disk directly, deleted once on the server). `UNPACKING` rip status, `contentType`/`contentPath`/`unpackBytes`/`unpackedTo` rip fields, `status.unpack` in `GET /api/rips`, `UNRAR_PATH`; unrar in the backend image; the backend mounts `<downloads>/.wayfinderr` writable. Archives already in the downloads are listed as skipped
- The MakeMKV runner reads discs from the work folder too (`root=work` in a job): update the `wayfinderr-makemkv` image with the backend
- "This machine" card: the downloads disk too, with ripping on
- Login: one account created on a setup screen with a one-time setup code from the backend log (or `WAYFINDERR_SETUP_CODE`); scrypt password hashes; 30-day sessions in an HttpOnly cookie
- Account menu: change password (signs out other devices), sign out, sign out everywhere
- Failed login limit: 5 per 15 minutes per client
- `node dist/cli.js reset-auth` (`npm run reset-auth`) for a forgotten password
- Dashboard "This machine" card: free/used space of the disks holding the watch folder and the database, one bar per disk when they are on different filesystems (with device, filesystem type and network/host-share detection)
- "This machine" card: refresh button to recheck the disk space right away (it is otherwise refreshed every minute)
- `GET /api/system/disks` endpoint
- Rip exclusions, edited from the Rips page: discs whose path in the downloads contains a rule (`*` wildcard, case-insensitive) are skipped instead of ripped; `PUT /api/rips/exclusions`
- Automatic ripping of film discs (ISO, BDMV, VIDEO_TS) from the downloads folder: `RIP_*` and `TMDB_*` variables, Rips page, `wayfinderr-makemkv` image (jlesage/makemkv plus the rip runner)
- `DELETE_AFTER_UPLOAD`: delete the local file once it is on the server
- Stop a queued or running upload (`POST /api/uploads/:id/cancel`, `CANCELLED` status, `upload-cancelled` WebSocket event, Stop button): the partial file on the server is deleted
- The watch folder, subfolders included, is also rescanned every 30 seconds for files the watcher misses
- Docker images for linux/arm64 too

### Changed
- Torrent cleanup removes a torrent without asking only when it is 100% the one: the rip's download, or a name match on the very same title with the same year in both names and no other torrent matching. Titles spelled differently (score 95), names without a year and runner-up matches now wait for "Remove torrent now"
- Backend image on Node 22 and Alpine 3.24 (`node:22-alpine3.24`): Node 20 is end of life, and Alpine 3.24's ffmpeg reads DVDs
- The browser only talks to the frontend, which proxies `/api`, `/health` and the `/ws` WebSocket to the backend; the backend port is no longer published. `BACKEND_URL` (frontend build arg, default `http://wayfinderr-backend:3001`) replaces `NEXT_PUBLIC_API_URL`
- WebSocket only on `/ws` (session cookie required, same site only)
- `/api/servers` returns `hasApiToken` instead of the API token; a blank token on edit keeps the saved one
- Unsafe cross-site requests are refused (403 `cross_site_request`); error responses use fixed messages
- Uploads keep 64 SFTP writes of 32 KiB in flight, like OpenSSH: no longer capped at chunk size / round trip time (~2 MiB/s)

### Fixed
- An upload no longer hangs forever when the SSH connection drops: the attempt fails and is retried
- An upload fails (and is retried) when the local file changed while it was sent
- A rip never takes the name of a file uploaded before: with `DELETE_AFTER_UPLOAD` it would have replaced that film on the server
- Unfinished uploads are resumed once after a restart (PENDING ones were queued twice)
- Rips waiting for their film are looked up on TMDB again when the backend starts (retried after 10 minutes when TMDB does not answer): after an update, or a TMDB key added later, the ones now identified go on by themselves with their scan, without a rescan, or wait only for the title; the others get an up-to-date reason. A Skip or a choice made meanwhile is never overwritten
- TMDB match: apostrophe look-alikes (′ ＇ ʼ ‛...) and ordinal signs (º ª) in TMDB titles, ordinals and "$" spelled out or left out (`La 25a ora` and `La 25 ora` for *La 25ª ora*, `Cash` for *Ca$h*), the release year first and then the same words over the same letters ("I.T." is not "It"; it asks when the two disagree), the film found past the first ten search results
- Release names: tags joined by signs (`[ITA-ENG]`, `ITA/ENG`, `[SUB-ITA]`, `-ITA-`, `Director’s Cut`), dashes left at the end and brackets glued to words (`Il Padrino(1972)[BDRip]`) and years between dashes (`-1972-`) no longer end up in the title or hide the year
- `docs/DEPLOYMENT.md` update steps: `docker compose pull`, since `docker-compose build` builds nothing with the published images; `--profile makemkv` for the MakeMKV image
- The TMDB match ignores every sign and space in the title, however the download name writes it: apostrophes and a possessive 's with or without the s ("Bridget.Jones.Baby" is *Bridget Jones's Baby*), `&`/`+` as "and", "e" or left out, hyphens, dots, colons, superscripts ("Alien 3" is *Alien³*)

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
- [x] User authentication (username/password, see Unreleased)
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
