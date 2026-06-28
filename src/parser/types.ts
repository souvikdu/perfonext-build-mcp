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

export type GrowthSeverity = 'info' | 'warning' | 'critical';

export interface ChunkGrowthContribution {
  chunkPath: string;
  deltaBytes: number;
  deltaRatio: number | null;
  isNew: boolean;
  isShared: boolean;
  affectedRouteCount: number;
}

export interface RouteGrowthFinding {
  path: string;
  deltaBytes: number;
  deltaRatio: number | null;
  severity: GrowthSeverity;
  topContributingChunks: ChunkGrowthContribution[];
}

export interface OverallGrowthSummary {
  totalDeltaBytes: number;
  totalDeltaRatio: number | null;
  severity: GrowthSeverity;
  newChunkCount: number;
  removedChunkCount: number;
  grownChunkCount: number;
  shrunkChunkCount: number;
}

export type GrowthSuggestionKind =
  | 'shared-chunk-growth'
  | 'new-chunk'
  | 'chunk-growth'
  | 'route-regression';

export interface GrowthSuggestion {
  kind: GrowthSuggestionKind;
  severity: GrowthSeverity;
  chunkPath: string | null;
  routePath: string | null;
  deltaBytes: number;
  deltaRatio: number | null;
  affectedRouteCount: number | null;
  message: string;
  recommendedAction: string;
}

export interface GrowthExplanation {
  baselineBuildId: string;
  currentBuildId: string;
  overall: OverallGrowthSummary;
  routeFindings: RouteGrowthFinding[];
  topGrowingChunks: ChunkGrowthContribution[];
  suggestions: GrowthSuggestion[];
}

// --- Webpack module stats (.next/stats.json) -------------------------------

export interface WebpackModuleReason {
  moduleName: string | null;
  userRequest: string | null;
}

export interface WebpackModule {
  name: string;
  packageName: string | null;
  sizeBytes: number;
  chunkIds: Array<string | number>;
  reasons: WebpackModuleReason[];
}

export interface WebpackChunk {
  id: string | number;
  names: string[];
  files: string[];
  sizeBytes: number;
}

export interface ParsedWebpackStats {
  buildId: string;
  statsPath: string;
  modules: WebpackModule[];
  chunks: WebpackChunk[];
  moduleCount: number;
  parsedModuleCount: number;
}

export interface ImportChainNode {
  moduleName: string;
  packageName: string | null;
}

export interface ImportTrace {
  moduleName: string;
  packageName: string | null;
  sizeBytes: number;
  chunkFiles: string[];
  importChain: ImportChainNode[];
}

export interface TraceImportResult {
  query: string;
  matchCount: number;
  traces: ImportTrace[];
}

// --- Attribution & costs (v0.4.0) ------------------------------------------

export interface DuplicatePackageEntry {
  packageName: string;
  wastedBytes: number;
  totalBytes: number;
  chunkCount: number;
  chunkFiles: string[];
}

export interface SharedChunkPackage {
  packageName: string;
  bytes: number;
  shareOfChunk: number;
}

export interface SharedChunkComposition {
  chunkPath: string;
  sizeBytes: number;
  routeCount: number;
  sharedByRoutes: string[];
  topPackages: SharedChunkPackage[];
}

export interface PackageCostEntry {
  packageName: string;
  totalBytes: number;
  moduleCount: number;
  chunkCount: number;
  sharedBytes: number;
  exclusiveBytes: number;
  routeCount: number;
}

export type OptimizationKind =
  | 'dedupe-package'
  | 'move-out-of-shared-chunk'
  | 'optimize-package-imports'
  | 'code-split-route'
  | 'audit-shared-baseline';

export interface OptimizationSuggestion {
  kind: OptimizationKind;
  severity: GrowthSeverity;
  title: string;
  bytes: number;
  evidence: string;
  recommendedAction: string;
  packageName: string | null;
  chunkPath: string | null;
  routePath: string | null;
}

export interface OptimizationReport {
  buildId: string;
  webpackStatsUsed: boolean;
  suggestionCount: number;
  suggestions: OptimizationSuggestion[];
  note: string | null;
}