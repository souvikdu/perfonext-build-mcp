import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { formatBytes } from '../format.js';
import { traceImport } from '../parser/webpack-stats.js';
import { getBuildStats } from '../store.js';
import { resolveWebpackStats, statsTextResult } from './webpack-shared.js';

export function registerTraceImport(server: McpServer): void {
  server.registerTool(
    'trace_import',
    {
      title: 'Trace Import',
      description:
        'Explain why a module is bundled by tracing its import chain from an entry point to the module. ' +
        'moduleSizeBytes is the unminified webpack module size, not emitted chunk size. ' +
        'Requires load_webpack_stats first.',
      inputSchema: {
        buildId: z.string().describe('Build ID returned by load_build_stats'),
        moduleName: z
          .string()
          .describe(
            'Module or package name to search for (case-insensitive substring), e.g. "lodash"',
          ),
        limit: z
          .number()
          .int()
          .positive()
          .max(25)
          .optional()
          .describe('Maximum matching modules to trace. Defaults to 10.'),
      },
    },
    async ({ buildId, moduleName, limit }) => {
      const build = getBuildStats(buildId);
      if (!build) {
        throw new Error(`Build "${buildId}" not found. Call load_build_stats first.`);
      }

      const resolved = resolveWebpackStats(buildId);
      if ('breadcrumb' in resolved) {
        return statsTextResult(resolved.breadcrumb);
      }

      const result = traceImport(resolved.stats, moduleName, limit ?? 10);
      return statsTextResult({
        buildId,
        query: result.query,
        matchCount: result.matchCount,
        traces: result.traces.map((trace) => ({
          moduleName: trace.moduleName,
          packageName: trace.packageName,
          moduleSizeBytes: trace.moduleSizeBytes,
          moduleSizeBytesText: formatBytes(trace.moduleSizeBytes),
          chunkFiles: trace.chunkFiles,
          importChain: trace.importChain,
        })),
      });
    },
  );
}
