import { afterEach, expect, it, vi } from 'vitest';
import {
  RegionStream,
  startupTiles,
  ELEVATION_TILE_SIZE,
  ELEVATION_TILE_WIDTH,
} from './region-stream';
import { MapSource } from './map-source';
import { buildWorld } from './network';
import { Traffic } from './traffic';
import { NullEngine, Scene } from '@babylonjs/core';
import type { RegionData, WorkerRequest, WorkerResponse } from './types';
import * as data from './data';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
function mockedDownloads() {
  const cache = new Map();
  vi.spyOn(data, 'cacheGet').mockImplementation(async (k) => cache.get(k));
  vi.spyOn(data, 'cachePut').mockImplementation(async (k, v) => {
    cache.set(k, v);
  });
  vi.spyOn(data, 'loadElevations').mockImplementation(
    async (_c, _s, _p, _l, shape) => ({
      ...shape!,
      values: new Float32Array(shape!.width ** 2),
    }),
  );
  const requests = vi
    .spyOn(MapSource.prototype, 'request')
    .mockResolvedValue([
      { type: 'relation', id: 99, tags: { 'ISO3166-1': 'RU' } },
    ]);
  const cells = vi
    .spyOn(MapSource.prototype, 'cell')
    .mockResolvedValue([{ type: 'node', id: 1, lat: 0, lon: 0 }]);
  return { cells, cache, requests };
}
it('обновляет старый DEM, повторно используя сохранённую карту OSM', async () => {
  // Arrange
  const { cache, cells } = mockedDownloads();
  const first = new RegionStream({ lat: 0, lon: 0 }, 'mobile');
  await first.start(new AbortController().signal, () => {});
  first.dispose();
  for (const value of cache.values())
    if (value.tile)
      value.tile.elevation = {
        ...value.tile.elevation,
        size: 1600,
        width: 81,
        values: new Float32Array(81 * 81),
      };
  cells.mockRestore();
  vi.mocked(data.loadElevations).mockClear();
  const fetcher = vi.fn().mockRejectedValue(new Error('Сеть недоступна'));
  vi.stubGlobal('fetch', fetcher);
  const next = new RegionStream({ lat: 0, lon: 0 }, 'mobile');
  try {
    // Act
    const result = await next.start(new AbortController().signal, () => {});
    // Assert
    expect(fetcher).not.toHaveBeenCalled();
    expect(data.loadElevations).toHaveBeenCalledTimes(4);
    expect(result.elevation.patches).toHaveLength(4);
    for (const p of result.elevation.patches!) {
      expect(p.size).toBe(ELEVATION_TILE_SIZE);
      expect(p.width).toBe(ELEVATION_TILE_WIDTH);
    }
    expect(result.elements).toEqual([{ type: 'node', id: 1, lat: 0, lon: 0 }]);
  } finally {
    next.dispose();
  }
});
it('переносит свежий старый район в клетки без сетевых запросов OSM', async () => {
  // Arrange
  const { cache, requests, cells } = mockedDownloads();
  requests.mockRestore();
  cells.mockRestore();
  const legacy = {
    ...fixture(),
    fetchedAt: new Date().toISOString(),
    drivingSide: 'left' as const,
  };
  cache.set(data.regionKey(legacy.center), legacy);
  const fetcher = vi.fn().mockRejectedValue(new Error('Сеть недоступна'));
  vi.stubGlobal('fetch', fetcher);
  const stream = new RegionStream(legacy.center, 'mobile');
  try {
    // Act
    const result = await stream.start(new AbortController().signal, () => {});
    // Assert
    expect(result.drivingSide).toBe('left');
    expect(result.elements).toEqual(legacy.elements);
    expect(result.loadedTiles).toHaveLength(4);
    expect(fetcher).not.toHaveBeenCalled();
  } finally {
    stream.dispose();
  }
});
it('не переносит просроченный старый район вместо свежей загрузки', async () => {
  // Arrange
  const { cache, cells, requests } = mockedDownloads(),
    legacy = fixture();
  cache.set(data.regionKey(legacy.center), {
    ...legacy,
    fetchedAt: new Date(Date.now() - 8 * 86400000).toISOString(),
  });
  const stream = new RegionStream(legacy.center, 'mobile');
  try {
    // Act
    await stream.start(new AbortController().signal, () => {});
    // Assert
    expect(cells).toHaveBeenCalledTimes(4);
    expect(requests).toHaveBeenCalledTimes(1);
  } finally {
    stream.dispose();
  }
});
it('старт отдаёт только 2 × 2 км, затем фон расширяет карту и ограничивает её память при поездке', async () => {
  // Arrange
  const { cells } = mockedDownloads();
  const stream = new RegionStream({ lat: 0, lon: 0 }, 'mobile');
  try {
    // Act
    const first = await stream.start(new AbortController().signal, () => {});
    // Assert
    expect(new Set(first.loadedTiles)).toEqual(new Set(startupTiles()));
    expect(cells).toHaveBeenCalledTimes(4);
    expect(
      cells.mock.calls.every((call) => call[2] === 0 && call[3] === true),
    ).toBe(true);
    expect(first.elements).toHaveLength(1);
    // Act — уезжаем на десятки километров, не накапливая старые клетки.
    for (let i = 1; i <= 40; i++)
      await stream.next({ x: i * 1000, y: 0, z: 0 }, Math.PI / 2);
    const last = stream.snapshot({ x: 40000, y: 0, z: 0 });
    // Assert
    expect(last.loadedTiles!.length).toBeLessThanOrEqual(16);
    expect(last.loadedTiles).not.toContain('-1,-1');
    expect(last.heightDatum).toBe(first.heightDatum);
    expect(stream.diagnostics().recent.length).toBeLessThanOrEqual(40);
  } finally {
    stream.dispose();
  }
});
it('после обрыва старта берёт готовые клетки из кэша', async () => {
  // Arrange
  const { cells } = mockedDownloads();
  cells
    .mockResolvedValueOnce([{ type: 'node', id: 1 }])
    .mockRejectedValueOnce(new Error('Обрыв связи'));
  const first = new RegionStream({ lat: 0, lon: 0 }, 'mobile');
  // Act
  await expect(
    first.start(new AbortController().signal, () => {}),
  ).rejects.toThrow('Обрыв связи');
  const next = new RegionStream({ lat: 0, lon: 0 }, 'mobile');
  try {
    await next.start(new AbortController().signal, () => {});
    // Assert — первая успешная клетка повторно не запрашивается.
    expect(cells).toHaveBeenCalledTimes(5);
  } finally {
    next.dispose();
  }
});
it('отмена поездки запрещает дальнейшие сетевые обращения', async () => {
  // Arrange
  const { cells } = mockedDownloads();
  const stream = new RegionStream({ lat: 0, lon: 0 }, 'mobile');
  await stream.start(new AbortController().signal, () => {});
  stream.dispose();
  // Act / Assert
  await expect(stream.next({ x: 0, y: 0, z: 0 }, 0)).rejects.toBeDefined();
  expect(cells).toHaveBeenCalledTimes(4);
});
it('после медленного ответа использует актуальное окно машины, не устанавливая устаревшую клетку', async () => {
  // Arrange
  mockedDownloads();
  const stream = new RegionStream({ lat: 0, lon: 0 }, 'mobile');
  await stream.start(new AbortController().signal, () => {});
  try {
    // Act
    const result = await stream.next({ x: 0, y: 0, z: 0 }, 0, () => ({
      position: { x: 10000, y: 0, z: 0 },
      heading: Math.PI / 2,
    }));
    // Assert — готовые данные старого окна не выбрасываем до успешной замены.
    expect(result).toBeNull();
    expect(stream.snapshot({ x: 0, y: 0, z: 0 }).loadedTiles).toHaveLength(4);
  } finally {
    stream.dispose();
  }
});

const fixture = (shift = 0): RegionData => ({
  center: { lat: 0, lon: 0 },
  elements: [
    { type: 'node', id: 1, lat: 0, lon: 0 },
    { type: 'node', id: 2, lat: 0.001, lon: 0 },
    {
      type: 'way',
      id: 10 + shift,
      nodes: [1, 2],
      tags: { highway: 'residential' },
    },
  ],
  elevation: { width: 2, size: 5600, values: new Float32Array(4) },
  drivingSide: 'right',
  fetchedAt: 'test',
});
it('подготовка нового мира не меняет текущие кварталы до commit и сбрасывает кэш после него', async () => {
  // Arrange
  const replies: WorkerResponse[] = [];
  const surface = {
    onmessage: undefined as
      | undefined
      | ((event: { data: WorkerRequest }) => void),
    postMessage: (r: WorkerResponse) => replies.push(r),
  };
  vi.stubGlobal('self', surface);
  await import('./world.worker');
  const call = (data: WorkerRequest) => {
    surface.onmessage!({ data });
    return replies.at(-1)!;
  };
  // Act
  call({ id: 1, type: 'world', region: fixture() });
  const before = call({ id: 2, type: 'chunk', key: '0,0', lod: 0 });
  call({ id: 3, type: 'prepare', region: { ...fixture(1), elements: [] } });
  const during = call({ id: 4, type: 'chunk', key: '0,0', lod: 0 });
  call({ id: 5, type: 'commit' });
  const after = call({ id: 6, type: 'chunk', key: '0,0', lod: 0 });
  // Assert
  expect(before.type).toBe('chunk');
  expect(during.type).toBe('chunk');
  expect(after.type).toBe('chunk');
  if (
    before.type === 'chunk' &&
    during.type === 'chunk' &&
    after.type === 'chunk'
  ) {
    expect(during.chunk).toBe(before.chunk);
    expect(before.chunk.road.indices.length).toBeGreaterThan(0);
    expect(after.chunk.road.indices).toHaveLength(0);
  }
});
it('переносит трафик на ту же дорогу после перестановки индексов и запрещает смену сети в гонке', () => {
  // Arrange
  const before = buildWorld(fixture()),
    after = buildWorld(fixture());
  after.edges.reverse();
  after.edges.forEach((e, i) => (e.id = i));
  const engine = new NullEngine(),
    scene = new Scene(engine),
    traffic = new Traffic(scene, before);
  traffic.agents.push({
    id: 1,
    edge: 0,
    distance: 25,
    speed: 10,
    point: { x: 0, y: 0, z: 25 },
    heading: 0,
    stuck: 0,
  });
  try {
    // Act
    traffic.replaceWorld(after);
    // Assert
    expect(traffic.agents[0].edge).toBe(1);
    expect(traffic.agents[0].distance).toBe(25);
    traffic.agents[0].race = {
      route: {
        id: 'r',
        kind: 'sprint',
        title: 'Заезд',
        edges: [1],
        points: [],
        cumulative: [],
        length: 100,
        laps: 1,
      },
      index: 0,
      lap: 0,
      finished: false,
      progress: 0,
    };
    expect(() => traffic.replaceWorld(before)).toThrow(
      'Нельзя менять дорожную сеть во время гонки.',
    );
  } finally {
    traffic.dispose();
    scene.dispose();
    engine.dispose();
  }
});
