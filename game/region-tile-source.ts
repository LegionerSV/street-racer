import type { LoadingLog } from './loading-log';
import type { MapBox } from './map-source';
import { CompositeTileSource, type TileSource } from './tile-source';
import { toGeo } from './geo';
import type { Center, ElevationGrid, OSMElement } from './types';

export type MapTile = {
  key: string;
  elements: OSMElement[];
  elevation: ElevationGrid;
};

type CachedMapTile = { tile: MapTile; savedAt: number };

type RegionTileSourceOptions = {
  center: Center;
  elevationSize: number;
  elevationWidth: number;
  tileSize: number;
  tileMargin: number;
  log?: LoadingLog;
  cacheKey: (key: string) => string;
  validateCenter: (center: Center) => void;
  get: <T>(key: string) => Promise<T | undefined>;
  put: <T>(key: string, value: T) => Promise<void>;
  mapCell: (box: MapBox, stage: string) => Promise<OSMElement[]>;
  loadElevation: (
    center: Center,
    signal: AbortSignal,
    shape: { size: number; width: number; offsetX: number; offsetZ: number },
  ) => Promise<ElevationGrid>;
};

// До MAP-S3-04 RegionStream планирует старые километровые клетки. Этот адаптер
// использует общую политику TileSource, не выдавая локальный ключ за глобальный XYZ.
export function createRegionTileSource(options: RegionTileSourceOptions) {
  const savedAt = new Map<string, number>(),
    cache: TileSource<MapTile, string> = {
      name: 'indexeddb',
      load: async (key, signal) => {
        signal.throwIfAborted();
        const cached = await options.get<CachedMapTile>(options.cacheKey(key));
        signal.throwIfAborted();
        if (!cached || Date.now() - cached.savedAt >= 7 * 86400000)
          return { kind: 'missing', source: 'indexeddb' };
        if (
          cached.tile.elevation.size !== options.elevationSize ||
          cached.tile.elevation.width !== options.elevationWidth
        )
          return {
            kind: 'incompatible',
            source: 'indexeddb',
            error: 'Сохранённый рельеф участка имеет устаревший формат.',
          };
        return { kind: 'hit', source: 'indexeddb', tile: cached.tile };
      },
      save: async (key, tile, signal) => {
        signal.throwIfAborted();
        await options.put(options.cacheKey(key), {
          tile,
          savedAt: savedAt.get(key) ?? Date.now(),
        });
        savedAt.delete(key);
        signal.throwIfAborted();
      },
    },
    remote: TileSource<MapTile, string> = {
      name: 'static',
      load: async (_key, signal) => {
        signal.throwIfAborted();
        return { kind: 'missing', source: 'static' };
      },
    },
    fallback: TileSource<MapTile, string> = {
      name: 'overpass-dem',
      load: async (key, signal) => {
        signal.throwIfAborted();
        const cached = await options.get<CachedMapTile>(options.cacheKey(key)),
          fresh = cached && Date.now() - cached.savedAt < 7 * 86400000,
          [x, z] = key.split(',').map(Number),
          size = options.tileSize + options.tileMargin * 2,
          offsetX = (x + 0.5) * options.tileSize,
          offsetZ = (z + 0.5) * options.tileSize,
          sw = toGeo(
            { x: offsetX - size / 2, y: 0, z: offsetZ - size / 2 },
            options.center,
          ),
          ne = toGeo(
            { x: offsetX + size / 2, y: 0, z: offsetZ + size / 2 },
            options.center,
          );
        options.validateCenter(sw);
        options.validateCenter(ne);
        const [elements, elevation] = await Promise.all([
          fresh
            ? cached.tile.elements
            : options.mapCell(
                {
                  south: sw.lat,
                  west: sw.lon,
                  north: ne.lat,
                  east: ne.lon,
                },
                `Участок ${key}`,
              ),
          options.loadElevation(options.center, signal, {
            size: options.elevationSize,
            width: options.elevationWidth,
            offsetX,
            offsetZ,
          }),
        ]);
        signal.throwIfAborted();
        savedAt.set(key, fresh ? cached.savedAt : Date.now());
        return {
          kind: 'hit',
          source: 'overpass-dem',
          tile: { key, elements, elevation },
        };
      },
    };
  return new CompositeTileSource(
    [cache, remote, fallback],
    (key) => key,
    options.log,
  );
}
