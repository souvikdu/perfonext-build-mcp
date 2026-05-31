import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { formatBytes, formatMs, formatPct } from '../format.js';
import { getSharedChunks } from '../parser/analysis.js';
import { getBuildStats, listBuildStats } from '../store.js';

export function registerGetSharedChunks(server: McpServer): void {
  server.registerTool('get_shared_chunks', {
    title: 'Get Shared Chunks',
    description: 'Rank the heaviest shared chunks in a loaded Next.js build and show which routes depend on them.',
    inputSchema: {
      buildId: z.string().optional().describe('Build ID returned from load_build_stats. Omit to list loaded builds.'),
      limit: z.number().int().positive().max(25).optional().describe('How many shared chunks to include. Defaults to 10.'),
    },
  }, async ({ buildId, limit }) => {
    if (!buildId) {
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            builds: listBuildStats().map(build => ({
              ...build,
              totalChunkBytesText: formatBytes(build.totalChunkBytes),
              buildTimeText: formatMs(build.buildTimeMs),
            })),
          }, null, 2),
        }],
      };
    }

    const build = getBuildStats(buildId);
    if (!build) {
      throw new Error(`Build "${buildId}" not found. Call get_shared_chunks without a buildId to list all loaded builds.`);
    }

    const chunks = getSharedChunks(build, limit ?? 10);
    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify({
          buildId: build.id,
          chunks: chunks.map(chunk => ({
            ...chunk,
            sizeBytesText: formatBytes(chunk.sizeBytes),
            shareOfAllChunkBytesText: formatPct(chunk.shareOfAllChunkBytes),
          })),
        }, null, 2),
      }],
    };
  });
}