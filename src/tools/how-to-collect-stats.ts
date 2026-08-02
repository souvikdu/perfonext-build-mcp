import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

type CollectionMethod = 'manual' | 'automatic';
type CollectionScenario = 'webpack' | 'turbopack';

const NEXT_CONFIG_WEBPACK_SNIPPET = `// next.config.ts — write .next/stats.json only when ANALYZE=true
import type { NextConfig } from "next";
import { StatsWriterPlugin } from "webpack-stats-plugin";

const nextConfig: NextConfig = {
  webpack(config) {
    if (process.env.ANALYZE === "true") {
      config.plugins.push(
        new StatsWriterPlugin({
          filename: "stats.json", // -> .next/stats.json
          // ids + large modulesSpace are required: without them webpack drops
          // chunk ids and collapses the module list, yielding empty attribution.
          stats: {
            all: false,
            modules: true,
            chunks: true,
            chunkModules: true,
            reasons: true,
            ids: true,
            nestedModules: true,
            modulesSpace: Infinity,
            chunkModulesSpace: Infinity,
          },
        }),
      );
    }
    return config;
  },
};

export default nextConfig;`;

function buildManualResponse(scenario: CollectionScenario): Record<string, unknown> {
  if (scenario === 'turbopack') {
    return turbopackResponse();
  }

  return {
    method: 'manual',
    steps: [
      {
        step: 1,
        title: 'Add the dev dependency',
        command: 'npm install --save-dev webpack-stats-plugin',
      },
      {
        step: 2,
        title: 'Emit stats behind an ANALYZE flag in next.config',
        snippet: NEXT_CONFIG_WEBPACK_SNIPPET,
      },
      {
        step: 3,
        title: 'Build with the flag set',
        command: 'ANALYZE=true next build',
      },
    ],
    producesFile: '.next/stats.json',
    nextStep:
      'Once .next/stats.json exists, call load_webpack_stats with the same buildDir and the buildId from load_build_stats.',
  };
}

function buildAutomaticResponse(scenario: CollectionScenario): Record<string, unknown> {
  if (scenario === 'turbopack') {
    return turbopackResponse();
  }

  return {
    method: 'automatic',
    actions: [
      {
        action: 'add-dev-dependency',
        run: 'npm install --save-dev webpack-stats-plugin',
      },
      {
        action: 'edit-next-config',
        description: 'Add a webpack hook gated behind ANALYZE=true that writes .next/stats.json.',
        snippet: NEXT_CONFIG_WEBPACK_SNIPPET,
      },
      {
        action: 'add-package-script',
        script: { analyze: 'ANALYZE=true next build' },
      },
      {
        action: 'run-build',
        run: 'npm run analyze',
      },
      {
        action: 'verify-output',
        description: 'Confirm .next/stats.json exists before loading it.',
      },
    ],
    producesFile: '.next/stats.json',
    nextStep:
      'After .next/stats.json exists, call load_webpack_stats with the same buildDir and the buildId from load_build_stats.',
  };
}

function turbopackResponse(): Record<string, unknown> {
  return {
    method: 'unavailable',
    scenario: 'turbopack',
    summary:
      'Turbopack has no webpack module graph, so .next/stats.json cannot be produced and trace_import cannot run.',
    guidance:
      'Run a one-off webpack build (omit --turbopack) with the stats hook to use trace_import, or stay on the manifest-only tools.',
    manifestOnlyTools: [
      'load_build_stats',
      'get_largest_routes',
      'get_shared_chunks',
      'compare_builds',
      'explain_growth',
    ],
    nextStep:
      'Rebuild with webpack to produce .next/stats.json, or continue with get_largest_routes / get_shared_chunks on the build you already loaded.',
  };
}

export function registerHowToCollectStats(server: McpServer): void {
  server.registerTool(
    'how_to_collect_stats',
    {
      title: 'How To Collect Webpack Stats',
      description:
        'Explain how to generate the webpack stats file (.next/stats.json) required by the bundle attribution ' +
        'tools. Choose manual (a recipe you apply yourself) or automatic (an action plan Copilot executes).',
      inputSchema: {
        method: z
          .enum(['manual', 'automatic'])
          .describe(
            'manual: return a recipe to apply yourself. automatic: return an action plan for Copilot to execute.',
          ),
        scenario: z
          .enum(['webpack', 'turbopack'])
          .optional()
          .describe(
            'Collection context. Defaults to webpack. Use turbopack if the app builds with --turbopack.',
          ),
      },
    },
    async ({ method, scenario }) => {
      const resolvedScenario: CollectionScenario = scenario ?? 'webpack';
      const resolvedMethod: CollectionMethod = method;
      const payload =
        resolvedMethod === 'manual'
          ? buildManualResponse(resolvedScenario)
          : buildAutomaticResponse(resolvedScenario);

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(payload, null, 2),
          },
        ],
      };
    },
  );
}
