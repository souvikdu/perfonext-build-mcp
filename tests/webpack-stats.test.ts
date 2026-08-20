import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import type {
  BuildChunk,
  BuildRoute,
  ParsedBuildStats,
  ParsedWebpackStats,
  WebpackChunk,
  WebpackModule,
} from '../src/parser/types.js';
import { parseBuildStats } from '../src/parser/build-stats.js';
import {
  checkWebpackStatsOverlap,
  explainSharedChunks,
  extractPackageName,
  findDuplicates,
  getPackageCosts,
  parseWebpackStats,
  traceImport,
} from '../src/parser/webpack-stats.js';
import { suggestOptimizations } from '../src/parser/analysis.js';
import { resolveWebpackStats } from '../src/tools/webpack-shared.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const fixtureBuildDir = resolve(__dirname, 'fixtures/sample-next-build/.next');
const fixtureNoStatsDir = resolve(__dirname, 'fixtures/sample-next-build-updated/.next');

describe('webpack stats parser', () => {
  it('parses modules and chunks from stats.json', async () => {
    const stats = await parseWebpackStats(fixtureBuildDir, 'build-1');
    expect(stats).not.toBeNull();
    expect(stats!.buildId).toBe('build-1');
    expect(stats!.chunks).toHaveLength(6);
    expect(stats!.parsedModuleCount).toBe(stats!.modules.length);
    expect(stats!.modules.length).toBeGreaterThan(0);
  });

  it('returns null when stats.json is absent (graceful, not an error)', async () => {
    const stats = await parseWebpackStats(fixtureNoStatsDir, 'build-missing');
    expect(stats).toBeNull();
  });

  it('attributes modules to the correct npm package', () => {
    expect(extractPackageName('./node_modules/lodash/lodash.js')).toBe('lodash');
    expect(extractPackageName('./node_modules/@acme/ui/index.js')).toBe('@acme/ui');
    expect(extractPackageName('./node_modules/outer/node_modules/inner/index.js')).toBe('inner');
    expect(extractPackageName('./src/components/Search.js')).toBeNull();
    // Next.js vendored copies stay attributed to `next`; do not unwrap compiled/*.
    expect(extractPackageName('./node_modules/next/dist/compiled/react-dom/index.js')).toBe('next');
  });
});

describe('trace_import', () => {
  it('traces an import chain from an entry to the matched module', async () => {
    const stats = await parseWebpackStats(fixtureBuildDir, 'build-1');
    const result = traceImport(stats!, 'react-dom');

    expect(result.matchCount).toBe(1);
    const trace = result.traces[0];
    expect(trace.packageName).toBe('react-dom');
    expect(trace.moduleSizeBytes).toBeGreaterThan(0);
    expect(trace.importChain.length).toBeGreaterThanOrEqual(2);
    expect(trace.importChain[trace.importChain.length - 1].moduleName).toContain('react-dom');
    expect(trace.importChain[0].packageName).toBe('react');
  });

  it('matches case-insensitively by substring', async () => {
    const stats = await parseWebpackStats(fixtureBuildDir, 'build-1');
    expect(traceImport(stats!, 'LODASH').matchCount).toBe(1);
  });
});

describe('graceful degradation', () => {
  it('returns a breadcrumb (not an error) when stats are not loaded', () => {
    const resolved = resolveWebpackStats('never-loaded');
    expect('breadcrumb' in resolved).toBe(true);
    if ('breadcrumb' in resolved) {
      expect(resolved.breadcrumb.webpackStatsLoaded).toBe(false);
      expect(String(resolved.breadcrumb.nextStep)).toContain('how_to_collect_stats');
    }
  });
});

describe('manifest tools are unaffected by stats presence', () => {
  it('parses valid build stats whether or not a stats.json sits in the build dir', async () => {
    const withStats = await parseBuildStats(fixtureBuildDir);
    const withoutStats = await parseBuildStats(fixtureNoStatsDir);

    expect(withStats.routes).toHaveLength(4);
    expect(withStats.chunks.length).toBeGreaterThan(0);
    expect(withoutStats.routes.length).toBeGreaterThan(0);
    // The build-stats parser reads manifests only; the stats.json present in
    // fixtureBuildDir must never leak into the parsed chunk output.
    expect(withStats.chunks.some((chunk) => chunk.chunkPath.includes('stats.json'))).toBe(false);
  });
});

describe('find_duplicates', () => {
  it('ranks packages bundled into more than one chunk by wasted bytes', async () => {
    const stats = await parseWebpackStats(fixtureBuildDir, 'build-1');
    const duplicates = findDuplicates(stats!);

    const lodash = duplicates.find((entry) => entry.packageName === 'lodash');
    expect(lodash).toBeDefined();
    expect(lodash!.wastedBytes).toBe(70000);
    expect(lodash!.chunkCount).toBe(2);
    // Single-chunk packages (react, react-dom) waste nothing and must be excluded.
    expect(duplicates.some((entry) => entry.packageName === 'react-dom')).toBe(false);
    // Sorted by wasted bytes desc — lodash leads.
    expect(duplicates[0].packageName).toBe('lodash');
  });
});

describe('explain_shared_chunks', () => {
  it('ranks the packages and app code that dominate each shared chunk', async () => {
    const build = await parseBuildStats(fixtureBuildDir);
    const stats = await parseWebpackStats(fixtureBuildDir, build.id);
    const compositions = explainSharedChunks(build, stats!);

    expect(compositions.length).toBeGreaterThan(0);
    const sharedSearch = compositions.find((chunk) => chunk.chunkPath.includes('shared-search'));
    expect(sharedSearch).toBeDefined();
    expect(sharedSearch!.emittedSizeBytes).toBeGreaterThan(0);
    // date-fns dominates the shared-search chunk.
    expect(sharedSearch!.topPackages[0].packageName).toBe('date-fns');
    expect(sharedSearch!.topPackages[0].moduleSizeBytes).toBeGreaterThan(0);
    // App code is surfaced as a labelled entry, not dropped.
    const labels = compositions.flatMap((chunk) => chunk.topPackages.map((pkg) => pkg.packageName));
    expect(labels).toContain('(app code)');
    // Shares within a chunk sum to ~1.
    const total = sharedSearch!.topPackages.reduce((sum, pkg) => sum + pkg.shareOfChunk, 0);
    expect(total).toBeCloseTo(1, 5);
  });
});

describe('getPackageCosts', () => {
  it('aggregates module bytes per package with shared/exclusive split and route count', async () => {
    const build = await parseBuildStats(fixtureBuildDir);
    const stats = await parseWebpackStats(fixtureBuildDir, build.id);
    const costs = getPackageCosts(build, stats!);

    // Sorted by total bytes desc — react-dom is the heaviest single package.
    expect(costs[0].packageName).toBe('react-dom');
    expect(costs[0].totalBytes).toBe(120000);

    const lodash = costs.find((entry) => entry.packageName === 'lodash');
    expect(lodash).toBeDefined();
    // lodash lives only in route-exclusive chunks.
    expect(lodash!.exclusiveBytes).toBe(70000);
    expect(lodash!.sharedBytes).toBe(0);
    expect(lodash!.chunkCount).toBe(2);
  });
});

describe('suggest_optimizations', () => {
  it('produces severity-ranked, evidence-backed suggestions when stats are loaded', async () => {
    const build = await parseBuildStats(fixtureBuildDir);
    const stats = await parseWebpackStats(fixtureBuildDir, build.id);
    const report = suggestOptimizations(build, stats);

    expect(report.webpackStatsUsed).toBe(true);
    expect(report.note).toBeNull();

    // Dedupe lodash is the top finding (critical, 70000 wasted bytes).
    const top = report.suggestions[0];
    expect(top.kind).toBe('dedupe-package');
    expect(top.packageName).toBe('lodash');
    expect(top.severity).toBe('critical');

    // date-fns is suggested to move out of the shared chunk.
    const moveDateFns = report.suggestions.find(
      (s) => s.kind === 'move-out-of-shared-chunk' && s.packageName === 'date-fns',
    );
    expect(moveDateFns).toBeDefined();
    expect(moveDateFns!.severity).toBe('warning');

    // Framework packages are never suggested for moving out of the shared chunk.
    expect(
      report.suggestions.some(
        (s) => s.kind === 'move-out-of-shared-chunk' && s.packageName === 'react-dom',
      ),
    ).toBe(false);
  });

  it('degrades to manifest-only suggestions with a breadcrumb when stats are absent', async () => {
    const build = await parseBuildStats(fixtureBuildDir);
    const report = suggestOptimizations(build, null);

    expect(report.webpackStatsUsed).toBe(false);
    expect(report.note).toContain('load_webpack_stats');
    // Without stats, no dedupe or shared-chunk suggestions are possible.
    expect(report.suggestions.every((s) => s.kind !== 'dedupe-package')).toBe(true);
    expect(report.suggestions.every((s) => s.kind !== 'move-out-of-shared-chunk')).toBe(true);
    // The shared-baseline audit is manifest-only and still fires.
    expect(report.suggestions.some((s) => s.kind === 'audit-shared-baseline')).toBe(true);
  });
});

// Synthetic builds let us assert the generic suggestion rules independently of fixture quirks.
function makeRoute(path: string, totalBytes: number, exclusiveChunkBytes: number): BuildRoute {
  return {
    path,
    type: 'static',
    prerenderBlockedReason: null,
    chunkPaths: [],
    totalBytes,
    initialLoadBytes: totalBytes,
    sharedChunkBytes: totalBytes - exclusiveChunkBytes,
    exclusiveChunkBytes,
    isPrerendered: true,
    isAppRoute: true,
  };
}

function makeChunk(
  chunkPath: string,
  sizeBytes: number,
  sharedByRoutes: string[],
  isShared: boolean,
): BuildChunk {
  return { chunkPath, sizeBytes, routeCount: sharedByRoutes.length, sharedByRoutes, isShared };
}

function makeBuild(
  routes: BuildRoute[],
  chunks: BuildChunk[],
  sharedChunkBytes: number,
): ParsedBuildStats {
  return {
    id: 'synthetic',
    buildDir: '/synthetic/.next',
    buildOutputPath: null,
    routes,
    chunks,
    totalChunkBytes: chunks.reduce((sum, chunk) => sum + chunk.sizeBytes, 0),
    sharedChunkBytes,
    buildTimeMs: null,
  };
}

function makeModules(
  packageName: string,
  count: number,
  sizeBytes: number,
  chunkId: string,
): WebpackModule[] {
  return Array.from(
    { length: count },
    (_unused, index) =>
      ({
        name: `./node_modules/${packageName}/m${index}.js`,
        packageName,
        sizeBytes,
        chunkIds: [chunkId],
        reasons: [],
      }) satisfies WebpackModule,
  );
}

function makeStats(modules: WebpackModule[], chunks: WebpackChunk[]): ParsedWebpackStats {
  return {
    buildId: 'synthetic',
    statsPath: '/synthetic/.next/stats.json',
    modules,
    chunks,
    moduleCount: modules.length,
    parsedModuleCount: modules.length,
  };
}

describe('suggest_optimizations generic rules', () => {
  // A shared chunk loaded by two routes, plus a chunk exclusive to one route.
  const sharedChunkFile = 'static/chunks/shared.js';
  const pageChunkFile = 'static/chunks/page-a.js';
  const buildChunks = [
    makeChunk(sharedChunkFile, 60000, ['/a', '/b'], true),
    makeChunk(pageChunkFile, 50000, ['/a'], false),
  ];
  const routes = [makeRoute('/a', 110000, 50000), makeRoute('/b', 60000, 0)];
  const build = makeBuild(routes, buildChunks, 60000);
  const webpackChunks = [
    { id: 'sc', names: [], files: [sharedChunkFile], sizeBytes: 60000 },
    { id: 'pa', names: [], files: [pageChunkFile], sizeBytes: 50000 },
  ] satisfies WebpackChunk[];

  it('suggests optimize-package-imports only for multi-route, non-infrastructure barrels', () => {
    const stats = makeStats(
      [
        ...makeModules('ui-kit', 8, 1000, 'sc'), // multi-route barrel, below move-out threshold → include
        ...makeModules('core-js-pure', 8, 1000, 'sc'), // multi-route polyfill → exclude
        ...makeModules('big-single', 8, 1000, 'pa'), // single-route barrel → exclude (code-split concern)
      ],
      webpackChunks,
    );

    const report = suggestOptimizations(build, stats);
    const importPkgs = report.suggestions
      .filter((s) => s.kind === 'optimize-package-imports')
      .map((s) => s.packageName);

    expect(importPkgs).toContain('ui-kit');
    expect(importPkgs).not.toContain('core-js-pure');
    expect(importPkgs).not.toContain('big-single');
  });

  it('caps the number of optimize-package-imports suggestions', () => {
    // Seven qualifying multi-route barrels, each below the move-out threshold so none are claimed
    // by move-out-of-shared-chunk first; only the top OPT_IMPORTS_MAX (5) should surface.
    const modules = Array.from({ length: 7 }, (_unused, index) =>
      makeModules(`barrel-${index}`, 8, 1000 + index * 10, 'sc'),
    ).flat();
    const report = suggestOptimizations(build, makeStats(modules, webpackChunks), 50);
    const importCount = report.suggestions.filter(
      (s) => s.kind === 'optimize-package-imports',
    ).length;

    expect(importCount).toBe(5);
  });

  it('does not re-list a package for optimize-imports once it is flagged for move-out', () => {
    // big-shared is a heavy top package in a 2-route shared chunk (move-out candidate) AND a
    // many-small-module barrel (would-be optimize-imports). The more specific move-out finding wins
    // and the package must not appear twice with a second, inconsistent byte figure.
    const stats = makeStats(makeModules('big-shared', 8, 5000, 'sc'), webpackChunks);
    const report = suggestOptimizations(build, stats);

    const movePkgs = report.suggestions
      .filter((s) => s.kind === 'move-out-of-shared-chunk')
      .map((s) => s.packageName);
    const importPkgs = report.suggestions
      .filter((s) => s.kind === 'optimize-package-imports')
      .map((s) => s.packageName);

    expect(movePkgs).toContain('big-shared');
    expect(importPkgs).not.toContain('big-shared');
  });

  it('excludes big-module packages from optimize-imports (not barrels)', () => {
    // Two route-exclusive chunks, so packages spread across them are multi-route via package costs
    // but never move-out candidates (no shared chunk). token-blob has few, huge modules → not a
    // barrel; mini-kit has many small modules → a real barrel.
    const paFile = 'static/chunks/pa-only.js';
    const pbFile = 'static/chunks/pb-only.js';
    const guardBuild = makeBuild(
      [makeRoute('/a', 500000, 500000), makeRoute('/b', 500000, 500000)],
      [makeChunk(paFile, 450000, ['/a'], false), makeChunk(pbFile, 450000, ['/b'], false)],
      0,
    );
    const guardChunks = [
      { id: 'pa', names: [], files: [paFile], sizeBytes: 450000 },
      { id: 'pb', names: [], files: [pbFile], sizeBytes: 450000 },
    ] satisfies WebpackChunk[];
    const stats = makeStats(
      [
        ...makeModules('token-blob', 4, 100000, 'pa'), // avg 100 KB → not a barrel
        ...makeModules('token-blob', 4, 100000, 'pb'),
        ...makeModules('mini-kit', 4, 1000, 'pa'), // avg 1 KB → barrel
        ...makeModules('mini-kit', 4, 1000, 'pb'),
      ],
      guardChunks,
    );
    const report = suggestOptimizations(guardBuild, stats, 50);
    const importPkgs = report.suggestions
      .filter((s) => s.kind === 'optimize-package-imports')
      .map((s) => s.packageName);

    expect(importPkgs).toContain('mini-kit');
    expect(importPkgs).not.toContain('token-blob');
  });

  it("uses each route's own shared bytes (not the global shared total) for the baseline audit", () => {
    // build.sharedChunkBytes sums every shared chunk (2 MB) even though no single route loads them
    // all; the audit must instead use the median of per-route sharedChunkBytes (100 KB here), so the
    // reported figure stays bounded by a real page's weight.
    const skewedRoutes = [
      makeRoute('/a', 100000, 0),
      makeRoute('/b', 100000, 0),
      makeRoute('/c', 100000, 0),
      makeRoute('/heavy', 1000000, 940000),
    ];
    const skewedBuild = makeBuild(skewedRoutes, buildChunks, 2000000);
    const report = suggestOptimizations(skewedBuild, null);

    const baseline = report.suggestions.find((s) => s.kind === 'audit-shared-baseline');
    expect(baseline).toBeDefined();
    expect(baseline!.bytes).toBe(100000);
  });

  it('rewords code-split advice for Next.js framework routes (no next/dynamic)', () => {
    // /404 is a heavy framework route; a normal content route stays next/dynamic advice.
    const frameworkBuild = makeBuild(
      [makeRoute('/404', 950000, 940000), makeRoute('/products', 950000, 940000)],
      buildChunks,
      0,
    );
    const report = suggestOptimizations(frameworkBuild, null);

    const notFound = report.suggestions.find(
      (s) => s.kind === 'code-split-route' && s.routePath === '/404',
    );
    const products = report.suggestions.find(
      (s) => s.kind === 'code-split-route' && s.routePath === '/products',
    );

    expect(notFound).toBeDefined();
    expect(notFound!.title).toBe('Slim down /404');
    expect(notFound!.recommendedAction).toContain('framework route');
    expect(notFound!.recommendedAction).not.toContain('next/dynamic so they leave');

    expect(products).toBeDefined();
    expect(products!.title).toBe('Code-split /products');
    expect(products!.recommendedAction).toContain('next/dynamic');
  });
});

describe('chunk-file normalization is leading-slash tolerant', () => {
  it('attributes modules when webpack files and manifest paths differ by a leading slash', () => {
    const build = makeBuild(
      [makeRoute('/a', 60000, 0), makeRoute('/b', 60000, 0)],
      [makeChunk('static/chunks/shared.js', 60000, ['/a', '/b'], true)],
      60000,
    );
    // Webpack emits the same chunk with a LEADING SLASH — the join must still match.
    const stats = makeStats(makeModules('lib', 4, 10000, 'sc'), [
      { id: 'sc', names: [], files: ['/static/chunks/shared.js'], sizeBytes: 60000 },
    ]);

    const shared = explainSharedChunks(build, stats);
    expect(shared[0].topPackages.some((pkg) => pkg.packageName === 'lib')).toBe(true);

    const lib = getPackageCosts(build, stats).find((cost) => cost.packageName === 'lib');
    expect(lib).toBeDefined();
    expect(lib!.routeCount).toBe(2);
    expect(lib!.sharedBytes).toBe(40000);
  });
});

describe('checkWebpackStatsOverlap', () => {
  it('detects 100% overlap when chunk files match exactly', () => {
    const build = makeBuild(
      [makeRoute('/a', 60000, 0)],
      [
        makeChunk('static/chunks/c1.js', 30000, ['/a'], false),
        makeChunk('static/chunks/c2.js', 30000, ['/a'], false),
      ],
      0,
    );
    const stats = makeStats(
      [],
      [
        { id: '1', names: [], files: ['static/chunks/c1.js'], sizeBytes: 30000 },
        { id: '2', names: [], files: ['/static/chunks/c2.js'], sizeBytes: 30000 },
      ],
    );

    const overlap = checkWebpackStatsOverlap(build, stats);
    expect(overlap.manifestChunkCount).toBe(2);
    expect(overlap.matchedChunkCount).toBe(2);
    expect(overlap.overlapRatio).toBe(1);
    expect(overlap.isSkewed).toBe(false);
  });

  it('normalizes ./ prefixes, backslashes, and query/hash suffixes in chunk paths', () => {
    const build = makeBuild(
      [makeRoute('/a', 60000, 0)],
      [
        makeChunk('static/chunks/c1.js', 30000, ['/a'], false),
        makeChunk('static/chunks/c2.js', 30000, ['/a'], false),
      ],
      0,
    );
    const stats = makeStats(
      [],
      [
        { id: '1', names: [], files: ['./static\\chunks\\c1.js?hash=123'], sizeBytes: 30000 },
        { id: '2', names: [], files: ['static/chunks/c2.js#tag'], sizeBytes: 30000 },
      ],
    );

    const overlap = checkWebpackStatsOverlap(build, stats);
    expect(overlap.matchedChunkCount).toBe(2);
    expect(overlap.isSkewed).toBe(false);
  });

  it('detects version skew when overlap is below 50%', () => {
    const build = makeBuild(
      [makeRoute('/a', 100000, 0)],
      [
        makeChunk('static/chunks/c1.js', 25000, ['/a'], false),
        makeChunk('static/chunks/c2.js', 25000, ['/a'], false),
        makeChunk('static/chunks/c3.js', 25000, ['/a'], false),
        makeChunk('static/chunks/c4.js', 25000, ['/a'], false),
      ],
      0,
    );
    // Stats only has c1.js (1 out of 4 chunks matched = 25% < 50%)
    const stats = makeStats(
      [],
      [
        { id: '1', names: [], files: ['static/chunks/c1.js'], sizeBytes: 25000 },
        { id: 'old', names: [], files: ['static/chunks/old-stale.js'], sizeBytes: 25000 },
      ],
    );

    const overlap = checkWebpackStatsOverlap(build, stats);
    expect(overlap.manifestChunkCount).toBe(4);
    expect(overlap.matchedChunkCount).toBe(1);
    expect(overlap.overlapRatio).toBe(0.25);
    expect(overlap.isSkewed).toBe(true);
  });

  it('handles empty manifest chunks gracefully', () => {
    const build = makeBuild([], [], 0);
    const stats = makeStats([], []);
    const overlap = checkWebpackStatsOverlap(build, stats);
    expect(overlap.manifestChunkCount).toBe(0);
    expect(overlap.matchedChunkCount).toBe(0);
    expect(overlap.overlapRatio).toBe(1);
    expect(overlap.isSkewed).toBe(false);
  });
});
