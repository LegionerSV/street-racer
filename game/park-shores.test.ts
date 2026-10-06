import { expect, it } from 'vitest';
import { buildChunk } from './chunks';
import { polygonContains } from './geo';
import { parkFenceSpan } from './park-fences';
import { CURB_WIDTH, SIDEWALK_WIDTH, CURB_HEIGHT } from './clearance';
import type { Area, Edge, MeshData, Point, World } from './types';

const ring = (
  x: number,
  z: number,
  width: number,
  depth: number,
  y = 0,
): Point[] => [
  { x, y, z },
  { x: x + width, y, z },
  { x: x + width, y, z: z + depth },
  { x, y, z: z + depth },
];
function world(areas: Area[], edges: Edge[] = [], height = 0): World {
  return {
    center: { lat: 0, lon: 0 },
    nodes: [],
    edges,
    restrictions: [],
    buildings: [],
    trees: [],
    areas,
    elevation: {
      width: 2,
      size: 5600,
      values: new Float32Array(4).fill(height),
    },
    drivingSide: 'right',
    warnings: [],
    spawnEdge: null,
    routes: [],
  };
}
function contains(mesh: MeshData, point: Point) {
  for (let i = 0; i < mesh.indices.length; i += 3) {
    const triangle = mesh.indices.slice(i, i + 3).map((id) => ({
      x: mesh.positions[id * 3],
      y: mesh.positions[id * 3 + 1],
      z: mesh.positions[id * 3 + 2],
    }));
    if (polygonContains(point, triangle)) return true;
  }
  return false;
}
function road(extra: Partial<Edge> = {}): Edge {
  return {
    id: 1,
    stableId: 'park-road',
    way: 1,
    from: 1,
    to: 2,
    length: 180,
    width: 8,
    lanes: 2,
    speed: 14,
    name: 'Улица',
    bridge: false,
    tunnel: false,
    layer: 0,
    blocked: false,
    points: [
      { x: 100, y: 3, z: 20 },
      { x: 100, y: 3, z: 200 },
    ],
    ...extra,
  };
}

it('сохраняет непрерывность ограды между соседними сегментами дороги', () => {
  // Arrange
  const edge = road();
  const segments = [
    { edge, a: { x: 100, y: 3, z: 20 }, b: { x: 100, y: 3, z: 100 } },
    { edge, a: { x: 100, y: 3, z: 100 }, b: { x: 100, y: 3, z: 200 } },
  ];
  const p = { x: 110, y: 20, z: 85 },
    q = { x: 110, y: 20, z: 105 },
    r = { x: 110, y: 20, z: 125 };
  // Act
  const first = parkFenceSpan(p, q, segments, () => 3)!;
  const second = parkFenceSpan(q, r, segments, () => 3)!;
  // Assert
  expect(first[1]).toEqual(second[0]);
  expect(first[1].z).toBe(105);
});

it.each([-1, 1])('привязывает ограду с обеих сторон улицы: %s', (side) => {
  // Arrange
  const edge = road(),
    [a, b] = edge.points;
  // Act
  const span = parkFenceSpan(
    { x: 100 + side * 10, y: 20, z: 40 },
    { x: 100 + side * 10, y: 20, z: 60 },
    [{ a, b, edge }],
    () => 3,
  )!;
  // Assert
  expect(span[0].x).toBeCloseTo(
    100 + side * (4 + CURB_WIDTH + SIDEWALK_WIDTH + 0.2),
  );
  expect(span[0].y).toBeCloseTo(3 + CURB_HEIGHT);
});

it.each(
  [-1, 1].flatMap((side) =>
    [false, true].map((reverse) => ({ side, reverse })),
  ),
)('сохраняет ограду у начала и конца дороги: %j', ({ side, reverse }) => {
  // Arrange
  const edge = road({
    points: [
      { x: 100, y: 3, z: 20 },
      { x: 100, y: 3, z: 100 },
    ],
  });
  const [a, b] = reverse ? [...edge.points].reverse() : edge.points;
  const segments = [{ a, b, edge }];
  const points = [0, 10, 20, 30, 90, 100, 110, 120].map((z) => ({
    x: 100 + side * 10,
    y: 20,
    z,
  }));
  // Act
  const spans = points
    .slice(1)
    .map((point, i) => parkFenceSpan(points[i], point, segments, () => 3));
  // Assert
  expect(spans.every(Boolean)).toBe(true);
  for (let i = 1; i < spans.length; i++)
    expect(spans[i - 1]![1]).toEqual(spans[i]![0]);
  expect(spans[0]![0]).toEqual({ ...points[0], y: 3 });
  expect(spans.at(-1)![1]).toEqual({ ...points.at(-1)!, y: 3 });
  expect(spans[1]![1].z).toBe(20);
  expect(spans[4]![1].z).toBe(100);
});

it.each([false, true])(
  'сохраняет перенесённую ограду в соседнем чанке без дублей, ось z: %s',
  (swap) => {
    // Arrange
    const transform = (point: Point): Point =>
      swap ? { ...point, x: point.z, z: point.x } : point;
    const park: Area = {
      id: 2,
      kind: 'park',
      railing: 'park',
      points: ring(255, 40, 30, 130, 20).map(transform),
    };
    const edge = road({
      points: [
        { x: 240, y: 3, z: 20 },
        { x: 240, y: 3, z: 200 },
      ].map(transform),
    });
    const data = world([park], [edge], 3);
    // Act
    const chunks = ['0,0', swap ? '0,1' : '1,0'].map((key) =>
      buildChunk(data, key, 0),
    );
    const nearby = chunks.map((chunk) =>
      chunk.breakables.filter(
        (fence) =>
          fence.kind === 'fence' &&
          (swap ? fence.point.z : fence.point.x) < 250,
      ),
    );
    // Assert
    expect(nearby[0]).toHaveLength(13);
    expect(nearby[1]).toHaveLength(0);
    for (const fence of nearby[0])
      expect(swap ? fence.point.z : fence.point.x).toBeCloseTo(
        240 + 4 + CURB_WIDTH + SIDEWALK_WIDTH + 0.2,
      );
    expect(
      buildChunk(data, '0,0', 1).breakables.some(
        (fence) => fence.kind === 'fence',
      ),
    ).toBe(false);
  },
);

it.each([-1, 1])(
  'соединяет соседние стороны ограды на углу парка: %s',
  (side) => {
    // Arrange
    const park: Area = {
      id: 2,
      kind: 'park',
      railing: 'park',
      points: ring(side > 0 ? 110 : 60, 40, 30, 130, 20),
    };
    const edge = road();
    // Act
    const fences = buildChunk(
      world([park], [edge], 3),
      '0,0',
      0,
    ).breakables.filter((fence) => fence.kind === 'fence');
    const endpoints = fences.flatMap((fence) =>
      [-1, 1].map((direction) => ({
        x:
          fence.point.x +
          (direction * Math.sin(fence.heading) * fence.length!) / 2,
        y: fence.point.y + (direction * (fence.rise || 0)) / 2,
        z:
          fence.point.z +
          (direction * Math.cos(fence.heading) * fence.length!) / 2,
      })),
    );
    // Assert
    expect(endpoints.length).toBeGreaterThan(0);
    for (const point of endpoints)
      expect(
        endpoints.filter(
          (other) =>
            Math.hypot(
              point.x - other.x,
              point.y - other.y,
              point.z - other.z,
            ) < 0.001,
        ),
      ).toHaveLength(2);
  },
);

it.each<Partial<Edge>>([
  { bridge: true },
  { tunnel: true },
  { tunnelApproach: true },
  { layer: 1 },
])('не привязывает наземную ограду к отдельному уровню дороги: %j', (extra) => {
  // Arrange
  const edge = road(extra),
    [a, b] = edge.points;
  const p = { x: 102, y: 20, z: 40 },
    q = { x: 102, y: 20, z: 60 };
  // Act
  const span = parkFenceSpan(p, q, [{ a, b, edge }], () => 7);
  // Assert
  expect(span).toEqual([
    { ...p, y: 7 },
    { ...q, y: 7 },
  ]);
});

it('оставляет проход через парк в месте пересечения с наземной дорогой', () => {
  // Arrange
  const edge = road(),
    [a, b] = edge.points;
  // Act
  const span = parkFenceSpan(
    { x: 95, y: 20, z: 60 },
    { x: 105, y: 20, z: 60 },
    [{ a, b, edge }],
    () => 3,
  );
  // Assert
  expect(span).toBeUndefined();
});

it.each([0, 1, 2])(
  'оставляет сушу у пруда и острова выше воды в LOD %s',
  (lod) => {
    // Arrange
    const pond: Area = {
      id: 1,
      kind: 'water',
      points: ring(131.4, 29.3, 150, 180),
      holes: [ring(169.2, 100.8, 22, 26)],
    };
    // Act
    const chunk = buildChunk(world([pond]), '0,0', lod);
    // Assert
    const heights = chunk.terrain.indices.map(
      (id) => chunk.terrain.positions[id * 3 + 1],
    );
    expect(Math.min(...heights)).toBeGreaterThanOrEqual(-0.001);
    expect(contains(chunk.terrain, { x: 130, y: 0, z: 90 })).toBe(true);
    expect(contains(chunk.terrain, { x: 180, y: 0, z: 115 })).toBe(true);
    expect(contains(chunk.water, { x: 180, y: 0, z: 115 })).toBe(false);
    expect(contains(chunk.water, { x: 200, y: 0, z: 90 })).toBe(true);
  },
);

it('не оставляет провал суши после догрузки природного водоёма', () => {
  // Arrange
  const pond: Area = {
    id: 1,
    kind: 'water',
    points: ring(131.4, 29.3, 150, 180),
  };
  const before = buildChunk(world([]), '0,0', 0);
  // Act
  const after = buildChunk(world([pond]), '0,0', 0);
  // Assert
  expect(
    Math.min(...before.terrain.positions.filter((_, i) => i % 3 === 1)),
  ).toBe(0);
  expect(
    Math.min(
      ...after.terrain.indices.map((id) => after.terrain.positions[id * 3 + 1]),
    ),
  ).toBeGreaterThanOrEqual(-0.001);
});

it.each([true, false])(
  'привязывает близкую ограду к внешнему краю дороги, тротуар %s',
  (sidewalk) => {
    // Arrange
    const park: Area = {
      id: 2,
      kind: 'park',
      railing: 'park',
      points: ring(110, 40, 30, 130, 20),
    };
    const edge = road({ sidewalkLeft: sidewalk, sidewalkRight: sidewalk });
    // Act
    const fences = buildChunk(
      world([park], [edge], 3),
      '0,0',
      0,
    ).breakables.filter(
      (b) =>
        b.kind === 'fence' &&
        Math.abs(Math.cos(b.heading)) > 0.9 &&
        b.point.x < 120,
    );
    // Assert
    expect(fences.length).toBeGreaterThan(0);
    const x =
      100 +
      edge.width / 2 +
      (sidewalk ? CURB_WIDTH + SIDEWALK_WIDTH : 0.2) +
      0.2;
    for (const fence of fences) {
      expect(fence.point.x).toBeCloseTo(x);
      expect(fence.point.y).toBeCloseTo(3 + (sidewalk ? CURB_HEIGHT : 0));
    }
  },
);

it('сохраняет далёкую от улицы ограду на границе парка и ставит её на землю', () => {
  // Arrange
  const park: Area = {
    id: 2,
    kind: 'park',
    railing: 'park',
    points: ring(180, 40, 30, 130, 20),
  };
  // Act
  const fences = buildChunk(
    world([park], [road()], 3),
    '0,0',
    0,
  ).breakables.filter((b) => b.kind === 'fence');
  // Assert
  expect(fences.length).toBeGreaterThan(0);
  for (const fence of fences) {
    expect(fence.point.y).toBeCloseTo(3);
    expect(fence.point.x >= 180 && fence.point.x <= 210).toBe(true);
  }
});
