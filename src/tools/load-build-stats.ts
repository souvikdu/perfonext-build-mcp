import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { formatBytes, formatMs } from '../format.js';
import { getBuildSummary } from '../parser/analysis.js';
import { parseBuildStats } from '../parser/build-stats.js';
import { storeBuildStats } from '../store.js';

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
          .describe('Absolute or relative path to the Next.js .next build directory'),
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
                warning:
                  missingChunkCount > 0
                    ? `${missingChunkCount} chunk file(s) referenced by the build manifest were missing or unreadable on disk (recorded as 0 bytes).`
                    : undefined,
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
