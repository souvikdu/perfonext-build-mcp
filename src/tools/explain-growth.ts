import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { formatBytes, formatPct } from '../format.js';
import { explainGrowth as explainBuildGrowth } from '../parser/analysis.js';
import { getBuildStats, listBuildStats } from '../store.js';

function formatNullableRatio(value: number | null): string | null {
  return value === null ? null : formatPct(value);
}

export function registerExplainGrowth(server: McpServer): void {
  server.registerTool('explain_growth', {
    title: 'Explain Growth',
    description:
      'Identify which routes and chunks are responsible for bundle size growth between two loaded builds. ' +
      'Returns severity-ranked route findings, the top growing chunks, and an overall regression summary.',
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
        .describe('Max route findings and top growing chunks to return. Defaults to 10.'),
    },
  }, async ({ baselineBuildId, currentBuildId, limit }) => {
    if (!baselineBuildId || !currentBuildId) {
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            builds: listBuildStats().map(build => ({
              id: build.id,
              buildDir: build.buildDir,
              routeCount: build.routeCount,
              totalChunkBytes: build.totalChunkBytes,
              totalChunkBytesText: formatBytes(build.totalChunkBytes),
            })),
          }, null, 2),
        }],
      };
    }

    const baseline = getBuildStats(baselineBuildId);
    if (!baseline) {
      throw new Error(`Build "${baselineBuildId}" not found. Call explain_growth without IDs to list loaded builds.`);
    }

    const current = getBuildStats(currentBuildId);
    if (!current) {
      throw new Error(`Build "${currentBuildId}" not found. Call explain_growth without IDs to list loaded builds.`);
    }

    const explanation = explainBuildGrowth(baseline, current, limit ?? 10);

    const hasGrowth =
      explanation.routeFindings.length > 0 || explanation.topGrowingChunks.length > 0;
    const nextStep = hasGrowth
      ? `Inspect the largest contributors with get_shared_chunks and get_largest_routes on build '${current.id}', then apply the recommended actions.`
      : `No bundle growth detected between '${baseline.id}' and '${current.id}'.`;

    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify({
          ...explanation,
          overall: {
            ...explanation.overall,
            totalDeltaBytesText: formatBytes(Math.abs(explanation.overall.totalDeltaBytes)),
            totalDeltaDirection: explanation.overall.totalDeltaBytes >= 0 ? 'growth' : 'shrink',
            totalDeltaRatioText: formatNullableRatio(explanation.overall.totalDeltaRatio),
          },
          routeFindings: explanation.routeFindings.map(finding => ({
            ...finding,
            deltaBytesText: formatBytes(finding.deltaBytes),
            deltaRatioText: formatNullableRatio(finding.deltaRatio),
            topContributingChunks: finding.topContributingChunks.map(chunk => ({
              ...chunk,
              deltaBytesText: formatBytes(chunk.deltaBytes),
              deltaRatioText: formatNullableRatio(chunk.deltaRatio),
            })),
          })),
          topGrowingChunks: explanation.topGrowingChunks.map(chunk => ({
            ...chunk,
            deltaBytesText: formatBytes(chunk.deltaBytes),
            deltaRatioText: formatNullableRatio(chunk.deltaRatio),
          })),
          suggestions: explanation.suggestions.map(suggestion => ({
            ...suggestion,
            deltaBytesText: formatBytes(suggestion.deltaBytes),
            deltaRatioText: formatNullableRatio(suggestion.deltaRatio),
          })),
          nextStep,
        }, null, 2),
      }],
    };
  });
}
