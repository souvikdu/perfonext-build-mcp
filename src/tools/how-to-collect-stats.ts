import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

type CollectionMethod = 'manual' | 'automatic';
type CollectionScenario = 'webpack' | 'turbopack';

export const STATS_DEV_DEPENDENCIES = ['webpack-stats-plugin', 'cross-env'] as const;
export const ANALYZE_BUILD_COMMAND = 'cross-env ANALYZE=true next build --webpack';
export const INSTALL_DEV_DEPENDENCIES_INSTRUCTION =
  "Install webpack-stats-plugin and cross-env as devDependencies in the Next.js app package, using this repository's existing package manager and workspace conventions.";
export const WEBPACK_RECIPE_NOTE =
  'This recipe requires webpack. Turbopack builds will not produce .next/stats.json.';

export const NEXT_CONFIG_WEBPACK_SNIPPET = `// next.config.ts — write .next/stats.json only when ANALYZE=true
import type { NextConfig } from "next";
import { StatsWriterPlugin } from "webpack-stats-plugin";

const nextConfig: NextConfig = {
  // Client/server/edge compilations race the same filename; without !isServer
  // a later server pass can overwrite a ~14 MB client graph with a ~30 KB file.
  webpack(config, { isServer }) {
    if (process.env.ANALYZE === "true" && !isServer) {
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

export function buildCollectStatsResponse(
  method: CollectionMethod,
  scenario: CollectionScenario,
): Record<string, unknown> {
  if (scenario === 'turbopack') {
    return turbopackResponse();
  }

  return method === 'manual' ? buildManualResponse() : buildAutomaticResponse();
}

function buildManualResponse(): Record<string, unknown> {
  return {
    method: 'manual',
    note: WEBPACK_RECIPE_NOTE,
    steps: [
      {
        step: 1,
        title: 'Add the dev dependencies',
        instruction: INSTALL_DEV_DEPENDENCIES_INSTRUCTION,
        packages: [...STATS_DEV_DEPENDENCIES],
      },
      {
        step: 2,
        title: 'Emit stats behind an ANALYZE flag in next.config',
        snippet: NEXT_CONFIG_WEBPACK_SNIPPET,
      },
      {
        step: 3,
        title: 'Build with webpack and the ANALYZE flag',
        command: ANALYZE_BUILD_COMMAND,
      },
    ],
    producesFile: '.next/stats.json',
    nextStep:
      'Once .next/stats.json exists, call load_webpack_stats with the same buildDir and the buildId from load_build_stats.',
  };
}

function buildAutomaticResponse(): Record<string, unknown> {
  return {
    method: 'automatic',
    note: WEBPACK_RECIPE_NOTE,
    actions: [
      {
        action: 'add-dev-dependency',
        packages: [...STATS_DEV_DEPENDENCIES],
        instruction: INSTALL_DEV_DEPENDENCIES_INSTRUCTION,
      },
      {
        action: 'edit-next-config',
        description:
          'Add a webpack hook gated behind ANALYZE=true && !isServer that writes .next/stats.json.',
        snippet: NEXT_CONFIG_WEBPACK_SNIPPET,
      },
      {
        action: 'add-package-script',
        script: { analyze: ANALYZE_BUILD_COMMAND },
      },
      {
        action: 'run-build',
        run: ANALYZE_BUILD_COMMAND,
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
      'suggest_optimizations',
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
      const payload = buildCollectStatsResponse(resolvedMethod, resolvedScenario);

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
