import { randomUUID } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import type {
  BuildChunk,
  BuildRoute,
  ParsedBuildStats,
  PrerenderBlockedReason,
  RouteType,
} from './types.js';

interface BuildManifestRaw {
  pages?: unknown;
}

interface PrerenderManifestRouteRaw {
  initialRevalidateSeconds?: unknown;
}

interface PrerenderManifestRaw {
  routes?: unknown;
  dynamicRoutes?: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object';
}

async function readJsonIfPresent<T>(filePath: string): Promise<T | null> {
  try {
    const content = await readFile(filePath, 'utf-8');
    return JSON.parse(content) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null;
    }

    throw error;
  }
}

async function getFileSizeBytes(filePath: string): Promise<number> {
  try {
    const result = await stat(filePath);
    return result.size;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return 0;
    }

    throw error;
  }
}

function parseRouteMap(raw: unknown): Record<string, string[]> {
  if (!isRecord(raw)) {
    return {};
  }

  const routeMap: Record<string, string[]> = {};
  for (const [route, files] of Object.entries(raw)) {
    if (!Array.isArray(files)) {
      continue;
    }

    routeMap[route] = files.filter((file): file is string => typeof file === 'string');
  }

  return routeMap;
}

function shouldIncludeRoute(route: string): boolean {
  return !route.startsWith('/_');
}

function getRouteType(
  route: string,
  prerenderRoutes: Record<string, PrerenderManifestRouteRaw>,
  dynamicRoutes: Record<string, unknown>,
): RouteType {
  if (route in dynamicRoutes || route.includes('[')) {
    return 'dynamic';
  }

  const prerenderRoute = prerenderRoutes[route];
  if (
    prerenderRoute &&
    typeof prerenderRoute.initialRevalidateSeconds === 'number' &&
    Number.isFinite(prerenderRoute.initialRevalidateSeconds) &&
    prerenderRoute.initialRevalidateSeconds > 0
  ) {
    return 'isr';
  }

  return 'static';
}

function getPrerenderBlockedReason(
  route: string,
  prerenderRoutes: Record<string, PrerenderManifestRouteRaw>,
  dynamicRoutes: Record<string, unknown>,
): PrerenderBlockedReason {
  if (route in prerenderRoutes) {
    const revalidate = prerenderRoutes[route].initialRevalidateSeconds;
    if (typeof revalidate === 'number' && Number.isFinite(revalidate) && revalidate > 0) {
      return 'isr';
    }

    return null;
  }

  // In dynamicRoutes: has getStaticPaths but some or all paths render on-demand
  if (route in dynamicRoutes) {
    return 'dynamic-params';
  }

  // Not prerendered at all
  if (route.includes('[')) {
    return 'dynamic-params';
  }

  return 'server-side-props';
}

export function parseBuildDurationMs(output: string): number | null {
  const match = output.match(
    /(?:compiled(?:\s+\w+)*\s+in|done\s+in)\s+(\d+(?:\.\d+)?)\s*(ms|s|m)\b/i,
  );
  if (!match) {
    return null;
  }

  const value = Number(match[1]);
  const unit = match[2].toLowerCase();
  if (!Number.isFinite(value)) {
    return null;
  }

  if (unit === 'ms') {
    return Math.round(value);
  }

  if (unit === 's') {
    return Math.round(value * 1000);
  }

  return Math.round(value * 60 * 1000);
}

export async function parseBuildStats(
  buildDirPath: string,
  buildOutputPath?: string,
): Promise<ParsedBuildStats> {
  const buildDir = resolve(buildDirPath);
  const buildManifestPath = join(buildDir, 'build-manifest.json');
  const prerenderManifestPath = join(buildDir, 'prerender-manifest.json');
  const appBuildManifestPath = join(buildDir, 'app-build-manifest.json');

  const buildManifest = await readJsonIfPresent<BuildManifestRaw>(buildManifestPath);
  if (!buildManifest) {
    throw new Error(
      `Could not find build-manifest.json in ${buildDir}. Run next build first and point this tool at the .next directory.`,
    );
  }

  const prerenderManifest = await readJsonIfPresent<PrerenderManifestRaw>(prerenderManifestPath);
  const appBuildManifest = await readJsonIfPresent<BuildManifestRaw>(appBuildManifestPath);

  const pagesRouteMap = parseRouteMap(buildManifest.pages);
  const appRouteMap = parseRouteMap(appBuildManifest?.pages);
  const prerenderRoutes = isRecord(prerenderManifest?.routes)
    ? (prerenderManifest!.routes as Record<string, PrerenderManifestRouteRaw>)
    : {};
  const dynamicRoutes = isRecord(prerenderManifest?.dynamicRoutes)
    ? (prerenderManifest!.dynamicRoutes as Record<string, unknown>)
    : {};

  const allRoutes = new Map<string, { chunkPaths: string[]; isAppRoute: boolean }>();

  for (const [route, chunkPaths] of Object.entries(pagesRouteMap)) {
    if (!shouldIncludeRoute(route)) {
      continue;
    }

    allRoutes.set(route, {
      chunkPaths: Array.from(new Set(chunkPaths)),
      isAppRoute: false,
    });
  }

  for (const [route, chunkPaths] of Object.entries(appRouteMap)) {
    if (!shouldIncludeRoute(route)) {
      continue;
    }

    const existing = allRoutes.get(route);
    allRoutes.set(route, {
      chunkPaths: Array.from(new Set([...(existing?.chunkPaths ?? []), ...chunkPaths])),
      isAppRoute: true,
    });
  }

  const chunkRouteMap = new Map<string, Set<string>>();

  for (const [route, details] of allRoutes) {
    for (const chunkPath of details.chunkPaths) {
      if (!chunkRouteMap.has(chunkPath)) {
        chunkRouteMap.set(chunkPath, new Set<string>());
      }
      chunkRouteMap.get(chunkPath)!.add(route);
    }
  }

  const chunkSizeEntries = await Promise.all(
    Array.from(chunkRouteMap.keys()).map(async (chunkPath) => {
      const normalized = chunkPath.replace(/^\//, '');
      const sizeBytes = await getFileSizeBytes(join(buildDir, normalized));
      return [chunkPath, sizeBytes] as const;
    }),
  );

  const chunkSizeMap = new Map<string, number>(chunkSizeEntries);

  const chunks: BuildChunk[] = Array.from(chunkRouteMap.entries())
    .map(([chunkPath, routeSet]) => ({
      chunkPath,
      sizeBytes: chunkSizeMap.get(chunkPath) ?? 0,
      routeCount: routeSet.size,
      sharedByRoutes: Array.from(routeSet).sort(),
      isShared: routeSet.size > 1,
    }))
    .sort((left, right) => right.sizeBytes - left.sizeBytes);

  const routes: BuildRoute[] = Array.from(allRoutes.entries())
    .map(([route, details]) => {
      const totalBytes = details.chunkPaths.reduce(
        (sum, chunkPath) => sum + (chunkSizeMap.get(chunkPath) ?? 0),
        0,
      );
      const sharedChunkBytes = details.chunkPaths.reduce((sum, chunkPath) => {
        const routeCount = chunkRouteMap.get(chunkPath)?.size ?? 0;
        if (routeCount > 1) {
          return sum + (chunkSizeMap.get(chunkPath) ?? 0);
        }

        return sum;
      }, 0);

      return {
        path: route,
        type: getRouteType(route, prerenderRoutes, dynamicRoutes),
        prerenderBlockedReason: getPrerenderBlockedReason(route, prerenderRoutes, dynamicRoutes),
        chunkPaths: details.chunkPaths,
        totalBytes,
        initialLoadBytes: totalBytes,
        sharedChunkBytes,
        exclusiveChunkBytes: totalBytes - sharedChunkBytes,
        isPrerendered: route in prerenderRoutes,
        isAppRoute: details.isAppRoute,
      } satisfies BuildRoute;
    })
    .sort((left, right) => right.totalBytes - left.totalBytes);

  let buildTimeMs: number | null = null;
  let resolvedBuildOutputPath: string | null = null;
  if (buildOutputPath) {
    resolvedBuildOutputPath = resolve(buildOutputPath);
    const output = await readFile(resolvedBuildOutputPath, 'utf-8');
    buildTimeMs = parseBuildDurationMs(output);
  }

  return {
    id: randomUUID(),
    buildDir,
    buildOutputPath: resolvedBuildOutputPath,
    routes,
    chunks,
    totalChunkBytes: chunks.reduce((sum, chunk) => sum + chunk.sizeBytes, 0),
    sharedChunkBytes: chunks.reduce(
      (sum, chunk) => sum + (chunk.isShared ? chunk.sizeBytes : 0),
      0,
    ),
    buildTimeMs,
  } satisfies ParsedBuildStats;
}
