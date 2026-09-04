import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { formatBytes, formatMs } from '../format.js';
import { getBuildSummary } from '../parser/analysis.js';
import { parseBuildStats } from '../parser/build-stats.js';
import { storeBuildStats } from '../store.js';

const INSPECTED_MANIFESTS = [
  'build-manifest.json',
  'app-build-manifest.json',
  'app-path-routes-manifest.json',
  'prerender-manifest.json',
] as const;

export function buildEmptyManifestWarning(
  summary: { routeCount: number; chunkCount: number },
  missingChunkCount: number,
): string | undefined {
  const parts: string[] = [];

  if (summary.routeCount === 0 || summary.chunkCount === 0) {
    parts.push(
      `Readable manifests were found but the route/chunk map is empty (routeCount: ${summary.routeCount}, chunkCount: ${summary.chunkCount}). ` +
        'Pass the project .next directory, not .next/standalone. ' +
        `Inspected manifests: ${INSPECTED_MANIFESTS.join(', ')}. ` +
        'suggest_optimizations and get_shared_chunks will be empty until a project .next directory with populated manifests is loaded.',
    );
  }

  if (missingChunkCount > 0) {
    parts.push(
      `${missingChunkCount} chunk file(s) referenced by the build manifest were missing or unreadable on disk (recorded as 0 bytes).`,
    );
  }

  return parts.length > 0 ? parts.join(' ') : undefined;
}

export function registerLoadBuildStats(server: McpServer): void {
  server.registerTool(
    'load_build_stats',
    {
      title: 'Load Build Stats',
      description:
        'Parse a Next.js .next directory and load route and chunk footprint data for later analysis.',
      inputSchema: {
        buildDir: z
          .string()
          .describe(
            'Absolute or relative path to the project .next build directory, not .next/standalone',
          ),
        buildOutputPath: z
          .string()
          .optional()
          .describe(
            'Optional path to captured next build terminal output for deriving build duration',
          ),
      },
    },
    async ({ buildDir, buildOutputPath }) => {
      const build = await parseBuildStats(buildDir, buildOutputPath);
      storeBuildStats(build);

      const summary = getBuildSummary(build);
      const missingChunkCount = build.missingChunkFiles?.length ?? 0;
      const warning = buildEmptyManifestWarning(summary, missingChunkCount);

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(
              {
                ...summary,
                totalChunkBytesText: formatBytes(summary.totalChunkBytes),
                sharedChunkBytesText: formatBytes(summary.sharedChunkBytes),
                buildTimeText: formatMs(summary.buildTimeMs),
                missingChunkFiles: build.missingChunkFiles,
                ...(warning ? { warning } : {}),
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
