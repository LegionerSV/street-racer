import { cacheGet, cachePut, loadElevations, validateCenter } from './data';
import { sampleElevation, toGeo, toLocal } from './geo';
import type { LoadingLog } from './loading-log';
import { abortableDelay, MapSource } from './map-source';
import {
  createRegionTileSource,
  tileElevationForSession,
  type MapTile,
} from './region-tile-source';
import {
  SOURCE_TILE_ZOOM,
  latLonToSourceTile,
  normalizeSourceTileX,
  parseSourceTileKey,
  sourceTileCenter,
  sourceTileKey,
} from './source-tiles';
import {
  chunkHasCoverage,
  sourceTileKeysForLocalBounds,
} from './stream-coverage';
import type { Center, OSMElement, Point, RegionData, Settings } from './types';

export const MAP_TILE_MARGIN = 300;
// Рельеф получает дополнительный запас для сглаживания и интерполяции.
export const ELEVATION_TILE_SIZE = 2600;
export const ELEVATION_TILE_WIDTH = 131;
export type { MapTile } from './region-tile-source';

export function startupTiles(center: Center) {
  const tile = latLonToSourceTile(center.lat, center.lon),
    result: string[] = [];
  for (let x = tile.x - 1; x <= tile.x + 1; x++)
    for (let y = tile.y - 1; y <= tile.y + 1; y++)
      result.push(
        sourceTileKey({
          z: SOURCE_TILE_ZOOM,
          x: normalizeSourceTileX(x, SOURCE_TILE_ZOOM),
          y,
        }),
      );
  return result;
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
  side: number,
  center: Center,
) {
  const geo = toGeo(p, center),
    current = latLonToSourceTile(geo.lat, geo.lon),
    half = Math.floor(side / 2),
    cells: { key: string; score: number }[] = [];
  for (let dx = -half; dx < side - half; dx++)
    for (let dy = -half; dy < side - half; dy++) {
      const id = {
          z: current.z,
          x: normalizeSourceTileX(current.x + dx, current.z),
          y: current.y + dy,
        },
        tileCenter = sourceTileCenter(id),
        local = toLocal(tileCenter.lat, tileCenter.lon, center),
        offsetX = local.x - p.x,
        offsetZ = local.z - p.z,
        distance = Math.hypot(offsetX, offsetZ);
      cells.push({
        key: sourceTileKey(id),
        score:
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
    error?: string;
    elements?: number;
  }[] = [];
  readonly windowSide: number;
  readonly maxElements: number;
  status = '';

  constructor(
    readonly center: Center,
    quality: Settings['quality'],
    private log?: LoadingLog,
  ) {
    this.windowSide = quality === 'mobile' ? 4 : 6;
    this.maxElements = quality === 'mobile' ? 180000 : 360000;
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
      get: cacheGet,
      put: cachePut,
      mapCell: (box, stage) => this.source.cellSnapshot(box, stage, 0, true),
      loadElevation: (center, signal, shape) =>
        loadElevations(center, signal, () => {}, log, shape),
      drivingSide: (center) => this.drivingSide(center),
    });
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
      initial = startupTiles(this.center);
    const centerTile = sourceTileKey(
      latLonToSourceTile(this.center.lat, this.center.lon),
    );
    signal.addEventListener('abort', cancel, { once: true });
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
    let order = tileOrder(p, heading, this.windowSide, this.center);
    const key = order.find(
      (candidate) =>
        !this.tiles.has(candidate) &&
        (this.failures.get(candidate) || 0) <= Date.now(),
    );
    if (!key) return null;
    this.status = 'Загружаем улицы вокруг';
    try {
      const tile = await this.fetchTile(key),
        candidate = new Map(this.tiles);
      candidate.set(key, tile);
      const current = latest?.();
      if (current) {
        p = current.position;
        heading = current.heading;
        order = tileOrder(p, heading, this.windowSide, this.center);
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
        this.windowSide ** 2,
        this.maxElements,
      );
      if (
        !kept.has(key) ||
        [...kept.values()].reduce(
          (count, item) => count + item.elements.length,
          0,
        ) > this.maxElements
      ) {
        this.status = 'Дальние улицы подгрузим, когда вы к ним приблизитесь.';
        this.failures.set(key, Date.now() + 30000);
        return null;
      }
      this.tiles = kept;
      this.failures.delete(key);
      this.status = '';
      this.record({
        at: new Date().toISOString(),
        tile: key,
        elements: tile.elements.length,
      });
      return this.snapshot(p);
    } catch (error) {
      this.control.signal.throwIfAborted();
      this.failures.set(key, Date.now() + 30000);
      this.status = 'Не удалось подгрузить участок. Повторим автоматически.';
      this.record({
        at: new Date().toISOString(),
        tile: key,
        error: error instanceof Error ? error.message : String(error),
      });
      await abortableDelay(30000, this.control.signal);
      this.source = new MapSource(this.control.signal, undefined, {
        get: cacheGet,
        put: cachePut,
      });
      this.sidePromises.clear();
      this.sessionSidePromise = undefined;
      this.tileSource = this.createTileSource();
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

  diagnostics() {
    return {
      tiles: this.tiles.size,
      tileLimit: this.windowSide ** 2,
      inputElements: [...this.tiles.values()].reduce(
        (count, tile) => count + tile.elements.length,
        0,
      ),
      elementLimit: this.maxElements,
      status: this.status,
      recent: this.messages,
    };
  }

  dispose() {
    this.control.abort();
    this.tiles.clear();
    this.failures.clear();
  }
}
