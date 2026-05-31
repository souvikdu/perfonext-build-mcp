import type {
  BuildComparison,
  ChunkDeltaEntry,
  ParsedBuildStats,
  RouteDeltaEntry,
  RouteSummaryEntry,
  SharedChunkSummaryEntry,
} from './types.js';

function calculateDeltaRatio(baseline: number, current: number): number | null {
  if (baseline === 0) {
    return current === 0 ? 0 : null;
  }

  return (current - baseline) / baseline;
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

  const baselineChunks = new Map(baseline.chunks.map(chunk => [chunk.chunkPath, chunk]));
  const currentChunks = new Map(current.chunks.map(chunk => [chunk.chunkPath, chunk]));
  const allChunkPaths = Array.from(new Set([...baselineChunks.keys(), ...currentChunks.keys()]));

  const chunkDeltas: ChunkDeltaEntry[] = allChunkPaths
    .map(chunkPath => {
      const baselineChunk = baselineChunks.get(chunkPath);
      const currentChunk = currentChunks.get(chunkPath);
      const baselineBytes = baselineChunk?.sizeBytes ?? 0;
      const currentBytes = currentChunk?.sizeBytes ?? 0;
      return {
        chunkPath,
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