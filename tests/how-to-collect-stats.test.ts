import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  ANALYZE_BUILD_COMMAND,
  NEXT_CONFIG_WEBPACK_SNIPPET,
  buildCollectStatsResponse,
} from '../src/tools/how-to-collect-stats.js';
import { registerLoadBuildStats } from '../src/tools/load-build-stats.js';
import { createToolHandlerStub } from './helpers/tool-stub.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const emptyManifestDir = resolve(__dirname, 'fixtures/empty-manifest/.next');

describe('how_to_collect_stats recipe', () => {
  it('gates StatsWriterPlugin on ANALYZE=true and !isServer', () => {
    expect(NEXT_CONFIG_WEBPACK_SNIPPET).toContain('webpack(config, { isServer })');
    expect(NEXT_CONFIG_WEBPACK_SNIPPET).toContain(
      'if (process.env.ANALYZE === "true" && !isServer)',
    );
  });

  it('uses cross-env and --webpack in the default webpack recipe', () => {
    expect(ANALYZE_BUILD_COMMAND).toContain('cross-env');
    expect(ANALYZE_BUILD_COMMAND).toContain('--webpack');

    const automatic = buildCollectStatsResponse('automatic', 'webpack');
    expect(JSON.stringify(automatic)).toContain('cross-env');
    expect(JSON.stringify(automatic)).toContain('--webpack');
    expect(JSON.stringify(automatic)).toContain('webpack-stats-plugin');
    expect(automatic.note).toContain('Turbopack builds will not produce .next/stats.json');

    const manual = buildCollectStatsResponse('manual', 'webpack');
    expect(JSON.stringify(manual)).toContain('cross-env');
    expect(JSON.stringify(manual)).toContain('--webpack');
  });

  it('lists suggest_optimizations among Turbopack manifest-only tools', () => {
    const turbopack = buildCollectStatsResponse('automatic', 'turbopack');
    expect(turbopack.manifestOnlyTools).toContain('suggest_optimizations');
  });
});

describe('load_build_stats empty manifest', () => {
  it('returns a warning when manifests are readable but route/chunk maps are empty', async () => {
    const { server, call } = createToolHandlerStub();
    registerLoadBuildStats(server);

    const result = await call('load_build_stats', { buildDir: emptyManifestDir });
    const payload = JSON.parse(result.content[0].text as string);

    expect(payload.routeCount).toBe(0);
    expect(payload.chunkCount).toBe(0);
    expect(payload.warning).toContain('route/chunk map is empty');
    expect(payload.warning).toContain('not .next/standalone');
    expect(payload.warning).toContain('build-manifest.json');
  });
});
