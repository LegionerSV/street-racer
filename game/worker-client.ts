import type {
  ChunkData,
  RegionData,
  WorkerRequest,
  WorkerResponse,
  World,
  EdgeStableId,
  PreparedWorld,
  PreparedPatch,
  Route,
  SourceTileData,
} from './types';
import { applyWorldPatch } from './world-patch';
// oxlint-disable-next-line import/default -- Vite создаёт конструктор Worker для импорта с ?worker.
import WorkerConstructor from './world.worker?worker';
export class WorldWorker {
  private worker: Worker;
  private preparationWorker: Worker | null = null;
  private world: World | null = null;
  private preparedWorld: World | null = null;
  private sequence = 0;
  private disposed = false;
  private sourceTiles: Map<string, SourceTileData> | null = null;
  private preparedSourceTiles: Map<string, SourceTileData> | null = null;
  private pending = new Map<
    number,
    {
      worker: Worker;
      resolve: (v: unknown) => void;
      reject: (e: Error) => void;
    }
  >();
  constructor() {
    this.worker = this.createWorker();
  }
  private createWorker(): Worker {
    const worker = new WorkerConstructor();
    worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
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
    worker.onerror = (event: ErrorEvent) => {
      this.pending.forEach((p, id) => {
        if (p.worker !== worker) return;
        p.reject(new Error(event.message || 'Не удалось подготовить район.'));
        this.pending.delete(id);
      });
    };
    return worker;
  }
  private request<T>(
    request:
      | Omit<Extract<WorkerRequest, { region: unknown }>, 'id'>
      | Omit<Extract<WorkerRequest, { type: 'chunk' }>, 'id'>
      | Omit<Extract<WorkerRequest, { type: 'race' }>, 'id'>
      | Omit<Extract<WorkerRequest, { type: 'prepareTiles' }>, 'id'>
      | Omit<Extract<WorkerRequest, { type: 'adopt' }>, 'id'>
      | { type: 'commit' },
    worker = this.worker,
  ): Promise<T> {
    if (this.disposed) return Promise.reject(new Error('Загрузка отменена.'));
    return new Promise((resolve, reject) => {
      const id = ++this.sequence;
      this.pending.set(id, {
        worker,
        resolve: (value) => resolve(value as T),
        reject,
      });
      worker.postMessage({ ...request, id });
    });
  }
  build(region: RegionData) {
    return this.request<World>({ type: 'world', region }).then((world) => {
      this.world = world;
      this.sourceTiles = region.sourceTiles
        ? new Map(region.sourceTiles.map((tile) => [tile.key, tile]))
        : null;
      this.preparedSourceTiles = null;
      return world;
    });
  }
  async prepare(
    region: RegionData,
    installedChunks?: string[],
    patchOnly = false,
  ) {
    if (this.disposed) throw new Error('Загрузка отменена.');
    if (!this.world) throw new Error('Район ещё не подготовлен.');
    const streamed = !!this.sourceTiles && !!region.sourceTiles;
    if (this.preparationWorker && this.preparationWorker !== this.worker)
      this.preparationWorker.terminate();
    // Потоковые тайлы уже хранятся в активном worker; повторная передача мира
    // при каждом обновлении карты расходовала память браузера.
    const worker = (this.preparationWorker = streamed
      ? this.worker
      : this.createWorker());
    this.preparedWorld = null;
    this.preparedSourceTiles = null;
    try {
      if (!streamed)
        await this.request<void>(
          {
            type: 'adopt',
            world: this.world,
            sourceTiles: this.sourceTiles
              ? [...this.sourceTiles.values()]
              : undefined,
          },
          worker,
        );
      const prepared = await this.prepareInWorker(
        region,
        worker,
        installedChunks,
        patchOnly,
      );
      this.preparedWorld = prepared.world;
      return prepared;
    } catch (error) {
      if (worker !== this.worker) worker.terminate();
      if (this.preparationWorker === worker) this.preparationWorker = null;
      throw error;
    }
  }
  private prepareInWorker(
    region: RegionData,
    worker: Worker,
    installedChunks?: string[],
    patchOnly = false,
  ) {
    if (!this.sourceTiles || !region.sourceTiles)
      return this.request<PreparedWorld>({ type: 'prepare', region }, worker);
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
    return this.request<PreparedWorld | PreparedPatch>(
      {
        type: 'prepareTiles',
        update: {
          add,
          remove,
          center: region.center,
          drivingSide: region.drivingSide,
          fetchedAt: region.fetchedAt,
          focus: region.focus,
          heightDatum: region.heightDatum,
          installedChunks,
          patchOnly,
        },
      },
      worker,
    ).then((prepared) => {
      this.preparedSourceTiles = next;
      return 'world' in prepared
        ? prepared
        : {
            world: applyWorldPatch(this.world!, prepared.patch, prepared.meta),
            patch: prepared.patch,
          };
    });
  }
  raceRoute(start: EdgeStableId, kind: Route['kind']) {
    return this.request<Route | null>({ type: 'race', start, kind });
  }
  commit() {
    const worker = this.preparationWorker;
    if (!worker || !this.preparedWorld)
      return Promise.reject(
        new Error('Новая часть района ещё не подготовлена.'),
      );
    return this.request<void>({ type: 'commit' }, worker).then(() => {
      if (worker !== this.worker) {
        this.worker.terminate();
        this.worker = worker;
      }
      this.preparationWorker = null;
      this.world = this.preparedWorld;
      this.preparedWorld = null;
      if (this.preparedSourceTiles) this.sourceTiles = this.preparedSourceTiles;
      this.preparedSourceTiles = null;
    });
  }
  chunk(key: string, lod: number, cacheLimit = 32) {
    return this.request<ChunkData>({ type: 'chunk', key, lod, cacheLimit });
  }
  preparedChunk(key: string, lod: number) {
    if (!this.preparationWorker)
      return Promise.reject(
        new Error('Новая часть района ещё не подготовлена.'),
      );
    return this.request<ChunkData>(
      { type: 'chunk', key, lod, prepared: true },
      this.preparationWorker,
    );
  }
  dispose() {
    this.disposed = true;
    this.worker.terminate();
    if (this.preparationWorker && this.preparationWorker !== this.worker)
      this.preparationWorker.terminate();
    this.pending.forEach((p) => p.reject(new Error('Загрузка отменена.')));
    this.pending.clear();
  }
}
