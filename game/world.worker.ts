import { buildWorld, createRaceRoute } from './network';
import { reconcileWorld } from './world-update';
import { buildChunk, ChunkBudget, indexWorld } from './chunks';
import type {
  ChunkData,
  WorkerRequest,
  WorkerResponse,
  World,
  WorldPatch,
} from './types';
import {
  buildIncrementalWorld,
  SourceTileRegistry,
} from './source-tile-registry';
import { createWorldPatch } from './world-patch';
let world: World | null = null;
let prepared: World | null = null;
let preparedPatch: WorldPatch | null = null;
let registry: SourceTileRegistry | null = null;
let preparedRegistry: SourceTileRegistry | null = null;
let cache = new ChunkBudget<ChunkData>(32);
self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const request = event.data;
  try {
    let response: WorkerResponse;
    if (request.type === 'world') {
      world = buildWorld(request.region);
      registry = SourceTileRegistry.fromRegion(request.region);
      prepared = null;
      preparedPatch = null;
      preparedRegistry = null;
      cache = new ChunkBudget(32);
      indexWorld(world);
      response = { id: request.id, type: 'world', world };
    } else if (request.type === 'prepare' || request.type === 'prepareTiles') {
      if (!world) throw new Error('Район ещё не подготовлен.');
      prepared = null;
      preparedPatch = null;
      preparedRegistry = null;
      const updateRegion =
        request.type === 'prepareTiles'
          ? {
              center: request.update.center,
              elements: [],
              elevation: { width: 2, size: 1, values: new Float32Array(4) },
              drivingSide: request.update.drivingSide,
              fetchedAt: request.update.fetchedAt,
              focus: request.update.focus,
              heightDatum: request.update.heightDatum,
            }
          : request.region;
      if (
        registry &&
        (request.type === 'prepareTiles' || request.region.sourceTiles)
      ) {
        const staged =
            request.type === 'prepareTiles'
              ? registry.stageUpdate(request.update.add, request.update.remove)
              : registry.stage(request.region),
          affected = staged.registry.affectedTiles(
            staged.changed,
            staged.changedElements,
          );
        prepared = buildIncrementalWorld(
          world,
          staged.registry,
          affected,
          updateRegion,
          staged.changedElements,
        );
        preparedRegistry = staged.registry;
        indexWorld(prepared);
        preparedPatch = createWorldPatch(world, prepared);
        response = {
          id: request.id,
          type: 'prepared',
          prepared: {
            world: prepared,
            patch: preparedPatch,
          },
        };
      } else {
        if (request.type === 'prepareTiles')
          throw new Error('Активный реестр source-тайлов ещё не подготовлен.');
        prepared = reconcileWorld(world, buildWorld(request.region));
        indexWorld(prepared);
        preparedPatch = createWorldPatch(world, prepared);
        response = {
          id: request.id,
          type: 'prepared',
          prepared: {
            world: prepared,
            patch: preparedPatch,
          },
        };
      }
    } else if (request.type === 'race') {
      if (!world) throw new Error('Район ещё не подготовлен.');
      response = {
        id: request.id,
        type: 'race',
        route: createRaceRoute(world, request.start, request.kind) ?? null,
      };
    } else if (request.type === 'commit') {
      if (!prepared) throw new Error('Новая часть района ещё не подготовлена.');
      world = prepared;
      if (preparedRegistry) registry = preparedRegistry;
      prepared = null;
      preparedRegistry = null;
      cache.invalidateChunks(preparedPatch?.dirtyChunks ?? []);
      preparedPatch = null;
      response = { id: request.id, type: 'committed' };
    } else if (request.type === 'chunk') {
      if (!world) throw new Error('Район ещё не подготовлен.');
      if (request.prepared && !prepared)
        throw new Error('Новая часть района ещё не подготовлена.');
      cache.setLimit(request.cacheLimit || 32);
      const id = `${request.key}/${request.lod}`,
        chunk = request.prepared
          ? buildChunk(prepared!, request.key, request.lod)
          : cache.get(id) || buildChunk(world, request.key, request.lod);
      if (!request.prepared) cache.touch(id, chunk);
      response = { id: request.id, type: 'chunk', chunk };
    } else throw new Error('Неизвестная команда подготовки района.');
    self.postMessage(response);
  } catch (error) {
    self.postMessage({
      id: request.id,
      type: 'error',
      error:
        error instanceof Error ? error.message : 'Ошибка подготовки района.',
    } satisfies WorkerResponse);
  }
};
