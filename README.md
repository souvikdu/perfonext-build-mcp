# perfonext-build-mcp

[![npm](https://img.shields.io/npm/v/@perfonext/build-mcp)](https://www.npmjs.com/package/@perfonext/build-mcp)

`perfonext-build-mcp` is an MCP server for loading and analyzing Next.js build artifacts. It gives GitHub Copilot and other MCP clients structured bundle and route-size data they can reason over instead of forcing the model to inspect raw `.next` manifests.

## What It Does

- loads Next.js build artifacts from a `.next` directory
- ranks the largest user-facing routes by emitted bundle footprint
- identifies the heaviest shared chunks that affect multiple routes
- compares two builds and explains which routes and chunks drove bundle growth, with
  severity-ranked, evidence-backed fix suggestions
- matches chunks across builds even though Next.js fingerprints filenames with content hashes
- traces why a given module or npm package is bundled (import chain entry → module) when an
  optional webpack stats file is collected
- keeps loaded build snapshots in memory so an MCP client can inspect them without re-reading the same build

## Inputs

The core tools read build artifacts developers already have after running `next build`:

- `.next/build-manifest.json`
- `.next/prerender-manifest.json` when present
- `.next/app-build-manifest.json` when present
- optional captured `next build` output text to derive build duration

Import-level attribution (`trace_import`) additionally needs a webpack module-stats file at
`.next/stats.json`. A stock `next build` does not emit one; `how_to_collect_stats` returns the recipe
to generate it. The manifest tools above never read it, so they work with or without it.

## Tools

| Tool | Description |
|------|-------------|
| `load_build_stats` | Parse a Next.js `.next` directory and load the build snapshot into memory |
| `get_largest_routes` | Rank the heaviest user-facing routes by total emitted chunk bytes |
| `get_shared_chunks` | Rank shared chunks by size and show which routes depend on them |
| `compare_builds` | Compare a baseline and current build snapshot to show which routes and chunks grew or shrank |
| `explain_growth` | Severity-rank which routes and chunks drove bundle growth between two builds, with evidence-backed fix suggestions |
| `how_to_collect_stats` | Return the recipe (manual) or an action plan (automatic) to generate `.next/stats.json` |
| `load_webpack_stats` | Parse `.next/stats.json` and link it to a loaded build; required before `trace_import` |
| `trace_import` | Explain why a module or npm package is bundled by walking its import chain to the entry |

The output stays machine-readable and includes raw byte counts so Copilot can explain regressions, prioritise fixes, and suggest concrete dependency or import-level follow-up.

Because Next.js content-hashes emitted filenames (`framework-<hash>.js`, and CSS files named purely by hash), `compare_builds` and `explain_growth` match chunks across builds by a hash-normalized identity. This prevents a rehashed-but-unchanged chunk from being misreported as removed-and-recreated, while still flagging genuinely new chunks.

### Deep bundle attribution (optional)

The manifest tools work with zero setup. To answer "why is this package bundled?", collect a webpack
stats file first:

1. Call `how_to_collect_stats({ method: 'manual' | 'automatic' })` and apply the returned steps — it
   adds `webpack-stats-plugin`, gates a `next.config` hook behind `ANALYZE=true`, and rebuilds.
2. Call `load_build_stats({ buildDir })` to get a `buildId`.
3. Call `load_webpack_stats({ buildId })` to parse the generated `.next/stats.json`.
4. Call `trace_import({ buildId, moduleName })` to see the import chain that pulls a module in.

If the app builds with Turbopack there is no webpack module graph, so `how_to_collect_stats` says so
and points back to the manifest-only tools. `trace_import` degrades gracefully with a breadcrumb when
no stats file is loaded — it is never an error.

## Install

Run directly with `npx`:

```bash
npx -y @perfonext/build-mcp
```

Or install globally:

```bash
npm install -g @perfonext/build-mcp
```

The executable command remains `perfonext-build-mcp` after installation.

## MCP Configuration

Add this server to VS Code settings:

```json
{
  "mcp": {
    "servers": {
      "perfonext-build": {
        "command": "npx",
        "args": ["-y", "@perfonext/build-mcp"]
      }
    }
  }
}
```

## Example Copilot Prompts

- "Load the Next.js build in `./.next` and show me the largest routes."
- "Which shared chunks are affecting the most routes in this build?"
- "Summarize the build footprint and tell me which routes ship the most JavaScript."
- "Compare my baseline and current `.next` builds and show me which routes or shared chunks grew the most."
- "Explain what grew between my baseline and current `.next` builds and what I should fix first."
- "Set up webpack stats collection so I can see why a package is bundled."
- "Why is `axios` in my bundle? Trace its import chain."

## Development

```bash
npm install
npm run build
npm test
```

Sample fixtures for local validation live under `tests/fixtures/`.

## License

MIT