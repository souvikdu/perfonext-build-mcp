# Changelog

All notable changes to `@perfonext/build-mcp` are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Changed

- Publish workflow migrated to npm trusted publishing (OIDC) with `npm publish --provenance`, removing the `NPM_TOKEN` secret. npm is upgraded to latest before publishing to support OIDC authentication.

## [0.4.2] - 2026-08-02

### Added

- ESLint 9 flat config and Prettier tooling, with `lint`, `lint:fix`, `format`, and `format:check` npm scripts.
- Lint and format checks wired into the pull-request CI workflow.
- Pull request, release, bug report, and feature request templates, plus Dependabot config and release-note categories.
- `.nvmrc` pinning the Node version for contributors.

### Changed

- README rewritten: installation, quick start, VS Code MCP setup, tool reference, and troubleshooting.
- Source and test files reformatted with Prettier (no functional changes).
- Build script now runs `shx chmod +x dist/index.js` so `npm run build` works on Windows as well as Unix.

### Fixed

- Removed unused imports and other ESLint-reported issues in parsers and tools.
- Added missing trailing newlines to workflow files.

## [0.4.1] - 2026-06-30

### Fixed

- `suggest_optimizations` code-split advice is now aware of Next.js framework routes (`/404`, `/500`, `/_error`, `/_app`, `/_document`) — these are now flagged to trim heavy/global imports rather than split with `next/dynamic`, which doesn't apply to error pages or the app shell. No API or schema changes.

## [0.4.0] - 2026-06-29

### Added

- `find_duplicates` tool — ranks npm packages bundled into more than one chunk by wasted bytes.
- `explain_shared_chunks` tool — shows which packages and app code dominate widely-shared chunks.
- `suggest_optimizations` tool (capstone) — severity-ranked, evidence-backed recommendations: `code-split-route`, `audit-shared-baseline`, `dedupe-package`, `move-out-of-shared-chunk`, `optimize-package-imports`. Runs on manifests alone, enriched when webpack stats are loaded.

### Changed

- Shared-baseline audit now uses median per-route shared bytes for a bounded, honest ratio.
- Barrel detection excludes infrastructure/large non-barrel packages, caps the import-optimization list, and avoids double-listing packages already flagged for move-out.
- `load_webpack_stats` now points directly to `suggest_optimizations`.

### Fixed

- Leading-slash-tolerant chunk-file joins in shared-chunk and package-cost attribution.
- `find_duplicates` now counts distinct chunks rather than emitted files.

## [0.3.0] - 2026-06-28

### Added

- `how_to_collect_stats` tool — manual recipe or automatic action plan for generating `.next/stats.json` (gated behind `ANALYZE=true`; normal builds unaffected).
- `load_webpack_stats` tool — parses `.next/stats.json` and attaches it to a loaded build by `buildId`.
- `trace_import` tool — walks a module's import chain back to the entry point.

### Notes

- Existing manifest tools remain unchanged and need zero setup; the stats file is only required for `trace_import`.
- Turbopack builds have no webpack module graph — `how_to_collect_stats` reports this and points to manifest-only tools.

## [0.2.0] - 2026-06-25

### Added

- `explain_growth` tool — explains which routes/chunks are responsible for bundle growth between two loaded builds, with severity-ranked findings, top growing chunks, evidence-backed fix suggestions, and a `nextStep` breadcrumb.

### Changed

- Cross-build chunk matching in `compare_builds` and `explain_growth` now normalizes Next.js content-hashed filenames, so rehashed-but-unchanged chunks are matched instead of reported as removed-and-recreated.

## [0.1.0] - 2026-06-01

### Added

- Initial release of `@perfonext/build-mcp` — Next.js build artifact analysis for GitHub Copilot and MCP clients.
- `load_build_stats` — parses a `.next` directory and loads route/chunk footprint data (build-manifest.json, prerender-manifest.json, app-build-manifest.json).
- `get_largest_routes` — ranks routes by total emitted chunk bytes, with exclusive vs. shared split, shared ratio, chunk count, route type, and `prerenderBlockedReason`.
- `get_shared_chunks` — ranks shared chunks by size and shows dependent routes.
- `compare_builds` — compares two build snapshots for route/chunk growth and shrinkage, plus shared chunk bytes and build duration deltas.

### Known Limitations

- Chunk names are hashed; module-level contents require webpack stats or source maps (addressed in later versions).
- `prerenderBlockedReason` is heuristic-based from manifest data.
- `buildTimeMs` is `null` unless a captured build output text file is provided.
