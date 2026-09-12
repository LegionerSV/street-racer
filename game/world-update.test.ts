import { expect, it } from 'vitest';
import { buildWorld } from './network';
import { reconcileWorld, edgeKey } from './world-update';
import { sampleElevation, sampleRoadElevation, smoothElevation } from './geo';
import type { RegionData } from './types';
import { sourceTileKeysForLocalBounds } from './stream-coverage';
const region = (x: number): RegionData => ({
  center: { lat: 0, lon: 0 },
  elements: [
    { type: 'node', id: 1, lat: 0, lon: x / 111320 },
    { type: 'node', id: 2, lat: 0, lon: (x + 100) / 111320 },
    { type: 'way', id: 10, nodes: [1, 2], tags: { highway: 'residential' } },
  ],
  drivingSide: 'right',
  elevation: {
    width: 2,
    size: 1600,
    offsetX: x + 500,
    offsetZ: 500,
    values: new Float32Array(4),
  },
  fetchedAt: 'test',
  loadedTiles: sourceTileKeysForLocalBounds(
    { lat: 0, lon: 0 },
    { minX: x, minZ: 0, maxX: x + 1000, maxZ: 1000 },
  ),
  focus: { x, y: 0, z: 0 },
  heightDatum: 0,
});
it('строит доступные дороги далеко за прежней границей и закрывает выход в неготовую клетку', () => {
  // Arrange
  const input = region(10000);
  input.elements.push(
    { type: 'node', id: 3, lat: 0, lon: 11500 / 111320 },
    { type: 'way', id: 11, nodes: [2, 3], tags: { highway: 'residential' } },
  );
  // Act
  const world = buildWorld(input);
  // Assert
  expect(world.edges.find((e) => e.way === 10)?.blocked).toBe(false);
  expect(world.edges.find((e) => e.way === 11)?.blocked).toBe(true);
  expect(world.edges.find((e) => e.way === 11)?.unloaded).toBe(true);
  expect(world.loadedTiles).toEqual(input.loadedTiles);
});
it('пересчитывает высоту продолжения дороги после получения недостающих данных', () => {
  // Arrange
  const before = buildWorld(region(0)),
    after = buildWorld(region(0));
  before.edges[0].unloaded = true;
  before.edges[0].points = before.edges[0].points.map((p) => ({
    ...p,
    y: 100,
  }));
  // Act
  const next = reconcileWorld(before, after);
  // Assert
  expect(next.edges[0].points[0].y).toBeLessThan(1);
});
it('не возвращает старую ошибочную высоту закрытого моста после пересчёта', () => {
  // Arrange
  const before = buildWorld(region(0)),
    after = buildWorld(region(0));
  before.edges[0].blocked = true;
  before.edges[0].points = before.edges[0].points.map((p) => ({
    ...p,
    y: 100,
  }));
  // Act
  const next = reconcileWorld(before, after);
  // Assert
  expect(next.edges[0].blocked).toBe(false);
  expect(next.edges[0].points[0].y).toBeLessThan(1);
});
it('сохраняет высоту готовой дороги и сопоставляет её по OSM, а не индексу массива', () => {
  // Arrange
  const before = buildWorld(region(0)),
    after = buildWorld(region(0));
  before.edges[0].points = before.edges[0].points.map((p) => ({ ...p, y: 8 }));
  after.edges.reverse();
  after.edges.forEach((e, i) => (e.id = i));
  // Act
  const result = reconcileWorld(before, after);
  // Assert
  expect(
    result.edges.find((e) => edgeKey(e) === edgeKey(before.edges[0]))?.points,
  ).toEqual(before.edges[0].points);
  expect(result.edges.every((e, i) => e.id === i)).toBe(true);
  expect(result.spawnEdge).toBe(before.spawnEdge);
  expect(
    result.routes.every((route) =>
      route.edges.every((id) =>
        result.edges.some((edge) => edge.stableId === id),
      ),
    ),
  ).toBe(true);
});
it('стыкует высоту нового продолжения с уже построенной дорогой', () => {
  // Arrange
  const before = buildWorld(region(0)),
    after = buildWorld(region(0)),
    ready = before.edges[0],
    continuation = structuredClone(ready);
  ready.points = [
    { x: 0, y: 2, z: 0 },
    { x: 100, y: 2, z: 0 },
  ];
  continuation.stableId = '10/2/3/1';
  continuation.from = 2;
  continuation.to = 3;
  continuation.unloaded = true;
  continuation.blocked = true;
  continuation.points = [
    { x: 100, y: 12, z: 0 },
    { x: 200, y: 12, z: 0 },
  ];
  before.edges = [ready, continuation];
  after.edges = [
    structuredClone(ready),
    {
      ...structuredClone(continuation),
      unloaded: false,
      blocked: false,
    },
  ];

  // Act
  const result = reconcileWorld(before, after);

  // Assert
  const joined = result.edges.find(
    (edge) => edge.stableId === continuation.stableId,
  )!;
  expect(joined.points[0].y).toBe(2);
  expect(joined.points[1].y).toBe(12);
});
it('составной рельеф использует абсолютные координаты клеток и сохраняет стык после выгрузки', () => {
  // Arrange
  const left = {
      width: 81,
      size: 1600,
      offsetX: 500,
      offsetZ: 500,
      values: Float32Array.from(
        { length: 81 * 81 },
        (_, i) => ((i % 81) * 20 - 300) * 0.01,
      ),
    },
    right = {
      width: 81,
      size: 1600,
      offsetX: 1500,
      offsetZ: 500,
      values: Float32Array.from(
        { length: 81 * 81 },
        (_, i) => ((i % 81) * 20 + 700) * 0.01,
      ),
    };
  const grid = smoothElevation({
    width: 2,
    size: 1,
    values: new Float32Array(4),
    patches: [left, right],
  });
  // Act / Assert
  expect(sampleElevation(grid, 999, 500)).toBeCloseTo(9.99, 3);
  expect(sampleElevation(grid, 1001, 500)).toBeCloseTo(10.01, 3);
  expect(sampleRoadElevation(grid, 1500, 500)).toBeCloseTo(15, 3);
  expect(
    sampleElevation({ ...grid, patches: [grid.patches![1]] }, 1500, 500),
  ).toBeCloseTo(15, 3);
});
