import type { LoadingLog } from './loading-log';
import type { MapBox } from './map-source';
import {
  CompositeTileSource,
  IndexedDbTileSource,
  OverpassTileSource,
  S3TileSource,
  type ArtifactStore,
  type TileSource,
} from './tile-source';
import { toLocal } from './geo';
import { sourceTileCenter, type SourceTileId } from './source-tiles';
import { type TileArtifactV1 } from './tile-artifact';
import { prepareTileArtifact } from './tile-preparation';
import { TERRAIN_GRID_SIZE } from './terrain-policy';
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

export function createRegionTileSource(
  options: RegionTileSourceOptions,
): TileSource {
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
  const source = new CompositeTileSource(
    // Каталог S3 проверяется первым: новый overlay сразу перекрывает старую
    // запись IndexedDB, а кэш остаётся offline-fallback и приёмником save.
    [remote, cache, fallback],
    (id) => `${id.z}/${id.x}/${id.y}`,
    options.log,
    options.onSourceResult,
  );
  return {
    name: source.name,
    async load(id, signal) {
      const result = await source.load(id, signal);
      if (result.kind !== 'hit') return result;
      const { tile } = result,
        grid = tile.elevation;
      const samplingValid = (value: ElevationGrid) =>
        options.elevationSize < TERRAIN_GRID_SIZE ||
        value.sampling === 'ground-minimum-v1';
      if (
        (grid.sizeX ?? grid.size) >= options.elevationSize &&
        (grid.sizeZ ?? grid.size) >= options.elevationSize &&
        grid.width >= options.elevationWidth &&
        samplingValid(grid)
      )
        return result;
      // Старый опубликованный OSM остаётся пригодным. Его узкий DEM нельзя
      // фильтровать с продолжением краевых уклонов: это создаёт ложные холмы.
      const key = `expanded-dem:2:${id.z}/${id.x}/${id.y}:${options.elevationSize}/${options.elevationWidth}`;
      const valid = (
        value: ElevationGrid | undefined,
      ): value is ElevationGrid =>
        !!value &&
        value.width === options.elevationWidth &&
        value.size === options.elevationSize &&
        samplingValid(value) &&
        value.values?.length === value.width ** 2 &&
        value.values.every(Number.isFinite);
      try {
        let elevation: ElevationGrid | undefined;
        try {
          elevation = await options.get<ElevationGrid>(key);
        } catch {
          /* Кэш необязателен. */
        }
        if (!valid(elevation)) {
          elevation = await options.loadElevation(
            sourceTileCenter(id),
            signal,
            {
              size: options.elevationSize,
              width: options.elevationWidth,
              offsetX: 0,
              offsetZ: 0,
            },
          );
          signal.throwIfAborted();
          if (!valid(elevation))
            throw new Error(
              'Обновлённый рельеф участка содержит неполные данные.',
            );
          try {
            await options.put(key, elevation);
          } catch {
            /* Отказ диска не прерывает поездку. */
          }
        }
        signal.throwIfAborted();
        return {
          ...result,
          tile: {
            ...tile,
            elevation,
            checksum: `${tile.checksum}:dem-2-${options.elevationSize}-${options.elevationWidth}`,
          },
        };
      } catch (error) {
        return {
          kind: signal.aborted ? 'aborted' : 'temporary-failure',
          source: result.source,
          error:
            error instanceof Error
              ? error.message
              : 'Не удалось обновить рельеф участка.',
        };
      }
    },
  };
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
