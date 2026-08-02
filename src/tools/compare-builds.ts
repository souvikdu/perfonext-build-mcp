import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { formatBytes, formatMs, formatPct } from '../format.js';
import { compareBuilds as compareLoadedBuilds } from '../parser/analysis.js';
import { getBuildStats, listBuildStats } from '../store.js';

function formatNullableRatio(value: number | null): string | null {
  return value === null ? null : formatPct(value);
}

export function registerCompareBuilds(server: McpServer): void {
  server.registerTool(
    'compare_builds',
    {
      title: 'Compare Builds',
      description:
        'Compare two loaded Next.js builds and show which routes and chunks grew or shrank the most.',
      inputSchema: {
        baselineBuildId: z
          .string()
          .optional()
          .describe('Baseline build ID from load_build_stats. Omit to list loaded builds.'),
        currentBuildId: z
          .string()
          .optional()
          .describe('Current build ID from load_build_stats. Omit to list loaded builds.'),
        limit: z
          .number()
          .int()
          .positive()
          .max(25)
          .optional()
          .describe('How many route and chunk deltas to include. Defaults to 10.'),
      },
    },
    async ({ baselineBuildId, currentBuildId, limit }) => {
      if (!baselineBuildId || !currentBuildId) {
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                {
                  builds: listBuildStats().map((build) => ({
                    id: build.id,
                    buildDir: build.buildDir,
                    routeCount: build.routeCount,
                    chunkCount: build.chunkCount,
                    totalChunkBytes: build.totalChunkBytes,
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

      const baseline = getBuildStats(baselineBuildId);
      if (!baseline) {
        throw new Error(
          `Build "${baselineBuildId}" not found. Call compare_builds without IDs to list loaded builds.`,
        );
      }

      const current = getBuildStats(currentBuildId);
      if (!current) {
        throw new Error(
          `Build "${currentBuildId}" not found. Call compare_builds without IDs to list loaded builds.`,
        );
      }

      const comparison = compareLoadedBuilds(baseline, current, limit ?? 10);
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(
              {
                ...comparison,
                baselineTotalChunkBytesText: formatBytes(comparison.baselineTotalChunkBytes),
                currentTotalChunkBytesText: formatBytes(comparison.currentTotalChunkBytes),
                totalChunkDeltaBytesText: formatBytes(Math.abs(comparison.totalChunkDeltaBytes)),
                totalChunkDeltaDirection:
                  comparison.totalChunkDeltaBytes >= 0 ? 'growth' : 'shrink',
                totalChunkDeltaRatioText: formatNullableRatio(comparison.totalChunkDeltaRatio),
                baselineSharedChunkBytesText: formatBytes(comparison.baselineSharedChunkBytes),
                currentSharedChunkBytesText: formatBytes(comparison.currentSharedChunkBytes),
                sharedChunkDeltaBytesText: formatBytes(Math.abs(comparison.sharedChunkDeltaBytes)),
                sharedChunkDeltaDirection:
                  comparison.sharedChunkDeltaBytes >= 0 ? 'growth' : 'shrink',
                sharedChunkDeltaRatioText: formatNullableRatio(comparison.sharedChunkDeltaRatio),
                baselineBuildTimeText: formatMs(comparison.baselineBuildTimeMs),
                currentBuildTimeText: formatMs(comparison.currentBuildTimeMs),
                buildTimeDeltaText:
                  comparison.buildTimeDeltaMs === null
                    ? null
                    : formatMs(Math.abs(comparison.buildTimeDeltaMs)),
                buildTimeDeltaDirection:
                  comparison.buildTimeDeltaMs === null
                    ? null
                    : comparison.buildTimeDeltaMs >= 0
                      ? 'slower'
                      : 'faster',
                buildTimeDeltaRatioText: formatNullableRatio(comparison.buildTimeDeltaRatio),
                routeDeltas: comparison.routeDeltas.map((route) => ({
                  ...route,
                  baselineBytesText: formatBytes(route.baselineBytes),
                  currentBytesText: formatBytes(route.currentBytes),
                  deltaBytesText: formatBytes(Math.abs(route.deltaBytes)),
                  deltaDirection: route.deltaBytes >= 0 ? 'growth' : 'shrink',
                  deltaRatioText: formatNullableRatio(route.deltaRatio),
                })),
                chunkDeltas: comparison.chunkDeltas.map((chunk) => ({
                  ...chunk,
                  baselineBytesText: formatBytes(chunk.baselineBytes),
                  currentBytesText: formatBytes(chunk.currentBytes),
                  deltaBytesText: formatBytes(Math.abs(chunk.deltaBytes)),
                  deltaDirection: chunk.deltaBytes >= 0 ? 'growth' : 'shrink',
                  deltaRatioText: formatNullableRatio(chunk.deltaRatio),
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
