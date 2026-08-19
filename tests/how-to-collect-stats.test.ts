import { describe, expect, it } from 'vitest';

import { NEXT_CONFIG_WEBPACK_SNIPPET } from '../src/tools/how-to-collect-stats.js';

describe('how_to_collect_stats recipe', () => {
  it('gates StatsWriterPlugin on ANALYZE=true and !isServer', () => {
    expect(NEXT_CONFIG_WEBPACK_SNIPPET).toContain('webpack(config, { isServer })');
    expect(NEXT_CONFIG_WEBPACK_SNIPPET).toContain(
      'if (process.env.ANALYZE === "true" && !isServer)',
    );
  });
});
