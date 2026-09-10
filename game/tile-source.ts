import type { LoadingLog } from './loading-log';
import type { SourceTileId } from './source-tiles';
import {
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
  | { kind: 'hit'; source: string; tile: TTile }
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
        },
      );
      if (result.kind === 'aborted') return result;
      if (result.kind !== 'hit') continue;
      if (index > 0 && this.sources[0].save) {
        if (signal.aborted) return aborted(source.name, signal);
        try {
          await this.sources[0].save(tileId, result.tile, signal, result.source);
        } catch (error) {
          if (signal.aborted) return aborted(source.name, signal, error);
          this.log?.start('Сохранение source-тайла', {
            tile: key,
            source: this.sources[0].name,
          })('error', {
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
