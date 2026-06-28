import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { parseWebpackStats } from '../parser/webpack-stats.js';
import { getBuildStats, storeWebpackStats } from '../store.js';
import { statsTextResult } from './webpack-shared.js';

export function registerLoadWebpackStats(server: McpServer): void {
  server.registerTool('load_webpack_stats', {
    title: 'Load Webpack Stats',
    description:
      'Parse the webpack module stats file (.next/stats.json) and link it to a build loaded with ' +
      'load_build_stats. Unlocks the stats-powered tools: suggest_optimizations (enriched), ' +
      'find_duplicates, explain_shared_chunks, and trace_import.',
    inputSchema: {
      buildId: z.string().describe('Build ID returned by load_build_stats; the stats.json is read from that build directory'),
    },
  }, async ({ buildId }) => {
    const build = getBuildStats(buildId);
    if (!build) {
      throw new Error(`Build "${buildId}" not found. Call load_build_stats first and pass the buildId it returns.`);
    }

    const stats = await parseWebpackStats(build.buildDir, buildId);
    if (!stats) {
      return statsTextResult({
        buildId,
        webpackStatsLoaded: false,
        message: `No stats.json found in ${build.buildDir}. A stock next build does not emit one.`,
        nextStep: 'Call how_to_collect_stats to generate .next/stats.json, then load_webpack_stats again.',
      });
    }

    storeWebpackStats(stats);
    const looksCollapsed = stats.parsedModuleCount === 0 || stats.chunks.length === 0;
    return statsTextResult({
      buildId,
      webpackStatsLoaded: true,
      statsPath: stats.statsPath,
      moduleCount: stats.moduleCount,
      parsedModuleCount: stats.parsedModuleCount,
      chunkCount: stats.chunks.length,
      ...(looksCollapsed
        ? {
            warning:
              'The stats file parsed but contains no usable modules/chunks. This usually means the stats ' +
              'config collapsed the module graph (webpack groups modules once `modulesSpace` is exceeded and ' +
              'omits chunk ids unless `ids: true`). Re-run how_to_collect_stats for the corrected config and rebuild.',
          }
        : {}),
      nextStep: looksCollapsed
        ? 'Call how_to_collect_stats again, apply the corrected stats config, rebuild, then load_webpack_stats.'
        : 'Now call suggest_optimizations for ranked, evidence-backed fixes (now enriched with this stats data). ' +
          'Drill in with find_duplicates, explain_shared_chunks, or trace_import on a specific package.',
    });
  });
}
