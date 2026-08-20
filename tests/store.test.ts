import { afterEach, describe, expect, it } from 'vitest';

import {
  clearBuildStats,
  getBuildStats,
  getWebpackStats,
  listBuildStats,
  storeBuildStats,
  storeWebpackStats,
} from '../src/store.js';
import type { ParsedBuildStats, ParsedWebpackStats } from '../src/parser/types.js';

function buildStatsFixture(id: string): ParsedBuildStats {
  return {
    id,
    buildDir: `/path/to/${id}`,
    buildOutputPath: null,
    routes: [],
    chunks: [],
    totalChunkBytes: 1000,
    sharedChunkBytes: 500,
    buildTimeMs: 1200,
  };
}

function webpackStatsFixture(buildId: string): ParsedWebpackStats {
  return {
    buildId,
    statsPath: `/path/to/${buildId}/stats.json`,
    modules: [],
    chunks: [],
    moduleCount: 10,
    parsedModuleCount: 10,
  };
}

describe('store', () => {
  afterEach(() => {
    clearBuildStats();
  });

  it('stores and retrieves build stats', () => {
    const build = buildStatsFixture('b1');
    storeBuildStats(build);
    expect(getBuildStats('b1')).toBe(build);
    expect(listBuildStats()).toHaveLength(1);
  });

  it('stores and retrieves webpack stats', () => {
    const ws = webpackStatsFixture('b1');
    storeWebpackStats(ws);
    expect(getWebpackStats('b1')).toBe(ws);
  });

  it('evicts oldest build and associated webpack stats when cap of 20 is exceeded', () => {
    for (let i = 0; i < 21; i++) {
      const id = `b${i}`;
      storeBuildStats(buildStatsFixture(id));
      storeWebpackStats(webpackStatsFixture(id));
    }

    expect(getBuildStats('b0')).toBeUndefined(); // oldest evicted
    expect(getWebpackStats('b0')).toBeUndefined(); // linked webpack stats also evicted
    expect(getBuildStats('b20')).toBeDefined(); // newest kept
    expect(getWebpackStats('b20')).toBeDefined();
    expect(listBuildStats()).toHaveLength(20);
  });

  it('evicts oldest standalone webpack stats when cap of 20 is exceeded', () => {
    for (let i = 0; i < 21; i++) {
      const id = `ws${i}`;
      storeWebpackStats(webpackStatsFixture(id));
    }

    expect(getWebpackStats('ws0')).toBeUndefined();
    expect(getWebpackStats('ws20')).toBeDefined();
  });

  it('clears all builds and webpack stats on clearBuildStats', () => {
    storeBuildStats(buildStatsFixture('b1'));
    storeWebpackStats(webpackStatsFixture('b1'));
    clearBuildStats();
    expect(getBuildStats('b1')).toBeUndefined();
    expect(getWebpackStats('b1')).toBeUndefined();
    expect(listBuildStats()).toHaveLength(0);
  });
});
