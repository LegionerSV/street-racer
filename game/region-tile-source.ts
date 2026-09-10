import type { LoadingLog } from './loading-log';
import type { MapBox } from './map-source';
import {
  CompositeTileSource,
  IndexedDbTileSource,
  OverpassTileSource,
  S3TileSource,
  type ArtifactStore,
} from './tile-source';
import { toGeo, toLocal } from './geo';
import {
  sourceTileBounds,
  sourceTileCenter,
  type SourceTileBounds,
  type SourceTileId,
} from './source-tiles';
import {
  TILE_ARTIFACT_SCHEMA_VERSION,
  TILE_BUILD_VERSION,
  type TileArtifactV1,
} from './tile-artifact';
import type { Center, ElevationGrid, OSMElement, RegionData } from './types';

export type MapTile = TileArtifactV1;

type RegionTileSourceOptions = {
  elevationSize: number;
  elevationWidth: number;
  tileMargin: number;
  log?: LoadingLog;
  tileBaseUrl?: string;
  tileFetch?: (input: string, init?: RequestInit) => Promise<Response>;
  tileRequestTimeoutMs?: number;
  catalogCache?: Map<string, Promise<import('./tile-source').TileCatalogV1>>;
  onSourceResult?: (
    tileId: SourceTileId,
    result: import('./tile-source').TileLoadResult,
  ) => void;
  get: <T>(key: string) => Promise<T | undefined>;
  put: <T>(key: string, value: T) => Promise<void>;
  mapCell: (
    box: MapBox,
    stage: string,
  ) => Promise<{ elements: OSMElement[]; savedAt: number }>;
  loadElevation: (
    center: Center,
    signal: AbortSignal,
    shape: { size: number; width: number; offsetX: number; offsetZ: number },
  ) => Promise<ElevationGrid>;
  drivingSide: (
    center: Center,
  ) => Promise<{ side: RegionData['drivingSide']; resolved: boolean }>;
};

function bufferedBounds(id: SourceTileId, margin: number): SourceTileBounds {
  const core = sourceTileBounds(id),
    center = sourceTileCenter(id),
    southWest = toGeo(
      {
        x: toLocal(center.lat, core.west, center).x - margin,
        y: 0,
        z: toLocal(core.south, center.lon, center).z - margin,
      },
      center,
    ),
    northEast = toGeo(
      {
        x: toLocal(center.lat, core.east, center).x + margin,
        y: 0,
        z: toLocal(core.north, center.lon, center).z + margin,
      },
      center,
    );
  return {
    south: southWest.lat,
    west: southWest.lon,
    north: northEast.lat,
    east: northEast.lon,
  };
}

export function createRegionTileSource(options: RegionTileSourceOptions) {
  const store: ArtifactStore = {
      get: (key) => options.get(key),
      put: (key, value) => options.put(key, value),
    },
    cache = new IndexedDbTileSource(store),
    remote = new S3TileSource({
      baseUrl:
        options.tileBaseUrl ??
        (
          import.meta as ImportMeta & {
            env?: Record<string, string | undefined>;
          }
        ).env?.VITE_MAP_TILE_BASE_URL,
      fetch: options.tileFetch,
      timeoutMs: options.tileRequestTimeoutMs,
      catalogCache: options.catalogCache,
    }),
    fallback = new OverpassTileSource(async (id, signal) => {
      signal.throwIfAborted();
      const coreBounds = sourceTileBounds(id),
        tileCenter = sourceTileCenter(id),
        bounds = bufferedBounds(id, options.tileMargin),
        [map, elevation, drivingSide] = await Promise.all([
          options.mapCell(bounds, `Source-тайл ${id.z}/${id.x}/${id.y}`),
          options.loadElevation(tileCenter, signal, {
            size: options.elevationSize,
            width: options.elevationWidth,
            offsetX: 0,
            offsetZ: 0,
          }),
          options.drivingSide(tileCenter),
        ]);
      signal.throwIfAborted();
      return {
        schemaVersion: TILE_ARTIFACT_SCHEMA_VERSION,
        tileBuildVersion: TILE_BUILD_VERSION,
        ...id,
        coreBounds,
        bufferedBounds: bounds,
        generatedAt: new Date().toISOString(),
        osmTimestamp: new Date(map.savedAt).toISOString(),
        drivingSide: drivingSide.side,
        drivingSideSource: drivingSide.resolved ? 'tile-center' : 'default',
        elements: map.elements,
        elevation,
      };
    });
  return new CompositeTileSource(
    [cache, remote, fallback],
    (id) => `${id.z}/${id.x}/${id.y}`,
    options.log,
    options.onSourceResult,
  );
}

export function tileElevationForSession(
  tile: TileArtifactV1,
  sessionCenter: Center,
): ElevationGrid {
  const local = toLocal(
      (tile.coreBounds.south + tile.coreBounds.north) / 2,
      (tile.coreBounds.west + tile.coreBounds.east) / 2,
      sessionCenter,
    ),
    tileCenterLatitude = (tile.coreBounds.south + tile.coreBounds.north) / 2,
    xScale =
      Math.cos((sessionCenter.lat * Math.PI) / 180) /
      Math.cos((tileCenterLatitude * Math.PI) / 180);
  return {
    ...tile.elevation,
    sizeX: (tile.elevation.sizeX ?? tile.elevation.size) * xScale,
    sizeZ: tile.elevation.sizeZ ?? tile.elevation.size,
    offsetX: local.x,
    offsetZ: local.z,
  };
}
