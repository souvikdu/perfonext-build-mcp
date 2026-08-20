import type { ParsedBuildStats, ParsedWebpackStats } from './parser/types.js';

const MAX_BUILDS = 20;

const builds = new Map<string, ParsedBuildStats>();
const webpackStats = new Map<string, ParsedWebpackStats>();

export function storeBuildStats(build: ParsedBuildStats): void {
  if (builds.size >= MAX_BUILDS && !builds.has(build.id)) {
    const oldestBuildId = builds.keys().next().value;
    if (oldestBuildId !== undefined) {
      builds.delete(oldestBuildId);
      webpackStats.delete(oldestBuildId);
    }
  }
  builds.set(build.id, build);
}

export function getBuildStats(id: string): ParsedBuildStats | undefined {
  return builds.get(id);
}

export function storeWebpackStats(stats: ParsedWebpackStats): void {
  if (webpackStats.size >= MAX_BUILDS && !webpackStats.has(stats.buildId)) {
    const oldestKey = webpackStats.keys().next().value;
    if (oldestKey !== undefined) {
      webpackStats.delete(oldestKey);
    }
  }
  webpackStats.set(stats.buildId, stats);
}

export function getWebpackStats(buildId: string): ParsedWebpackStats | undefined {
  return webpackStats.get(buildId);
}

export function clearBuildStats(): void {
  builds.clear();
  webpackStats.clear();
}

export function listBuildStats(): Array<{
  id: string;
  buildDir: string;
  routeCount: number;
  chunkCount: number;
  totalChunkBytes: number;
  buildTimeMs: number | null;
}> {
  return Array.from(builds.values()).map((build) => ({
    id: build.id,
    buildDir: build.buildDir,
    routeCount: build.routes.length,
    chunkCount: build.chunks.length,
    totalChunkBytes: build.totalChunkBytes,
    buildTimeMs: build.buildTimeMs,
  }));
}
