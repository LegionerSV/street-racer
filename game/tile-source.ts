import type { LoadingLog } from './loading-log';
import type { SourceTileId } from './source-tiles';
import {
  TILE_ARTIFACT_SCHEMA_VERSION,
  TILE_BUILD_VERSION,
  TileArtifactError,
  decodeTileArtifact,
  encodeTileArtifact,
  type TileArtifactV1,
  type TileArtifactV1Input,
} from './tile-artifact';

export type TileLoadFailureKind =
  | 'missing'
  | 'temporary-failure'
  | 'incompatible'
  | 'corrupt'
  | 'aborted';

export type TileLoadResult<TTile = TileArtifactV1> =
  | {
      kind: 'hit';
      source: string;
      tile: TTile;
      timings?: { fetchMs?: number; decodeMs?: number };
    }
  | { kind: TileLoadFailureKind; source: string; error?: string };

export interface TileSource<TTile = TileArtifactV1, TId = SourceTileId> {
  readonly name: string;
  load: (tileId: TId, signal: AbortSignal) => Promise<TileLoadResult<TTile>>;
  save?: (
    tileId: TId,
    tile: TTile,
    signal: AbortSignal,
    source?: string,
  ) => Promise<void>;
}

function aborted(source: string, signal: AbortSignal, error?: unknown) {
  return {
    kind: 'aborted' as const,
    source,
    error:
      signal.reason instanceof Error
        ? signal.reason.message
        : error instanceof Error
          ? error.message
          : 'Загрузка source-тайла отменена.',
  };
}

function thrownResult<T>(
  source: string,
  signal: AbortSignal,
  error: unknown,
): TileLoadResult<T> {
  if (
    signal.aborted ||
    (error instanceof DOMException && error.name === 'AbortError')
  )
    return aborted(source, signal, error);
  return {
    kind: 'temporary-failure',
    source,
    error: error instanceof Error ? error.message : String(error),
  };
}

function defaultTileKey(tileId: unknown) {
  if (typeof tileId === 'string') return tileId;
  if (
    typeof tileId === 'object' &&
    tileId !== null &&
    'z' in tileId &&
    'x' in tileId &&
    'y' in tileId
  ) {
    const id = tileId as SourceTileId;
    return `${id.z}/${id.x}/${id.y}`;
  }
  return JSON.stringify(tileId);
}

export class CompositeTileSource<
  TTile = TileArtifactV1,
  TId = SourceTileId,
> implements TileSource<TTile, TId> {
  readonly name = 'composite';
  private active = new Map<
    string,
    {
      promise: Promise<TileLoadResult<TTile>>;
      control: AbortController;
      subscribers: number;
    }
  >();

  constructor(
    private sources: TileSource<TTile, TId>[],
    private key: (tileId: TId) => string = defaultTileKey,
    private log?: LoadingLog,
    private observe?: (tileId: TId, result: TileLoadResult<TTile>) => void,
  ) {
    if (sources.length === 0)
      throw new Error('Цепочка источников тайлов не может быть пустой.');
  }

  load(tileId: TId, signal: AbortSignal): Promise<TileLoadResult<TTile>> {
    if (signal.aborted) return Promise.resolve(aborted(this.name, signal));
    const key = this.key(tileId);
    let operation = this.active.get(key);
    if (!operation) {
      const control = new AbortController(),
        created = {
          control,
          subscribers: 0,
          promise: undefined as unknown as Promise<TileLoadResult<TTile>>,
        };
      created.promise = this.loadOnce(tileId, key, control.signal).finally(
        () => {
          if (this.active.get(key) === created) this.active.delete(key);
        },
      );
      operation = created;
      this.active.set(key, operation);
    }
    operation.subscribers++;
    return new Promise((resolve) => {
      let settled = false;
      const finish = (result: TileLoadResult<TTile>) => {
          if (settled) return;
          settled = true;
          signal.removeEventListener('abort', onAbort);
          operation.subscribers--;
          resolve(result);
        },
        onAbort = () => {
          finish(aborted(this.name, signal));
          if (operation.subscribers === 0 && !operation.control.signal.aborted)
            operation.control.abort(signal.reason);
        };
      signal.addEventListener('abort', onAbort, { once: true });
      void operation.promise.then(finish, (error) =>
        finish(thrownResult(this.name, signal, error)),
      );
    });
  }

  private async loadOnce(
    tileId: TId,
    key: string,
    signal: AbortSignal,
  ): Promise<TileLoadResult<TTile>> {
    let last: TileLoadResult<TTile> | undefined;
    for (const [index, source] of this.sources.entries()) {
      if (signal.aborted) return aborted(source.name, signal);
      const end = this.log?.start('Источник source-тайла', {
        tile: key,
        source: source.name,
      });
      let result: TileLoadResult<TTile>;
      try {
        result = await source.load(tileId, signal);
      } catch (error) {
        result = thrownResult(source.name, signal, error);
      }
      this.observe?.(tileId, result);
      last = result;
      end?.(
        result.kind === 'hit'
          ? 'success'
          : result.kind === 'aborted'
            ? 'cancelled'
            : 'error',
        {
          result: result.kind,
          error: result.kind === 'hit' ? undefined : result.error,
          ...(result.kind === 'hit' ? result.timings : undefined),
        },
      );
      if (result.kind === 'aborted') return result;
      if (result.kind !== 'hit') continue;
      if (index > 0 && this.sources[0].save) {
        if (signal.aborted) return aborted(source.name, signal);
        const saveEnd = this.log?.start('Сохранение source-тайла', {
          tile: key,
          source: this.sources[0].name,
        });
        try {
          await this.sources[0].save(
            tileId,
            result.tile,
            signal,
            result.source,
          );
          saveEnd?.('success');
        } catch (error) {
          if (signal.aborted) return aborted(source.name, signal, error);
          saveEnd?.('error', {
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
      return result;
    }
    return (
      last ?? {
        kind: 'missing',
        source: this.name,
        error: `Source-тайл ${key} отсутствует во всех источниках.`,
      }
    );
  }
}

type ArtifactCacheEntry = { serialized: string; savedAt: number };
export type ArtifactStore = {
  get(key: string): Promise<ArtifactCacheEntry | undefined>;
  put(key: string, value: ArtifactCacheEntry): Promise<void>;
};

function sourceTileKey(tileId: SourceTileId) {
  return `${tileId.z}/${tileId.x}/${tileId.y}`;
}

export class IndexedDbTileSource implements TileSource {
  readonly name = 'indexeddb';

  constructor(
    private store: ArtifactStore,
    private maxAgeMs = 7 * 24 * 60 * 60 * 1000,
  ) {}

  private key(tileId: SourceTileId) {
    return `source-tile:1:${sourceTileKey(tileId)}`;
  }

  async load(
    tileId: SourceTileId,
    signal: AbortSignal,
  ): Promise<TileLoadResult> {
    try {
      signal.throwIfAborted();
      const entry = await this.store.get(this.key(tileId));
      signal.throwIfAborted();
      if (!entry || Date.now() - entry.savedAt >= this.maxAgeMs)
        return { kind: 'missing', source: this.name };
      return {
        kind: 'hit',
        source: this.name,
        tile: decodeTileArtifact(entry.serialized, tileId),
      };
    } catch (error) {
      if (signal.aborted) return aborted(this.name, signal, error);
      if (error instanceof TileArtifactError)
        return {
          kind: error.code.startsWith('incompatible-')
            ? 'incompatible'
            : 'corrupt',
          source: this.name,
          error: error.message,
        };
      return thrownResult(this.name, signal, error);
    }
  }

  async save(
    tileId: SourceTileId,
    tile: TileArtifactV1,
    signal: AbortSignal,
    source?: string,
  ) {
    signal.throwIfAborted();
    const serialized = encodeTileArtifact(tile);
    decodeTileArtifact(serialized, tileId);
    const osmTimestamp = Date.parse(tile.osmTimestamp);
    await this.store.put(this.key(tileId), {
      serialized,
      savedAt:
        source === 'overpass-dem' && Number.isFinite(osmTimestamp)
          ? Math.min(Date.now(), osmTimestamp)
          : Date.now(),
    });
    signal.throwIfAborted();
  }
}

export class StaticTileSource implements TileSource {
  readonly name = 'static';

  async load(
    _tileId: SourceTileId,
    signal: AbortSignal,
  ): Promise<TileLoadResult> {
    if (signal.aborted) return aborted(this.name, signal);
    return { kind: 'missing', source: this.name };
  }
}

export type TileCatalogEntry = {
  bytes: number;
  checksum: string;
  path?: string;
};

export type TileCatalogDatasetV1 = {
  datasetId: string;
  schemaVersion: number;
  tileBuildVersion: string;
  path: string;
  tiles: Record<string, TileCatalogEntry>;
};

export type TileCatalogV1 = {
  schemaVersion: 1;
  generatedAt: string;
  activeDatasets: string[];
  datasets: TileCatalogDatasetV1[];
};

type S3TileSourceOptions = {
  baseUrl?: string;
  fetch?: (input: string, init?: RequestInit) => Promise<Response>;
  timeoutMs?: number;
  catalogCache?: Map<string, Promise<TileCatalogV1>>;
};

class CatalogError extends Error {
  constructor(
    readonly kind: 'temporary-failure' | 'incompatible' | 'corrupt',
    message: string,
  ) {
    super(message);
    this.name = 'CatalogError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function safeCatalogPath(value: unknown) {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    /^[A-Za-z0-9._~-]+(?:\/[A-Za-z0-9._~-]+)*$/.test(value) &&
    value
      .split('/')
      .every((part) => part !== '' && part !== '.' && part !== '..')
  );
}

function decodeCatalog(serialized: string): TileCatalogV1 {
  let value: unknown;
  try {
    value = JSON.parse(serialized);
  } catch {
    throw new CatalogError('corrupt', 'Каталог S3 содержит некорректный JSON.');
  }
  if (!isRecord(value) || value.schemaVersion !== 1)
    throw new CatalogError(
      'incompatible',
      `Несовместимая версия каталога S3: ${isRecord(value) ? String(value.schemaVersion) : 'не указана'}.`,
    );
  if (
    typeof value.generatedAt !== 'string' ||
    !Number.isFinite(Date.parse(value.generatedAt)) ||
    !Array.isArray(value.activeDatasets) ||
    !value.activeDatasets.every((id) => typeof id === 'string') ||
    !Array.isArray(value.datasets)
  )
    throw new CatalogError(
      'corrupt',
      'Каталог S3 содержит некорректные метаданные.',
    );
  const datasetIds = new Set<string>();
  for (const dataset of value.datasets) {
    if (
      !isRecord(dataset) ||
      typeof dataset.datasetId !== 'string' ||
      datasetIds.has(dataset.datasetId) ||
      !Number.isInteger(dataset.schemaVersion) ||
      typeof dataset.tileBuildVersion !== 'string' ||
      !safeCatalogPath(dataset.path) ||
      !isRecord(dataset.tiles)
    )
      throw new CatalogError(
        'corrupt',
        'Каталог S3 содержит некорректный dataset.',
      );
    datasetIds.add(dataset.datasetId);
    for (const [key, entry] of Object.entries(dataset.tiles))
      if (
        !/^\d+\/\d+\/\d+$/.test(key) ||
        !isRecord(entry) ||
        !Number.isInteger(entry.bytes) ||
        (entry.bytes as number) <= 0 ||
        typeof entry.checksum !== 'string' ||
        !/^crc32:[0-9a-f]{8}$/.test(entry.checksum) ||
        (entry.path !== undefined && !safeCatalogPath(entry.path))
      )
        throw new CatalogError(
          'corrupt',
          'Каталог S3 содержит некорректную запись тайла.',
        );
  }
  if (!value.activeDatasets.every((id) => datasetIds.has(id)))
    throw new CatalogError(
      'corrupt',
      'Каталог S3 ссылается на отсутствующий активный dataset.',
    );
  return value as TileCatalogV1;
}

function waitForAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(signal.reason);
    signal.addEventListener('abort', onAbort, { once: true });
    void promise.then(
      (value) => {
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener('abort', onAbort);
        reject(error);
      },
    );
  });
}

export class S3TileSource implements TileSource {
  readonly name = 's3';
  private readonly baseUrl?: string;
  private readonly configurationError?: string;
  private readonly request: (
    input: string,
    init?: RequestInit,
  ) => Promise<Response>;
  private readonly timeoutMs: number;
  private readonly catalogCache: Map<string, Promise<TileCatalogV1>>;

  constructor(options: S3TileSourceOptions = {}) {
    const configured = options.baseUrl?.trim();
    if (configured)
      try {
        const parsed = new URL(configured);
        if (
          !['http:', 'https:'].includes(parsed.protocol) ||
          parsed.username ||
          parsed.password ||
          parsed.search ||
          parsed.hash
        )
          throw new Error(
            'разрешены только публичные HTTP(S) URL без credentials, query и hash',
          );
        this.baseUrl = parsed.href.replace(/\/+$/, '');
      } catch (error) {
        this.configurationError = `Некорректный VITE_MAP_TILE_BASE_URL: ${error instanceof Error ? error.message : String(error)}.`;
      }
    this.request =
      options.fetch ?? ((input, init) => globalThis.fetch(input, init));
    this.timeoutMs = options.timeoutMs ?? 15_000;
    this.catalogCache = options.catalogCache ?? new Map();
  }

  private url(path: string) {
    if (!safeCatalogPath(path))
      throw new CatalogError(
        'corrupt',
        'Каталог S3 содержит небезопасный путь.',
      );
    const base = new URL(`${this.baseUrl}/`),
      resolved = new URL(path, base),
      basePath = base.pathname.endsWith('/')
        ? base.pathname
        : `${base.pathname}/`;
    if (
      resolved.origin !== base.origin ||
      !resolved.pathname.startsWith(basePath)
    )
      throw new CatalogError(
        'corrupt',
        'Путь каталога S3 выходит за базовый префикс.',
      );
    return resolved.href;
  }

  private async fetchText(path: string, signal?: AbortSignal) {
    const timeout = AbortSignal.timeout(this.timeoutMs),
      combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
    try {
      const response = await this.request(this.url(path), {
        method: 'GET',
        signal: combined,
        headers: { Accept: 'application/json' },
      });
      return { response, text: await response.text() };
    } catch (error) {
      if (signal?.aborted) throw error;
      const reason = timeout.aborted
        ? `Таймаут S3 GET (${this.timeoutMs} мс).`
        : `Сетевая/CORS ошибка S3 GET: ${error instanceof Error ? error.message : String(error)}.`;
      throw new CatalogError('temporary-failure', reason);
    }
  }

  private loadCatalog() {
    const cacheKey = this.baseUrl!;
    let catalog = this.catalogCache.get(cacheKey);
    if (!catalog) {
      const pending = this.fetchText('maps/catalog-v1.json')
        .then(({ response, text }) => {
          if (!response.ok)
            throw new CatalogError(
              'temporary-failure',
              `Каталог S3 недоступен: HTTP ${response.status}.`,
            );
          return decodeCatalog(text);
        })
        .catch((error) => {
          if (this.catalogCache.get(cacheKey) === pending)
            this.catalogCache.delete(cacheKey);
          throw error;
        });
      catalog = pending;
      this.catalogCache.set(cacheKey, catalog);
    }
    return catalog;
  }

  async load(
    tileId: SourceTileId,
    signal: AbortSignal,
  ): Promise<TileLoadResult> {
    if (signal.aborted) return aborted(this.name, signal);
    if (this.configurationError)
      return {
        kind: 'temporary-failure',
        source: this.name,
        error: this.configurationError,
      };
    if (!this.baseUrl)
      return {
        kind: 'missing',
        source: this.name,
        error: 'S3 source-тайлы отключены: VITE_MAP_TILE_BASE_URL не задан.',
      };
    try {
      const catalog = await waitForAbort(this.loadCatalog(), signal),
        key = sourceTileKey(tileId),
        datasets = new Map(
          catalog.datasets.map((dataset) => [dataset.datasetId, dataset]),
        );
      let incompatible: TileCatalogDatasetV1 | undefined;
      for (const datasetId of catalog.activeDatasets) {
        const dataset = datasets.get(datasetId)!,
          entry = dataset.tiles[key];
        if (!entry) continue;
        if (
          dataset.schemaVersion !== TILE_ARTIFACT_SCHEMA_VERSION ||
          dataset.tileBuildVersion !== TILE_BUILD_VERSION
        ) {
          incompatible ??= dataset;
          continue;
        }
        const path = entry.path ?? `${dataset.path}/${key}.tile.json.br`,
          fetchStarted = performance.now(),
          { response, text } = await this.fetchText(path, signal),
          fetched = performance.now();
        if (response.status === 404)
          return {
            kind: 'missing',
            source: this.name,
            error: `Source-тайл ${key} заявлен в каталоге, но отсутствует в S3 (HTTP 404).`,
          };
        if (!response.ok)
          return {
            kind: 'temporary-failure',
            source: this.name,
            error: `S3 GET source-тайла ${key} завершился с HTTP ${response.status}.`,
          };
        const tile = decodeTileArtifact(text, tileId),
          decoded = performance.now();
        if (tile.checksum !== entry.checksum)
          return {
            kind: 'corrupt',
            source: this.name,
            error: `Контрольная сумма source-тайла ${key} не совпадает с каталогом S3.`,
          };
        return {
          kind: 'hit',
          source: this.name,
          tile,
          timings: {
            fetchMs: Math.round(fetched - fetchStarted),
            decodeMs: Math.round(decoded - fetched),
          },
        };
      }
      if (incompatible)
        return {
          kind: 'incompatible',
          source: this.name,
          error: `Source-тайл ${key} опубликован в несовместимом dataset ${incompatible.datasetId} (schema ${incompatible.schemaVersion}, build ${incompatible.tileBuildVersion}).`,
        };
      return {
        kind: 'missing',
        source: this.name,
        error: `Source-тайл ${key} отсутствует в активных datasets каталога S3.`,
      };
    } catch (error) {
      if (signal.aborted) return aborted(this.name, signal, error);
      if (error instanceof TileArtifactError)
        return {
          kind: error.code.startsWith('incompatible-')
            ? 'incompatible'
            : 'corrupt',
          source: this.name,
          error: error.message,
        };
      if (error instanceof CatalogError)
        return { kind: error.kind, source: this.name, error: error.message };
      return thrownResult(this.name, signal, error);
    }
  }
}

export class OverpassTileSource implements TileSource {
  readonly name = 'overpass-dem';

  constructor(
    private build: (
      tileId: SourceTileId,
      signal: AbortSignal,
    ) => Promise<TileArtifactV1Input>,
  ) {}

  async load(
    tileId: SourceTileId,
    signal: AbortSignal,
  ): Promise<TileLoadResult> {
    try {
      signal.throwIfAborted();
      const built = await this.build(tileId, signal);
      signal.throwIfAborted();
      const tile = decodeTileArtifact(encodeTileArtifact(built), tileId);
      return { kind: 'hit', source: this.name, tile };
    } catch (error) {
      if (signal.aborted) return aborted(this.name, signal, error);
      if (error instanceof TileArtifactError)
        return {
          kind: error.code.startsWith('incompatible-')
            ? 'incompatible'
            : 'corrupt',
          source: this.name,
          error: error.message,
        };
      return thrownResult(this.name, signal, error);
    }
  }
}
