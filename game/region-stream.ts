import {
  cacheGet,
  cachePut,
  loadElevations,
  validateCenter,
  regionKey,
} from './data';
import { MapSource, abortableDelay } from './map-source';
import { sampleElevation, toGeo, bounds } from './geo';
import { selectLegacyMap } from './legacy-map';
import type {
  Center,
  ElevationGrid,
  OSMElement,
  Point,
  RegionData,
  Settings,
} from './types';
import type { LoadingLog } from './loading-log';

export const MAP_TILE_SIZE = 1000;
export const MAP_TILE_MARGIN = 300;
// до 520 м для открытия DEM, до 200 м для сглаживания и запас для интерполяции.
export const ELEVATION_TILE_SIZE = 2600;
export const ELEVATION_TILE_WIDTH = 131;
export type MapTile = {
  key: string;
  elements: OSMElement[];
  elevation: ElevationGrid;
};
export const startupTiles = () => ['-1,-1', '0,-1', '-1,0', '0,0'];
export const mapTileAt = (p: Pick<Point, 'x' | 'z'>) =>
  `${Math.floor((p.x + 1e-5) / 1000)},${Math.floor((p.z + 1e-5) / 1000)}`;
export function tileReady(loaded: Set<string>, chunk: string) {
  const [x, z] = chunk.split(',').map(Number);
  return loaded.has(`${Math.floor(x / 4)},${Math.floor(z / 4)}`);
}
export function tileOrder(p: Point, heading: number, side: number) {
  const cx = Math.round(p.x / 1000),
    cz = Math.round(p.z / 1000),
    half = side / 2;
  const cells: { key: string; score: number }[] = [];
  for (let x = cx - half; x < cx + half; x++)
    for (let z = cz - half; z < cz + half; z++) {
      const dx = (x + 0.5) * 1000 - p.x,
        dz = (z + 0.5) * 1000 - p.z,
        d = Math.hypot(dx, dz);
      cells.push({
        key: `${x},${z}`,
        score:
          d -
          ((dx * Math.sin(heading) + dz * Math.cos(heading)) / (d || 1)) * 600,
      });
    }
  return cells
    .sort((a, b) => a.score - b.score || a.key.localeCompare(b.key))
    .map((c) => c.key);
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
  const country = elements.find((e) => e.tags?.['ISO3166-1'])?.tags?.[
    'ISO3166-1'
  ];
  const explicit = elements.find((e) => e.tags?.driving_side)?.tags
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
  private control = new AbortController();
  private side: RegionData['drivingSide'] = 'right';
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
  }
  private cacheKey(key: string) {
    return `stream:1:${this.center.lat.toFixed(7)}:${this.center.lon.toFixed(7)}:${key}`;
  }
  private tileBox(key: string) {
    const [x, z] = key.split(',').map(Number);
    const sw = toGeo(
      { x: x * 1000 - MAP_TILE_MARGIN, y: 0, z: z * 1000 - MAP_TILE_MARGIN },
      this.center,
    );
    const ne = toGeo(
      {
        x: (x + 1) * 1000 + MAP_TILE_MARGIN,
        y: 0,
        z: (z + 1) * 1000 + MAP_TILE_MARGIN,
      },
      this.center,
    );
    return { south: sw.lat, west: sw.lon, north: ne.lat, east: ne.lon };
  }
  private async restoreLegacy() {
    const end = this.log?.start('Старый кэш района');
    const legacy = await cacheGet<RegionData>(regionKey(this.center));
    this.control.signal.throwIfAborted();
    const savedAt = legacy ? Date.parse(legacy.fetchedAt) : NaN;
    if (
      !legacy ||
      !Number.isFinite(savedAt) ||
      Date.now() - savedAt > 7 * 86400000
    ) {
      end?.('success', { cacheHit: false });
      return;
    }
    const old = bounds(legacy.center);
    let restored = 0;
    for (const key of startupTiles()) {
      const box = this.tileBox(key);
      if (
        box.south < old.south ||
        box.north > old.north ||
        box.west < old.west ||
        box.east > old.east
      )
        continue;
      const elements = selectLegacyMap(legacy.elements, box);
      if (!elements) continue;
      await this.source.seedCell(box, elements, savedAt);
      restored++;
    }
    end?.('success', { cacheHit: true, restoredTiles: restored });
    return restored === 4 ? legacy.drivingSide : undefined;
  }
  private async fetchTile(key: string): Promise<MapTile> {
    this.control.signal.throwIfAborted();
    const cached = await cacheGet<{ tile: MapTile; savedAt: number }>(
      this.cacheKey(key),
    );
    this.control.signal.throwIfAborted();
    const fresh = cached && Date.now() - cached.savedAt < 7 * 86400000;
    if (
      fresh &&
      cached.tile.elevation.size === ELEVATION_TILE_SIZE &&
      cached.tile.elevation.width === ELEVATION_TILE_WIDTH
    )
      return cached.tile;
    const [x, z] = key.split(',').map(Number),
      size = 1000 + MAP_TILE_MARGIN * 2,
      offsetX = (x + 0.5) * 1000,
      offsetZ = (z + 0.5) * 1000;
    const sw = toGeo(
        { x: offsetX - size / 2, y: 0, z: offsetZ - size / 2 },
        this.center,
      ),
      ne = toGeo(
        { x: offsetX + size / 2, y: 0, z: offsetZ + size / 2 },
        this.center,
      );
    validateCenter(sw);
    validateCenter(ne);
    // Старые OSM-данные остаются пригодны: обновляем только недостаточный запас DEM.
    // Рельеф получает ту же сетку в метрах, независимо от широты центра клетки.
    const [elements, elevation] = await Promise.all([
      fresh
        ? cached.tile.elements
        : this.source.cell(
            { south: sw.lat, west: sw.lon, north: ne.lat, east: ne.lon },
            `Участок ${key}`,
            0,
            true,
          ),
      loadElevations(this.center, this.control.signal, () => {}, this.log, {
        size: ELEVATION_TILE_SIZE,
        width: ELEVATION_TILE_WIDTH,
        offsetX,
        offsetZ,
      }),
    ]);
    this.control.signal.throwIfAborted();
    const tile = { key, elements, elevation };
    await cachePut(this.cacheKey(key), {
      tile,
      savedAt: fresh ? cached.savedAt : Date.now(),
    });
    return tile;
  }
  async start(
    signal: AbortSignal,
    progress: (text: string, n: number) => void,
  ) {
    validateCenter(this.center);
    signal.throwIfAborted();
    const cancel = () => this.dispose();
    signal.addEventListener('abort', cancel, { once: true });
    // Начальный экран имеет собственный срок; фон после старта живёт до конца поездки.
    const deadline = setTimeout(
      () =>
        this.control.abort(
          new Error(
            'Подготовка стартового района заняла больше пяти минут. Готовые части сохранены; повторите попытку.',
          ),
        ),
      300000,
    );
    try {
      const restoredSide = await this.restoreLegacy();
      this.side =
        restoredSide ??
        countrySide(
          await this.source.request(
            `is_in(${this.center.lat},${this.center.lon})->.a;area.a["admin_level"="2"];out tags;`,
            'Сторона движения',
          ),
        );
      for (const [i, key] of startupTiles().entries()) {
        progress(`Загружаем стартовый район · ${i + 1} из 4`, 5 + i * 18);
        const tile = await this.fetchTile(key);
        this.tiles.set(key, tile);
        if (
          [...this.tiles.values()].reduce((n, t) => n + t.elements.length, 0) >
          this.maxElements
        )
          throw new Error(
            'Стартовый район содержит слишком много объектов. Выберите менее плотный участок.',
          );
      }
      this.datum = sampleElevation(
        this.tiles.values().next().value!.elevation,
        0,
        0,
      );
      progress('Стартовый район готов', 83);
      // Закрытый журнал старта больше не удерживаем в длительной фоновой сессии.
      this.log = undefined;
      this.source = new MapSource(this.control.signal, undefined, {
        get: cacheGet,
        put: cachePut,
      });
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
      for (const e of tile.elements) elements.set(`${e.type}/${e.id}`, e);
    return {
      center: this.center,
      elements: [...elements.values()],
      elevation: {
        width: 2,
        size: 1,
        values: new Float32Array(4),
        patches: [...this.tiles.values()].map((t) => t.elevation),
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
    let order = tileOrder(p, heading, this.windowSide);
    const key = order.find(
      (k) => !this.tiles.has(k) && (this.failures.get(k) || 0) <= Date.now(),
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
        order = tileOrder(p, heading, this.windowSide);
      }
      const pinned = new Set<string>();
      // После сетевого ожидания используем свежую позицию, чтобы не удалить
      // опору под машиной, успевшей пересечь несколько клеток.
      for (const dx of [-350, 350])
        for (const dz of [-350, 350])
          pinned.add(mapTileAt({ x: p.x + dx, z: p.z + dz }));
      const kept = retainTiles(
        candidate,
        order,
        pinned,
        this.windowSide ** 2,
        this.maxElements,
      );
      if (
        !kept.has(key) ||
        [...kept.values()].reduce((n, t) => n + t.elements.length, 0) >
          this.maxElements
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
      // Следующая попытка после общей паузы снова проверит доступность серверов.
      await abortableDelay(30000, this.control.signal);
      this.source = new MapSource(this.control.signal, undefined, {
        get: cacheGet,
        put: cachePut,
      });
      return null;
    } finally {
      const wanted = new Set(order);
      for (const k of this.failures.keys())
        if (!wanted.has(k)) this.failures.delete(k);
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
        (n, t) => n + t.elements.length,
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
