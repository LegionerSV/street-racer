import type { Bounds } from './geometry';
import { resample, toGeo, toLocal } from './geo';
import {
  SOURCE_TILE_ZOOM,
  latLonToSourceTile,
  parseSourceTileKey,
  sourceTileBounds,
  sourceTileKey,
  type SourceTileId,
} from './source-tiles';
import type { Center, Point } from './types';

const BOUNDS_EPSILON = 1e-5;

export function sourceTileLocalBounds(
  tile: SourceTileId,
  center: Center,
): Bounds {
  const bounds = sourceTileBounds(tile),
    southWest = toLocal(bounds.south, bounds.west, center),
    northEast = toLocal(bounds.north, bounds.east, center);
  return {
    minX: Math.min(southWest.x, northEast.x),
    maxX: Math.max(southWest.x, northEast.x),
    minZ: Math.min(southWest.z, northEast.z),
    maxZ: Math.max(southWest.z, northEast.z),
  };
}

export function sourceTilesForLocalBounds(
  center: Center,
  bounds: Bounds,
  zoom = SOURCE_TILE_ZOOM,
): SourceTileId[] {
  const southWest = toGeo(
      {
        x:
          bounds.maxX > bounds.minX
            ? bounds.minX + BOUNDS_EPSILON
            : bounds.minX,
        y: 0,
        z:
          bounds.maxZ > bounds.minZ
            ? bounds.minZ + BOUNDS_EPSILON
            : bounds.minZ,
      },
      center,
    ),
    northEast = toGeo(
      {
        x: Math.max(bounds.minX, bounds.maxX - BOUNDS_EPSILON),
        y: 0,
        z: Math.max(bounds.minZ, bounds.maxZ - BOUNDS_EPSILON),
      },
      center,
    ),
    west = latLonToSourceTile(southWest.lat, southWest.lon, zoom),
    east = latLonToSourceTile(northEast.lat, northEast.lon, zoom),
    count = 2 ** zoom,
    xs: number[] = [];
  for (let x = west.x; ; x = (x + 1) % count) {
    xs.push(x);
    if (x === east.x) break;
    if (xs.length > count)
      throw new Error('Не удалось определить диапазон source-тайлов.');
  }
  const result: SourceTileId[] = [];
  for (const x of xs)
    for (let y = east.y; y <= west.y; y++) result.push({ z: zoom, x, y });
  return result;
}

export function sourceTileKeysForLocalBounds(center: Center, bounds: Bounds) {
  return sourceTilesForLocalBounds(center, bounds).map(sourceTileKey);
}

export function chunkHasCoverage(
  loaded: Set<string>,
  chunk: string,
  center: Center,
) {
  const [x, z] = chunk.split(',').map(Number);
  return sourceTileKeysForLocalBounds(center, {
    minX: x * 250,
    maxX: (x + 1) * 250,
    minZ: z * 250,
    maxZ: (z + 1) * 250,
  }).every((key) => loaded.has(key));
}

export function pointHasCoverage(
  loaded: Set<string> | undefined,
  point: Point,
  center: Center,
) {
  if (!loaded) return false;
  // Точка на общей границе принадлежит покрытию с положительной стороны,
  // как и локальные игровые chunks; это исключает нулевые щели на швах.
  const geo = toGeo(
    { ...point, x: point.x + BOUNDS_EPSILON, z: point.z + BOUNDS_EPSILON },
    center,
  );
  return loaded.has(sourceTileKey(latLonToSourceTile(geo.lat, geo.lon)));
}

export function coverageBounds(
  tiles: string[] | undefined,
  center: Center,
): Bounds[] | undefined {
  return tiles?.map((key) =>
    sourceTileLocalBounds(parseSourceTileKey(key), center),
  );
}

export function routeHasCoverage(
  points: Point[],
  tiles: string[] | undefined,
  center: Center,
  margin = 120,
) {
  if (!tiles) return true;
  const loaded = new Set(tiles);
  return (
    points.length > 0 &&
    resample(points, 20).every((point) =>
      sourceTileKeysForLocalBounds(center, {
        minX: point.x - margin,
        maxX: point.x + margin,
        minZ: point.z - margin,
        maxZ: point.z + margin,
      }).every((key) => loaded.has(key)),
    )
  );
}

export function needsRaceRecovery(
  active: boolean,
  loaded: Set<string> | null | undefined,
  critical: string[],
  center: Center,
) {
  return (
    active &&
    !!loaded &&
    critical.some((key) => !chunkHasCoverage(loaded, key, center))
  );
}
