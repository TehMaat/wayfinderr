# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

### Added
- Ultra-API restart (issue #59): when a server's storage API is unreachable, **Restart API** on its card logs in over SSH and runs Ultra's (unofficial) Ultra-API script, `bash <(wget -qO- https://scripts.ultra.cc/util-v2/Ultra-API/main.sh)`, picking the *Restart* entry (its number is read from the menu, nothing is typed if there is none), then checks the API again for up to 30 seconds. The switch under it, **Restart automatically when unreachable**, does the same by itself when the API cannot be reached (not on a 401/403, a wrong token), at most once every 15 minutes per server; a toast says when it runs and how it went. The card shows when the last restart ran and why it failed. `POST /api/servers/:id/restart-api`, `autoRestartApi`/`apiRestartAt`/`apiRestartError` server fields, `apiRestarting` in the server list, `server-api-restart` WebSocket event
- **Join discs…** in the *Choose…* dialog of a disc that can be joined (issue #62), next to *Rip this title*: the film picked in the dialog goes with the join, so the discs start with it. The join dialog shows the film every disc gets, or says that it is chosen once for all of them. On a disc already in a join, *Choose…* says which part it is and that the film and second language are every disc's, and its button reads *Rip this part*. `tmdbId` in `POST /api/rips/join`
- TMDB: a release named with two titles, `<localized title> - <original title>` ("Vom Winde verweht - Gone with the Wind (1939)"), is identified when the whole name matches no film: each side is matched as a title (same year rule), and it is automatic when they give exactly one film (issue #62)
- Source .torrent files sent before their upload exists (issue #60): by bookrr, once the download is complete, or by hand (**Clients** page, *Source .torrent files*, which lists them, downloads and deletes them). Each one is kept for good and copied into its upload as soon as the rip of its download is done (the rip's download has the torrent's name), or when a file of the watch folder sits under that name, or when the upload is matched to its hash; the torrent cleanup then looks for that very hash in the clients, a certain match. A torrent cleanup that finds no torrent no longer drops the .torrent kept. `SourceTorrent` model, `/api/source-torrents`
- API key (issue #60), for bookrr and scripts: sent in the `X-Api-Key` header it works like a login on every API and on the WebSocket. Shown, copied and regenerated from the account menu (**API key**). `GET/POST /api/auth/api-key`
- Merge: a source .torrent for each of the two files (issue #60). The **Source torrent** card now shows on files held for a merge and on merged inputs too, and "Add .torrent…" works on them; the merged file has no source torrent of its own (no more name match on it, which found one of the two at random or none) and its page shows the two inputs' source torrents instead
- **Read again** button over the media info of an upload page: reads the file's tracks again with ffprobe, after it changed on the disk (track languages fixed with `mkvpropedit`, a disc whose English is tagged as Italian), so the page shows them (Dyadrr always reads the file itself). Uses `POST /api/uploads/:id/media`, so a file already on a server is read there

### Fixed
- Join discs stopped at the film choice (issue #62): with no disc identified on TMDB, the join went back to *Choose…* on every disc, and choosing the film on one of them only ripped that one, the others staying in *Needs attention* with the old "choose the right one" reason (and the film already set), so the join waited for each disc to be confirmed by hand. A film chosen on a part, or found on TMDB for one of them, now queues the other parts waiting for a choice again, with their title picked as usual
- Merge: pairing two files never started their analysis. The new pair was saved as already analyzing (the column's default), so the analysis refused to start ("already being analyzed"): the pair stayed *Queued* for good, with no Dyadrr job, and Stop could not stop it. A new pair now starts as not analyzed and goes to analyzing once its job is written; pairs left stuck that way end as *Error* (`NOT_STARTED`) on their own, to analyze again, and Stop works on them too
- Merge: stopping an analysis or a merge still queued in the Dyadrr container (which runs one job at a time, so a job can wait behind a long one) did nothing until its turn came. The queued job is now withdrawn at once and the pair is stopped right away; a running one gets SIGTERM as before. The card says the job is queued behind another one

### Added
- Merge with Dyadrr, fifth part: with merging on, a disc without Italian is ripped instead of waiting for a choice, keeping the original language and English (never offered as the language in place of a missing original one), and its file is held for the merge. One writer at a time: a merge waits for the rip, unpacking or join in progress (a waiting merge can be stopped before it starts), and the rips wait for a running merge
- Merge with Dyadrr, fourth part: the merge. **Merge…** on a pair that can be merged asks the choices left pending (with what each value does) and the merged file's name, the film's usual one (rip, TMDB, or the better video's name), in the watch folder; a file with that name already there (locally or on a server) is replaced only once confirmed, else the merge stops to let you check. Dyadrr merges with `--expect` on the confirmed analysis, followed live; the merged file is uploaded as it is (never held), the two inputs become `MERGED` and are kept or deleted (new setting in **Choices**; files in the downloads are never deleted), and once the merged file is on a server the source torrents of both inputs are cleaned up. A merge stopped or failed leaves the pair mergeable, with the reason. `POST /api/merge/pairs/:id/merge`, `GET /api/merge/pairs/:id/merge-preview`, `GET /api/merge/pairs/:id/merge-report`, `inputs` in `/api/merge/settings`, `MERGING`/`MERGED` pair statuses, `MERGED` upload status, `upload-merged` WebSocket event
- Merge with Dyadrr, third part: pairing and analysis. **Pair…** on a held file, or **Pair files…** on the **Merge** page, pairs two files of the same film (any two still on the disk and not uploading, the likely twin listed first); Dyadrr runs `dyadrr analyze` on them in its container, followed live on the page (phase and progress), then the page shows what it found: which file is the better video and which the Italian one, the offset, the share in common, where the Italian goes, the Italian tracks, the warnings, the choices still to make with what each value does, or why it was refused, with the full report one click away. Analyze again, stop, remove the pair (never the files). The original language comes from the rip or TMDB, or is typed in. **Choices** sets Dyadrr's four choices to a fixed value or *Ask each time*. A file being analyzed cannot be uploaded, retried or deleted. `MergePair` model, `/api/merge/candidates`, `/api/merge/pairs`, `/api/merge/settings`, `merge-pair-*` WebSocket events
- Merge with Dyadrr, second part: files held for a merge (with `MERGE_ENABLED`). A new file without Italian audio is always held instead of uploaded; one with Italian audio is held when a twin of the same film is around, certain or doubtful: a held file without Italian, a rip not finished, or a torrent of the download clients (downloading or not, its own source torrent left out), compared on every TMDB title of the film, so an Italian disc finds the German release of the same film. An unreachable client counts as a doubt. Held files (`HELD` upload status, `holdKind`/`holdMessage` fields, `upload-held` WebSocket event) are never uploaded, deleted, released locally, removed from the history, cleaned up with their archive, ripped again over, and they keep their source torrent; the **Merge** page lists them (with a count in the menu) and, like their upload page, says why and offers **Upload as it is** and **Delete file…**. `POST /api/uploads/:id/hold/upload`, `POST /api/uploads/:id/hold/delete`, `held` in `GET /api/merge`. The film's TMDB titles lookup is shared with the torrent cleanup (`services/filmLookup.ts`)
- Merge with Dyadrr, first part (off by default, `MERGE_ENABLED`): [Dyadrr](https://github.com/TehMaat/dyadrr) merges two rips of the same film, the better video and the Italian audio, into one file without re-encoding. The optional `dyadrr` service in `docker-compose.yml` (profile `merge`, image `ghcr.io/tehmaat/dyadrr`, `DYADRR_TAG`) gets its jobs through the watch folder (`.wayfinderr/dyadrr/jobs`), with the backend side of its file job protocol in `services/merge`. A **Merge** page, always in the menu, says how to turn it on, or whether the Dyadrr container is running and the language is Italian (`RIP_LANGUAGE=it`). Holding the files of a pair, the analysis and the merge come next. `GET /api/merge`
- Second language when the original one is missing on the disc: a film whose disc has no audio in its original language (by TMDB) but has it in another one besides Italian (an anime like *Resident Evil: Death Island*, Japanese, on a Blu-ray with only Italian and English) no longer rips with Italian only on its own: it stops in *Needs attention*, and *Choose…* shows a **Second language** choice for the chosen title (one of the disc's other audio languages, or only Italian). That language is kept like the original one (audio and subtitles, after Italian), on every part of a join too. `secondLanguage` rip field and `POST /api/rips/:id/choose` body field
- Table columns (issue #45): drag the right edge of a column header to resize it, in the Uploads and Rips tables (double-click goes back to the starting widths). The Uploads list also has a **Columns** menu in its toolbar to pick the columns shown. Both are kept in the browser
- TMDB link on the upload page: the film the tracker command went on with, read from Unit3Dup's `'TMDB ID'........ 238` line whether it found the film on its own or the id was typed in, else the rip's. Earlier releases get it from their kept output at start. `tmdbId` upload field
- Re-upload with the .torrent already made (issue #43): "Upload to the tracker again" after a tracker error that came after the hashing (HTTP 403, 404...) no longer waits for the other tracker uploads of the server. When the .torrent of the file is still in the ITTUP/Unit3Dup archive (in the folder of the tracker the earlier output says it was hashed for), the command reuses it without hashing the file again, so it goes into a second queue, of these re-uploads only, beside the server's one. The **Tracker** card and the toast say so; without the .torrent it is queued as before. After a restart the queued ones are checked again
- Local release (issue #37): with room on this machine, a file is released from the local qBittorrent instead of uploaded to a server. A client with **Local release** on (SSH login to the machine it runs on, the watch folder as that machine sees it, a release folder, release tag and tracker command such as `ittup -u {path}`) adds "Release locally…" to the menu and the **Tracker** card of an upload not on a server yet: its upload stops, the file is moved over SSH into `<release folder>/<name>/<name>.mkv` with the usual name dialog, then the tracker command (ITTUP) uploads it and seeds it from that client, in tmux as on a server. The upload then counts as completed on the client ("qBittorrent (local)") and its source torrent is cleaned up as after an upload; that cleanup never takes the release's own torrent. **Test connection** also checks the SSH login, the folders, tmux and the command. `?local=1` on `/api/uploads/:id/release`, `localClientId` upload field, `localRelease`/`sshHost`/`sshPort`/`sshUsername`/`sshPassword`/`hostWatchDir`/`releaseDir`/`releaseTag`/`trackerCommand` client fields
- ITTUP (the ItaTorrents fork of Unit3Dup): its .torrent archive is also looked for in `~/ittup_config` (`ittup.json`, `torrent_archive_path`)
- Accent color: violet, red, blue, green or amber, from the palette button next to the theme toggle in the sidebar. It colors the dashboard, the logo and the browser tab icon, and is kept in the browser like the theme
- The source torrent's .torrent added by hand is kept: the **Source torrent** card downloads it (and offers "Replace .torrent…"), next to the tracker's .torrent in the **Tracker** card. Matched to another torrent later, it is dropped. `GET /api/uploads/:id/torrent/file`, `torrentFileName` upload field
- Source torrent by hand when it was not found: "Add .torrent…" in the **Source torrent** card now also shows for a source torrent not checked, not matched (`NO_MATCH`), to review or in error. The .torrent becomes the upload's source torrent (name, hash, tracker); still in a download client, it is left there to remove by hand, else it counts as removed
- The tracker's .torrent: once Unit3Dup uploads a file, its .torrent (the one it downloaded back from the tracker) is read from the Unit3Dup archive on the server and kept with its info hash; the **Tracker** card of the upload page shows the hash and the tracker and downloads the .torrent. `GET /api/uploads/:id/release/torrent`, `releaseTracker`/`releaseTorrentName`/`releaseTorrentPath`/`releaseTorrentHash` upload fields
- Add the .torrent by hand ("Add .torrent…" / "Replace .torrent…" in the **Tracker** card), when it is not in the Unit3Dup archive: kept once one of its files has the upload's size, its tracker read from its announce URL (host only). `PUT /api/uploads/:id/release/torrent`
- Link a release made before ("Link existing release" in the **Tracker** card, "Check on the server" once renamed): finds the file on the server by its exact size, its .torrent in the Unit3Dup archive, and reads its media info again there. `POST /api/uploads/:id/release/link`, `remoteFound` upload field
- The source torrent keeps its tracker (host only, never the passkey) with its hash once it is removed; the upload page shows both. `torrentTracker` upload field
- Source tracker by hand, for torrents removed before it was kept: "Add .torrent…" in the **Source torrent** card of an upload reads the tracker (and the hash, when unknown) from the source torrent's .torrent; the upload list's "Add source .torrents" button takes several at once, each going to the removed source torrents with its info hash. Only the tracker host is kept, never the file or its passkey. `POST /api/uploads/:id/torrent/file`, `POST /api/uploads/torrent-file`
- **Missing …** badge in the upload list, and a warning on the upload page, for what could not be found: the file on the server, the .torrent, the media info, the source torrent's hash, tracker or .torrent
- Rename and upload to the tracker, from the upload history ("Rename & upload to tracker…" in an upload's menu, or the **Tracker** card of its page): the file on the server is renamed as moverr.py does (`NAME.YEAR.{VERSION}.{HYBRID}.{REMUX}.RESOLUTION.{VU}.{DV}.{P#}.{HDR}.AUDIO.SUBS-TAG.mkv`, moved into `<release folder>/<name>/`) after a confirmation that shows the analysis, the extra-language warning, the questions (film name and year prefilled from the rip's TMDB match or the file name, version, REMUX, auto-HYBRID for Dolby Vision profile 8) and the result. Then the server's tracker command (`unit3dup -u {path}`) runs over SSH inside tmux, with its output live on the page. Unit3Dup's questions (TMDB id, duplicate found, trailer id) are recognised and answered from the page (Continue/Skip/Quit buttons for a duplicate), with a toast; the TMDB question is answered on its own with the rip's id; the outcome is read from the tracker's answer. Survives a dropped connection or a restart (followed again from tmux); one command at a time per server. Server settings: release folder, release tag, tracker command, and "After each upload: ask for the release name right away" (off by default). `/api/uploads/:id/release`, `remotePath`/`release*` upload fields, `releaseDir`/`releaseTag`/`trackerCommand`/`releaseAuto` server fields, `release-updated`/`release-output` WebSocket events; needs tmux and bash on the server
- Low disk space guard, per client ("Pause all torrents below (GB free)" in the client dialog, blank = off): when a disk of this machine (watch folder, downloads, database) drops below that, every torrent of the qBittorrent client is paused and tagged `wayfinderr-low-space`; with 10% more free space (at least 1 GB) only those are resumed. Checked every 30 seconds; torrents started meanwhile are paused again. The client card shows the pause, a toast says when it happens. `minFreeGB`/`spacePausedAt`/`spaceMessage` client fields, `client-updated` WebSocket event
- Torrent cleanup while uploading: the upload page shows the source torrent card during the upload too, with "Find torrent" and "Remove torrent now". Removal is by hand only until the upload completes (a match is only suggested, `REVIEW`); the confirmation warns when the client deletes the downloaded files. `POST /api/uploads/:id/torrent/check` accepts uploads in progress
- Rip again: a film already ripped is ripped again from its disc, while that is still in the downloads, with the current settings (same film and title): the rip's menu → "Rip again…". The earlier file in the watch folder is deleted, the new one keeps its name and its upload replaces the copy on the server; a joined film is ripped again from every disc. `POST /api/rips/:id/rip-again`, `canRipAgain` rip field
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
- Rips page: the list takes the whole width and the height left under the setup, scrolling under its header
- Upload list: the progress bar without the percentage
- New logo, a glass pyramid with a glowing core inspired by the Star Wars wayfinder: in the sidebar, on the login screen, as the browser tab icon and in the README. In five colors (violet, red, blue, green, amber: `docs/assets/logo-<color>.svg|png`, written by `scripts/logos.mjs`)
- Renamed uploads show their release name in the list and on their page (the uploaded name below it); the search matches the file and release names, the torrent names and the hashes
- "Read media info again" (and the upload page's automatic probe) reads the copy on the server when the local file is gone
- Torrent cleanup removes a torrent without asking only when it is 100% the one: the rip's download, or a name match on the very same title with the same year in both names and no other torrent matching. Titles spelled differently (score 95), names without a year and runner-up matches now wait for "Remove torrent now"
- Backend image on Node 22 and Alpine 3.24 (`node:22-alpine3.24`): Node 20 is end of life, and Alpine 3.24's ffmpeg reads DVDs
- The browser only talks to the frontend, which proxies `/api`, `/health` and the `/ws` WebSocket to the backend; the backend port is no longer published. `BACKEND_URL` (frontend build arg, default `http://wayfinderr-backend:3001`) replaces `NEXT_PUBLIC_API_URL`
- WebSocket only on `/ws` (session cookie required, same site only)
- `/api/servers` returns `hasApiToken` instead of the API token; a blank token on edit keeps the saved one
- Unsafe cross-site requests are refused (403 `cross_site_request`); error responses use fixed messages
- Uploads keep 64 SFTP writes of 32 KiB in flight, like OpenSSH: no longer capped at chunk size / round trip time (~2 MiB/s)

### Fixed
- Upload list: the horizontal scrollbar was below the last row, out of sight with many uploads; the table now scrolls both ways under a header that stays on top, and the scrollbars are visible in the dark theme
- The tracker's .torrent was not found in the Unit3Dup archive: Unit3Dup names it after the file without its extension (`<name>.torrent`, not `<name>.mkv.torrent`). It is now looked for under the file name with and without the extension and the folder name, and a .torrent of the whole folder counts too
- Linking a release showed "Uploaded to the tracker" as well as "Release linked"
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
