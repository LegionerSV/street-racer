import { afterEach, expect, it, vi } from 'vitest';
import type { WorkerRequest, WorkerResponse, World, RegionData } from './types';

const { instances, MockWorker } = vi.hoisted(() => {
  const instances: MockWorker[] = [];
  class MockWorker {
    requests: WorkerRequest[] = [];
    onmessage?: (event: { data: WorkerResponse }) => void;
    onerror?: (event: { message: string }) => void;
    terminated = false;
    constructor() {
      instances.push(this);
    }
    postMessage(request: WorkerRequest) {
      this.requests.push(request);
    }
    terminate() {
      this.terminated = true;
    }
    reply(type: string, response: object) {
      const request = this.requests.findLast((r) => r.type === type)!;
      this.onmessage?.({
        data: { id: request.id, ...response } as WorkerResponse,
      });
    }
  }
  return { instances, MockWorker };
});
vi.mock('./world.worker?worker', () => ({
  default: class extends MockWorker {},
}));
import { WorldWorker } from './worker-client';
import { buildWorld } from './network';
import { createWorldPatch } from './world-patch';
afterEach(() => {
  instances.length = 0;
});
const region: RegionData = {
  center: { lat: 0, lon: 0 },
  fetchedAt: 'test',
  drivingSide: 'right',
  elements: [],
  elevation: { width: 2, size: 1, values: new Float32Array(4) },
};
const world = {
  edges: [],
  nodes: [],
  buildings: [],
  areas: [],
  trees: [],
  routes: [],
  restrictions: [],
} as unknown as World;

it('готовит обновление в отдельном worker, продолжая выдавать дорожные кварталы активного мира', async () => {
  // Arrange
  const client = new WorldWorker(),
    building = client.build(region);
  const active = instances[0];
  active.reply('world', { type: 'world', world });
  await building;
  // Act — фоновая подготовка намеренно не отвечает.
  const preparation = client.prepare(region);
  const geometry = client.chunk('1,0', 0);
  active.reply('chunk', { type: 'chunk', chunk: { key: '1,0' } });
  // Assert
  expect(await geometry).toEqual({ key: '1,0' });
  expect(instances).toHaveLength(2);
  expect(active.requests.map((r) => r.type)).toEqual(['world', 'chunk']);
  const background = instances[1];
  expect(background.requests[0].type).toBe('adopt');
  background.reply('adopt', { type: 'committed' });
  await vi.waitFor(() =>
    expect(background.requests.at(-1)?.type).toBe('prepare'),
  );
  background.reply('prepare', {
    type: 'prepared',
    prepared: { world, patch: {} },
  });
  await preparation;
  const staged = client.preparedChunk('1,0', 0);
  background.reply('chunk', { type: 'chunk', chunk: { key: 'prepared' } });
  expect(await staged).toEqual({ key: 'prepared' });
  const committing = client.commit();
  background.reply('commit', { type: 'committed' });
  await committing;
  expect(active.terminated).toBe(true);
  const next = client.chunk('2,0', 0);
  background.reply('chunk', { type: 'chunk', chunk: { key: '2,0' } });
  expect(await next).toEqual({ key: '2,0' });
  client.dispose();
  expect(background.terminated).toBe(true);
});

it('обновляет поток source-тайлов в активном worker без копирования целого мира', async () => {
  // Arrange
  const first = { ...region, sourceTiles: [{ key: '15/16384/16384', elements: [], elevation: region.elevation, checksum: 'first' }] },
    nextRegion = { ...first, sourceTiles: [...first.sourceTiles, { key: '15/16385/16384', elements: [], elevation: region.elevation, checksum: 'next' }] },
    client = new WorldWorker(),
    building = client.build(first),
    active = instances[0];
  active.reply('world', { type: 'world', world });
  await building;
  // Act
  const preparation = client.prepare(nextRegion);
  // Assert
  expect(instances).toHaveLength(1);
  expect(active.requests.at(-1)?.type).toBe('prepareTiles');
  active.reply('prepareTiles', { type: 'prepared', prepared: { world, patch: {} } });
  await preparation;
  const staged = client.preparedChunk('1,0', 0);
  active.reply('chunk', { type: 'chunk', chunk: { key: 'prepared' } });
  expect(await staged).toEqual({ key: 'prepared' });
  const committing = client.commit();
  active.reply('commit', { type: 'committed' });
  await committing;
  expect(active.terminated).toBe(false);
  client.dispose();
  expect(active.terminated).toBe(true);
});
it('при потоковом обновлении получает из worker патч вместо полной копии мира', async () => {
  // Arrange
  const first = { ...region, sourceTiles: [{ key: '15/16384/16384', elements: [], elevation: region.elevation, checksum: 'first' }] },
    nextRegion = { ...first, sourceTiles: [...first.sourceTiles, { key: '15/16385/16384', elements: [], elevation: region.elevation, checksum: 'next' }] },
    before = buildWorld({ ...first, loadedTiles: first.sourceTiles.map((tile) => tile.key) }),
    after = { ...before, loadedTiles: nextRegion.sourceTiles.map((tile) => tile.key) },
    patch = createWorldPatch(before, after, ['0,0']),
    client = new WorldWorker(),
    building = client.build(first),
    active = instances[0];
  active.reply('world', { type: 'world', world: before });
  await building;
  // Act
  const preparation = client.prepare(nextRegion, ['0,0'], true);
  expect(active.requests.at(-1)).toMatchObject({ type: 'prepareTiles', update: { patchOnly: true, installedChunks: ['0,0'] } });
  active.reply('prepareTiles', { type: 'prepared', prepared: { patch, meta: {
    center: after.center, drivingSide: after.drivingSide, heightDatum: after.heightDatum,
    warnings: after.warnings, spawnEdge: after.spawnEdge, routes: after.routes,
    elevation: { ...after.elevation, patches: undefined },
  } } });
  const prepared = await preparation;
  // Assert
  expect(instances).toHaveLength(1);
  expect(prepared.world.loadedTiles).toEqual(after.loadedTiles);
  client.dispose();
});

it('ошибка фонового worker не прерывает активную геометрию и допускает повтор', async () => {
  // Arrange
  const client = new WorldWorker(),
    building = client.build(region);
  instances[0].reply('world', { type: 'world', world });
  await building;
  // Act
  const preparation = client.prepare(region),
    rejected = expect(preparation).rejects.toThrow('Фоновый сбой');
  instances.at(-1)!.onerror?.({ message: 'Фоновый сбой' });
  await rejected;
  const geometry = client.chunk('0,0', 0);
  instances[0].reply('chunk', { type: 'chunk', chunk: { key: '0,0' } });
  // Assert
  expect(await geometry).toEqual({ key: '0,0' });
  expect(instances[0].terminated).toBe(false);
  const retry = client.prepare(region),
    cancelled = expect(retry).rejects.toThrow('Загрузка отменена.');
  client.dispose();
  await cancelled;
  expect(instances.every((w) => w.terminated)).toBe(true);
});
