import type {
  BuildComparison,
  ChunkDeltaEntry,
  ChunkGrowthContribution,
  GrowthExplanation,
  GrowthSeverity,
  GrowthSuggestion,
  ParsedBuildStats,
  RouteDeltaEntry,
  RouteGrowthFinding,
  RouteSummaryEntry,
  SharedChunkSummaryEntry,
} from './types.js';

function calculateDeltaRatio(baseline: number, current: number): number | null {
  if (baseline === 0) {
    return current === 0 ? 0 : null;
  }

  return (current - baseline) / baseline;
}

/**
 * Strip Next.js content-hash suffixes (`framework-<hash>.js` → `framework.js`) so the same
 * chunk matches across builds. Pure-hash basenames (e.g. CSS `4c7ae03ab6df2350.css`) have no
 * stable prefix and are left untouched — their hash is already a content-stable identity.
 */
export function normalizeChunkKey(chunkPath: string): string {
  const clean = chunkPath.replace(/^\//, '');
  const lastSlash = clean.lastIndexOf('/');
  const dir = lastSlash >= 0 ? clean.slice(0, lastSlash + 1) : '';
  const file = lastSlash >= 0 ? clean.slice(lastSlash + 1) : clean;

  const lastDot = file.lastIndexOf('.');
  const base = lastDot >= 0 ? file.slice(0, lastDot) : file;
  const ext = lastDot >= 0 ? file.slice(lastDot) : '';

  // Strip a trailing "-<contenthash>" segment. Pure-hash basenames have no dash and are left
  // as-is, preserving their content-stable identity.
  const normalizedBase = base.replace(/-[0-9a-f]{8,}$/i, '');

  return `${dir}${normalizedBase}${ext}`;
}

interface NormalizedChunk {
  displayPath: string;
  sizeBytes: number;
  routeCount: number;
  routeSet: Set<string>;
}

/**
 * Collapse a build's chunks into hash-normalized buckets so they can be matched across builds.
 * Distinct chunks that normalize to the same key are summed and their routes unioned.
 */
function aggregateChunksByKey(build: ParsedBuildStats): Map<string, NormalizedChunk> {
  const map = new Map<string, NormalizedChunk>();

  for (const chunk of build.chunks) {
    const key = normalizeChunkKey(chunk.chunkPath);
    const existing = map.get(key);
    if (existing) {
      existing.sizeBytes += chunk.sizeBytes;
      for (const route of chunk.sharedByRoutes) {
        existing.routeSet.add(route);
      }
    } else {
      map.set(key, {
        displayPath: chunk.chunkPath,
        sizeBytes: chunk.sizeBytes,
        routeCount: chunk.routeCount,
        routeSet: new Set(chunk.sharedByRoutes),
      });
    }
  }

  for (const entry of map.values()) {
    entry.routeCount = entry.routeSet.size;
  }

  return map;
}

export function getBuildSummary(build: ParsedBuildStats): {
  buildId: string;
  buildDir: string;
  routeCount: number;
  chunkCount: number;
  sharedChunkCount: number;
  totalChunkBytes: number;
  sharedChunkBytes: number;
  buildTimeMs: number | null;
} {
  return {
    buildId: build.id,
    buildDir: build.buildDir,
    routeCount: build.routes.length,
    chunkCount: build.chunks.length,
    sharedChunkCount: build.chunks.filter(chunk => chunk.isShared).length,
    totalChunkBytes: build.totalChunkBytes,
    sharedChunkBytes: build.sharedChunkBytes,
    buildTimeMs: build.buildTimeMs,
  };
}

export function getLargestRoutes(build: ParsedBuildStats, limit: number): RouteSummaryEntry[] {
  return build.routes.slice(0, limit).map(route => ({
    path: route.path,
    type: route.type,
    prerenderBlockedReason: route.prerenderBlockedReason,
    totalBytes: route.totalBytes,
    initialLoadBytes: route.initialLoadBytes,
    sharedChunkBytes: route.sharedChunkBytes,
    exclusiveChunkBytes: route.exclusiveChunkBytes,
    sharedRatio: route.totalBytes === 0 ? 0 : route.sharedChunkBytes / route.totalBytes,
    chunkCount: route.chunkPaths.length,
    isPrerendered: route.isPrerendered,
    isAppRoute: route.isAppRoute,
  }));
}

export function getSharedChunks(build: ParsedBuildStats, limit: number): SharedChunkSummaryEntry[] {
  return build.chunks
    .filter(chunk => chunk.isShared)
    .slice(0, limit)
    .map(chunk => ({
      chunkPath: chunk.chunkPath,
      sizeBytes: chunk.sizeBytes,
      routeCount: chunk.routeCount,
      sharedByRoutes: chunk.sharedByRoutes,
      shareOfAllChunkBytes: build.totalChunkBytes === 0 ? 0 : chunk.sizeBytes / build.totalChunkBytes,
    }));
}

export function compareBuilds(
  baseline: ParsedBuildStats,
  current: ParsedBuildStats,
  limit: number,
): BuildComparison {
  const baselineRoutes = new Map(baseline.routes.map(route => [route.path, route]));
  const currentRoutes = new Map(current.routes.map(route => [route.path, route]));
  const allRoutePaths = Array.from(new Set([...baselineRoutes.keys(), ...currentRoutes.keys()]));

  const routeDeltas: RouteDeltaEntry[] = allRoutePaths
    .map(path => {
      const baselineRoute = baselineRoutes.get(path);
      const currentRoute = currentRoutes.get(path);
      const baselineBytes = baselineRoute?.totalBytes ?? 0;
      const currentBytes = currentRoute?.totalBytes ?? 0;
      return {
        path,
        baselineBytes,
        currentBytes,
        deltaBytes: currentBytes - baselineBytes,
        deltaRatio: calculateDeltaRatio(baselineBytes, currentBytes),
      } satisfies RouteDeltaEntry;
    })
    .sort((left, right) => Math.abs(right.deltaBytes) - Math.abs(left.deltaBytes))
    .slice(0, limit);

  const baselineChunks = aggregateChunksByKey(baseline);
  const currentChunks = aggregateChunksByKey(current);
  const allChunkKeys = Array.from(new Set([...baselineChunks.keys(), ...currentChunks.keys()]));

  const chunkDeltas: ChunkDeltaEntry[] = allChunkKeys
    .map(key => {
      const baselineChunk = baselineChunks.get(key);
      const currentChunk = currentChunks.get(key);
      const baselineBytes = baselineChunk?.sizeBytes ?? 0;
      const currentBytes = currentChunk?.sizeBytes ?? 0;
      return {
        chunkPath: currentChunk?.displayPath ?? baselineChunk?.displayPath ?? key,
        baselineBytes,
        currentBytes,
        deltaBytes: currentBytes - baselineBytes,
        deltaRatio: calculateDeltaRatio(baselineBytes, currentBytes),
        baselineRouteCount: baselineChunk?.routeCount ?? 0,
        currentRouteCount: currentChunk?.routeCount ?? 0,
      } satisfies ChunkDeltaEntry;
    })
    .sort((left, right) => Math.abs(right.deltaBytes) - Math.abs(left.deltaBytes))
    .slice(0, limit);

  return {
    baselineBuildId: baseline.id,
    currentBuildId: current.id,
    baselineTotalChunkBytes: baseline.totalChunkBytes,
    currentTotalChunkBytes: current.totalChunkBytes,
    totalChunkDeltaBytes: current.totalChunkBytes - baseline.totalChunkBytes,
    totalChunkDeltaRatio: calculateDeltaRatio(baseline.totalChunkBytes, current.totalChunkBytes),
    baselineSharedChunkBytes: baseline.sharedChunkBytes,
    currentSharedChunkBytes: current.sharedChunkBytes,
    sharedChunkDeltaBytes: current.sharedChunkBytes - baseline.sharedChunkBytes,
    sharedChunkDeltaRatio: calculateDeltaRatio(baseline.sharedChunkBytes, current.sharedChunkBytes),
    baselineBuildTimeMs: baseline.buildTimeMs,
    currentBuildTimeMs: current.buildTimeMs,
    buildTimeDeltaMs:
      baseline.buildTimeMs === null || current.buildTimeMs === null
        ? null
        : current.buildTimeMs - baseline.buildTimeMs,
    buildTimeDeltaRatio:
      baseline.buildTimeMs === null || current.buildTimeMs === null
        ? null
        : calculateDeltaRatio(baseline.buildTimeMs, current.buildTimeMs),
    routeDeltas,
    chunkDeltas,
  } satisfies BuildComparison;
}

const SEVERITY_CRITICAL_BYTES = 50 * 1024;
const SEVERITY_WARNING_BYTES = 10 * 1024;
const SEVERITY_CRITICAL_RATIO = 0.2;
const SEVERITY_WARNING_RATIO = 0.05;

function classifySeverity(deltaBytes: number, deltaRatio: number | null): GrowthSeverity {
  if (
    deltaBytes >= SEVERITY_CRITICAL_BYTES ||
    (deltaRatio !== null && deltaRatio >= SEVERITY_CRITICAL_RATIO)
  ) {
    return 'critical';
  }

  if (
    deltaBytes >= SEVERITY_WARNING_BYTES ||
    (deltaRatio !== null && deltaRatio >= SEVERITY_WARNING_RATIO)
  ) {
    return 'warning';
  }

  return 'info';
}

const SEVERITY_RANK: Record<GrowthSeverity, number> = {
  info: 0,
  warning: 1,
  critical: 2,
};

function buildGrowthSuggestions(
  chunkContributions: ChunkGrowthContribution[],
  routeFindings: RouteGrowthFinding[],
  limit: number,
): GrowthSuggestion[] {
  const suggestions: GrowthSuggestion[] = [];
  const explainedChunks = new Set<string>();

  for (const chunk of chunkContributions) {
    const severity = classifySeverity(chunk.deltaBytes, chunk.deltaRatio);
    if (severity === 'info') {
      continue;
    }

    if (chunk.isNew) {
      explainedChunks.add(chunk.chunkPath);
      suggestions.push({
        kind: 'new-chunk',
        severity,
        chunkPath: chunk.chunkPath,
        routePath: null,
        deltaBytes: chunk.deltaBytes,
        deltaRatio: chunk.deltaRatio,
        affectedRouteCount: chunk.affectedRouteCount,
        message:
          `New chunk ${chunk.chunkPath} appeared in the current build and is loaded by ` +
          `${chunk.affectedRouteCount} route(s).`,
        recommendedAction: chunk.isShared
          ? 'Confirm the dependency that introduced it. If it is only needed on some routes, load it with a dynamic import so it stays out of the shared bundle.'
          : 'Confirm the dependency that introduced it and consider a dynamic import if it is not required on initial load.',
      });
      continue;
    }

    if (chunk.isShared) {
      explainedChunks.add(chunk.chunkPath);
      suggestions.push({
        kind: 'shared-chunk-growth',
        severity,
        chunkPath: chunk.chunkPath,
        routePath: null,
        deltaBytes: chunk.deltaBytes,
        deltaRatio: chunk.deltaRatio,
        affectedRouteCount: chunk.affectedRouteCount,
        message:
          `Shared chunk ${chunk.chunkPath} grew and is loaded by ${chunk.affectedRouteCount} routes, ` +
          'so the regression multiplies across the app.',
        recommendedAction:
          'Identify the package driving the growth and move it out of the shared chunk (route-level or dynamic import) so only the routes that need it pay the cost.',
      });
      continue;
    }

    explainedChunks.add(chunk.chunkPath);
    suggestions.push({
      kind: 'chunk-growth',
      severity,
      chunkPath: chunk.chunkPath,
      routePath: null,
      deltaBytes: chunk.deltaBytes,
      deltaRatio: chunk.deltaRatio,
      affectedRouteCount: chunk.affectedRouteCount,
      message: `Chunk ${chunk.chunkPath} grew and is exclusive to ${chunk.affectedRouteCount} route(s).`,
      recommendedAction:
        'Inspect the import chain for this chunk and split or lazy-load heavy dependencies that are not needed on initial render.',
    });
  }

  for (const route of routeFindings) {
    if (route.severity !== 'critical') {
      continue;
    }

    const topChunk = route.topContributingChunks[0];
    if (topChunk && explainedChunks.has(topChunk.chunkPath)) {
      continue;
    }

    suggestions.push({
      kind: 'route-regression',
      severity: route.severity,
      chunkPath: topChunk?.chunkPath ?? null,
      routePath: route.path,
      deltaBytes: route.deltaBytes,
      deltaRatio: route.deltaRatio,
      affectedRouteCount: null,
      message: topChunk
        ? `Route ${route.path} regressed critically; its largest contributor is ${topChunk.chunkPath}.`
        : `Route ${route.path} regressed critically.`,
      recommendedAction:
        "Compare this route's chunk list against the baseline and inspect the import chain of its largest contributor.",
    });
  }

  return suggestions
    .sort(
      (left, right) =>
        SEVERITY_RANK[right.severity] - SEVERITY_RANK[left.severity] ||
        right.deltaBytes - left.deltaBytes,
    )
    .slice(0, limit);
}

export function explainGrowth(
  baseline: ParsedBuildStats,
  current: ParsedBuildStats,
  limit: number,
): GrowthExplanation {
  const baselineChunks = aggregateChunksByKey(baseline);
  const currentChunks = aggregateChunksByKey(current);
  const allChunkKeys = Array.from(new Set([...baselineChunks.keys(), ...currentChunks.keys()]));

  const chunkContributions: Array<ChunkGrowthContribution & { key: string }> = allChunkKeys
    .map(key => {
      const baselineChunk = baselineChunks.get(key);
      const currentChunk = currentChunks.get(key);
      const baselineBytes = baselineChunk?.sizeBytes ?? 0;
      const currentBytes = currentChunk?.sizeBytes ?? 0;
      const deltaBytes = currentBytes - baselineBytes;
      return {
        key,
        chunkPath: currentChunk?.displayPath ?? baselineChunk?.displayPath ?? key,
        deltaBytes,
        deltaRatio: calculateDeltaRatio(baselineBytes, currentBytes),
        isNew: baselineChunk === undefined,
        isShared: (currentChunk?.routeCount ?? baselineChunk?.routeCount ?? 0) > 1,
        affectedRouteCount: currentChunk?.routeCount ?? baselineChunk?.routeCount ?? 0,
      };
    })
    .filter(entry => entry.deltaBytes > 0)
    .sort((left, right) => right.deltaBytes - left.deltaBytes);

  const topGrowingChunks: ChunkGrowthContribution[] = chunkContributions
    .slice(0, limit)
    .map(({ key: _key, ...rest }) => rest);

  const baselineRoutes = new Map(baseline.routes.map(route => [route.path, route]));
  const currentRoutes = new Map(current.routes.map(route => [route.path, route]));
  const allRoutePaths = Array.from(new Set([...baselineRoutes.keys(), ...currentRoutes.keys()]));

  const routeFindings = allRoutePaths
    .map(path => {
      const baselineRoute = baselineRoutes.get(path);
      const currentRoute = currentRoutes.get(path);
      const baselineBytes = baselineRoute?.totalBytes ?? 0;
      const currentBytes = currentRoute?.totalBytes ?? 0;
      const deltaBytes = currentBytes - baselineBytes;
      const deltaRatio = calculateDeltaRatio(baselineBytes, currentBytes);

      const routeChunkKeys = new Set([
        ...(baselineRoute?.chunkPaths ?? []).map(normalizeChunkKey),
        ...(currentRoute?.chunkPaths ?? []).map(normalizeChunkKey),
      ]);

      const topContributingChunks = chunkContributions
        .filter(chunk => routeChunkKeys.has(chunk.key))
        .slice(0, 5)
        .map(({ key: _key, ...rest }) => rest);

      return {
        path,
        deltaBytes,
        deltaRatio,
        severity: classifySeverity(deltaBytes, deltaRatio),
        topContributingChunks,
      } satisfies RouteGrowthFinding;
    })
    .filter(finding => finding.deltaBytes > 0)
    .sort((left, right) => right.deltaBytes - left.deltaBytes)
    .slice(0, limit);

  const allDeltas = allChunkKeys.map(key => {
    const baselineBytes = baselineChunks.get(key)?.sizeBytes ?? 0;
    const currentBytes = currentChunks.get(key)?.sizeBytes ?? 0;
    return currentBytes - baselineBytes;
  });

  const totalDeltaBytes = current.totalChunkBytes - baseline.totalChunkBytes;

  const overallSeverity = classifySeverity(
    Math.abs(totalDeltaBytes),
    calculateDeltaRatio(baseline.totalChunkBytes, current.totalChunkBytes),
  );

  const suggestions = buildGrowthSuggestions(chunkContributions, routeFindings, limit);

  return {
    baselineBuildId: baseline.id,
    currentBuildId: current.id,
    overall: {
      totalDeltaBytes,
      totalDeltaRatio: calculateDeltaRatio(baseline.totalChunkBytes, current.totalChunkBytes),
      severity: totalDeltaBytes > 0 ? overallSeverity : 'info',
      newChunkCount: allChunkKeys.filter(key => !baselineChunks.has(key)).length,
      removedChunkCount: allChunkKeys.filter(key => !currentChunks.has(key)).length,
      grownChunkCount: allDeltas.filter(d => d > 0).length,
      shrunkChunkCount: allDeltas.filter(d => d < 0).length,
    },
    routeFindings,
    topGrowingChunks,
    suggestions,
  } satisfies GrowthExplanation;
}