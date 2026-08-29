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

async function getFileSizeBytes(filePath: string): Promise<number | null> {
  try {
    const result = await stat(filePath);
    return result.size;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (
      code === 'ENOENT' ||
      code === 'EACCES' ||
      code === 'EPERM' ||
      code === 'EISDIR' ||
      code === 'ENOTDIR'
    ) {
      return null;
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

interface RouteClassification {
  type: RouteType;
  isPrerendered: boolean;
  prerenderBlockedReason: PrerenderBlockedReason;
}

/**
 * Derive rendering mode, prerender status, and blocked reason from manifest membership alone, in
 * one place so the three fields cannot disagree. `realPath` must be the path Next.js uses in
 * `prerender-manifest.json` (see `app-path-routes-manifest.json`), not the build-manifest key.
 */
function classifyRoute(
  realPath: string,
  isAppRoute: boolean,
  prerenderRoutes: Record<string, PrerenderManifestRouteRaw>,
  dynamicRoutes: Record<string, unknown>,
): RouteClassification {
  const prerendered = prerenderRoutes[realPath];
  if (prerendered) {
    const revalidate = prerendered.initialRevalidateSeconds;
    const isr = typeof revalidate === 'number' && Number.isFinite(revalidate) && revalidate > 0;
    return {
      type: isr ? 'isr' : 'static',
      isPrerendered: true,
      prerenderBlockedReason: isr ? 'isr' : null,
    };
  }

  // Has getStaticPaths/generateStaticParams, but this path renders on demand.
  if (realPath in dynamicRoutes) {
    return { type: 'ssg', isPrerendered: false, prerenderBlockedReason: 'dynamic-params' };
  }

  return {
    type: 'dynamic',
    isPrerendered: false,
    prerenderBlockedReason: isAppRoute ? 'dynamic-rendering' : 'server-side-props',
  };
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
  const appPathRoutesManifestPath = join(buildDir, 'app-path-routes-manifest.json');

  const buildManifest = await readJsonIfPresent<BuildManifestRaw>(buildManifestPath);
  if (!buildManifest) {
    throw new Error(
      `Could not find build-manifest.json in ${buildDir}. Run next build first and point this tool at the .next directory.`,
    );
  }

  const prerenderManifest = await readJsonIfPresent<PrerenderManifestRaw>(prerenderManifestPath);
  const appBuildManifest = await readJsonIfPresent<BuildManifestRaw>(appBuildManifestPath);
  const appPathRoutesManifest =
    await readJsonIfPresent<Record<string, unknown>>(appPathRoutesManifestPath);

  // `/gallery/page` -> `/gallery`. Pages Router keys are already the real path.
  const appPathRoutes: Record<string, string> = {};
  for (const [manifestKey, realPath] of Object.entries(appPathRoutesManifest ?? {})) {
    if (typeof realPath === 'string') {
      appPathRoutes[manifestKey] = realPath;
    }
  }

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

  const appLayoutChunks = appRouteMap['/layout'] ?? [];

  for (const [route, chunkPaths] of Object.entries(appRouteMap)) {
    if (!shouldIncludeRoute(route) || route === '/layout') {
      continue;
    }

    const existing = allRoutes.get(route);
    allRoutes.set(route, {
      chunkPaths: Array.from(
        new Set([...(existing?.chunkPaths ?? []), ...appLayoutChunks, ...chunkPaths]),
      ),
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

  const missingChunkFiles: string[] = [];

  const chunkSizeEntries = await Promise.all(
    Array.from(chunkRouteMap.keys()).map(async (chunkPath) => {
      const normalized = chunkPath.replace(/^\//, '');
      const sizeBytes = await getFileSizeBytes(join(buildDir, normalized));
      if (sizeBytes === null) {
        missingChunkFiles.push(chunkPath);
      }
      return [chunkPath, sizeBytes ?? 0] as const;
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

      const classification = classifyRoute(
        appPathRoutes[route] ?? route,
        details.isAppRoute,
        prerenderRoutes,
        dynamicRoutes,
      );

      return {
        path: route,
        type: classification.type,
        prerenderBlockedReason: classification.prerenderBlockedReason,
        chunkPaths: details.chunkPaths,
        totalBytes,
        initialLoadBytes: totalBytes,
        sharedChunkBytes,
        exclusiveChunkBytes: totalBytes - sharedChunkBytes,
        isPrerendered: classification.isPrerendered,
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
    missingChunkFiles: missingChunkFiles.length > 0 ? missingChunkFiles.sort() : undefined,
  } satisfies ParsedBuildStats;
}
