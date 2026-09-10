import type { LoadingLog } from './loading-log';
import type { MapBox } from './map-source';
import {
  CompositeTileSource,
  IndexedDbTileSource,
  OverpassTileSource,
  S3TileSource,
  type ArtifactStore,
} from './tile-source';
import { toLocal } from './geo';
import { type SourceTileId } from './source-tiles';
import { type TileArtifactV1 } from './tile-artifact';
import { prepareTileArtifact } from './tile-preparation';
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
  now?: () => Date;
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
    signal: AbortSignal,
  ) => Promise<{ elements: OSMElement[]; savedAt: number }>;
  loadElevation: (
    center: Center,
    signal: AbortSignal,
    shape: { size: number; width: number; offsetX: number; offsetZ: number },
  ) => Promise<ElevationGrid>;
  drivingSide: (
    center: Center,
    signal: AbortSignal,
  ) => Promise<{ side: RegionData['drivingSide']; resolved: boolean }>;
};

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
    fallback = new OverpassTileSource((id, signal) =>
      prepareTileArtifact(
        id,
        signal,
        {
          tileMargin: options.tileMargin,
          elevationSize: options.elevationSize,
          elevationWidth: options.elevationWidth,
          generatedAt: (options.now?.() ?? new Date()).toISOString(),
        },
        {
          map: options.mapCell,
          elevation: options.loadElevation,
          drivingSide: options.drivingSide,
        },
      ),
    );
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
