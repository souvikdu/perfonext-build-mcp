import type { ParsedBuildStats } from './parser/types.js';

const builds = new Map<string, ParsedBuildStats>();

export function storeBuildStats(build: ParsedBuildStats): void {
  builds.set(build.id, build);
}

export function getBuildStats(id: string): ParsedBuildStats | undefined {
  return builds.get(id);
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