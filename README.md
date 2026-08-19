# perfonext-build-mcp

> Analyze Next.js build artifacts to find heavy routes, shared chunks, and bundle growth.

[![npm](https://img.shields.io/npm/v/@perfonext/build-mcp)](https://www.npmjs.com/package/@perfonext/build-mcp)
[![npm downloads](https://img.shields.io/npm/dt/@perfonext/build-mcp)](https://www.npmjs.com/package/@perfonext/build-mcp)
[![license](https://img.shields.io/npm/l/@perfonext/build-mcp)](https://www.npmjs.com/package/@perfonext/build-mcp)

`perfonext-build-mcp` is a Model Context Protocol (MCP) server that gives GitHub Copilot, Claude Desktop,
Claude Code, and other MCP clients structured bundle analysis for Next.js performance work. It loads `.next`
build artifacts and turns them into route-size rankings, shared-chunk and duplication findings, and
severity-ranked fix suggestions — evidence agents can reason over instead of inspecting raw `.next` manifests.

## Quick Start

Run directly with `npx`:

```bash
npx -y @perfonext/build-mcp
```

Or install globally:

```bash
npm install -g @perfonext/build-mcp
```

The executable command remains `perfonext-build-mcp` after installation.

Add the server to VS Code in `.vscode/mcp.json` (the workspace MCP configuration file):

```json
{
  "servers": {
    "perfonext-build": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@perfonext/build-mcp"]
    }
  }
}
```

Then reload the VS Code window and run **MCP: List Servers** to start it, or accept the trust prompt when it appears. For a locally-built checkout, point `command`/`args` at `node` and the repo's `dist/index.js` instead.

Then ask Copilot: _"Load the Next.js build in `./.next` and show me the largest routes."_

## What It Does

- loads Next.js build artifacts from a `.next` directory
- ranks the largest user-facing routes by emitted bundle footprint
- identifies the heaviest shared chunks that affect multiple routes
- compares two builds and explains which routes and chunks drove bundle growth, with
  severity-ranked, evidence-backed fix suggestions
- matches chunks across builds even though Next.js fingerprints filenames with content hashes
- traces why a given module or npm package is bundled (import chain entry → module) when an
  optional webpack stats file is collected
- finds npm packages duplicated across chunks and explains what dominates shared chunks
- aggregates all of the above into severity-ranked, evidence-backed optimization suggestions tied to
  concrete Next.js actions
- keeps loaded build snapshots in memory so an MCP client can inspect them without re-reading the same build

## Tools

| Tool                    | Description                                                                                                        |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `load_build_stats`      | Parse a Next.js `.next` directory and load the build snapshot into memory                                          |
| `get_largest_routes`    | Rank the heaviest user-facing routes by total emitted chunk bytes                                                  |
| `get_shared_chunks`     | Rank shared chunks by size and show which routes depend on them                                                    |
| `compare_builds`        | Compare a baseline and current build snapshot to show which routes and chunks grew or shrank                       |
| `explain_growth`        | Severity-rank which routes and chunks drove bundle growth between two builds, with evidence-backed fix suggestions |
| `how_to_collect_stats`  | Return the recipe (manual) or an action plan (automatic) to generate `.next/stats.json`                            |
| `load_webpack_stats`    | Parse `.next/stats.json` and link it to a loaded build; required before `trace_import`                             |
| `trace_import`          | Explain why a module or npm package is bundled by walking its import chain to the entry                            |
| `find_duplicates`       | Rank npm packages whose code is emitted into more than one chunk, by wasted bytes                                  |
| `explain_shared_chunks` | Show which packages and app code dominate the shared chunks loaded by many routes                                  |
| `suggest_optimizations` | Aggregate route, chunk, and webpack-stats evidence into severity-ranked, evidence-backed fix suggestions           |

The output stays machine-readable and includes raw byte counts so Copilot can explain regressions, prioritise fixes, and suggest concrete dependency or import-level follow-up.

Because Next.js content-hashes emitted filenames (`framework-<hash>.js`, and CSS files named purely by hash), `compare_builds` and `explain_growth` match chunks across builds by a hash-normalized identity. This prevents a rehashed-but-unchanged chunk from being misreported as removed-and-recreated, while still flagging genuinely new chunks.

## Inputs

The core tools read build artifacts developers already have after running `next build`:

- `.next/build-manifest.json`
- `.next/prerender-manifest.json` when present
- `.next/app-build-manifest.json` when present
- optional captured `next build` output text to derive build duration

Import-level attribution (`trace_import`, `find_duplicates`, `explain_shared_chunks`) and the
stats-enriched suggestions from `suggest_optimizations` additionally need a webpack module-stats file
at `.next/stats.json`. A stock `next build` does not emit one; `how_to_collect_stats` returns the
recipe to generate it. The manifest tools above never read it, so they work with or without it.

### Deep bundle attribution (optional)

The manifest tools work with zero setup. To answer "why is this package bundled?", collect a webpack
stats file first:

1. Call `how_to_collect_stats({ method: 'manual' | 'automatic' })` and apply the returned steps — it
   adds `webpack-stats-plugin`, gates a `next.config` hook behind `ANALYZE=true && !isServer`, and rebuilds.
2. Call `load_build_stats({ buildDir })` to get a `buildId`.
3. Call `load_webpack_stats({ buildId })` to parse the generated `.next/stats.json`.
4. Call `trace_import({ buildId, moduleName })` to see the import chain that pulls a module in.
5. Call `find_duplicates({ buildId })` to find packages bundled into more than one chunk, and
   `explain_shared_chunks({ buildId })` to see what dominates the chunks loaded by many routes.
6. Call `suggest_optimizations({ buildId })` for severity-ranked, evidence-backed recommendations.
   It works on manifests alone and is enriched with dedupe, shared-chunk, and package-import
   findings once stats are loaded. Code-split advice is tailored for Next.js framework routes
   (`/404`, `/500`, `/_error`, `/_app`, `/_document`) — these are flagged to be slimmed down by
   trimming imports rather than split with `next/dynamic`, which does not apply to them.

If the app builds with Turbopack there is no webpack module graph, so `how_to_collect_stats` says so
and points back to the manifest-only tools. The attribution tools degrade gracefully with a
breadcrumb when no stats file is loaded — it is never an error.

## Example Copilot Prompts

- "Load the Next.js build in `./.next` and show me the largest routes."
- "Which shared chunks are affecting the most routes in this build?"
- "Summarize the build footprint and tell me which routes ship the most JavaScript."
- "Compare my baseline and current `.next` builds and show me which routes or shared chunks grew the most."
- "Explain what grew between my baseline and current `.next` builds and what I should fix first."
- "Set up webpack stats collection so I can see why a package is bundled."
- "Why is `axios` in my bundle? Trace its import chain."
- "Which npm packages are duplicated across chunks and how many bytes are wasted?"
- "What's dominating my shared chunks?"
- "Suggest the highest-impact bundle optimizations for this build."

## Related Perfonext Tools

- [perfonext-profiler-mcp](https://github.com/souvikdu/perfonext-profiler-mcp) — CPU profiling (V8/Chrome) for Next.js servers
- [perfonext-render-mcp](https://github.com/souvikdu/perfonext-render-mcp) — React render analysis for Next.js apps

## Development

```bash
npm install
npm run build
npm test
```

Sample fixtures for local validation live under `tests/fixtures/`.

## License

MIT
