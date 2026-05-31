import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { compareBuilds, getBuildSummary, getLargestRoutes, getSharedChunks } from '../src/parser/analysis.js';
import { parseBuildDurationMs, parseBuildStats } from '../src/parser/build-stats.js';

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
});