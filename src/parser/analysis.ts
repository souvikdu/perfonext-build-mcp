import type {
  BuildComparison,
  ChunkDeltaEntry,
  ChunkGrowthContribution,
  GrowthExplanation,
  GrowthSeverity,
  GrowthSuggestion,
  OptimizationReport,
  OptimizationSuggestion,
  ParsedBuildStats,
  ParsedWebpackStats,
  RouteDeltaEntry,
  RouteGrowthFinding,
  RouteSummaryEntry,
  SharedChunkSummaryEntry,
} from './types.js';
import { formatBytes, formatPct } from '../format.js';
import { explainSharedChunks, findDuplicates, getPackageCosts } from './webpack-stats.js';

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

// --- Optimization capstone (v0.4.0) ----------------------------------------

const OPT_CRITICAL_BYTES = 50 * 1024;
const OPT_WARNING_BYTES = 10 * 1024;
const ROUTE_SPLIT_CRITICAL_BYTES = 244 * 1024;
const ROUTE_SPLIT_WARNING_BYTES = 128 * 1024;
const BARREL_MODULE_COUNT = 8;
// A barrel is many SMALL re-exported modules; few huge modules (a token blob) won't benefit.
const BARREL_MAX_AVG_MODULE_BYTES = 50 * 1024;
const SHARED_BASELINE_RATIO = 0.5;
const SHARED_BASELINE_WARNING_RATIO = 0.7;
// optimize-package-imports is the lowest-confidence kind (import style is unknowable from build
// stats), so cap how many can appear and let higher-confidence findings surface first.
const OPT_IMPORTS_MAX = 5;

// Framework packages are loaded on (nearly) every route by design; you cannot move or barrel-trim
// them out, so they are never a move-out or optimize-imports target.
const FRAMEWORK_PACKAGES = new Set(['react', 'react-dom', 'next', 'scheduler']);
// Transpiler/polyfill runtimes are pulled in by the build, not imported via a barrel, so
// optimizePackageImports cannot help them and they cannot be "moved" out of shared code.
const POLYFILL_PACKAGES = new Set([
  'core-js',
  'core-js-pure',
  'regenerator-runtime',
  'tslib',
  '@swc/helpers',
  '@babel/runtime',
]);

// Infrastructure = framework + polyfill/runtime. These are structural to every build and are not
// actionable via move-out or optimize-imports in any app, so they are excluded from both.
function isInfrastructurePackage(packageName: string): boolean {
  return FRAMEWORK_PACKAGES.has(packageName) || POLYFILL_PACKAGES.has(packageName);
}

// Outlier-robust central tendency: a few very heavy routes must not skew the "typical page" used
// as the shared-baseline denominator.
function median(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }

  const sorted = [...values].sort((left, right) => left - right);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function severityForBytes(bytes: number, critical: number, warning: number): GrowthSeverity {
  if (bytes >= critical) {
    return 'critical';
  }

  if (bytes >= warning) {
    return 'warning';
  }

  return 'info';
}

function stableSuggestionKey(suggestion: OptimizationSuggestion): string {
  return [suggestion.kind, suggestion.packageName, suggestion.chunkPath, suggestion.routePath].join('|');
}

/**
 * Aggregate manifest evidence (always) and webpack-stats evidence (when loaded) into
 * severity-ranked, evidence-backed recommendations tied to concrete Next.js actions. Works on
 * manifests alone; webpack stats add dedupe, shared-chunk, package-import, and cost findings.
 */
export function suggestOptimizations(
  build: ParsedBuildStats,
  stats: ParsedWebpackStats | null,
  limit = 15,
): OptimizationReport {
  const suggestions: OptimizationSuggestion[] = [];

  // Manifest-only: code-split routes that ship a lot of route-exclusive JavaScript.
  for (const route of build.routes) {
    const severity = severityForBytes(
      route.exclusiveChunkBytes,
      ROUTE_SPLIT_CRITICAL_BYTES,
      ROUTE_SPLIT_WARNING_BYTES,
    );
    if (severity === 'info') {
      continue;
    }

    suggestions.push({
      kind: 'code-split-route',
      severity,
      title: `Code-split ${route.path}`,
      bytes: route.exclusiveChunkBytes,
      evidence: `${route.path} ships ${formatBytes(route.exclusiveChunkBytes)} of route-exclusive JavaScript on initial load.`,
      recommendedAction:
        'Lazy-load interaction-only or below-the-fold components on this route with next/dynamic so they leave the initial bundle.',
      packageName: null,
      chunkPath: null,
      routePath: route.path,
    });
  }

  // Manifest-only: flag when the shared baseline dominates a typical page. Both sides use the route
  // MEDIAN. The numerator is per-route sharedChunkBytes (what a route actually loads), not
  // build.sharedChunkBytes (the sum of all shared chunks, which can exceed any one page's weight).
  const medianRouteBytes = median(build.routes.map(route => route.totalBytes));
  const medianRouteSharedBytes = median(build.routes.map(route => route.sharedChunkBytes));
  if (
    build.routes.length >= 2 &&
    medianRouteBytes > 0 &&
    medianRouteSharedBytes >= SHARED_BASELINE_RATIO * medianRouteBytes
  ) {
    const ratio = medianRouteSharedBytes / medianRouteBytes;
    suggestions.push({
      kind: 'audit-shared-baseline',
      severity: ratio >= SHARED_BASELINE_WARNING_RATIO ? 'warning' : 'info',
      title: 'Shared baseline dominates page weight',
      bytes: medianRouteSharedBytes,
      evidence: `Shared chunks add ${formatBytes(medianRouteSharedBytes)} to a typical page — about ${formatPct(ratio)} of its ${formatBytes(medianRouteBytes)} total.`,
      recommendedAction: stats
        ? 'Run explain_shared_chunks to see which packages dominate the shared chunks, then trim or defer them.'
        : 'Collect webpack stats (how_to_collect_stats) and run explain_shared_chunks to see which packages dominate the shared chunks.',
      packageName: null,
      chunkPath: null,
      routePath: null,
    });
  }

  if (stats) {
    // Dedupe packages emitted into more than one chunk.
    for (const duplicate of findDuplicates(stats, 50)) {
      const severity = severityForBytes(duplicate.wastedBytes, OPT_CRITICAL_BYTES, OPT_WARNING_BYTES);
      if (severity === 'info') {
        continue;
      }

      suggestions.push({
        kind: 'dedupe-package',
        severity,
        title: `Dedupe ${duplicate.packageName}`,
        bytes: duplicate.wastedBytes,
        evidence: `${duplicate.packageName} is bundled into ${duplicate.chunkCount} chunks, duplicating ${formatBytes(duplicate.wastedBytes)} of code.`,
        recommendedAction:
          'Run `npm dedupe`, align the version across dependents, or import it from a single shared module so it is emitted once.',
        packageName: duplicate.packageName,
        chunkPath: null,
        routePath: null,
      });
    }

    // Move heavy non-framework packages out of widely-shared chunks.
    const movedPackages = new Set<string>();
    for (const chunk of explainSharedChunks(build, stats, 20, 5)) {
      if (chunk.routeCount < 2) {
        continue;
      }

      for (const pkg of chunk.topPackages) {
        if (pkg.packageName === '(app code)' || isInfrastructurePackage(pkg.packageName)) {
          continue;
        }
        if (movedPackages.has(pkg.packageName)) {
          continue;
        }

        const severity = severityForBytes(pkg.bytes, OPT_CRITICAL_BYTES, OPT_WARNING_BYTES);
        if (severity === 'info') {
          continue;
        }

        movedPackages.add(pkg.packageName);
        suggestions.push({
          kind: 'move-out-of-shared-chunk',
          severity,
          title: `Move ${pkg.packageName} out of the shared bundle`,
          bytes: pkg.bytes,
          evidence: `${pkg.packageName} adds ${formatBytes(pkg.bytes)} (${formatPct(pkg.shareOfChunk)}) to ${chunk.chunkPath}, which is loaded by ${chunk.routeCount} routes.`,
          recommendedAction:
            'Import it only where it is used (route-level or via next/dynamic) so routes that do not need it stop paying for it on initial load.',
          packageName: pkg.packageName,
          chunkPath: chunk.chunkPath,
          routePath: null,
        });
      }
    }

    // Suggest optimizePackageImports for barrel-style packages shared across multiple routes.
    // Single-route packages (code-split concern), infrastructure, and packages already flagged for
    // move-out are excluded; move-out is more specific and subsumes barrel-trimming. Capped because
    // import style cannot be confirmed from build stats.
    const importCandidates: OptimizationSuggestion[] = [];
    for (const cost of getPackageCosts(build, stats, 100)) {
      const avgModuleBytes = cost.moduleCount > 0 ? cost.totalBytes / cost.moduleCount : 0;
      if (
        cost.moduleCount < BARREL_MODULE_COUNT ||
        avgModuleBytes > BARREL_MAX_AVG_MODULE_BYTES ||
        cost.routeCount < 2 ||
        isInfrastructurePackage(cost.packageName) ||
        movedPackages.has(cost.packageName)
      ) {
        continue;
      }

      const severity = severityForBytes(cost.totalBytes, OPT_CRITICAL_BYTES, OPT_WARNING_BYTES);
      importCandidates.push({
        kind: 'optimize-package-imports',
        // Barrel optimization is a config win, not an emergency — cap at warning.
        severity: severity === 'critical' ? 'warning' : severity,
        title: `Optimize imports for ${cost.packageName}`,
        bytes: cost.totalBytes,
        evidence: `${cost.packageName} pulls in ${cost.moduleCount} modules (${formatBytes(cost.totalBytes)}) across ${cost.routeCount} routes; a barrel import can bundle far more than you use.`,
        recommendedAction: `Add "${cost.packageName}" to experimental.optimizePackageImports in next.config so Next.js only bundles the exports you import.`,
        packageName: cost.packageName,
        chunkPath: null,
        routePath: null,
      });
    }

    importCandidates
      .sort((left, right) => right.bytes - left.bytes || left.packageName!.localeCompare(right.packageName!))
      .slice(0, OPT_IMPORTS_MAX)
      .forEach(candidate => suggestions.push(candidate));
  }

  const ranked = suggestions
    .sort(
      (left, right) =>
        SEVERITY_RANK[right.severity] - SEVERITY_RANK[left.severity] ||
        right.bytes - left.bytes ||
        stableSuggestionKey(left).localeCompare(stableSuggestionKey(right)),
    )
    .slice(0, limit);

  return {
    buildId: build.id,
    webpackStatsUsed: stats !== null,
    suggestionCount: ranked.length,
    suggestions: ranked,
    note: stats
      ? null
      : 'Webpack stats are not loaded, so import- and package-level suggestions are unavailable. ' +
        'Run how_to_collect_stats then load_webpack_stats for dedupe, shared-chunk, and package-import analysis.',
  } satisfies OptimizationReport;
}