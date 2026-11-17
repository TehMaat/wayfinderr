# Wayfinderr

## Proposals become issues

When the maintainer proposes something ("there's this thing…": a feature, a change, a problem, an
idea), do not write code:

1. analyze the proposal against the code and the docs: what it touches, how it could be done,
   risks, open questions;
2. open a GitHub issue with the analysis: clear title, context, proposal, what changes (code,
   docs, screenshots), acceptance criteria, open questions;
3. give the maintainer the link to the issue and **stop**: go ahead only when the maintainer says
   so.

The pull request that implements the issue closes it with `Closes #N`.

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
