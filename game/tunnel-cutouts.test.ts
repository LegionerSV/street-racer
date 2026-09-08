import { expect, it } from 'vitest';
import {
  Ray,
  Vector3,
  NullEngine,
  Scene,
  HavokPlugin,
  Mesh,
  VertexData,
  PhysicsAggregate,
  PhysicsShapeType,
} from '@babylonjs/core';
import HavokPhysics from '@babylonjs/havok';
import { readFile } from 'node:fs/promises';
import { PlayerCar } from './vehicle';
import { buildWorld } from './network';
import { buildChunk } from './chunks';
import type { MeshData, RegionData } from './types';

function portalRegion(): RegionData {
  // Верхняя улица проходит поперёк портала; её откос тянется к опущенному
  // подходу нижней дороги и в прежней версии образует зелёную стену.
  return {
    center: { lat: 0, lon: 0 },
    fetchedAt: 'test',
    drivingSide: 'right',
    elevation: { width: 2, size: 5600, values: new Float32Array(4) },
    elements: [
      ...[
        [-300, 100],
        [50, 100],
        [200, 100],
        [550, 100],
        [65, 20],
        [65, 180],
      ].map(([x, z], i) => ({
        type: 'node' as const,
        id: i + 1,
        lon: x / 111320,
        lat: z / 111320,
      })),
      {
        type: 'way',
        id: 10,
        nodes: [1, 2],
        tags: { highway: 'primary', oneway: 'yes' },
      },
      {
        type: 'way',
        id: 11,
        nodes: [2, 3],
        tags: { highway: 'primary', oneway: 'yes', tunnel: 'yes', layer: '-1' },
      },
      {
        type: 'way',
        id: 12,
        nodes: [3, 4],
        tags: { highway: 'primary', oneway: 'yes' },
      },
      {
        type: 'way',
        id: 20,
        nodes: [5, 6],
        tags: { highway: 'primary', width: '14' },
      },
    ],
  };
}
function hits(mesh: MeshData, ray: Ray) {
  let count = 0;
  for (let i = 0; i < mesh.indices.length; i += 3) {
    const [a, b, c] = mesh.indices
      .slice(i, i + 3)
      .map((id) => Vector3.FromArray(mesh.positions, id * 3));
    const hit = ray.intersectsTriangle(a, b, c);
    if (hit && hit.distance > 0 && hit.distance < ray.length) count++;
  }
  return count;
}
it.each([0, 1, 2].flatMap((lod) => [0, 180].map((shift) => ({ lod, shift }))))(
  'откосы не перекрывают портал на LOD $lod, сдвиг $shift м',
  ({ lod, shift }) => {
    // Arrange
    const region = portalRegion();
    for (const e of region.elements)
      if (e.lon !== undefined) e.lon += shift / 111320;
    const world = buildWorld(region),
      floor = world.edges.find((e) => e.tunnel)!.points[0].y;
    // Act
    const chunks = ['0,0', '1,0'].map((key) => buildChunk(world, key, lod));
    // Assert — проверка лучами не использует алгоритм вычитания геометрии.
    for (const z of [97.7, 100.1, 102.3])
      for (const above of [0.6, 1.5, 3, 5]) {
        const ray = new Ray(
          new Vector3(48 + shift, floor + above, z),
          new Vector3(1, 0, 0),
          154,
        );
        for (const chunk of chunks)
          for (const role of ['terrain', 'shoulders'] as const)
            expect(hits(chunk[role], ray), `${role}, z=${z}, h=${above}`).toBe(
              0,
            );
      }
    expect(
      chunks.reduce(
        (sum, c) =>
          sum +
          hits(
            c.road,
            new Ray(
              new Vector3(65 + shift, 10, 100),
              new Vector3(0, -1, 0),
              11,
            ),
          ),
        0,
      ),
    ).toBeGreaterThan(0);
    expect(
      chunks.reduce(
        (sum, c) =>
          sum +
          hits(
            c.terrain,
            new Ray(
              new Vector3(140 + shift, 10, 100),
              new Vector3(0, -1, 0),
              10.1,
            ),
          ),
        0,
      ),
    ).toBeGreaterThan(0);
    for (const c of chunks)
      for (const mesh of [c.terrain, c.shoulders]) {
        expect(mesh.colors).toHaveLength((mesh.positions.length / 3) * 4);
        expect(mesh.positions.every(Number.isFinite)).toBe(true);
      }
  },
);

it('машина физически проезжает портал под откосом верхней дороги', async () => {
  // Arrange
  const world = buildWorld(portalRegion());
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
  for (const key of ['-1,0', '0,0', '1,0']) {
    const chunk = buildChunk(world, key, 0);
    for (const role of [
      'terrain',
      'shoulders',
      'road',
      'sidewalks',
      'structures',
    ] as const) {
      const data = chunk[role];
      if (!data?.indices.length) continue;
      const mesh = new Mesh(role, scene),
        vertices = new VertexData();
      vertices.positions = data.positions;
      vertices.indices = data.indices;
      vertices.applyToMesh(mesh);
      new PhysicsAggregate(
        mesh,
        PhysicsShapeType.MESH,
        { mass: 0, friction: 0.65 },
        scene,
      );
    }
  }
  const car = new PlayerCar(scene);
  car.teleport({ x: -200, y: 1, z: 98.3 }, Math.PI / 2);
  let lowest = Infinity;
  try {
    // Act
    for (let i = 0; i < 3600 && car.position.x < 450; i++) {
      car.step(1 / 60, new Set(car.speed < 20 ? ['KeyW'] : []), false);
      scene.getPhysicsEngine()!._step(1 / 60);
      car.afterPhysics();
      lowest = Math.min(lowest, car.position.y);
    }
    // Assert
    expect(car.position.x).toBeGreaterThan(445);
    expect(lowest).toBeLessThan(-5);
    expect(car.grounded).toBe(true);
    expect(car.position.y).toBeGreaterThan(0.5);
  } finally {
    car.dispose();
    scene.dispose();
    engine.dispose();
  }
}, 20000);
