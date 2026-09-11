import type {
  ChunkData,
  RegionData,
  WorkerRequest,
  WorkerResponse,
  World,
  EdgeStableId,
  PreparedWorld,
  Route,
  SourceTileData,
} from './types';
// oxlint-disable-next-line import/default -- Vite создаёт конструктор Worker для импорта с ?worker.
import WorkerConstructor from './world.worker?worker';
export class WorldWorker {
  private worker = new WorkerConstructor();
  private sequence = 0;
  private disposed = false;
  private sourceTiles: Map<string, SourceTileData> | null = null;
  private preparedSourceTiles: Map<string, SourceTileData> | null = null;
  private pending = new Map<
    number,
    { resolve: (v: unknown) => void; reject: (e: Error) => void }
  >();
  constructor() {
    this.worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const response = event.data,
        task = this.pending.get(response.id);
      if (!task) return;
      this.pending.delete(response.id);
      if (response.type === 'error') task.reject(new Error(response.error));
      else
        task.resolve(
          response.type === 'race'
            ? response.route
            : response.type === 'prepared'
              ? response.prepared
              : response.type === 'world'
                ? response.world
                : response.type === 'chunk'
                  ? response.chunk
                  : undefined,
        );
    };
    this.worker.onerror = (event) => {
      this.pending.forEach((p) =>
        p.reject(new Error(event.message || 'Не удалось подготовить район.')),
      );
      this.pending.clear();
    };
  }
  private request<T>(
    request:
      | Omit<Extract<WorkerRequest, { region: unknown }>, 'id'>
      | Omit<Extract<WorkerRequest, { type: 'chunk' }>, 'id'>
      | Omit<Extract<WorkerRequest, { type: 'race' }>, 'id'>
      | Omit<Extract<WorkerRequest, { type: 'prepareTiles' }>, 'id'>
      | { type: 'commit' },
  ): Promise<T> {
    if (this.disposed) return Promise.reject(new Error('Загрузка отменена.'));
    return new Promise((resolve, reject) => {
      const id = ++this.sequence;
      this.pending.set(id, { resolve: (value) => resolve(value as T), reject });
      this.worker.postMessage({ ...request, id });
    });
  }
  build(region: RegionData) {
    return this.request<World>({ type: 'world', region }).then((world) => {
      this.sourceTiles = region.sourceTiles
        ? new Map(region.sourceTiles.map((tile) => [tile.key, tile]))
        : null;
      this.preparedSourceTiles = null;
      return world;
    });
  }
  prepare(region: RegionData) {
    if (!this.sourceTiles || !region.sourceTiles)
      return this.request<PreparedWorld>({ type: 'prepare', region });
    const next = new Map(region.sourceTiles.map((tile) => [tile.key, tile])),
      add = region.sourceTiles.filter((tile) => {
        const current = this.sourceTiles!.get(tile.key);
        return (
          !current ||
          (current.checksum && tile.checksum
            ? current.checksum !== tile.checksum
            : current.elements !== tile.elements ||
              current.elevation !== tile.elevation)
        );
      }),
      remove = [...this.sourceTiles.keys()].filter((key) => !next.has(key));
    return this.request<PreparedWorld>({
      type: 'prepareTiles',
      update: {
        add,
        remove,
        center: region.center,
        drivingSide: region.drivingSide,
        fetchedAt: region.fetchedAt,
        focus: region.focus,
        heightDatum: region.heightDatum,
      },
    }).then((prepared) => {
      this.preparedSourceTiles = next;
      return prepared;
    });
  }
  raceRoute(start: EdgeStableId, kind: Route['kind']) {
    return this.request<Route | null>({ type: 'race', start, kind });
  }
  commit() {
    return this.request<void>({ type: 'commit' }).then(() => {
      if (this.preparedSourceTiles) this.sourceTiles = this.preparedSourceTiles;
      this.preparedSourceTiles = null;
    });
  }
  chunk(key: string, lod: number, cacheLimit = 32) {
    return this.request<ChunkData>({ type: 'chunk', key, lod, cacheLimit });
  }
  preparedChunk(key: string, lod: number) {
    return this.request<ChunkData>({ type: 'chunk', key, lod, prepared: true });
  }
  dispose() {
    this.disposed = true;
    this.worker.terminate();
    this.pending.forEach((p) => p.reject(new Error('Загрузка отменена.')));
    this.pending.clear();
  }
}
