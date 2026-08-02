import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { formatBytes, formatMs, formatPct } from '../format.js';
import { getLargestRoutes } from '../parser/analysis.js';
import { getBuildStats, listBuildStats } from '../store.js';

export function registerGetLargestRoutes(server: McpServer): void {
  server.registerTool(
    'get_largest_routes',
    {
      title: 'Get Largest Routes',
      description:
        'Rank the heaviest user-facing routes in a loaded Next.js build by emitted chunk bytes.',
      inputSchema: {
        buildId: z
          .string()
          .optional()
          .describe('Build ID returned from load_build_stats. Omit to list loaded builds.'),
        limit: z
          .number()
          .int()
          .positive()
          .max(25)
          .optional()
          .describe('How many routes to include. Defaults to 10.'),
      },
    },
    async ({ buildId, limit }) => {
      if (!buildId) {
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                {
                  builds: listBuildStats().map((build) => ({
                    ...build,
                    totalChunkBytesText: formatBytes(build.totalChunkBytes),
                    buildTimeText: formatMs(build.buildTimeMs),
                  })),
                },
                null,
                2,
              ),
            },
          ],
        };
      }

      const build = getBuildStats(buildId);
      if (!build) {
        throw new Error(
          `Build "${buildId}" not found. Call get_largest_routes without a buildId to list all loaded builds.`,
        );
      }

      const routes = getLargestRoutes(build, limit ?? 10);
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(
              {
                buildId: build.id,
                routes: routes.map((route) => ({
                  ...route,
                  totalBytesText: formatBytes(route.totalBytes),
                  initialLoadBytesText: formatBytes(route.initialLoadBytes),
                  sharedChunkBytesText: formatBytes(route.sharedChunkBytes),
                  exclusiveChunkBytesText: formatBytes(route.exclusiveChunkBytes),
                  sharedRatioText: formatPct(route.sharedRatio),
                })),
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  );
}
