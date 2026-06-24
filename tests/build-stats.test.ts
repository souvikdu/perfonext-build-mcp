import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { compareBuilds, explainGrowth, getBuildSummary, getLargestRoutes, getSharedChunks, normalizeChunkKey } from '../src/parser/analysis.js';
import { parseBuildDurationMs, parseBuildStats } from '../src/parser/build-stats.js';
import type { ParsedBuildStats } from '../src/parser/types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const fixtureBuildDir = resolve(__dirname, 'fixtures/sample-next-build/.next');
const fixtureBuildOutputPath = resolve(__dirname, 'fixtures/sample-next-build/build-output.txt');
const fixtureUpdatedBuildDir = resolve(__dirname, 'fixtures/sample-next-build-updated/.next');
const fixtureUpdatedBuildOutputPath = resolve(__dirname, 'fixtures/sample-next-build-updated/build-output.txt');

describe('build stats parser', () => {
  it('parses Next.js build artifacts and emitted chunk sizes', async () => {
    const build = await parseBuildStats(fixtureBuildDir, fixtureBuildOutputPath);

    expect(build.routes).toHaveLength(4);
    expect(build.chunks.length).toBeGreaterThan(0);
    expect(build.totalChunkBytes).toBeGreaterThan(0);
    expect(build.sharedChunkBytes).toBeGreaterThan(0);
    expect(build.buildTimeMs).toBe(12300);

    const dashboard = build.routes.find(route => route.path === '/dashboard');
    expect(dashboard?.type).toBe('isr');
    expect(dashboard?.isPrerendered).toBe(true);
    expect(dashboard?.prerenderBlockedReason).toBe('isr');

    const blog = build.routes.find(route => route.path === '/blog/[slug]');
    expect(blog?.type).toBe('dynamic');
    expect(blog?.prerenderBlockedReason).toBe('dynamic-params');

    const home = build.routes.find(route => route.path === '/');
    expect(home?.prerenderBlockedReason).toBeNull();

    const search = build.routes.find(route => route.path === '/search');
    expect(search?.isAppRoute).toBe(true);
    expect(search?.prerenderBlockedReason).toBeNull();
  });

  it('extracts build duration from captured build output', () => {
    expect(parseBuildDurationMs('Compiled successfully in 12.3s')).toBe(12300);
    expect(parseBuildDurationMs('Done in 840ms')).toBe(840);
    expect(parseBuildDurationMs('no duration here')).toBeNull();
  });
});

describe('build stats analysis', () => {
  it('returns a summary with route and shared chunk counts', async () => {
    const build = await parseBuildStats(fixtureBuildDir, fixtureBuildOutputPath);
    const summary = getBuildSummary(build);

    expect(summary.routeCount).toBe(4);
    expect(summary.sharedChunkCount).toBeGreaterThan(0);
  });

  it('ranks largest routes by total emitted bytes', async () => {
    const build = await parseBuildStats(fixtureBuildDir, fixtureBuildOutputPath);
    const routes = getLargestRoutes(build, 3);

    expect(routes).toHaveLength(3);
    expect(routes[0].path).toBe('/dashboard');
    expect(routes[0].totalBytes).toBeGreaterThanOrEqual(routes[1].totalBytes);
    expect(routes[0].sharedRatio).toBeGreaterThan(0);
  });

  it('ranks shared chunks by size and route fan-out', async () => {
    const build = await parseBuildStats(fixtureBuildDir, fixtureBuildOutputPath);
    const chunks = getSharedChunks(build, 3);

    expect(chunks).toHaveLength(3);
    expect(chunks[0].chunkPath).toBe('static/chunks/framework.js');
    expect(chunks[0].routeCount).toBe(4);
    expect(chunks[0].sharedByRoutes).toContain('/dashboard');
  });

  it('compares two builds and surfaces the biggest route and chunk growth', async () => {
    const baseline = await parseBuildStats(fixtureBuildDir, fixtureBuildOutputPath);
    const current = await parseBuildStats(fixtureUpdatedBuildDir, fixtureUpdatedBuildOutputPath);
    const comparison = compareBuilds(baseline, current, 3);

    expect(comparison.totalChunkDeltaBytes).toBeGreaterThan(0);
    expect(comparison.totalChunkDeltaRatio).not.toBeNull();
    expect(comparison.buildTimeDeltaMs).toBe(2700);
    expect(comparison.routeDeltas[0].path).toBe('/dashboard');
    expect(comparison.routeDeltas[0].deltaBytes).toBeGreaterThan(0);
    expect(comparison.chunkDeltas[0].chunkPath).toBe('static/chunks/dashboard.js');
    expect(comparison.chunkDeltas[0].deltaBytes).toBeGreaterThan(0);
  });

  it('explains growth with severity-ranked route findings and top growing chunks', async () => {
    const baseline = await parseBuildStats(fixtureBuildDir, fixtureBuildOutputPath);
    const current = await parseBuildStats(fixtureUpdatedBuildDir, fixtureUpdatedBuildOutputPath);
    const explanation = explainGrowth(baseline, current, 5);

    // Overall summary
    expect(explanation.overall.totalDeltaBytes).toBeGreaterThan(0);
    expect(explanation.overall.grownChunkCount).toBeGreaterThan(0);
    expect(['info', 'warning', 'critical']).toContain(explanation.overall.severity);

    // Route findings contain only grown routes, ranked by delta
    expect(explanation.routeFindings.length).toBeGreaterThan(0);
    expect(explanation.routeFindings.every(f => f.deltaBytes > 0)).toBe(true);
    expect(explanation.routeFindings[0].path).toBe('/dashboard');
    expect(explanation.routeFindings[0].topContributingChunks.length).toBeGreaterThan(0);
    expect(['info', 'warning', 'critical']).toContain(explanation.routeFindings[0].severity);

    // Top growing chunks ranked by absolute growth
    expect(explanation.topGrowingChunks.length).toBeGreaterThan(0);
    expect(explanation.topGrowingChunks[0].chunkPath).toBe('static/chunks/dashboard.js');
    expect(explanation.topGrowingChunks[0].deltaBytes).toBeGreaterThan(0);
    expect(explanation.topGrowingChunks.every(c => c.deltaBytes > 0)).toBe(true);
    // Chunks are sorted by descending delta
    for (let i = 1; i < explanation.topGrowingChunks.length; i++) {
      expect(explanation.topGrowingChunks[i - 1].deltaBytes).toBeGreaterThanOrEqual(
        explanation.topGrowingChunks[i].deltaBytes,
      );
    }
  });

  it('emits evidence-backed growth suggestions ranked by severity', async () => {
    const baseline = await parseBuildStats(fixtureBuildDir, fixtureBuildOutputPath);
    const current = await parseBuildStats(fixtureUpdatedBuildDir, fixtureUpdatedBuildOutputPath);
    const explanation = explainGrowth(baseline, current, 10);

    expect(explanation.suggestions.length).toBeGreaterThan(0);

    // Every suggestion carries actionable evidence
    for (const suggestion of explanation.suggestions) {
      expect(['shared-chunk-growth', 'new-chunk', 'chunk-growth', 'route-regression']).toContain(
        suggestion.kind,
      );
      expect(['warning', 'critical']).toContain(suggestion.severity);
      expect(suggestion.deltaBytes).toBeGreaterThan(0);
      expect(suggestion.message.length).toBeGreaterThan(0);
      expect(suggestion.recommendedAction.length).toBeGreaterThan(0);
      expect(suggestion.chunkPath ?? suggestion.routePath).toBeTruthy();
    }

    // Suggestions are ordered by descending severity, then descending delta
    const rank = { info: 0, warning: 1, critical: 2 } as const;
    for (let i = 1; i < explanation.suggestions.length; i++) {
      const previous = explanation.suggestions[i - 1];
      const next = explanation.suggestions[i];
      expect(rank[previous.severity]).toBeGreaterThanOrEqual(rank[next.severity]);
      if (previous.severity === next.severity) {
        expect(previous.deltaBytes).toBeGreaterThanOrEqual(next.deltaBytes);
      }
    }

    // The growing dashboard chunk is surfaced as a concrete suggestion
    expect(
      explanation.suggestions.some(s => s.chunkPath === 'static/chunks/dashboard.js'),
    ).toBe(true);
  });

  it('returns no suggestions when the current build does not grow', async () => {
    const build = await parseBuildStats(fixtureBuildDir, fixtureBuildOutputPath);
    const explanation = explainGrowth(build, build, 10);

    expect(explanation.overall.totalDeltaBytes).toBe(0);
    expect(explanation.routeFindings).toHaveLength(0);
    expect(explanation.topGrowingChunks).toHaveLength(0);
    expect(explanation.suggestions).toHaveLength(0);
  });
});

describe('hash-normalized chunk matching', () => {
  it('strips Next.js content hashes from emitted filenames', () => {
    expect(normalizeChunkKey('static/chunks/framework-feb80b81c41dadae.js')).toBe(
      'static/chunks/framework.js',
    );
    expect(normalizeChunkKey('static/chunks/main-4d0510f8d2f28672.js')).toBe(
      'static/chunks/main.js',
    );
    expect(normalizeChunkKey('static/chunks/pages/index-aa99d5f7f2a76986.js')).toBe(
      'static/chunks/pages/index.js',
    );
    // CSS files are named purely by a content hash, which is stable for unchanged content,
    // so they are matched by their real filename rather than collapsed together.
    expect(normalizeChunkKey('static/css/4c7ae03ab6df2350.css')).toBe(
      'static/css/4c7ae03ab6df2350.css',
    );
    // Already-stable names are left untouched.
    expect(normalizeChunkKey('static/chunks/dashboard.js')).toBe('static/chunks/dashboard.js');
    expect(normalizeChunkKey('/static/chunks/webpack-4ec3a227830ef821.js')).toBe(
      'static/chunks/webpack.js',
    );
  });

  function makeBuild(
    id: string,
    chunks: Array<{ chunkPath: string; sizeBytes: number; routes: string[] }>,
  ): ParsedBuildStats {
    const routeNames = Array.from(new Set(chunks.flatMap(chunk => chunk.routes)));
    return {
      id,
      buildDir: id,
      buildOutputPath: null,
      routes: routeNames.map(path => {
        const routeChunks = chunks.filter(chunk => chunk.routes.includes(path));
        const totalBytes = routeChunks.reduce((sum, chunk) => sum + chunk.sizeBytes, 0);
        return {
          path,
          type: 'static' as const,
          prerenderBlockedReason: null,
          chunkPaths: routeChunks.map(chunk => chunk.chunkPath),
          totalBytes,
          initialLoadBytes: totalBytes,
          sharedChunkBytes: 0,
          exclusiveChunkBytes: totalBytes,
          isPrerendered: false,
          isAppRoute: false,
        };
      }),
      chunks: chunks.map(chunk => ({
        chunkPath: chunk.chunkPath,
        sizeBytes: chunk.sizeBytes,
        routeCount: chunk.routes.length,
        sharedByRoutes: [...chunk.routes].sort(),
        isShared: chunk.routes.length > 1,
      })),
      totalChunkBytes: chunks.reduce((sum, chunk) => sum + chunk.sizeBytes, 0),
      sharedChunkBytes: 0,
      buildTimeMs: null,
    } satisfies ParsedBuildStats;
  }

  it('matches a rehashed chunk across builds instead of flagging it as new', () => {
    const baseline = makeBuild('baseline', [
      { chunkPath: 'static/chunks/framework-aaaaaaaaaaaaaaaa.js', sizeBytes: 100_000, routes: ['/', '/about'] },
    ]);
    const current = makeBuild('current', [
      { chunkPath: 'static/chunks/framework-bbbbbbbbbbbbbbbb.js', sizeBytes: 101_000, routes: ['/', '/about'] },
    ]);

    const explanation = explainGrowth(baseline, current, 10);

    expect(explanation.overall.newChunkCount).toBe(0);
    expect(explanation.overall.removedChunkCount).toBe(0);
    expect(explanation.topGrowingChunks).toHaveLength(1);
    expect(explanation.topGrowingChunks[0].isNew).toBe(false);
    expect(explanation.topGrowingChunks[0].deltaBytes).toBe(1_000);
    // A 1 KB change to the framework chunk is not a critical regression.
    expect(explanation.suggestions).toHaveLength(0);
  });

  it('still flags a genuinely new chunk after normalization', () => {
    const baseline = makeBuild('baseline', [
      { chunkPath: 'static/chunks/framework-aaaaaaaaaaaaaaaa.js', sizeBytes: 100_000, routes: ['/'] },
    ]);
    const current = makeBuild('current', [
      { chunkPath: 'static/chunks/framework-bbbbbbbbbbbbbbbb.js', sizeBytes: 100_000, routes: ['/'] },
      { chunkPath: 'static/chunks/charting-cccccccccccccccc.js', sizeBytes: 80_000, routes: ['/'] },
    ]);

    const explanation = explainGrowth(baseline, current, 10);

    expect(explanation.overall.newChunkCount).toBe(1);
    expect(explanation.topGrowingChunks).toHaveLength(1);
    expect(explanation.topGrowingChunks[0].chunkPath).toBe(
      'static/chunks/charting-cccccccccccccccc.js',
    );
    expect(explanation.topGrowingChunks[0].isNew).toBe(true);
    expect(explanation.suggestions.some(s => s.kind === 'new-chunk')).toBe(true);
  });

  it('does not invent growth for identical pure-hash CSS files across builds', () => {
    // Two distinct CSS files, byte-identical in both builds (same content => same hash).
    const cssChunks = [
      { chunkPath: 'static/css/4c7ae03ab6df2350.css', sizeBytes: 154_823, routes: ['/api-doc'] },
      { chunkPath: 'static/css/aae468ddb75cde20.css', sizeBytes: 5_826, routes: ['/'] },
    ];
    const baseline = makeBuild('baseline', cssChunks);
    const current = makeBuild('current', cssChunks);

    const explanation = explainGrowth(baseline, current, 10);

    // Distinct CSS files are kept distinct (not collapsed into one bucket) and unchanged
    // content produces zero growth and no false regression.
    expect(explanation.overall.totalDeltaBytes).toBe(0);
    expect(explanation.overall.newChunkCount).toBe(0);
    expect(explanation.overall.grownChunkCount).toBe(0);
    expect(explanation.topGrowingChunks).toHaveLength(0);
    expect(explanation.suggestions).toHaveLength(0);
  });
});