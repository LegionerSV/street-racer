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
