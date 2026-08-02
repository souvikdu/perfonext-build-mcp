import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import type {
  BuildChunk,
  DuplicatePackageEntry,
  ImportChainNode,
  ImportTrace,
  PackageCostEntry,
  ParsedBuildStats,
  ParsedWebpackStats,
  SharedChunkComposition,
  SharedChunkPackage,
  TraceImportResult,
  WebpackChunk,
  WebpackModule,
  WebpackModuleReason,
} from './types.js';

interface RawModule {
  name?: unknown;
  identifier?: unknown;
  size?: unknown;
  chunks?: unknown;
  reasons?: unknown;
}

interface RawChunk {
  id?: unknown;
  names?: unknown;
  files?: unknown;
  size?: unknown;
}

interface RawStats {
  modules?: unknown;
  chunks?: unknown;
}

const NODE_MODULES_MARKER = 'node_modules/';

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object';
}

function toFiniteNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((item): item is string => typeof item === 'string');
}

/**
 * Resolve the npm package an emitted module belongs to. Uses the LAST `node_modules/` segment so
 * nested installs (`a/node_modules/b`) attribute to the inner package, and preserves scoped names
 * (`@org/pkg`). Returns null for first-party application code.
 */
export function extractPackageName(moduleName: string): string | null {
  // Webpack `name` uses POSIX separators, but the `identifier` fallback can carry
  // Windows backslashes — normalize so attribution works on every platform.
  const normalized = moduleName.replace(/\\/g, '/');
  const markerIndex = normalized.lastIndexOf(NODE_MODULES_MARKER);
  if (markerIndex === -1) {
    return null;
  }

  const rest = normalized.slice(markerIndex + NODE_MODULES_MARKER.length);
  const parts = rest.split('/').filter(Boolean);
  if (parts.length === 0) {
    return null;
  }

  if (parts[0].startsWith('@') && parts.length >= 2) {
    return `${parts[0]}/${parts[1]}`;
  }

  return parts[0];
}

function normalizeReason(raw: unknown): WebpackModuleReason | null {
  if (!isRecord(raw)) {
    return null;
  }

  const moduleName = typeof raw.moduleName === 'string' ? raw.moduleName : null;
  const userRequest = typeof raw.userRequest === 'string' ? raw.userRequest : null;
  if (moduleName === null && userRequest === null) {
    return null;
  }

  return { moduleName, userRequest };
}

function normalizeModule(raw: RawModule): WebpackModule | null {
  const name =
    typeof raw.name === 'string'
      ? raw.name
      : typeof raw.identifier === 'string'
        ? raw.identifier
        : null;
  if (!name) {
    return null;
  }

  const chunkIds = Array.isArray(raw.chunks)
    ? raw.chunks.filter(
        (id): id is string | number => typeof id === 'string' || typeof id === 'number',
      )
    : [];

  const reasons = Array.isArray(raw.reasons)
    ? raw.reasons
        .map(normalizeReason)
        .filter((reason): reason is WebpackModuleReason => reason !== null)
    : [];

  return {
    name,
    packageName: extractPackageName(name),
    sizeBytes: toFiniteNumber(raw.size),
    chunkIds,
    reasons,
  } satisfies WebpackModule;
}

function normalizeChunk(raw: RawChunk): WebpackChunk | null {
  if (raw.id === undefined || (typeof raw.id !== 'string' && typeof raw.id !== 'number')) {
    return null;
  }

  return {
    id: raw.id,
    names: toStringArray(raw.names),
    files: toStringArray(raw.files),
    sizeBytes: toFiniteNumber(raw.size),
  } satisfies WebpackChunk;
}

/**
 * Parse a webpack module-stats JSON (`.next/stats.json`) into a compact, analysis-ready shape.
 * Only the fields the attribution tools need are retained — raw source, asset maps, and other
 * webpack noise are dropped so a multi-MB stats file stays small in memory.
 */
export async function parseWebpackStats(
  buildDirPath: string,
  buildId: string,
): Promise<ParsedWebpackStats | null> {
  const buildDir = resolve(buildDirPath);
  const statsPath = join(buildDir, 'stats.json');

  let content: string;
  try {
    content = await readFile(statsPath, 'utf-8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null;
    }

    throw error;
  }

  let raw: RawStats;
  try {
    raw = JSON.parse(content) as RawStats;
  } catch (error) {
    throw new Error(
      `Failed to parse webpack stats JSON at ${statsPath} (build "${buildId}"): ${(error as Error).message}`,
    );
  }

  const rawModules = Array.isArray(raw.modules) ? raw.modules : [];
  const rawChunks = Array.isArray(raw.chunks) ? raw.chunks : [];

  const modules = rawModules
    .map((module) => normalizeModule(module as RawModule))
    .filter((module): module is WebpackModule => module !== null);

  const chunks = rawChunks
    .map((chunk) => normalizeChunk(chunk as RawChunk))
    .filter((chunk): chunk is WebpackChunk => chunk !== null);

  return {
    buildId,
    statsPath,
    modules,
    chunks,
    moduleCount: rawModules.length,
    parsedModuleCount: modules.length,
  } satisfies ParsedWebpackStats;
}

function buildModuleIndex(stats: ParsedWebpackStats): Map<string, WebpackModule> {
  const index = new Map<string, WebpackModule>();
  for (const module of stats.modules) {
    index.set(module.name, module);
  }

  return index;
}

function chunkFilesForModule(
  module: WebpackModule,
  chunkById: Map<string | number, WebpackChunk>,
): string[] {
  const files = new Set<string>();
  for (const chunkId of module.chunkIds) {
    const chunk = chunkById.get(chunkId);
    for (const file of chunk?.files ?? []) {
      files.add(file);
    }
  }

  return Array.from(files).sort();
}

/**
 * Walk a module's `reasons` upward to the nearest entry to explain why it is bundled. Picks the
 * first resolvable parent at each step, guards against cycles, and caps depth so a pathological
 * graph cannot loop. Returns the chain ordered from entry → target.
 */
function buildImportChain(
  target: WebpackModule,
  moduleIndex: Map<string, WebpackModule>,
): ImportChainNode[] {
  const chain: ImportChainNode[] = [{ moduleName: target.name, packageName: target.packageName }];
  const visited = new Set<string>([target.name]);
  let current = target;
  const maxDepth = 25;

  for (let depth = 0; depth < maxDepth; depth += 1) {
    const parentReason = current.reasons.find(
      (reason) => reason.moduleName !== null && !visited.has(reason.moduleName),
    );
    if (!parentReason || parentReason.moduleName === null) {
      break;
    }

    const parent = moduleIndex.get(parentReason.moduleName);
    visited.add(parentReason.moduleName);
    chain.push({
      moduleName: parentReason.moduleName,
      packageName: parent?.packageName ?? extractPackageName(parentReason.moduleName),
    });

    if (!parent || parent.reasons.length === 0) {
      break;
    }

    current = parent;
  }

  return chain.reverse();
}

export function traceImport(
  stats: ParsedWebpackStats,
  moduleName: string,
  limit = 10,
): TraceImportResult {
  const query = moduleName.toLowerCase();
  const moduleIndex = buildModuleIndex(stats);
  const chunkById = new Map(stats.chunks.map((chunk) => [chunk.id, chunk] as const));

  const matches = stats.modules
    .filter((module) => module.name.toLowerCase().includes(query))
    .sort((left, right) => right.sizeBytes - left.sizeBytes);

  const traces: ImportTrace[] = matches.slice(0, limit).map((module) => ({
    moduleName: module.name,
    packageName: module.packageName,
    sizeBytes: module.sizeBytes,
    chunkFiles: chunkFilesForModule(module, chunkById),
    importChain: buildImportChain(module, moduleIndex),
  }));

  return {
    query: moduleName,
    matchCount: matches.length,
    traces,
  } satisfies TraceImportResult;
}

function normalizeChunkFile(chunkPath: string): string {
  return chunkPath.replace(/^\//, '');
}

interface DuplicateAccumulator {
  wastedBytes: number;
  totalBytes: number;
  chunkIds: Set<string | number>;
  chunkFiles: Set<string>;
}

/**
 * Rank npm packages whose code is emitted into more than one chunk. Wasted bytes are the
 * duplicated copies: `moduleBytes * (distinctChunkCount - 1)`, aggregated per package.
 */
export function findDuplicates(stats: ParsedWebpackStats, limit = 20): DuplicatePackageEntry[] {
  const chunkById = new Map(stats.chunks.map((chunk) => [chunk.id, chunk] as const));
  const byPackage = new Map<string, DuplicateAccumulator>();

  for (const module of stats.modules) {
    if (!module.packageName) {
      continue;
    }

    const distinctChunkIds = Array.from(new Set(module.chunkIds));
    const entry = byPackage.get(module.packageName) ?? {
      wastedBytes: 0,
      totalBytes: 0,
      chunkIds: new Set<string | number>(),
      chunkFiles: new Set<string>(),
    };

    entry.totalBytes += module.sizeBytes;
    if (distinctChunkIds.length > 1) {
      entry.wastedBytes += module.sizeBytes * (distinctChunkIds.length - 1);
    }

    for (const chunkId of distinctChunkIds) {
      entry.chunkIds.add(chunkId);
      for (const file of chunkById.get(chunkId)?.files ?? []) {
        entry.chunkFiles.add(file);
      }
    }

    byPackage.set(module.packageName, entry);
  }

  return Array.from(byPackage.entries())
    .filter(([, entry]) => entry.wastedBytes > 0)
    .map(
      ([packageName, entry]) =>
        ({
          packageName,
          wastedBytes: entry.wastedBytes,
          totalBytes: entry.totalBytes,
          // Distinct chunks, not files: one chunk can emit several files (.js + .css).
          chunkCount: entry.chunkIds.size,
          chunkFiles: Array.from(entry.chunkFiles).sort(),
        }) satisfies DuplicatePackageEntry,
    )
    .sort(
      (left, right) =>
        right.wastedBytes - left.wastedBytes || left.packageName.localeCompare(right.packageName),
    )
    .slice(0, limit);
}

/**
 * Explain what dominates each shared chunk: join the manifest's shared chunks to the webpack
 * module graph and rank the packages (and app code) by their byte share of the chunk.
 */
export function explainSharedChunks(
  build: ParsedBuildStats,
  stats: ParsedWebpackStats,
  limit = 5,
  packagesPerChunk = 5,
): SharedChunkComposition[] {
  const chunkByFile = new Map<string, WebpackChunk>();
  for (const chunk of stats.chunks) {
    for (const file of chunk.files) {
      // Normalize on insert so the join stays symmetric with the manifest-path lookup below.
      chunkByFile.set(normalizeChunkFile(file), chunk);
    }
  }

  const modulesByChunkId = new Map<string | number, WebpackModule[]>();
  for (const module of stats.modules) {
    for (const chunkId of new Set(module.chunkIds)) {
      const list = modulesByChunkId.get(chunkId) ?? [];
      list.push(module);
      modulesByChunkId.set(chunkId, list);
    }
  }

  // build.chunks is pre-sorted by sizeBytes desc, so the first `limit` shared chunks are the largest.
  const sharedChunks = build.chunks.filter((chunk) => chunk.isShared).slice(0, limit);

  return sharedChunks.map((chunk) => {
    const webpackChunk = chunkByFile.get(normalizeChunkFile(chunk.chunkPath));
    const modules = webpackChunk ? (modulesByChunkId.get(webpackChunk.id) ?? []) : [];

    const bytesByPackage = new Map<string, number>();
    let chunkModuleBytes = 0;
    for (const module of modules) {
      const label = module.packageName ?? '(app code)';
      bytesByPackage.set(label, (bytesByPackage.get(label) ?? 0) + module.sizeBytes);
      chunkModuleBytes += module.sizeBytes;
    }

    const topPackages: SharedChunkPackage[] = Array.from(bytesByPackage.entries())
      .map(([packageName, bytes]) => ({
        packageName,
        bytes,
        shareOfChunk: chunkModuleBytes === 0 ? 0 : bytes / chunkModuleBytes,
      }))
      .sort(
        (left, right) =>
          right.bytes - left.bytes || left.packageName.localeCompare(right.packageName),
      )
      .slice(0, packagesPerChunk);

    return {
      chunkPath: chunk.chunkPath,
      sizeBytes: chunk.sizeBytes,
      routeCount: chunk.routeCount,
      sharedByRoutes: chunk.sharedByRoutes,
      topPackages,
    } satisfies SharedChunkComposition;
  });
}

interface PackageCostAccumulator {
  totalBytes: number;
  moduleCount: number;
  sharedBytes: number;
  exclusiveBytes: number;
  chunkFiles: Set<string>;
  routes: Set<string>;
}

/**
 * Aggregate emitted module bytes per npm package, joined to the manifest so each package reports
 * which routes pay for it and how its bytes split between shared and route-exclusive chunks.
 */
export function getPackageCosts(
  build: ParsedBuildStats,
  stats: ParsedWebpackStats,
  limit = 20,
): PackageCostEntry[] {
  const chunkById = new Map(stats.chunks.map((chunk) => [chunk.id, chunk] as const));
  const buildChunkByFile = new Map<string, BuildChunk>();
  for (const chunk of build.chunks) {
    buildChunkByFile.set(normalizeChunkFile(chunk.chunkPath), chunk);
  }

  const byPackage = new Map<string, PackageCostAccumulator>();
  for (const module of stats.modules) {
    if (!module.packageName) {
      continue;
    }

    const acc = byPackage.get(module.packageName) ?? {
      totalBytes: 0,
      moduleCount: 0,
      sharedBytes: 0,
      exclusiveBytes: 0,
      chunkFiles: new Set<string>(),
      routes: new Set<string>(),
    };

    acc.totalBytes += module.sizeBytes;
    acc.moduleCount += 1;

    // Any shared placement counts wholly as shared; a duplicate exclusive copy is find_duplicates' job.
    let livesInSharedChunk = false;
    for (const chunkId of new Set(module.chunkIds)) {
      for (const file of chunkById.get(chunkId)?.files ?? []) {
        const buildChunk = buildChunkByFile.get(normalizeChunkFile(file));
        if (!buildChunk) {
          continue;
        }

        acc.chunkFiles.add(buildChunk.chunkPath);
        for (const route of buildChunk.sharedByRoutes) {
          acc.routes.add(route);
        }
        if (buildChunk.isShared) {
          livesInSharedChunk = true;
        }
      }
    }

    if (livesInSharedChunk) {
      acc.sharedBytes += module.sizeBytes;
    } else {
      acc.exclusiveBytes += module.sizeBytes;
    }

    byPackage.set(module.packageName, acc);
  }

  return Array.from(byPackage.entries())
    .map(
      ([packageName, acc]) =>
        ({
          packageName,
          totalBytes: acc.totalBytes,
          moduleCount: acc.moduleCount,
          chunkCount: acc.chunkFiles.size,
          sharedBytes: acc.sharedBytes,
          exclusiveBytes: acc.exclusiveBytes,
          routeCount: acc.routes.size,
        }) satisfies PackageCostEntry,
    )
    .sort(
      (left, right) =>
        right.totalBytes - left.totalBytes || left.packageName.localeCompare(right.packageName),
    )
    .slice(0, limit);
}
