import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { parseBuildStats } from '../src/parser/build-stats.js';
import {
  extractPackageName,
  parseWebpackStats,
  traceImport,
} from '../src/parser/webpack-stats.js';
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
  });
});

describe('trace_import', () => {
  it('traces an import chain from an entry to the matched module', async () => {
    const stats = await parseWebpackStats(fixtureBuildDir, 'build-1');
    const result = traceImport(stats!, 'react-dom');

    expect(result.matchCount).toBe(1);
    const trace = result.traces[0];
    expect(trace.packageName).toBe('react-dom');
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
    expect(withStats.chunks.some(chunk => chunk.chunkPath.includes('stats.json'))).toBe(false);
  });
});
