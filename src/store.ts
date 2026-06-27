import type { ParsedBuildStats, ParsedWebpackStats } from './parser/types.js';

const builds = new Map<string, ParsedBuildStats>();
const webpackStats = new Map<string, ParsedWebpackStats>();

export function storeBuildStats(build: ParsedBuildStats): void {
  builds.set(build.id, build);
}

export function getBuildStats(id: string): ParsedBuildStats | undefined {
  return builds.get(id);
}

export function storeWebpackStats(stats: ParsedWebpackStats): void {
  webpackStats.set(stats.buildId, stats);
}

export function getWebpackStats(buildId: string): ParsedWebpackStats | undefined {
  return webpackStats.get(buildId);
}

export function listBuildStats(): Array<{
  id: string;
  buildDir: string;
  routeCount: number;
  chunkCount: number;
  totalChunkBytes: number;
  buildTimeMs: number | null;
}> {
  return Array.from(builds.values()).map(build => ({
    id: build.id,
    buildDir: build.buildDir,
    routeCount: build.routes.length,
    chunkCount: build.chunks.length,
    totalChunkBytes: build.totalChunkBytes,
    buildTimeMs: build.buildTimeMs,
  }));
}