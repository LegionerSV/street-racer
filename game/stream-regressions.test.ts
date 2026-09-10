import { expect, it } from 'vitest';
import { buildWorld } from './network';
import { indexWorld, criticalChunks, buildChunk } from './chunks';
import { reconcileWorld, changedChunks } from './world-update';
import { SpatialGrid } from './geometry';
import {
  routeHasCoverage,
  needsRaceRecovery,
  sourceTileKeysForLocalBounds,
} from './stream-coverage';
import { tileReady } from './region-stream';
import type { Point, RegionData, OSMElement } from './types';

const point = (x: number, z: number): Point => ({ x, y: 0, z });
function input(
  points: Point[],
  ways: OSMElement[],
  tiles = sourceTileKeysForLocalBounds(
    { lat: 0, lon: 0 },
    { minX: 0, minZ: 0, maxX: 1000, maxZ: 1000 },
  ),
): RegionData {
  return {
    center: { lat: 0, lon: 0 },
    drivingSide: 'right',
    fetchedAt: 'test',
    elevation: { width: 2, size: 5000, values: new Float32Array(4) },
    loadedTiles: tiles,
    heightDatum: 0,
    elements: [
      ...points.map(
        (p, i): OSMElement => ({
          type: 'node',
          id: i + 1,
          lon: p.x / 111320,
          lat: p.z / 111320,
        }),
      ),
      ...ways,
    ],
  };
}
const road = (id: number, nodes: number[]): OSMElement => ({
  type: 'way',
  id,
  nodes,
  tags: { highway: 'residential' },
});

it('не предлагает гонку у неготовой границы, но открывает её после загрузки коридора', () => {
  // Arrange
  const data = input(
    [point(150, 1100), point(150, 1210), point(850, 1210), point(850, 1100)],
    [road(10, [1, 2, 3, 4, 1])],
  );
  // Act
  const before = buildWorld(data),
    after = buildWorld({
      ...data,
      loadedTiles: sourceTileKeysForLocalBounds(data.center, {
        minX: 0,
        minZ: 0,
        maxX: 1000,
        maxZ: 1500,
      }),
    });
  // Assert
  expect(before.routes).toHaveLength(0);
  expect(after.routes.map((r) => r.kind)).toContain('circuit');
  expect(
    after.routes.every((r) =>
      routeHasCoverage(r.points, after.loadedTiles, after.center),
    ),
  ).toBe(true);
});

it('при выезде гонщика к неготовой границе требует возврат, а ожидание коллизий не сбрасывает гонку', () => {
  // Arrange
  const center = { lat: 0, lon: 0 },
    loaded = new Set(
      sourceTileKeysForLocalBounds(center, {
        minX: 200,
        minZ: 200,
        maxX: 800,
        maxZ: 800,
      }),
    ),
    outside = point(500, 1200),
    inside = point(500, 500);
  // Act / Assert
  expect(
    needsRaceRecovery(true, loaded, criticalChunks(outside, 0, true), center),
  ).toBe(true);
  expect(
    needsRaceRecovery(true, loaded, criticalChunks(inside, 0, true), center),
  ).toBe(false);
  expect(
    needsRaceRecovery(
      false,
      loaded,
      criticalChunks(outside, Math.PI / 2, true),
      center,
    ),
  ).toBe(false);
  const safeRoute = [point(200, 200), point(800, 800)];
  expect(routeHasCoverage(safeRoute, [...loaded], center)).toBe(true);
  for (const p of safeRoute)
    for (const heading of [0, Math.PI / 2, Math.PI, -Math.PI / 2])
      expect(
        criticalChunks(p, heading, true).every((k) =>
          tileReady(loaded, k, center),
        ),
      ).toBe(true);
});

it('обновляет старые кварталы вдоль всего моста при изменении высоты дальнего конца', () => {
  // Arrange
  const data = input(
    [point(400, 500), point(1400, 500)],
    [
      {
        ...road(10, [1, 2]),
        tags: { highway: 'residential', bridge: 'yes', layer: '1' },
      },
    ],
  );
  const patch = (center: number) => ({
    width: 81,
    size: 1600,
    offsetX: center,
    offsetZ: 500,
    values: Float32Array.from(
      { length: 81 * 81 },
      (_, i) => Math.max(0, center - 800 + (i % 81) * 20 - 1300) * 0.1,
    ),
  });
  const before = buildWorld({
    ...data,
    elevation: { ...data.elevation, patches: [patch(500)] },
  });
  const after = reconcileWorld(
    before,
    buildWorld({
      ...data,
      loadedTiles: sourceTileKeysForLocalBounds(data.center, {
        minX: 0,
        minZ: 0,
        maxX: 2000,
        maxZ: 1000,
      }),
      elevation: { ...data.elevation, patches: [patch(500), patch(1500)] },
    }),
  );
  // Act
  const dirty = changedChunks(before, after, ['2,2', '3,2', '-4,-4']);
  // Assert
  expect(before.edges[0].points).not.toEqual(after.edges[0].points);
  expect(dirty).toContain('2,2');
  expect(dirty).toContain('3,2');
  expect(dirty).not.toContain('-4,-4');
});

it('сохраняет старый спринт и добавляет появившийся после загрузки круг', () => {
  // Arrange
  const data = input(
    [point(150, 150), point(150, 600), point(600, 600), point(600, 150)],
    [road(10, [1, 2, 3])],
  );
  const before = buildWorld(data),
    after = buildWorld({
      ...data,
      elements: [...data.elements, road(11, [3, 4, 1])],
    });
  const sprint = before.routes.find((r) => r.kind === 'sprint')!;
  // Act
  const next = reconcileWorld(before, after);
  // Assert
  expect(sprint).toBeDefined();
  expect(next.routes.map((r) => r.kind).sort()).toEqual(['circuit', 'sprint']);
  expect(next.routes.find((r) => r.kind === 'sprint')?.points).toEqual(
    sprint.points,
  );
  expect(next.routes.every((r) => r.edges[0] === next.spawnEdge)).toBe(true);
});

it('отбрасывает дальнюю часть мультиполигона и сохраняет окружающий район полигон с отверстием', () => {
  // Arrange
  const square = (a: number, b: number) => [
    point(a, a),
    point(b, a),
    point(b, b),
    point(a, b),
  ];
  const data = input(
    [...square(-20000, 20000), ...square(50000, 70000), ...square(200, 400)],
    [
      { type: 'way', id: 10, nodes: [1, 2, 3, 4, 1] },
      { type: 'way', id: 11, nodes: [5, 6, 7, 8, 5] },
      { type: 'way', id: 12, nodes: [9, 10, 11, 12, 9] },
      {
        type: 'relation',
        id: 20,
        tags: { type: 'multipolygon', natural: 'water' },
        members: [
          { type: 'way', ref: 10, role: 'outer' },
          { type: 'way', ref: 11, role: 'outer' },
          { type: 'way', ref: 12, role: 'inner' },
        ],
      },
    ],
  );
  // Act
  const world = buildWorld(data),
    index = indexWorld(world);
  // Assert
  expect(world.areas).toHaveLength(1);
  expect(world.areas[0].holes).toHaveLength(1);
  expect(index.waters.cellCount).toBeLessThanOrEqual(64);
  expect(
    index.waters.query({ minX: 100, maxX: 100, minZ: 100, maxZ: 100 }),
  ).toHaveLength(1);
  expect(
    index.waters.query({ minX: 50000, maxX: 70000, minZ: 50000, maxZ: 70000 }),
  ).toHaveLength(0);
  const water = buildChunk(world, '1,1', 0).water;
  // Вода в квартале 250..500 обходит остров 200..400, а не закрывает его.
  let surface = 0;
  for (let i = 0; i < water.indices.length; i += 3) {
    const p = water.indices.slice(i, i + 3).map((j) => ({
      x: water.positions[j * 3],
      z: water.positions[j * 3 + 2],
    }));
    surface +=
      Math.abs(
        (p[1].x - p[0].x) * (p[2].z - p[0].z) -
          (p[1].z - p[0].z) * (p[2].x - p[0].x),
      ) / 2;
  }
  expect(surface).toBeCloseTo(250 * 250 - 150 * 150, 1);
});

it('сохраняет кварталы без изменений и обновляет коллизии удалённого здания', () => {
  // Arrange
  const before = buildWorld(
    input([point(200, 200), point(700, 200)], [road(10, [1, 2])]),
  );
  const after = structuredClone(before);
  before.buildings.push({
    id: 42,
    footprint: [point(510, 510), point(540, 510), point(540, 540)],
    height: 10,
    colour: 0,
    roof: 'flat',
  });
  // Act / Assert
  expect(changedChunks(after, structuredClone(after), ['0,0', '2,2'])).toEqual(
    [],
  );
  expect(changedChunks(before, after, ['0,0', '2,2'])).toEqual(['2,2']);
});

it('ограничивает вставку и запрос огромного полигона покрытием без потери исходной геометрии', () => {
  // Arrange
  const clip = [{ minX: -300, maxX: 1300, minZ: -300, maxZ: 1300 }];
  const grid = new SpatialGrid<Point[]>(250, clip),
    polygon = [point(-20000, -20000), point(20000, 20000)];
  // Act
  grid.add(polygon, { minX: -20000, maxX: 20000, minZ: -20000, maxZ: 20000 });
  // Assert
  expect(grid.cellCount).toBeLessThanOrEqual(64);
  expect(grid.query({ minX: -1e9, maxX: 1e9, minZ: -1e9, maxZ: 1e9 })).toEqual([
    polygon,
  ]);
  expect(
    grid.query({ minX: 5000, maxX: 5100, minZ: 5000, maxZ: 5100 }),
  ).toEqual([]);
});
