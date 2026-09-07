import { expect, it } from 'vitest';
import { NullEngine, Scene, Vector3, Mesh, VertexData, PhysicsAggregate, PhysicsShapeType, HavokPlugin } from '@babylonjs/core';
import HavokPhysics from '@babylonjs/havok';
import { readFile } from 'node:fs/promises';
import { buildWorld } from './network';
import { buildChunk } from './chunks';
import { PlayerCar } from './vehicle';

it.each(['bridge', 'tunnel'])('машина проходит %s целиком с въездом и выездом на физической геометрии', async kind => {
  // Arrange
  const world = buildWorld({ center: { lat: 0, lon: 0 }, fetchedAt: '2026-09-06', drivingSide: 'right', elevation: { size: 5600, width: 2, values: new Float32Array(4) }, elements: [
    { type: 'node', id: 1, lat: 0, lon: -.006 }, { type: 'node', id: 2, lat: 0, lon: -.003 },
    { type: 'node', id: 3, lat: 0, lon: .003 }, { type: 'node', id: 4, lat: 0, lon: .006 },
    { type: 'way', id: 10, nodes: [1, 2], tags: { highway: 'primary', oneway: 'yes' } },
    { type: 'way', id: 11, nodes: [2, 3], tags: { highway: 'primary', oneway: 'yes', [kind]: 'yes' } },
    { type: 'way', id: 12, nodes: [3, 4], tags: { highway: 'primary', oneway: 'yes' } },
  ] });
  const havok = await HavokPhysics({ wasmBinary: Uint8Array.from(await readFile(new URL('../node_modules/@babylonjs/havok/lib/esm/HavokPhysics.wasm', import.meta.url))).buffer });
  const engine = new NullEngine(), scene = new Scene(engine);
  scene.enablePhysics(new Vector3(0, -9.81, 0), new HavokPlugin(true, havok));
  for (let x = -3; x <= 2; x++) for (let z = -1; z <= 0; z++) {
    const chunk = buildChunk(world, `${x},${z}`, 0);
    for (const role of ['terrain', 'road', 'structures'] as const) {
      const data = chunk[role]; if (!data.indices.length) continue;
      const mesh = new Mesh(role, scene), vertices = new VertexData(); vertices.positions = data.positions; vertices.indices = data.indices; vertices.applyToMesh(mesh);
      new PhysicsAggregate(mesh, PhysicsShapeType.MESH, { mass: 0, friction: .65 }, scene);
    }
  }
  const car = new PlayerCar(scene); car.teleport({ x: -390, y: 1, z: -1 }, Math.PI / 2);
  let lowest = Infinity, highest = -Infinity;
  try {
    // Act
    for (let i = 0; i < 2400 && car.position.x < 390; i++) {
      const keys = new Set(car.speed < 23 ? ['KeyW'] : []);
      car.step(1 / 60, keys, false); scene.getPhysicsEngine()!._step(1 / 60); car.afterPhysics();
      if (Math.abs(car.position.x) < 120) { lowest = Math.min(lowest, car.position.y); highest = Math.max(highest, car.position.y); }
    }
    // Assert
    expect(car.position.x).toBeGreaterThan(385); expect(car.grounded).toBe(true); expect(car.position.y).toBeGreaterThan(.5);
    if (kind === 'bridge') expect(lowest, JSON.stringify({position:car.position,heading:car.heading,highest,lowest})).toBeGreaterThan(6);
    else { expect(highest, JSON.stringify({position:car.position,heading:car.heading,highest,lowest})).toBeLessThan(-5); expect(lowest).toBeGreaterThan(-9); }
  } finally { car.dispose(); scene.dispose(); engine.dispose(); }
}, 20000);
