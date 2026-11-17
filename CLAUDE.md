# Wayfinderr

## Issues

Every proposal from the maintainer ("there's this thing…": a feature, a change, a bug, a doc fix,
an idea for later) gets a GitHub issue on `TehMaat/wayfinderr`, and no code is written for it:

1. search the open issues first: when one already covers it, add to that issue instead of opening
   another;
2. analyze the proposal against the code and the docs: what it touches, how it could be done,
   risks, open questions;
3. open the issue with the analysis: what is asked and why, what changes (code, docs,
   screenshots), the acceptance points, the open questions; a proposal too large for one pull
   request becomes a parent issue with sub-issues;
4. give the maintainer the issue's link and **stop**: go ahead only when the maintainer says so.

The pull request says `Closes #N` and the CHANGELOG entry cites `(issue #N)`.

## Versioning

Every pull request to `main` raises the version in both `backend/package.json` and
`frontend/package.json` (same number, never lower): patch for fixes only, minor for
new features or behavior changes, major only when the maintainer asks. See
"Versioning" in CONTRIBUTING.md for the commands and the release tag.

## Documentation and screenshots

Every change updates, in the same pull request, the documentation and the screenshots it touches:
README.md and the pages in `docs/` (CONFIGURATION for settings, with `.env.example` and the compose
file; API for endpoints; USAGE for features and behavior; ARCHITECTURE and its SVG diagrams for
structure; TROUBLESHOOTING; CHANGELOG always). When the UI changes, take the screenshots again with
`node scripts/screenshots/run.mjs` (a new page or dialog gets its shot in
`scripts/screenshots/shots.mjs`), look at them, and commit the PNGs. Diagrams are SVG, never ASCII
art. Every name in docs, screenshots and demo data is made up: no real films, torrents, release
groups or trackers. See "Documentation and screenshots" in CONTRIBUTING.md.
