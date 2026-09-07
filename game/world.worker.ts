import { buildWorld } from './network';
import { buildChunk, ChunkBudget, indexWorld } from './chunks';
import type { ChunkData, WorkerRequest, WorkerResponse, World } from './types';
let world: World | null = null;
const cache = new ChunkBudget<ChunkData>(32);
self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const request = event.data;
  try {
    let response: WorkerResponse;
    if (request.type === 'world') { world = buildWorld(request.region); indexWorld(world); response = { id: request.id, type: 'world', world }; }
    else {
      if (!world) throw new Error('Район ещё не подготовлен.');
      cache.setLimit(request.cacheLimit || 32);
      const id = `${request.key}/${request.lod}`, chunk = cache.get(id) || buildChunk(world, request.key, request.lod); cache.touch(id, chunk);
      response = { id: request.id, type: 'chunk', chunk };
    }
    self.postMessage(response);
  } catch (error) { self.postMessage({ id: request.id, type: 'error', error: error instanceof Error ? error.message : 'Ошибка подготовки района.' } satisfies WorkerResponse); }
};
