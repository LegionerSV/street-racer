import { expect, it } from 'vitest';
import { buildChunk } from './chunks';
import { buildWorld } from './network';
import { projectOnSegment, tileKey } from './geo';
import type { Edge, MeshData, OSMElement, Point, World } from './types';
import roads from './fixtures/birzhevaya-roads.osm.json';
import dem from './fixtures/birzhevaya-elevation.json';
import { bridgeRailingSpans, embankmentRailingSpans } from './bridge-railings';
import { PARAPET_COLOUR } from './parapet';
import {
  NullEngine,
  Scene,
  Vector3,
  Mesh,
  VertexData,
  PhysicsAggregate,
  PhysicsShapeType,
  HavokPlugin,
} from '@babylonjs/core';
import HavokPhysics from '@babylonjs/havok';
import { readFile } from 'node:fs/promises';

function railVertices(mesh: MeshData): Point[] {
  return Array.from({ length: mesh.positions.length / 3 }, (_, i) => i)
    .filter(
      (i) =>
        Math.abs(mesh.colors![i * 4] - PARAPET_COLOUR[0]) < 1e-6 &&
        Math.abs(mesh.colors![i * 4 + 1] - PARAPET_COLOUR[1]) < 1e-6,
    )
    .map((i) => ({
      x: mesh.positions[i * 3],
      y: mesh.positions[i * 3 + 1],
      z: mesh.positions[i * 3 + 2],
    }));
}
function fixture(separation = 8, height = 0, layer = 1): World {
  const edge: Edge = {
    id: 0,
    stableId: '10/1/2/0',
    way: 10,
    from: 1,
    to: 2,
    name: 'Мост',
    width: 8,
    lanes: 2,
    length: 100,
    speed: 10,
    bridge: true,
    tunnel: false,
    layer: 1,
    blocked: false,
    points: [
      { x: 30, y: 6, z: 80 },
      { x: 130, y: 6, z: 80 },
    ],
  };
  return {
    center: { lat: 0, lon: 0 },
    edges: [
      edge,
      {
        ...edge,
        id: 1,
        way: 20,
        from: 3,
        to: 4,
        layer,
        points: [
          { x: 130, y: 6 + height, z: 80 + separation },
          { x: 30, y: 6 + height, z: 80 + separation },
        ],
      },
    ],
    nodes: [],
    restrictions: [],
    buildings: [],
    areas: [],
    trees: [],
    elevation: { width: 2, size: 5600, values: new Float32Array(4) },
    drivingSide: 'right',
    warnings: [],
    spawnEdge: null,
    routes: [],
  };
}
it('выбирает ближайший берег независимо от начала контура воды', () => {
  // Arrange
  const fences = (rotation: number) => {
    const world = fixture(60);
    world.edges[0] = {
      ...world.edges[0],
      bridge: false,
      layer: 0,
      name: 'Набережная',
    };
    const points = [
      { x: 0, y: 0, z: 85 },
      { x: 200, y: 0, z: 85 },
      { x: 200, y: 0, z: 240 },
      { x: 0, y: 0, z: 240 },
    ];
    world.areas = [
      {
        id: 1,
        kind: 'water',
        railing: 'river',
        points: [...points.slice(rotation), ...points.slice(0, rotation)],
      },
    ];
    return buildChunk(world, '0,0', 0).breakables.filter(
      (b) => b.fenceType === 'embankment',
    );
  };
  // Act
  const first = fences(0),
    rotated = fences(2);
  // Assert
  expect(first.length).toBeGreaterThan(0);
  expect(rotated).toEqual(first);
});
it.each(['нет воды', 'далёкая вода', 'неоднозначный берег'])(
  'не угадывает ограждение набережной: %s',
  (state) => {
    // Arrange
    const world = fixture();
    world.edges = [
      { ...world.edges[0], bridge: false, layer: 0, name: 'Набережная' },
    ];
    if (state !== 'нет воды')
      world.areas = [
        {
          id: 1,
          kind: 'water',
          railing: 'river',
          points: [
            { x: 0, y: 0, z: state === 'далёкая вода' ? 160 : 40 },
            { x: 200, y: 0, z: state === 'далёкая вода' ? 160 : 40 },
            { x: 200, y: 0, z: 200 },
            { x: 0, y: 0, z: 200 },
          ],
        },
      ];
    // Act
    const fences = buildChunk(world, '0,0', 0).breakables.filter(
      (p) => p.fenceType === 'embankment',
    );
    // Assert
    expect(fences).toEqual([]);
  },
);
it.each([0, 0.8])(
  'оставляет только внешние перила общего моста при разнице высот %s м',
  (height) => {
    // Arrange
    const world = fixture(8, height);
    // Act
    const points = railVertices(buildChunk(world, '0,0', 0).structures);
    // Assert — перила за внешними тротуарами, без стенок между направлениями.
    expect(points.length).toBeGreaterThan(0);
    expect(
      points.every(
        (p) =>
          (p.z <= 73.8 + 1e-6 && p.z >= 73.34 - 1e-6) ||
          (p.z >= 94.2 - 1e-6 && p.z <= 94.66 + 1e-6),
      ),
    ).toBe(true);
    expect(new Set(points.map((p) => p.z)).size).toBe(4);
  },
);

it('сохраняет внешний парапет за широким променадом, исключая внутренний проезд', () => {
  // Arrange
  const world = fixture(14);
  world.edges = world.edges.map((e) => ({
    ...e,
    bridge: false,
    layer: 0,
    name: 'Набережная',
  }));
  world.areas = [
    {
      id: 1,
      kind: 'water',
      railing: 'river',
      points: [
        { x: 0, y: 0, z: 128 },
        { x: 200, y: 0, z: 128 },
        { x: 200, y: 0, z: 240 },
        { x: 0, y: 0, z: 240 },
      ],
    },
  ];
  // Act
  const fences = buildChunk(world, '0,0', 0).breakables.filter(
    (p) => p.fenceType === 'embankment',
  );
  // Assert
  expect(fences.length).toBeGreaterThan(0);
  expect(fences.every((p) => Math.abs(p.point.z - 100.2) < 1e-6)).toBe(true);
});

it('убирает внутренние парапеты встречных половин общего моста с зазором между OSM-осями', () => {
  // Arrange
  const world = fixture(14);
  world.edges = world.edges.map((e) => ({
    ...e,
    width: 10.2,
    oneWay: true,
    sidewalkLeft: false,
    sidewalkRight: false,
  }));
  // Act
  const points = railVertices(buildChunk(world, '0,0', 0).structures);
  // Assert
  expect(points.length).toBeGreaterThan(0);
  expect(points.every((p) => p.z < 80 || p.z > 94)).toBe(true);
});

it.each([0, 2])(
  'не оставляет откосы над водой на LOD %s и сохраняет остров',
  (lod) => {
    // Arrange
    const world = fixture();
    world.edges = [
      { ...world.edges[0], bridge: false, layer: 0, name: 'Набережная' },
    ];
    const ring = (x0: number, z0: number, x1: number, z1: number) => [
      { x: x0, y: 0, z: z0 },
      { x: x1, y: 0, z: z0 },
      { x: x1, y: 0, z: z1 },
      { x: x0, y: 0, z: z1 },
    ];
    world.areas = [
      {
        id: 1,
        kind: 'water',
        railing: 'river',
        points: ring(0, 87, 200, 200),
        holes: [ring(150, 120, 180, 150)],
      },
    ];
    // Act
    const chunk = buildChunk(world, '0,0', lod);
    const centers = (mesh: MeshData) =>
      Array.from({ length: mesh.indices.length / 3 }, (_, i) => {
        const ids = mesh.indices.slice(i * 3, i * 3 + 3);
        return {
          x: ids.reduce((s, id) => s + mesh.positions[id * 3], 0) / 3,
          z: ids.reduce((s, id) => s + mesh.positions[id * 3 + 2], 0) / 3,
        };
      });
    // Assert
    for (const mesh of [chunk.terrain, chunk.shoulders])
      expect(
        centers(mesh).filter(
          (p) => p.x > 0 && p.x < 140 && p.z > 87 && p.z < 200,
        ),
      ).toEqual([]);
    expect(
      centers(chunk.terrain).some(
        (p) => p.x > 150 && p.x < 180 && p.z > 120 && p.z < 150,
      ),
    ).toBe(true);
  },
);

it('не опускает местную поверхность реки к далёкой низкой вершине её контура', () => {
  // Arrange
  const world = fixture();
  world.edges = [];
  world.areas = [
    {
      id: 1,
      kind: 'water',
      railing: 'river',
      points: [
        { x: -1000, y: -40, z: -1000 },
        { x: 1000, y: 0, z: -1000 },
        { x: 1000, y: 0, z: 1000 },
        { x: -1000, y: 0, z: 1000 },
      ],
    },
  ];
  // Act
  const meshes = ['0,0', '1,0'].map((key) => buildChunk(world, key, 0).water);
  // Assert
  for (const mesh of meshes) {
    expect(mesh.indices.length).toBeGreaterThan(0);
    expect(
      mesh.positions
        .filter((_, i) => i % 3 === 1)
        .every((y) => Math.abs(y + 0.4) < 1e-6),
    ).toBe(true);
  }
});

it('сохраняет ровный верх укреплённого берега вместо провала под набережной', () => {
  // Arrange
  const world = fixture();
  world.edges = [
    { ...world.edges[0], bridge: false, layer: 0, name: 'Набережная' },
  ];
  world.areas = [
    {
      id: 1,
      kind: 'water',
      railing: 'river',
      points: [
        { x: 0, y: 0, z: 100 },
        { x: 200, y: 0, z: 100 },
        { x: 200, y: 0, z: 240 },
        { x: 0, y: 0, z: 240 },
      ],
    },
  ];
  // Act
  const terrain = buildChunk(world, '0,0', 0).terrain;
  const coastal = new Set(
    terrain.indices.filter(
      (i) =>
        terrain.positions[i * 3] > 40 &&
        terrain.positions[i * 3] < 120 &&
        Math.abs(terrain.positions[i * 3 + 2] - 100) < 1e-5,
    ),
  );
  // Assert
  expect(coastal.size).toBeGreaterThan(0);
  expect(
    [...coastal].every(
      (i) => Math.abs(terrain.positions[i * 3 + 1] - 5.7) < 1e-5,
    ),
  ).toBe(true);
});
it.each([false, true])(
  'добавляет ограждение после загрузки берега, остров: %s',
  (island) => {
    // Arrange
    const world = fixture();
    world.edges = [
      { ...world.edges[0], bridge: false, layer: 0, name: 'Набережная' },
    ];
    const ring = (south: number, north: number) => [
      { x: 0, y: 0, z: south },
      { x: 200, y: 0, z: south },
      { x: 200, y: 0, z: north },
      { x: 0, y: 0, z: north },
    ];
    const loaded: World = {
      ...world,
      areas: [
        {
          id: 1,
          kind: 'water',
          railing: 'river',
          points: ring(island ? -100 : 90, 300),
          holes: island ? [ring(0, 90)] : [],
        },
      ],
    };
    // Act
    const waiting = buildChunk(world, '0,0', 0).breakables.filter(
      (p) => p.fenceType === 'embankment',
    );
    const ready = buildChunk(loaded, '0,0', 0).breakables.filter(
      (p) => p.fenceType === 'embankment',
    );
    // Assert
    expect(waiting).toEqual([]);
    expect(ready.length).toBeGreaterThan(0);
    expect(ready.every((p) => Math.abs(p.point.z - 86.2) < 1e-6)).toBe(true);
  },
);
it.each([
  [20, 0, 1],
  [8, 5, 2],
])(
  'сохраняет оба ограждения независимых мостов: разнос %s м, высота %s м, слой %s',
  (separation, height, layer) => {
    // Arrange / Act
    const points = railVertices(
      buildChunk(fixture(separation, height, layer), '0,0', 0).structures,
    );
    // Assert
    expect(new Set(points.map((p) => p.z)).size).toBe(8);
  },
);
it.each([0, 6])(
  'открывает разрыв только для съезда на уровне полотна, высота дороги %s м',
  (height) => {
    // Arrange
    const world = fixture(),
      edge = world.edges[0];
    const road = {
      a: { x: 80, y: height, z: 60 },
      b: { x: 80, y: height, z: 80 },
      edge: { ...edge, way: 30, bridge: false, layer: 0 },
    };
    // Act
    const spans = bridgeRailingSpans(
      { x: 30, y: 6, z: 73.8 },
      { x: 130, y: 6, z: 73.8 },
      edge,
      [road],
    );
    // Assert — нижняя дорога не разрывает перила над собой.
    if (height === 0)
      expect(spans).toEqual([
        { a: { x: 30, y: 6, z: 73.8 }, b: { x: 130, y: 6, z: 73.8 } },
      ]);
    else {
      expect(spans).toHaveLength(2);
      expect(spans[0].b.x).toBeCloseTo(75.85, 6);
      expect(spans[1].a.x).toBeCloseTo(84.15, 6);
      expect(spans.every((s) => s.a.y === 6 && s.b.y === 6)).toBe(true);
    }
  },
);
it('прерывает ограждение набережной на поперечной дороге, но сохраняет над нижней дорогой', () => {
  // Arrange
  const edge = fixture().edges[0];
  const bankA = { x: 20, y: 2.15, z: 20.7 },
    bankB = { x: 120, y: 2.15, z: 20.7 };
  const crossing = {
    a: { x: 70, y: 2, z: 0 },
    b: { x: 70, y: 2, z: 50 },
    edge: { ...edge, way: 30, bridge: false, width: 8, layer: 0 },
  };
  // Act
  const spans = embankmentRailingSpans(bankA, bankB, [crossing]);
  const below = embankmentRailingSpans(bankA, bankB, [
    { ...crossing, a: { ...crossing.a, y: -4 }, b: { ...crossing.b, y: -4 } },
  ]);
  // Assert
  expect(spans).toHaveLength(2);
  expect(spans[0].b.x).toBeLessThan(66);
  expect(spans[1].a.x).toBeGreaterThan(74);
  expect(below).toEqual([{ a: bankA, b: bankB }]);
});
it('убирает коллизии внутренних перил и сохраняет внешнее ограждение в Havok', async () => {
  // Arrange — те же структуры и тип коллизии, что устанавливает игровой runtime.
  const chunk = buildChunk(fixture(), '0,0', 0);
  const havok = await HavokPhysics({
    wasmBinary: Uint8Array.from(
      await readFile(
        new URL(
          '../node_modules/@babylonjs/havok/lib/esm/HavokPhysics.wasm',
          import.meta.url,
        ),
      ),
    ).buffer,
  });
  const engine = new NullEngine(),
    scene = new Scene(engine);
  scene.enablePhysics(new Vector3(0, -9.81, 0), new HavokPlugin(true, havok));
  const mesh = new Mesh('structures', scene),
    vertices = new VertexData();
  vertices.positions = chunk.structures.positions;
  vertices.indices = chunk.structures.indices;
  vertices.applyToMesh(mesh);
  new PhysicsAggregate(mesh, PhysicsShapeType.MESH, { mass: 0 }, scene);
  try {
    // Act
    const physics = scene.getPhysicsEngine()!;
    physics._step(1 / 60);
    const middle = physics.raycast(
      new Vector3(80, 6.5, 80),
      new Vector3(80, 6.5, 88),
    );
    const outer = physics.raycast(
      new Vector3(80, 6.5, 80),
      new Vector3(80, 6.5, 70),
    );
    // Assert
    expect(middle.hasHit).toBe(false);
    expect(outer.hasHit).toBe(true);
    expect(outer.hitPointWorld.z).toBeCloseTo(73.8, 2);
  } finally {
    scene.dispose();
    engine.dispose();
  }
});
it('не размещает перила на соседней проезжей части реальных Биржевого и Дворцового мостов', () => {
  // Arrange
  const world = buildWorld({
    center: roads.center,
    elements: roads.elements as OSMElement[],
    elevation: { ...dem, values: Float32Array.from(dem.values) },
    drivingSide: 'right',
    fetchedAt: 'test',
  });
  const bridges = world.edges.filter((e) =>
    [362785969, 362785970, 362796524, 362796525].includes(e.way),
  );
  const keys = new Set(
    bridges.flatMap((e) => e.points.map((p) => tileKey(p.x, p.z))),
  );
  // Act
  const points = [...keys].flatMap((key) =>
    railVertices(buildChunk(world, key, 0).structures),
  );
  const conflicts = points.filter((p) =>
    bridges.some((e) =>
      e.points.slice(1).some((b, i) => {
        const projection = projectOnSegment(p, e.points[i], b);
        return (
          projection.t > 0.01 &&
          projection.t < 0.99 &&
          projection.distance < e.width / 2 - 0.1 &&
          Math.abs(p.y - projection.point.y) < 2
        );
      }),
    ),
  );
  // Assert
  expect(points.length).toBeGreaterThan(0);
  expect(conflicts).toEqual([]);
});
