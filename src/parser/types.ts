export type RouteType = 'static' | 'dynamic' | 'isr';

export type PrerenderBlockedReason = 'isr' | 'dynamic-params' | 'server-side-props' | null;

export interface BuildRoute {
  path: string;
  type: RouteType;
  prerenderBlockedReason: PrerenderBlockedReason;
  chunkPaths: string[];
  totalBytes: number;
  initialLoadBytes: number;
  sharedChunkBytes: number;
  exclusiveChunkBytes: number;
  isPrerendered: boolean;
  isAppRoute: boolean;
}

export interface BuildChunk {
  chunkPath: string;
  sizeBytes: number;
  routeCount: number;
  sharedByRoutes: string[];
  isShared: boolean;
}

export interface ParsedBuildStats {
  id: string;
  buildDir: string;
  buildOutputPath: string | null;
  routes: BuildRoute[];
  chunks: BuildChunk[];
  totalChunkBytes: number;
  sharedChunkBytes: number;
  buildTimeMs: number | null;
}

export interface RouteSummaryEntry {
  path: string;
  type: RouteType;
  prerenderBlockedReason: PrerenderBlockedReason;
  totalBytes: number;
  initialLoadBytes: number;
  sharedChunkBytes: number;
  exclusiveChunkBytes: number;
  sharedRatio: number;
  chunkCount: number;
  isPrerendered: boolean;
  isAppRoute: boolean;
}

export interface SharedChunkSummaryEntry {
  chunkPath: string;
  sizeBytes: number;
  routeCount: number;
  sharedByRoutes: string[];
  shareOfAllChunkBytes: number;
}

export interface RouteDeltaEntry {
  path: string;
  baselineBytes: number;
  currentBytes: number;
  deltaBytes: number;
  deltaRatio: number | null;
}

export interface ChunkDeltaEntry {
  chunkPath: string;
  baselineBytes: number;
  currentBytes: number;
  deltaBytes: number;
  deltaRatio: number | null;
  baselineRouteCount: number;
  currentRouteCount: number;
}

export interface BuildComparison {
  baselineBuildId: string;
  currentBuildId: string;
  baselineTotalChunkBytes: number;
  currentTotalChunkBytes: number;
  totalChunkDeltaBytes: number;
  totalChunkDeltaRatio: number | null;
  baselineSharedChunkBytes: number;
  currentSharedChunkBytes: number;
  sharedChunkDeltaBytes: number;
  sharedChunkDeltaRatio: number | null;
  baselineBuildTimeMs: number | null;
  currentBuildTimeMs: number | null;
  buildTimeDeltaMs: number | null;
  buildTimeDeltaRatio: number | null;
  routeDeltas: RouteDeltaEntry[];
  chunkDeltas: ChunkDeltaEntry[];
}