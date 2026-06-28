import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { formatBytes } from '../format.js';
import { suggestOptimizations } from '../parser/analysis.js';
import { getBuildStats, getWebpackStats } from '../store.js';
import { statsTextResult } from './webpack-shared.js';

export function registerSuggestOptimizations(server: McpServer): void {
  server.registerTool('suggest_optimizations', {
    title: 'Suggest Optimizations',
    description:
      'Aggregate route, chunk, and (when loaded) webpack-stats evidence into severity-ranked, ' +
      'evidence-backed bundle optimizations tied to concrete Next.js actions. Works on manifests alone; ' +
      'load_webpack_stats first for dedupe, shared-chunk, and package-import suggestions.',
    inputSchema: {
      buildId: z.string().describe('Build ID returned by load_build_stats'),
      limit: z.number().int().positive().max(50).optional().describe('Maximum suggestions to return. Defaults to 15.'),
    },
  }, async ({ buildId, limit }) => {
    const build = getBuildStats(buildId);
    if (!build) {
      throw new Error(`Build "${buildId}" not found. Call load_build_stats first.`);
    }

    const stats = getWebpackStats(buildId) ?? null;
    const report = suggestOptimizations(build, stats, limit ?? 15);

    return statsTextResult({
      buildId,
      webpackStatsUsed: report.webpackStatsUsed,
      suggestionCount: report.suggestionCount,
      suggestions: report.suggestions.map(suggestion => ({
        kind: suggestion.kind,
        severity: suggestion.severity,
        title: suggestion.title,
        bytes: suggestion.bytes,
        bytesText: formatBytes(suggestion.bytes),
        evidence: suggestion.evidence,
        recommendedAction: suggestion.recommendedAction,
        packageName: suggestion.packageName,
        chunkPath: suggestion.chunkPath,
        routePath: suggestion.routePath,
      })),
      ...(report.note ? { note: report.note } : {}),
      nextStep: report.webpackStatsUsed
        ? 'Use trace_import on a flagged package to see its import chain, or find_duplicates / explain_shared_chunks for more detail.'
        : 'Run how_to_collect_stats then load_webpack_stats to unlock dedupe, shared-chunk, and package-import suggestions.',
    });
  });
}
