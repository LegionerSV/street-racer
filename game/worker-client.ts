import type { ChunkData, RegionData, WorkerRequest, WorkerResponse, World } from './types';
// oxlint-disable-next-line import/default -- Vite создаёт конструктор Worker для импорта с ?worker.
import WorkerConstructor from './world.worker?worker';
export class WorldWorker {
  private worker = new WorkerConstructor();
  private sequence = 0;
  private disposed = false;
  private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  constructor() {
    this.worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const response = event.data, task = this.pending.get(response.id); if (!task) return;
      this.pending.delete(response.id);
      if (response.type === 'error') task.reject(new Error(response.error)); else task.resolve(response.type === 'world' ? response.world : response.type==='chunk'?response.chunk:undefined);
    };
    this.worker.onerror = event => { this.pending.forEach(p => p.reject(new Error(event.message || 'Не удалось подготовить район.'))); this.pending.clear(); };
  }
  private request<T>(request: Omit<Extract<WorkerRequest, { region: unknown }>, 'id'> | Omit<Extract<WorkerRequest, { type: 'chunk' }>, 'id'> | {type:'commit'}): Promise<T> {
    if (this.disposed) return Promise.reject(new Error('Загрузка отменена.'));
    return new Promise((resolve, reject) => { const id = ++this.sequence; this.pending.set(id, { resolve: value => resolve(value as T), reject }); this.worker.postMessage({ ...request, id }); });
  }
  build(region: RegionData) { return this.request<World>({ type: 'world', region }); }
  prepare(region: RegionData) { return this.request<World>({ type: 'prepare', region }); }
  commit() { return this.request<void>({type:'commit'}); }
  chunk(key: string, lod: number, cacheLimit=32) { return this.request<ChunkData>({ type: 'chunk', key, lod, cacheLimit }); }
  dispose() { this.disposed = true; this.worker.terminate(); this.pending.forEach(p => p.reject(new Error('Загрузка отменена.'))); this.pending.clear(); }
}
