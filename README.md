# perfonext-build-mcp

[![npm](https://img.shields.io/npm/v/@perfonext/build-mcp)](https://www.npmjs.com/package/@perfonext/build-mcp)

`perfonext-build-mcp` is an MCP server for loading and analyzing Next.js build artifacts. It gives GitHub Copilot and other MCP clients structured bundle and route-size data they can reason over instead of forcing the model to inspect raw `.next` manifests.

## What It Does

- loads Next.js build artifacts from a `.next` directory
- ranks the largest user-facing routes by emitted bundle footprint
- identifies the heaviest shared chunks that affect multiple routes
- keeps loaded build snapshots in memory so an MCP client can inspect them without re-reading the same build

## Inputs

The MVP reads build artifacts developers already have after running `next build`:

- `.next/build-manifest.json`
- `.next/prerender-manifest.json` when present
- `.next/app-build-manifest.json` when present
- optional captured `next build` output text to derive build duration

## Tools

| Tool | Description |
|------|-------------|
| `load_build_stats` | Parse a Next.js `.next` directory and load the build snapshot into memory |
| `get_largest_routes` | Rank the heaviest user-facing routes by total emitted chunk bytes |
| `get_shared_chunks` | Rank shared chunks by size and show which routes depend on them |
| `compare_builds` | Compare a baseline and current build snapshot to show which routes and chunks grew or shrank |

The output stays machine-readable and includes raw byte counts so Copilot can explain regressions, prioritise fixes, and suggest concrete dependency or import-level follow-up.

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

## Development

```bash
npm install
npm run build
npm test
```

Sample fixtures for local validation live under `tests/fixtures/`.

## License

MIT