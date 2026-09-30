import { expect, it } from 'vitest';
import fixture from './fixtures/borovaya-rail-approach.json';
import { buildRailways } from './railways';
import { buildWorld } from './network';
import { buildChunk } from './chunks';
import { toGeo, toLocal } from './geo';
import type { Point, RegionData } from './types';

function railwayRegion(
  segments: { id: number; nodes: number[]; bridge?: boolean }[],
): RegionData {
  const center = { lat: 59.93, lon: 30.3 };
  const ids = [...new Set(segments.flatMap((s) => s.nodes))];
  return {
    center,
    drivingSide: 'right',
    fetchedAt: '',
    elevation: { width: 2, size: 10000, values: new Float32Array(4) },
    elements: [
      ...ids.map((id) => ({
        type: 'node' as const,
        id,
        ...toGeo({ x: id * 50, y: 0, z: 50 }, center),
      })),
      ...segments.map((s) => ({
        type: 'way' as const,
        id: s.id,
        nodes: s.nodes,
        tags: { railway: 'rail', ...(s.bridge ? { bridge: 'yes' } : {}) },
      })),
    ],
  };
}

it('продолжает длинный подъём через короткие отрезки и ответвление', () => {
  // Arrange
  const data = railwayRegion([
    { id: 1, nodes: [0, 1], bridge: true },
    { id: 2, nodes: [1, 2] },
    { id: 3, nodes: [2, 3] },
    { id: 4, nodes: [2, 4] },
  ]);
  // Act
  const lines = buildRailways(data, data.elevation);
  // Assert
  expect(lines[1].points.at(-1)!.y).toBe(lines[2].points[0].y);
  expect(lines[1].points.at(-1)!.y).toBe(lines[3].points[0].y);
  expect(lines[2].points.at(-1)!.y).toBeGreaterThan(3);
});

it('ограничивает подъём на длинном отрезке с редкими узлами', () => {
  // Arrange
  const data = railwayRegion([
    { id: 1, nodes: [0, 1], bridge: true },
    { id: 2, nodes: [1, 21] },
  ]);
  // Act
  const line = buildRailways(data, data.elevation)[1];
  // Assert
  expect(line.points.length).toBeGreaterThan(20);
  expect(line.points.find((p) => Math.abs(p.x - 250) < 6)!.y).toBeGreaterThan(
    1,
  );
  expect(line.points.filter((p) => p.x >= 410).every((p) => p.y === 0)).toBe(
    true,
  );
  const slopes = line.points
    .slice(1)
    .map(
      (p, i) =>
        Math.abs(p.y - line.points[i].y) /
        Math.hypot(p.x - line.points[i].x, p.z - line.points[i].z),
    );
  expect(Math.max(...slopes)).toBeLessThan(0.025);
});

it('не суммирует подъём между двумя мостами и не зависит от порядка ways', () => {
  // Arrange
  const data = railwayRegion([
    { id: 1, nodes: [0, 1], bridge: true },
    { id: 2, nodes: [1, 3] },
    { id: 3, nodes: [3, 4], bridge: true },
  ]);
  // Act
  const lines = buildRailways(data, data.elevation);
  const reversed = buildRailways(
    { ...data, elements: [...data.elements].reverse() },
    data.elevation,
  );
  // Assert
  expect(lines[1].points[0].y).toBe(5);
  expect(lines[1].points.at(-1)!.y).toBe(5);
  expect(Math.max(...lines[1].points.map((p) => p.y))).toBe(5);
  for (const line of lines)
    expect(reversed.find((l) => l.id === line.id)).toEqual(line);
});

it('пересчитывает подход после догрузки моста и возвращает землю при его удалении', () => {
  // Arrange
  const data = railwayRegion([
    { id: 1, nodes: [0, 1], bridge: true },
    { id: 2, nodes: [1, 2] },
    { id: 3, nodes: [2, 3] },
  ]);
  const partial = {
    ...data,
    elements: data.elements.filter((e) => !(e.type === 'way' && e.id === 1)),
  };
  // Act
  const before = buildRailways(partial, data.elevation);
  const loaded = buildRailways(data, data.elevation);
  const removed = buildRailways(partial, data.elevation);
  // Assert
  expect(before.every((l) => l.points.every((p) => p.y === 0))).toBe(true);
  expect(loaded[2].points.at(-1)!.y).toBeGreaterThan(3);
  expect(removed).toEqual(before);
});

it('не выдумывает связи при отсутствующих узлах и на пустой карте', () => {
  // Arrange
  const data = railwayRegion([
    { id: 1, nodes: [0, 1], bridge: true },
    { id: 2, nodes: [1, 2] },
  ]);
  data.elements = data.elements.filter(
    (e) => !(e.type === 'node' && e.id === 1),
  );
  // Act
  const missing = buildRailways(data, data.elevation);
  const empty = buildRailways({ ...data, elements: [] }, data.elevation);
  // Assert
  expect(missing).toEqual([]);
  expect(empty).toEqual([]);
});

it('устраняет разрыв 4,23 м у Боровой и сохраняет высоту стрелочной ветки', () => {
  // Arrange
  const data: RegionData = {
    ...fixture,
    elements: fixture.elements as RegionData['elements'],
    drivingSide: 'right',
    fetchedAt: '',
    elevation: { width: 2, size: 10000, values: new Float32Array(4) },
  };
  const shared = data.elements.find(
    (e) => e.type === 'node' && e.id === 5878693292,
  )!;
  const location = toLocal(shared.lat!, shared.lon!, data.center);
  // Act
  const lines = buildRailways(data, data.elevation);
  const heights = lines.flatMap((l) =>
    l.points
      .filter((p) => Math.hypot(p.x - location.x, p.z - location.z) < 0.001)
      .map((p) => p.y),
  );
  // Assert
  expect(heights).toHaveLength(3);
  expect(Math.max(...heights) - Math.min(...heights)).toBeLessThan(0.001);
  expect(heights[0]).toBeGreaterThan(4);
});

it.each([0, 1, 2, 3])(
  'заполняет пространство под подходом откосами на LOD %i',
  (lod) => {
    // Arrange
    const world = buildWorld(railwayRegion([]));
    world.railways = [
      {
        id: 1,
        nodes: [1, 2],
        bridge: false,
        service: '',
        points: [
          { x: 20, y: 4, z: 50 },
          { x: 100, y: 5, z: 50 },
        ],
      },
    ];
    // Act
    const mesh = buildChunk(world, '0,0', lod).structures;
    const points: Point[] = [];
    for (let i = 0; i < mesh.positions.length; i += 3)
      points.push({
        x: mesh.positions[i],
        y: mesh.positions[i + 1],
        z: mesh.positions[i + 2],
      });
    // Assert
    expect(points.some((p) => p.y <= 0.1 && Math.abs(p.z - 50) > 5)).toBe(true);
    expect(points.some((p) => p.y >= 4 && Math.abs(p.z - 50) >= 2)).toBe(true);
  },
);

it('не заполняет землёй проём моста', () => {
  // Arrange
  const world = buildWorld(railwayRegion([]));
  world.railways = [
    {
      id: 1,
      nodes: [1, 2],
      bridge: true,
      service: '',
      points: [
        { x: 20, y: 5, z: 50 },
        { x: 30, y: 5, z: 50 },
      ],
    },
  ];
  // Act
  const mesh = buildChunk(world, '0,0', 3).structures;
  // Assert
  expect(
    mesh.positions.filter((_, i) => i % 3 === 1).every((y) => y >= 3.7),
  ).toBe(true);
});

it.each([0, 3])('закрывает торец насыпи у устоя на LOD %i', (lod) => {
  // Arrange
  const world = buildWorld(railwayRegion([]));
  world.railways = [
    {
      id: 1,
      nodes: [1, 2],
      bridge: false,
      service: '',
      points: [
        { x: 20, y: 5, z: 50 },
        { x: 30, y: 5, z: 50 },
      ],
    },
    {
      id: 2,
      nodes: [2, 3],
      bridge: true,
      service: '',
      points: [
        { x: 30, y: 5, z: 50 },
        { x: 40, y: 5, z: 50 },
      ],
    },
  ];
  // Act
  const mesh = buildChunk(world, '0,0', lod).structures;
  const faces = [];
  for (let i = 0; i < mesh.indices.length; i += 3) {
    const points = mesh.indices
      .slice(i, i + 3)
      .map((vertex) => ({
        x: mesh.positions[vertex * 3],
        y: mesh.positions[vertex * 3 + 1],
      }));
    if (points.every((p) => Math.abs(p.x - 30) < 0.001)) faces.push(points);
  }
  // Assert
  expect(
    faces.some(
      (points) =>
        Math.min(...points.map((p) => p.y)) <= 0.1 &&
        Math.max(...points.map((p) => p.y)) >= 5,
    ),
  ).toBe(true);
});

it('смыкает края полотна и откосов на повороте между разными ways', () => {
  // Arrange
  const world = buildWorld(railwayRegion([]));
  world.railways = [
    {
      id: 1,
      nodes: [1, 2],
      bridge: false,
      service: '',
      points: [
        { x: 20, y: 5, z: 50 },
        { x: 70, y: 5, z: 50 },
      ],
    },
    {
      id: 2,
      nodes: [2, 3],
      bridge: false,
      service: '',
      points: [
        { x: 70, y: 5, z: 50 },
        { x: 70, y: 5, z: 100 },
      ],
    },
  ];
  // Act
  const mesh = buildChunk(world, '0,0', 3).structures;
  const atJoin = [];
  for (let i = 0; i < mesh.positions.length; i += 3)
    if (
      Math.abs(mesh.positions[i] - 67.9) < 0.001 &&
      Math.abs(mesh.positions[i + 1] - 5.07) < 0.001 &&
      Math.abs(mesh.positions[i + 2] - 52.1) < 0.001
    )
      atJoin.push(i);
  // Assert
  expect(atJoin.length).toBe(4);
});

it('сохраняет плавный сход подъёма на неоднородном рельефе между редкими узлами', () => {
  // Arrange
  const data = railwayRegion([
    { id: 1, nodes: [0, 1], bridge: true },
    { id: 2, nodes: [1, 21] },
  ]);
  data.elevation = {
    width: 3,
    size: 2000,
    values: new Float32Array([0, 0, 4, 0, 0, 4, 0, 0, 4]),
  };
  // Act
  const line = buildRailways(data, data.elevation)[1];
  // Assert
  const changes = line.points
    .slice(1)
    .map((point, i) => Math.abs(point.y - line.points[i].y));
  expect(Math.max(...changes)).toBeLessThan(0.25);
});
