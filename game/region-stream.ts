import { cacheGet, cachePut, loadElevations, validateCenter } from './data';
import { criticalChunks } from './chunks';
import { sampleElevation, toGeo, toLocal } from './geo';
import type { LoadingLog } from './loading-log';
import { MapSource } from './map-source';
import {
  createRegionTileSource,
  tileElevationForSession,
  type MapTile,
} from './region-tile-source';
import {
  latLonToSourceTile,
  parseSourceTileKey,
  sourceTileCenter,
  sourceTileKey,
} from './source-tiles';
import {
  chunkHasCoverage,
  sourceTileLocalBounds,
  sourceTileKeysForLocalBounds,
} from './stream-coverage';
import type { Center, OSMElement, Point, RegionData, Settings } from './types';

export const MAP_TILE_MARGIN = 300;
// Рельеф получает дополнительный запас для сглаживания и интерполяции.
export const ELEVATION_TILE_SIZE = 2600;
export const ELEVATION_TILE_WIDTH = 131;
export type { MapTile } from './region-tile-source';

export type MapStreamingPolicy = {
  blockingRadiusMeters: number;
  targetRadiusMeters: number;
  forwardTileRows: number;
  maxConcurrentTiles: number;
  maxElements: number;
};

const MAP_STREAMING_POLICIES: Record<Settings['quality'], MapStreamingPolicy> =
  {
    mobile: {
      blockingRadiusMeters: 800,
      targetRadiusMeters: 2500,
      forwardTileRows: 1,
      maxConcurrentTiles: 2,
      maxElements: 180000,
    },
    low: {
      blockingRadiusMeters: 900,
      targetRadiusMeters: 2700,
      forwardTileRows: 1,
      maxConcurrentTiles: 2,
      maxElements: 360000,
    },
    medium: {
      blockingRadiusMeters: 1000,
      targetRadiusMeters: 3000,
      forwardTileRows: 2,
      maxConcurrentTiles: 3,
      maxElements: 360000,
    },
    high: {
      blockingRadiusMeters: 1000,
      targetRadiusMeters: 3000,
      forwardTileRows: 2,
      maxConcurrentTiles: 4,
      maxElements: 360000,
    },
  };

export function mapStreamingPolicy(quality: Settings['quality']) {
  return MAP_STREAMING_POLICIES[quality];
}

export function startupTiles(center: Center, radiusMeters = 1000) {
  return sourceTileKeysForLocalBounds(center, {
    minX: -radiusMeters,
    maxX: radiusMeters,
    minZ: -radiusMeters,
    maxZ: radiusMeters,
  });
}

export const mapTileAt = (p: Pick<Point, 'x' | 'z'>, center: Center) => {
  const geo = toGeo({ ...p, y: 0 }, center);
  return sourceTileKey(latLonToSourceTile(geo.lat, geo.lon));
};

export function tileReady(loaded: Set<string>, chunk: string, center: Center) {
  return chunkHasCoverage(loaded, chunk, center);
}

export function tileOrder(
  p: Point,
  heading: number,
  radiusMeters: number,
  forwardTileRows: number,
  center: Center,
) {
  const geo = toGeo(p, center),
    current = latLonToSourceTile(geo.lat, geo.lon),
    currentBounds = sourceTileLocalBounds(current, center),
    tileSpanX = currentBounds.maxX - currentBounds.minX,
    tileSpanZ = currentBounds.maxZ - currentBounds.minZ,
    forwardX = Math.sin(heading) * tileSpanX * forwardTileRows,
    forwardZ = Math.cos(heading) * tileSpanZ * forwardTileRows,
    keys = sourceTileKeysForLocalBounds(center, {
      minX: p.x - radiusMeters + Math.min(0, forwardX),
      maxX: p.x + radiusMeters + Math.max(0, forwardX),
      minZ: p.z - radiusMeters + Math.min(0, forwardZ),
      maxZ: p.z + radiusMeters + Math.max(0, forwardZ),
    }),
    blocking = new Set(
      criticalChunks(p, heading, true).flatMap((key) => {
        const [x, z] = key.split(',').map(Number);
        return sourceTileKeysForLocalBounds(center, {
          minX: x * 250,
          maxX: (x + 1) * 250,
          minZ: z * 250,
          maxZ: (z + 1) * 250,
        });
      }),
    ),
    cells: { key: string; score: number }[] = [];
  for (const key of keys) {
    const id = parseSourceTileKey(key),
      tileCenter = sourceTileCenter(id),
      local = toLocal(tileCenter.lat, tileCenter.lon, center),
      offsetX = local.x - p.x,
      offsetZ = local.z - p.z,
      distance = Math.hypot(offsetX, offsetZ);
    cells.push({
      key,
      score:
        (blocking.has(key) ? -1_000_000 : 0) +
        distance -
        ((offsetX * Math.sin(heading) + offsetZ * Math.cos(heading)) /
          (distance || 1)) *
          600,
    });
  }
  return cells
    .sort((a, b) => a.score - b.score || a.key.localeCompare(b.key))
    .map((cell) => cell.key);
}

// Бюджет относится к входным объектам, а не обещает точный размер JS/GPU heap.
export function retainTiles(
  tiles: Map<string, MapTile>,
  order: string[],
  pinned: Set<string>,
  limit: number,
  maxElements: number,
) {
  const kept = new Map<string, MapTile>();
  let count = 0;
  for (const key of [...pinned, ...order]) {
    const tile = tiles.get(key);
    if (!tile || kept.has(key)) continue;
    if (
      !pinned.has(key) &&
      (kept.size >= limit || count + tile.elements.length > maxElements)
    )
      continue;
    kept.set(key, tile);
    count += tile.elements.length;
  }
  return kept;
}

function countrySide(elements: OSMElement[]): RegionData['drivingSide'] {
  const country = elements.find((element) => element.tags?.['ISO3166-1'])
      ?.tags?.['ISO3166-1'],
    explicit = elements.find((element) => element.tags?.driving_side)?.tags
      ?.driving_side;
  if (!country && !explicit)
    throw new Error(
      'Не удалось определить сторону движения для участка. Выберите точку на суше и повторите.',
    );
  return explicit === 'left' ||
    (!explicit &&
      new Set(
        'GB IE AU NZ JP IN PK BD LK NP BT TH MY SG ID BN TL ZA BW LS SZ NA ZM ZW MW MZ TZ KE UG MU SC MT CY JM BS BB TT AG DM GD KN LC VC GY SR FJ PG SB TO WS KI TV NR MV HK MO'.split(
          ' ',
        ),
      ).has(country!))
    ? 'left'
    : 'right';
}

export class RegionStream {
  private tiles = new Map<string, MapTile>();
  private source: MapSource;
  private tileSource: ReturnType<typeof createRegionTileSource>;
  private control = new AbortController();
  private side: RegionData['drivingSide'] = 'right';
  private sidePromises = new Map<
    string,
    Promise<{ side: RegionData['drivingSide']; resolved: boolean }>
  >();
  private sessionSidePromise?: Promise<RegionData['drivingSide']>;
  private datum?: number;
  private failures = new Map<string, number>();
  private messages: {
    at: string;
    tile: string;
    source?: string;
    fallback?: string;
    error?: string;
    elements?: number;
  }[] = [];
  private tileDiagnostics = new Map<
    string,
    { source?: string; fallback?: string }
  >();
  private catalogCache = new Map<
    string,
    Promise<import('./tile-source').TileCatalogV1>
  >();
  readonly policy: MapStreamingPolicy;
  readonly maxElements: number;
  private blockingTileCount = 0;
  private targetTileCount = 0;
  status = '';

  constructor(
    readonly center: Center,
    quality: Settings['quality'],
    private log?: LoadingLog,
  ) {
    this.policy = mapStreamingPolicy(quality);
    this.maxElements = this.policy.maxElements;
    this.log?.start('Политика окна source-тайлов', {
      blockingRadiusMeters: this.policy.blockingRadiusMeters,
      targetRadiusMeters: this.policy.targetRadiusMeters,
      forwardTileRows: this.policy.forwardTileRows,
      staticConcurrency: this.policy.maxConcurrentTiles,
      elementLimit: this.policy.maxElements,
    })();
    this.source = new MapSource(this.control.signal, log, {
      get: cacheGet,
      put: cachePut,
    });
    this.tileSource = this.createTileSource(log);
  }

  private sessionDrivingSide() {
    this.sessionSidePromise ??= this.source
      .request(
        `is_in(${this.center.lat},${this.center.lon})->.a;area.a["admin_level"="2"];out tags;`,
        'Сторона движения',
      )
      .then(countrySide);
    return this.sessionSidePromise;
  }

  private drivingSide(center: Center) {
    const key = `${center.lat.toFixed(7)},${center.lon.toFixed(7)}`,
      existing = this.sidePromises.get(key);
    if (existing) return existing;
    const promise = this.source
      .request(
        `is_in(${center.lat},${center.lon})->.a;area.a["admin_level"="2"];out tags;`,
        `Сторона движения / ${key}`,
      )
      .then((elements) => {
        try {
          return { side: countrySide(elements), resolved: true } as const;
        } catch {
          // Водный тайл не должен блокировать прибрежный старт. Значение
          // детерминировано, а для центрального тайла уточняется по точке сессии.
          return { side: 'right', resolved: false } as const;
        }
      });
    this.sidePromises.set(key, promise);
    return promise;
  }

  private async fetchTile(key: string): Promise<MapTile> {
    const result = await this.tileSource.load(
      parseSourceTileKey(key),
      this.control.signal,
    );
    if (result.kind === 'hit') return result.tile;
    this.control.signal.throwIfAborted();
    throw new Error(
      result.error ?? `Не удалось получить участок карты ${key}.`,
    );
  }

  private createTileSource(log?: LoadingLog) {
    return createRegionTileSource({
      elevationSize: ELEVATION_TILE_SIZE,
      elevationWidth: ELEVATION_TILE_WIDTH,
      tileMargin: MAP_TILE_MARGIN,
      log,
      catalogCache: this.catalogCache,
      onSourceResult: (id, result) => {
        const key = sourceTileKey(id),
          current = this.tileDiagnostics.get(key) ?? {};
        if (result.kind === 'hit') {
          current.source = result.source;
          if (result.source !== 'overpass-dem') current.fallback = undefined;
        } else if (result.source === 's3')
          current.fallback = `${result.kind}: ${result.error ?? 'без деталей'}`;
        this.tileDiagnostics.set(key, current);
      },
      get: cacheGet,
      put: cachePut,
      mapCell: (box, stage) => this.source.cellSnapshot(box, stage, 0, true),
      loadElevation: (center, signal, shape) =>
        loadElevations(center, signal, () => {}, log, shape),
      drivingSide: (center) => this.drivingSide(center),
    });
  }

  private resetTileSource() {
    this.source = new MapSource(this.control.signal, undefined, {
      get: cacheGet,
      put: cachePut,
    });
    this.sidePromises.clear();
    this.sessionSidePromise = undefined;
    this.tileSource = this.createTileSource();
  }

  async start(
    signal: AbortSignal,
    progress: (text: string, n: number) => void,
  ) {
    validateCenter(this.center);
    signal.throwIfAborted();
    const cancel = () => this.dispose(),
      deadline = setTimeout(
        () =>
          this.control.abort(
            new Error(
              'Подготовка стартового района заняла больше пяти минут. Готовые части сохранены; повторите попытку.',
            ),
          ),
        300000,
      ),
      initial = startupTiles(this.center, this.policy.blockingRadiusMeters);
    const centerTile = sourceTileKey(
      latLonToSourceTile(this.center.lat, this.center.lon),
    );
    signal.addEventListener('abort', cancel, { once: true });
    this.blockingTileCount = initial.length;
    this.targetTileCount = tileOrder(
      { x: 0, y: 0, z: 0 },
      0,
      this.policy.targetRadiusMeters,
      this.policy.forwardTileRows,
      this.center,
    ).length;
    try {
      for (const [index, key] of initial.entries()) {
        progress(
          `Загружаем стартовый район · ${index + 1} из ${initial.length}`,
          5 + (72 * index) / initial.length,
        );
        const tile = await this.fetchTile(key);
        if (key === centerTile)
          this.side =
            tile.drivingSideSource === 'default'
              ? await this.sessionDrivingSide()
              : tile.drivingSide;
        this.tiles.set(key, tile);
        this.blockingTileCount = initial.length - this.tiles.size;
        if (
          [...this.tiles.values()].reduce(
            (count, item) => count + item.elements.length,
            0,
          ) > this.maxElements
        )
          throw new Error(
            'Стартовый район содержит слишком много объектов. Выберите менее плотный участок.',
          );
      }
      const elevation = {
        width: 2,
        size: 1,
        values: new Float32Array(4),
        patches: [...this.tiles.values()].map((tile) =>
          tileElevationForSession(tile, this.center),
        ),
      };
      this.datum = sampleElevation(elevation, 0, 0);
      progress('Стартовый район готов', 83);
      this.log = undefined;
      this.source = new MapSource(this.control.signal, undefined, {
        get: cacheGet,
        put: cachePut,
      });
      this.tileSource = this.createTileSource();
      return this.snapshot({ x: 0, y: 0, z: 0 });
    } catch (error) {
      this.dispose();
      throw error;
    } finally {
      clearTimeout(deadline);
      signal.removeEventListener('abort', cancel);
    }
  }

  snapshot(focus: Point): RegionData {
    const elements = new Map<string, OSMElement>();
    for (const tile of this.tiles.values())
      for (const element of tile.elements)
        elements.set(`${element.type}/${element.id}`, element);
    return {
      center: this.center,
      elements: [...elements.values()],
      elevation: {
        width: 2,
        size: 1,
        values: new Float32Array(4),
        patches: [...this.tiles.values()].map((tile) =>
          tileElevationForSession(tile, this.center),
        ),
      },
      drivingSide: this.side,
      fetchedAt: new Date().toISOString(),
      loadedTiles: [...this.tiles.keys()],
      focus: { ...focus },
      heightDatum: this.datum,
    };
  }

  async next(
    p: Point,
    heading: number,
    latest?: () => { position: Point; heading: number },
  ): Promise<RegionData | null> {
    this.control.signal.throwIfAborted();
    let order = tileOrder(
      p,
      heading,
      this.policy.targetRadiusMeters,
      this.policy.forwardTileRows,
      this.center,
    );
    this.targetTileCount = order.length;
    this.blockingTileCount = this.missingBlockingTiles(p, heading);
    const keys = order
      .filter(
        (candidate) =>
          !this.tiles.has(candidate) &&
          (this.failures.get(candidate) || 0) <= Date.now(),
      )
      .slice(0, this.policy.maxConcurrentTiles);
    if (!keys.length) return null;
    this.status = 'Загружаем улицы вокруг';
    try {
      const loaded = await Promise.allSettled(
          keys.map(async (key) => ({ key, tile: await this.fetchTile(key) })),
        ),
        candidate = new Map(this.tiles);
      const current = latest?.();
      if (current) {
        p = current.position;
        heading = current.heading;
        order = tileOrder(
          p,
          heading,
          this.policy.targetRadiusMeters,
          this.policy.forwardTileRows,
          this.center,
        );
      }
      this.targetTileCount = order.length;
      const wanted = new Set(order);
      for (const [index, result] of loaded.entries()) {
        const key = keys[index];
        if (result.status === 'rejected') {
          this.failures.set(key, Date.now() + 30000);
          this.record({
            at: new Date().toISOString(),
            tile: key,
            source: this.tileDiagnostics.get(key)?.source,
            fallback: this.tileDiagnostics.get(key)?.fallback,
            error:
              result.reason instanceof Error
                ? result.reason.message
                : String(result.reason),
          });
        } else if (wanted.has(key)) candidate.set(key, result.value.tile);
      }
      const pinned = new Set(
        sourceTileKeysForLocalBounds(this.center, {
          minX: p.x - 350,
          maxX: p.x + 350,
          minZ: p.z - 350,
          maxZ: p.z + 350,
        }),
      );
      const kept = retainTiles(
          candidate,
          order,
          pinned,
          new Set([...order, ...pinned]).size,
          this.maxElements,
        ),
        keptElements = [...kept.values()].reduce(
          (count, tile) => count + tile.elements.length,
          0,
        ),
        accepted = loaded.filter(
          (result) =>
            result.status === 'fulfilled' &&
            kept.has(result.value.key) &&
            keptElements <= this.maxElements &&
            !this.tiles.has(result.value.key),
        );
      if (loaded.some((result) => result.status === 'rejected'))
        this.resetTileSource();
      if (!accepted.length) {
        for (const result of loaded)
          if (result.status === 'fulfilled')
            this.failures.set(result.value.key, Date.now() + 30000);
        this.status = 'Дальние улицы подгрузим, когда вы к ним приблизитесь.';
        return null;
      }
      this.tiles = kept;
      for (const key of this.tileDiagnostics.keys())
        if (!kept.has(key) && !wanted.has(key))
          this.tileDiagnostics.delete(key);
      this.blockingTileCount = this.missingBlockingTiles(p, heading);
      this.status = '';
      for (const result of accepted)
        if (result.status === 'fulfilled') {
          this.failures.delete(result.value.key);
          this.record({
            at: new Date().toISOString(),
            tile: result.value.key,
            source: this.tileDiagnostics.get(result.value.key)?.source,
            fallback: this.tileDiagnostics.get(result.value.key)?.fallback,
            elements: result.value.tile.elements.length,
          });
        }
      return this.snapshot(p);
    } catch {
      this.control.signal.throwIfAborted();
      this.status = 'Не удалось подгрузить участок. Повторим автоматически.';
      this.resetTileSource();
      return null;
    } finally {
      const wanted = new Set(order);
      for (const failed of this.failures.keys())
        if (!wanted.has(failed)) this.failures.delete(failed);
    }
  }

  private record(entry: (typeof this.messages)[number]) {
    this.messages.push(entry);
    if (this.messages.length > 40) this.messages.shift();
  }

  private missingBlockingTiles(p: Point, heading: number) {
    const loaded = new Set(this.tiles.keys()),
      keys = new Set(
        criticalChunks(p, heading, true).flatMap((key) => {
          const [x, z] = key.split(',').map(Number);
          return sourceTileKeysForLocalBounds(this.center, {
            minX: x * 250,
            maxX: (x + 1) * 250,
            minZ: z * 250,
            maxZ: (z + 1) * 250,
          });
        }),
      );
    return [...keys].filter((key) => !loaded.has(key)).length;
  }

  diagnostics() {
    return {
      tiles: this.tiles.size,
      blockingTiles: this.blockingTileCount,
      targetTiles: this.targetTileCount,
      retainedTiles: this.tiles.size,
      policy: this.policy,
      inputElements: [...this.tiles.values()].reduce(
        (count, tile) => count + tile.elements.length,
        0,
      ),
      elementLimit: this.maxElements,
      status: this.status,
      sources: [...this.tileDiagnostics.values()].reduce<
        Record<string, number>
      >((counts, item) => {
        if (item.source) counts[item.source] = (counts[item.source] ?? 0) + 1;
        return counts;
      }, {}),
      recent: this.messages,
    };
  }

  dispose() {
    this.control.abort();
    this.tiles.clear();
    this.failures.clear();
    this.tileDiagnostics.clear();
  }
}
