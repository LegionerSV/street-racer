import { expect, it } from 'vitest';
import { buildChunk } from './chunks';
import { buildWorld } from './network';
import { projectOnSegment, tileKey } from './geo';
import type { Edge, MeshData, OSMElement, Point, World } from './types';
import roads from './fixtures/birzhevaya-roads.osm.json';
import dem from './fixtures/birzhevaya-elevation.json';
import { bridgeRailingSpans } from './bridge-railings';
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
        Math.abs(mesh.colors![i * 4] - 0.37) < 1e-6 &&
        Math.abs(mesh.colors![i * 4 + 1] - 0.41) < 1e-6,
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
    spawnEdge: 0,
    routes: [],
  };
}
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
        (p) => Math.abs(p.z - 73.8) < 1e-6 || Math.abs(p.z - 94.2) < 1e-6,
      ),
    ).toBe(true);
    expect(new Set(points.map((p) => p.z)).size).toBe(2);
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
    expect(new Set(points.map((p) => p.z)).size).toBe(4);
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
