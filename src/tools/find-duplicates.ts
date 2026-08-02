import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { formatBytes } from '../format.js';
import { findDuplicates } from '../parser/webpack-stats.js';
import { getBuildStats } from '../store.js';
import { resolveWebpackStats, statsTextResult } from './webpack-shared.js';

export function registerFindDuplicates(server: McpServer): void {
  server.registerTool(
    'find_duplicates',
    {
      title: 'Find Duplicate Packages',
      description:
        'Find npm packages whose code is bundled into more than one chunk, wasting bytes, ranked by wasted ' +
        'bytes. Requires load_webpack_stats first.',
      inputSchema: {
        buildId: z.string().describe('Build ID returned by load_build_stats'),
        limit: z
          .number()
          .int()
          .positive()
          .max(50)
          .optional()
          .describe('Maximum duplicate packages to return. Defaults to 20.'),
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

      const duplicates = findDuplicates(resolved.stats, limit ?? 20);
      return statsTextResult({
        buildId,
        duplicateCount: duplicates.length,
        duplicates: duplicates.map((entry) => ({
          packageName: entry.packageName,
          wastedBytes: entry.wastedBytes,
          wastedBytesText: formatBytes(entry.wastedBytes),
          totalBytes: entry.totalBytes,
          totalBytesText: formatBytes(entry.totalBytes),
          chunkCount: entry.chunkCount,
          chunkFiles: entry.chunkFiles,
        })),
        nextStep:
          duplicates.length > 0
            ? 'Dedupe with `npm dedupe`, align versions, or move the package into a single shared chunk.'
            : 'No duplicated packages detected across chunks.',
      });
    },
  );
}
