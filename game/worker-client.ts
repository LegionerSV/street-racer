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
  async prepare(region: RegionData) {
    if (this.disposed) throw new Error('Загрузка отменена.');
    if (!this.world) throw new Error('Район ещё не подготовлен.');
    // Долгая пересборка не занимает очередь кварталов под движущейся машиной.
    this.preparationWorker?.terminate();
    const worker = (this.preparationWorker = this.createWorker());
    this.preparedWorld = null;
    this.preparedSourceTiles = null;
    try {
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
      const prepared = await this.prepareInWorker(region, worker);
      this.preparedWorld = prepared.world;
      return prepared;
    } catch (error) {
      worker.terminate();
      if (this.preparationWorker === worker) this.preparationWorker = null;
      throw error;
    }
  }
  private prepareInWorker(region: RegionData, worker: Worker) {
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
    return this.request<PreparedWorld>(
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
        },
      },
      worker,
    ).then((prepared) => {
      this.preparedSourceTiles = next;
      return prepared;
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
      this.worker.terminate();
      this.worker = worker;
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
    this.preparationWorker?.terminate();
    this.pending.forEach((p) => p.reject(new Error('Загрузка отменена.')));
    this.pending.clear();
  }
}
