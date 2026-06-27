#!/usr/bin/env node

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import { registerLoadBuildStats } from './tools/load-build-stats.js';
import { registerGetLargestRoutes } from './tools/get-largest-routes.js';
import { registerGetSharedChunks } from './tools/get-shared-chunks.js';
import { registerCompareBuilds } from './tools/compare-builds.js';
import { registerExplainGrowth } from './tools/explain-growth.js';
import { registerHowToCollectStats } from './tools/how-to-collect-stats.js';
import { registerLoadWebpackStats } from './tools/load-webpack-stats.js';
import { registerTraceImport } from './tools/trace-import.js';

const server = new McpServer({
  name: 'perfonext-build-mcp',
  version: '0.3.0',
});

registerLoadBuildStats(server);
registerGetLargestRoutes(server);
registerGetSharedChunks(server);
registerCompareBuilds(server);
registerExplainGrowth(server);
registerHowToCollectStats(server);
registerLoadWebpackStats(server);
registerTraceImport(server);

const transport = new StdioServerTransport();
await server.connect(transport);