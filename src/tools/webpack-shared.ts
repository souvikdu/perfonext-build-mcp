import { formatBytes } from '../format.js';
import { getWebpackStats } from '../store.js';
import type { ParsedWebpackStats } from '../parser/types.js';

/**
 * Resolve loaded webpack stats for a build, or a machine-readable breadcrumb when they are absent.
 * The attribution tools degrade gracefully: a missing stats file is guidance, not an error.
 */
export function resolveWebpackStats(
  buildId: string,
): { stats: ParsedWebpackStats } | { breadcrumb: Record<string, unknown> } {
  const stats = getWebpackStats(buildId);
  if (stats) {
    return { stats };
  }

  return {
    breadcrumb: {
      buildId,
      webpackStatsLoaded: false,
      message:
        'Webpack module stats are not loaded for this build, so import-level attribution is unavailable.',
      nextStep:
        'Generate .next/stats.json via how_to_collect_stats, then call load_webpack_stats with this buildId. ' +
        'The manifest-based tools (get_largest_routes, get_shared_chunks, compare_builds, explain_growth) work without it.',
    },
  };
}

export function statsTextResult(payload: Record<string, unknown>) {
  return {
    content: [{
      type: 'text' as const,
      text: JSON.stringify(payload, null, 2),
    }],
  };
}

export function withBytesText(bytes: number): { sizeBytes: number; sizeBytesText: string } {
  return { sizeBytes: bytes, sizeBytesText: formatBytes(bytes) };
}
