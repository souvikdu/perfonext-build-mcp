import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { formatBytes, formatPct } from '../format.js';
import { explainSharedChunks } from '../parser/webpack-stats.js';
import { getBuildStats } from '../store.js';
import { resolveWebpackStats, statsTextResult } from './webpack-shared.js';

export function registerExplainSharedChunks(server: McpServer): void {
  server.registerTool(
    'explain_shared_chunks',
    {
      title: 'Explain Shared Chunks',
      description:
        'Show which npm packages and app code dominate the shared chunks loaded by many routes, to identify ' +
        'what bloats common bundles. Package sizes are unminified webpack module sizes, not emitted chunk ' +
        'sizes. Requires load_build_stats and load_webpack_stats first.',
      inputSchema: {
        buildId: z.string().describe('Build ID returned by load_build_stats'),
        limit: z
          .number()
          .int()
          .positive()
          .max(20)
          .optional()
          .describe('Maximum shared chunks to analyse. Defaults to 5.'),
      },
    },
    async ({ buildId, limit }) => {
      const build = getBuildStats(buildId);
      if (!build) {
        throw new Error(`Build "${buildId}" not found. Call load_build_stats first.`);
      }

      const resolved = resolveWebpackStats(buildId);
      if ('breadcrumb' in resolved) {
        return statsTextResult(resolved.breadcrumb);
      }

      const compositions = explainSharedChunks(build, resolved.stats, limit ?? 5);
      return statsTextResult({
        buildId,
        sharedChunkCount: compositions.length,
        sharedChunks: compositions.map((chunk) => ({
          chunkPath: chunk.chunkPath,
          emittedSizeBytes: chunk.emittedSizeBytes,
          emittedSizeBytesText: formatBytes(chunk.emittedSizeBytes),
          routeCount: chunk.routeCount,
          sharedByRoutes: chunk.sharedByRoutes,
          topPackages: chunk.topPackages.map((pkg) => ({
            packageName: pkg.packageName,
            moduleSizeBytes: pkg.moduleSizeBytes,
            moduleSizeBytesText: formatBytes(pkg.moduleSizeBytes),
            shareOfChunk: pkg.shareOfChunk,
            shareOfChunkText: formatPct(pkg.shareOfChunk),
          })),
        })),
      });
    },
  );
}
