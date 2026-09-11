# Changelog

All notable changes to `@perfonext/build-mcp` are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.6.3] - 2026-09-11

### Changed

- **Point the npm homepage at the perfonext site**: `package.json`
  `homepage` is now `https://perfonext.github.io/`, so the npm
  listing links the docs site instead of the repo readme, and the
  README badge row gains a website badge.

## [0.6.2] - 2026-09-05

### Added

- Add `mcpName` property (`io.github.souvikdu/perfonext-build-mcp`) to `package.json` for MCP Registry package ownership verification.
- Add MCP Registry `server.json` metadata manifest.
- Automate MCP Registry publication via GitHub Actions OIDC (`mcp-publisher login github-oidc`) upon release tag pushes.

### Fixed

- Remove extraneous self-referential dependency (`@perfonext/build-mcp: file:`) from `package.json`.

## [0.6.1] - 2026-09-03

### Fixed

- `how_to_collect_stats` now installs `cross-env` alongside `webpack-stats-plugin` and runs `cross-env ANALYZE=true next build --webpack`, so the recipe works on Windows and does not silently produce a Turbopack build with no `.next/stats.json`.
- The default webpack recipe states that it requires webpack and that Turbopack builds will not produce `.next/stats.json`.
- Turbopack guidance now lists `suggest_optimizations` among the manifest-only tools.
- `load_build_stats` warns when manifests are readable but `routeCount` or `chunkCount` is 0, names the inspected manifests, and tells the agent to pass the project `.next` directory rather than `.next/standalone`.

## [0.6.0] - 2026-08-30

### Changed

- **BREAKING: `get_largest_routes` no longer reports `initialLoadBytes`.** It was a verbatim copy of `totalBytes` under a name that implied a different, gzipped measurement, so the two fields looked like corroborating evidence when only one number existed. A `unitsNote` now states that byte counts are raw uncompressed chunk bytes, which are larger than and not comparable to the gzipped "First Load JS" column in `next build` output.
- **Byte deltas now carry their sign.** `compare_builds` and `explain_growth` previously formatted deltas through `Math.abs`, so a 2 KB shrink and a 2 KB growth both rendered as `2.0 KB` and were distinguishable only by a separate direction field. Delta text is now `+2.0 KB` or `-2.0 KB`.

### Added

- `compare_builds` and `explain_growth` now explain that routes share chunks, so per-route deltas overlap and deliberately do not sum to the reported total. `explain_growth` points readers at `topGrowingChunks` for a non-overlapping breakdown.

## [0.5.0] - 2026-08-29

### Changed

- **Breaking:** `suggest_optimizations` renames `bytes`/`bytesText` to `emittedBytes`/`emittedBytesText`. Every suggestion is now sized in emitted on-disk bytes, so `dedupe-package`, `move-out-of-shared-chunk`, and `optimize-package-imports` are no longer ranked against route suggestions on a different (unminified webpack module) scale.
- **Breaking:** `explain_shared_chunks` renames `shareOfChunk`/`shareOfChunkText` to `shareOfChunkModuleBytes`/`shareOfChunkModuleBytesText` — the value has always been a share of the chunk's module bytes, not of its emitted size — and adds `emittedBytes`/`emittedBytesText` per package.
- `RouteType` gains `ssg` and `PrerenderBlockedReason` gains `dynamic-rendering`, so App Router routes are no longer described with Pages Router vocabulary.

### Fixed

- Route `type`, `isPrerendered`, and `prerenderBlockedReason` are now derived from `app-path-routes-manifest.json`, which maps build-manifest keys (`/gallery/page`) to the real paths (`/gallery`) that `prerender-manifest.json` is keyed by. Previously the lookup could never match for App Router routes, so every one of them reported `isPrerendered: false` with a `server-side-props` reason that does not exist in the App Router. The three fields now come from a single classifier and cannot disagree.

## [0.4.7] - 2026-08-29

### Fixed

- `find_duplicates` now groups webpack module records by source-module name before testing for duplication. webpack emits one record per chunk for the same source file, so packages duplicated across chunks were previously invisible; package byte totals are also counted once per source module instead of once per record.

## [0.4.6] - 2026-08-29

### Fixed

- App Router layout-only chunks are now attributed to the routes that consume them without exposing the synthetic `/layout` manifest entry as a user-facing route.

## [0.4.5] - 2026-08-27

### Changed

- README setup instructions now cover VS Code, Claude Desktop, Claude Code, and other MCP-compatible clients, with macOS and nvm troubleshooting for missing `npx` or `node` paths.

## [0.4.4] - 2026-08-20

### Added

- `load_build_stats` tracks and surfaces missing or unreadable chunk files in `missingChunkFiles` alongside a descriptive warning if manifest chunk files cannot be read on disk.
- `load_webpack_stats` validates manifest chunk overlap against `stats.json` chunk files via `checkWebpackStatsOverlap`, warning if version skew is detected (< 50% chunk overlap).
- `store.ts` adds bounded FIFO eviction capped at 20 builds (`MAX_BUILDS = 20`) evicting both build and linked webpack stats, and exports `clearBuildStats()` for testing and cleanup.

## [0.4.3] - 2026-08-20

### Changed

- `explain_shared_chunks` and `trace_import` now name module vs emitted sizes explicitly (`moduleSizeBytes`, `emittedSizeBytes`) so unminified webpack sizes are not mistaken for on-disk chunk bytes.
- `how_to_collect_stats` now gates `StatsWriterPlugin` on `ANALYZE=true && !isServer` so client/server/edge compilations do not race the same `.next/stats.json`.

### Fixed

- `load_build_stats` no longer treats the synthetic App Router `/layout` key (from `app-build-manifest.json`) as a user-facing route, so `suggest_optimizations` cannot emit a false `code-split-route` for it. A genuine Pages Router page literally named `/layout` (from `build-manifest.json`) is unaffected.

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
