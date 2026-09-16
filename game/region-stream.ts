import { cacheGet, cachePut, loadElevations, validateCenter } from './data';
import { criticalChunks } from './chunks';
import { sampleElevation, toGeo, toLocal } from './geo';
import type { LoadingLog } from './loading-log';
import {
  reduceMapElements,
  type ElementBreakdown,
  type ElementReductionStats,
  type MapDetailMode,
} from './map-element-filter';
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
export {
  TERRAIN_GRID_SIZE as ELEVATION_TILE_SIZE,
  TERRAIN_GRID_WIDTH as ELEVATION_TILE_WIDTH,
} from './terrain-policy';
import {
  TERRAIN_GRID_SIZE as ELEVATION_TILE_SIZE,
  TERRAIN_GRID_WIDTH as ELEVATION_TILE_WIDTH,
} from './terrain-policy';
export type { MapTile } from './region-tile-source';

export type MapStreamingPolicy = {
  blockingRadiusMeters: number;
  targetRadiusMeters: number;
  forwardTileRows: number;
  maxConcurrentTiles: number;
  maxUpdateTiles: number;
  maxElements: number;
};

type TileOutcome =
  | { key: string; status: 'fulfilled'; tile: MapTile }
  | { key: string; status: 'rejected'; reason: unknown };

const MAP_STREAMING_POLICIES: Record<Settings['quality'], MapStreamingPolicy> =
  {
    mobile: {
      blockingRadiusMeters: 1500,
      targetRadiusMeters: 2500,
      forwardTileRows: 4,
      maxConcurrentTiles: 4,
      maxUpdateTiles: 4,
      maxElements: 180000,
    },
    low: {
      blockingRadiusMeters: 2000,
      targetRadiusMeters: 2700,
      forwardTileRows: 4,
      maxConcurrentTiles: 6,
      maxUpdateTiles: 6,
      maxElements: 360000,
    },
    medium: {
      blockingRadiusMeters: 2500,
      targetRadiusMeters: 3000,
      forwardTileRows: 4,
      maxConcurrentTiles: 8,
      maxUpdateTiles: 8,
      maxElements: 360000,
    },
    high: {
      blockingRadiusMeters: 700,
      targetRadiusMeters: 800,
      forwardTileRows: 1,
      maxConcurrentTiles: 6,
      maxUpdateTiles: 2,
      maxElements: 100000,
    },
  };

export function mapStreamingPolicy(quality: Settings['quality']) {
  return MAP_STREAMING_POLICIES[quality];
}

export function mapForwardRows(
  policy: MapStreamingPolicy,
  speedMetersPerSecond: number,
) {
  return speedMetersPerSecond > 2 ? policy.forwardTileRows : 0;
}

export function mapRadiusAtSpeed(
  policy: MapStreamingPolicy,
  speedMetersPerSecond: number,
) {
  return speedMetersPerSecond > 2
    ? policy.targetRadiusMeters
    : policy.blockingRadiusMeters;
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

const osmElementKey = (element: OSMElement) => `${element.type}/${element.id}`;
const DETAIL_MODES: MapDetailMode[] = ['standard', 'minimal', 'roads'];

function uniqueElementCount(tiles: Iterable<MapTile>) {
  const keys = new Set<string>();
  for (const tile of tiles)
    for (const element of tile.elements) keys.add(osmElementKey(element));
  return keys.size;
}

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
    forwardReach = Math.max(tileSpanX, tileSpanZ) * forwardTileRows,
    corridorWidth = Math.max(tileSpanX, tileSpanZ),
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
      distance = Math.hypot(offsetX, offsetZ),
      forward = offsetX * Math.sin(heading) + offsetZ * Math.cos(heading),
      lateral = Math.abs(
        offsetX * Math.cos(heading) - offsetZ * Math.sin(heading),
      ),
      ahead =
        forward > 0 && forward <= forwardReach + 1 && lateral <= corridorWidth;
    // Передний коридор получает данные раньше боковых улиц, даже если они ближе.
    cells.push({
      key,
      score:
        (blocking.has(key) ? -1_000_000 : 0) +
        (ahead ? -10_000 : 0) +
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
  const elementKeys = new Set<string>();
  for (const key of [...pinned, ...order]) {
    const tile = tiles.get(key);
    if (!tile || kept.has(key)) continue;
    const additionalKeys = tile.elements
      .map(osmElementKey)
      .filter((elementKey) => !elementKeys.has(elementKey));
    if (
      !pinned.has(key) &&
      (kept.size >= limit ||
        elementKeys.size + additionalKeys.length > maxElements)
    )
      continue;
    kept.set(key, tile);
    for (const elementKey of additionalKeys) elementKeys.add(elementKey);
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
  private pendingTiles = new Map<string, Promise<void>>();
  private completedTiles: TileOutcome[] = [];
  private wakePending?: () => void;
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
    { source?: string; fallback?: string; filter?: ElementReductionStats }
  >();
  private catalogCache = new Map<
    string,
    Promise<import('./tile-source').TileCatalogV1>
  >();
  readonly policy: MapStreamingPolicy;
  readonly maxElements: number;
  private detailMode: MapDetailMode = 'standard';
  private startupRawKeys?: Set<string>;
  private startupRawUnique = 0;
  private startupKeptUnique = 0;
  private blockingTileCount = 0;
  private targetTileCount = 0;
  status = '';

  constructor(
    readonly center: Center,
    quality: Settings['quality'],
    private log?: LoadingLog,
    private closeCourtyards = false,
  ) {
    if (this.closeCourtyards) this.detailMode = 'minimal';
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
    if (result.kind === 'hit') {
      for (const element of result.tile.elements)
        this.startupRawKeys?.add(osmElementKey(element));
      const finish = this.log?.start('Отбор объектов source-тайла', {
        tile: key,
        mode: 'standard',
      });
      const started = performance.now();
      const processed = this.reduceTile(result.tile, 'standard');
      const current = this.tileDiagnostics.get(key) ?? {};
      current.filter = processed.stats;
      this.tileDiagnostics.set(key, current);
      finish?.('success', {
        rawElements: processed.stats.raw.total,
        keptElements: processed.stats.kept.total,
        rawNodes: processed.stats.raw.nodes,
        keptNodes: processed.stats.kept.nodes,
        rawBuildings: processed.stats.raw.buildings,
        keptBuildings: processed.stats.kept.buildings,
        rawBuildingParts: processed.stats.raw.buildingParts,
        keptBuildingParts: processed.stats.kept.buildingParts,
        rawTrees: processed.stats.raw.trees,
        keptTrees: processed.stats.kept.trees,
        rawAreas: processed.stats.raw.areas,
        keptAreas: processed.stats.kept.areas,
        filterMs: Math.round(performance.now() - started),
      });
      return processed.tile;
    }
    this.control.signal.throwIfAborted();
    throw new Error(
      result.error ?? `Не удалось получить участок карты ${key}.`,
    );
  }

  private reduceTile(
    tile: MapTile,
    mode: MapDetailMode,
    raw?: ElementBreakdown,
  ) {
    const requestedMode =
      this.closeCourtyards && mode === 'standard' ? 'minimal' : mode;
    const currentMode = tile.checksum.split('|')[1] as
        | MapDetailMode
        | undefined,
      effectiveMode =
        currentMode &&
        DETAIL_MODES.indexOf(currentMode) > DETAIL_MODES.indexOf(requestedMode)
          ? currentMode
          : requestedMode;
    const filtered = reduceMapElements(
      tile.elements,
      sourceTileCenter({ z: tile.z, x: tile.x, y: tile.y }),
      effectiveMode,
      this.closeCourtyards,
    );
    return {
      tile: {
        ...tile,
        elements: filtered.elements,
        checksum: `${tile.checksum.split('|')[0]}|${effectiveMode}`,
      },
      stats: { raw: raw ?? filtered.stats.raw, kept: filtered.stats.kept },
    };
  }

  private reduceTileMap(tiles: Map<string, MapTile>, mode: MapDetailMode) {
    const reduced = new Map<string, MapTile>(),
      filters = new Map<string, ElementReductionStats>();
    for (const [key, tile] of tiles) {
      const result = this.reduceTile(
        tile,
        mode,
        this.tileDiagnostics.get(key)?.filter?.raw,
      );
      reduced.set(key, result.tile);
      filters.set(key, result.stats);
    }
    return { tiles: reduced, filters };
  }

  private recordFilters(filters: Map<string, ElementReductionStats>) {
    for (const [key, filter] of filters) {
      const current = this.tileDiagnostics.get(key) ?? {};
      current.filter = filter;
      this.tileDiagnostics.set(key, current);
    }
  }

  private updateDetailMode() {
    this.detailMode =
      DETAIL_MODES[
        Math.max(
          0,
          ...[...this.tiles.values()].map((tile) =>
            DETAIL_MODES.indexOf(tile.checksum.split('|')[1] as MapDetailMode),
          ),
        )
      ];
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

  private requestTile(key: string) {
    const pending = this.fetchTile(key)
      .then(
        (tile): TileOutcome => ({ key, status: 'fulfilled', tile }),
        (reason): TileOutcome => ({ key, status: 'rejected', reason }),
      )
      .then((result) => {
        this.pendingTiles.delete(key);
        if (!this.control.signal.aborted) this.completedTiles.push(result);
        this.wakePending?.();
      });
    this.pendingTiles.set(key, pending);
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
      this.policy.blockingRadiusMeters,
      0,
      this.center,
    ).length;
    this.startupRawKeys = new Set<string>();
    try {
      const startupElementKeys = new Set<string>();
      let completed = 0;
      for (
        let offset = 0;
        offset < initial.length;
        offset += this.policy.maxConcurrentTiles
      ) {
        const batch = initial.slice(
          offset,
          offset + this.policy.maxConcurrentTiles,
        );
        const loaded = await Promise.all(
          batch.map(async (key) => {
            const tile = await this.fetchTile(key);
            completed++;
            progress(
              `Загружаем стартовый район · ${completed} из ${initial.length}`,
              5 + (72 * completed) / initial.length,
            );
            return { key, tile };
          }),
        );
        for (const { key, tile } of loaded) {
          if (key === centerTile)
            this.side =
              tile.drivingSideSource === 'default'
                ? await this.sessionDrivingSide()
                : tile.drivingSide;
          this.tiles.set(key, tile);
          for (const element of tile.elements)
            startupElementKeys.add(osmElementKey(element));
        }
        this.blockingTileCount = initial.length - this.tiles.size;
        this.startupRawUnique = this.startupRawKeys.size;
        this.startupKeptUnique = startupElementKeys.size;
        for (
          let modeIndex = 1;
          startupElementKeys.size > this.maxElements &&
          modeIndex < DETAIL_MODES.length;
          modeIndex++
        ) {
          const mode = DETAIL_MODES[modeIndex],
            before = startupElementKeys.size,
            reduced = this.reduceTileMap(this.tiles, mode);
          this.tiles = reduced.tiles;
          this.recordFilters(reduced.filters);
          this.updateDetailMode();
          startupElementKeys.clear();
          for (const tile of this.tiles.values())
            for (const element of tile.elements)
              startupElementKeys.add(osmElementKey(element));
          this.startupKeptUnique = startupElementKeys.size;
          this.log?.start('Упрощение стартового района', {
            mode,
            beforeElements: before,
            afterElements: startupElementKeys.size,
            elementLimit: this.maxElements,
          })();
        }
        this.log?.start('Бюджет стартового района', {
          rawUnique: this.startupRawUnique,
          keptUnique: this.startupKeptUnique,
          elementLimit: this.maxElements,
          loadedTiles: this.tiles.size,
          totalTiles: initial.length,
          mode: this.detailMode,
        })();
        if (startupElementKeys.size > this.maxElements)
          throw new Error(
            `Дорожная основа стартового района превышает лимит (${startupElementKeys.size} > ${this.maxElements}).`,
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
      this.startupRawUnique =
        this.startupRawKeys?.size ?? this.startupRawUnique;
      this.startupRawKeys = undefined;
      clearTimeout(deadline);
      signal.removeEventListener('abort', cancel);
    }
  }

  snapshot(focus: Point, full = true): RegionData {
    const elements = new Map<string, OSMElement>();
    if (full)
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
        patches: full
          ? [...this.tiles.values()].map((tile) =>
              tileElevationForSession(tile, this.center),
            )
          : undefined,
      },
      drivingSide: this.side,
      fetchedAt: new Date().toISOString(),
      loadedTiles: [...this.tiles.keys()],
      sourceTiles: [...this.tiles.entries()].map(([key, tile]) => ({
        key,
        elements: tile.elements,
        elevation: tileElevationForSession(tile, this.center),
        checksum: tile.checksum,
      })),
      focus: { ...focus },
      heightDatum: this.datum,
    };
  }

  async next(
    p: Point,
    heading: number,
    latest?: () => {
      position: Point;
      heading: number;
      speedMetersPerSecond?: number;
    },
    speedMetersPerSecond = 0,
    compactUpdate = false,
    pinnedTileKeys: Iterable<string> = [],
  ): Promise<RegionData | null> {
    this.control.signal.throwIfAborted();
    let order = tileOrder(
      p,
      heading,
      mapRadiusAtSpeed(this.policy, speedMetersPerSecond),
      mapForwardRows(this.policy, speedMetersPerSecond),
      this.center,
    );
    this.targetTileCount = order.length;
    this.blockingTileCount = this.missingBlockingTiles(p, heading);
    const slots =
        this.policy.maxUpdateTiles -
        this.pendingTiles.size -
        this.completedTiles.length,
      keys = order
        .filter(
          (candidate) =>
            !this.tiles.has(candidate) &&
            !this.pendingTiles.has(candidate) &&
            !this.completedTiles.some((result) => result.key === candidate) &&
            (this.failures.get(candidate) || 0) <= Date.now(),
        )
        .slice(0, Math.max(0, slots));
    for (const key of keys) this.requestTile(key);
    if (!this.pendingTiles.size && !this.completedTiles.length) return null;
    this.status = 'Загружаем улицы вокруг';
    try {
      if (!this.completedTiles.length)
        await new Promise<void>((resolve) => {
          this.wakePending = resolve;
        });
      this.wakePending = undefined;
      this.control.signal.throwIfAborted();
      const loaded = this.completedTiles.splice(0),
        candidate = new Map(this.tiles);
      const current = latest?.();
      if (current) {
        p = current.position;
        heading = current.heading;
        order = tileOrder(
          p,
          heading,
          mapRadiusAtSpeed(
            this.policy,
            current.speedMetersPerSecond ?? speedMetersPerSecond,
          ),
          mapForwardRows(
            this.policy,
            current.speedMetersPerSecond ?? speedMetersPerSecond,
          ),
          this.center,
        );
      }
      this.targetTileCount = order.length;
      const wanted = new Set(order);
      for (const result of loaded) {
        const key = result.key;
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
        } else if (wanted.has(key)) candidate.set(key, result.tile);
      }
      const pinned = new Set([
        ...sourceTileKeysForLocalBounds(this.center, {
          minX: p.x - 350,
          maxX: p.x + 350,
          minZ: p.z - 350,
          maxZ: p.z + 350,
        }),
        ...pinnedTileKeys,
      ]);
      const retain = (tiles: Map<string, MapTile>) =>
          retainTiles(
            tiles,
            order,
            pinned,
            new Set([...order, ...pinned]).size,
            this.maxElements,
          ),
        newlyAccepted = (tiles: Map<string, MapTile>) => {
          const withinBudget =
            uniqueElementCount(tiles.values()) <= this.maxElements;
          return loaded.filter(
            (result) =>
              result.status === 'fulfilled' &&
              tiles.has(result.key) &&
              withinBudget &&
              !this.tiles.has(result.key),
          );
        };
      let kept = retain(candidate),
        accepted = newlyAccepted(kept);
      if (
        !accepted.length &&
        loaded.some((result) => result.status === 'fulfilled')
      ) {
        for (let index = 1; index < DETAIL_MODES.length; index++) {
          const mode = DETAIL_MODES[index],
            reduced = this.reduceTileMap(candidate, mode),
            trial = retain(reduced.tiles),
            trialAccepted = newlyAccepted(trial);
          if (!trialAccepted.length) continue;
          kept = trial;
          accepted = trialAccepted;
          this.recordFilters(reduced.filters);
          this.record({
            at: new Date().toISOString(),
            tile: trialAccepted.map((result) => result.key).join(', '),
            fallback: `Упрощение карты: ${mode}`,
          });
          break;
        }
      }
      if (loaded.some((result) => result.status === 'rejected'))
        this.resetTileSource();
      if (!accepted.length) {
        for (const result of loaded)
          if (result.status === 'fulfilled')
            this.failures.set(result.key, Date.now() + 30000);
        this.status = 'Дальние улицы подгрузим, когда вы к ним приблизитесь.';
        return null;
      }
      this.tiles = kept;
      this.updateDetailMode();
      for (const key of this.tileDiagnostics.keys())
        if (!kept.has(key) && !wanted.has(key))
          this.tileDiagnostics.delete(key);
      this.blockingTileCount = this.missingBlockingTiles(p, heading);
      this.status = '';
      for (const result of accepted)
        if (result.status === 'fulfilled') {
          this.failures.delete(result.key);
          this.record({
            at: new Date().toISOString(),
            tile: result.key,
            source: this.tileDiagnostics.get(result.key)?.source,
            fallback: this.tileDiagnostics.get(result.key)?.fallback,
            elements: kept.get(result.key)?.elements.length,
          });
        }
      return this.snapshot(p, !compactUpdate);
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
      pendingTiles: this.pendingTiles.size,
      completedTiles: this.completedTiles.length,
      retainedTiles: this.tiles.size,
      policy: this.policy,
      inputElements: uniqueElementCount(this.tiles.values()),
      elementLimit: this.maxElements,
      filter: {
        mode: this.detailMode,
        startupRawUnique: this.startupRawUnique,
        startupKeptUnique: this.startupKeptUnique,
        tiles: [...this.tiles.keys()].map((key) => ({
          tile: key,
          mode: this.tiles.get(key)?.checksum.split('|')[1],
          source: this.tileDiagnostics.get(key)?.source,
          raw: this.tileDiagnostics.get(key)?.filter?.raw,
          kept: this.tileDiagnostics.get(key)?.filter?.kept,
        })),
      },
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
    this.wakePending?.();
    this.pendingTiles.clear();
    this.completedTiles.length = 0;
    this.tiles.clear();
    this.failures.clear();
    this.tileDiagnostics.clear();
  }
}
