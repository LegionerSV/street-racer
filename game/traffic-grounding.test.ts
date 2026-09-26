import { expect, it } from 'vitest';
import {
  NullEngine,
  Scene,
  Vector3,
  HavokPlugin,
  Quaternion,
} from '@babylonjs/core';
import HavokPhysics from '@babylonjs/havok';
import { readFile } from 'node:fs/promises';
import { Traffic } from './traffic';
import type { Edge, World } from './types';

const edge = (id: number, y: number, rise = 0): Edge => ({
  id,
  stableId: `ground-${id}`,
  from: id * 2,
  to: id * 2 + 1,
  way: id,
  length: Math.hypot(400, rise),
  width: 8,
  lanes: 2,
  oneWay: true,
  speed: 15,
  name: 'Уклон',
  bridge: y > 3,
  tunnel: false,
  layer: y > 3 ? 1 : 0,
  blocked: false,
  points: [
    { x: 0, y, z: 0 },
    { x: 0, y: y + rise, z: 400 },
  ],
});
const makeWorld = (edges: Edge[]): World => ({
  center: { lat: 60, lon: 30 },
  nodes: [],
  edges,
  restrictions: [],
  buildings: [],
  areas: [],
  trees: [],
  elevation: { width: 2, size: 5600, values: new Float32Array(4) },
  drivingSide: 'right',
  warnings: [],
  spawnEdge: edges[0].stableId!,
  routes: [],
});
async function setup(edges: Edge[]) {
  const engine = new NullEngine(),
    scene = new Scene(engine);
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
  scene.enablePhysics(new Vector3(0, -9.81, 0), new HavokPlugin(true, havok));
  const traffic = new Traffic(scene, makeWorld(edges));
  traffic.agents.push({
    id: 12,
    edge: edges[0].stableId!,
    distance: 40,
    speed: 10,
    point: { x: 0, y: edges[0].points[0].y + 0.8, z: 40 },
    heading: 0,
    stuck: 0,
  });
  return { engine, scene, traffic };
}

it.each([0, 48, -48])(
  'анимированный и физический трафик опираются колёсами на дорогу с перепадом %s',
  async (rise) => {
    // Arrange
    const { engine, scene, traffic } = await setup([edge(1, 20, rise)]);
    try {
      // Act
      for (let i = 0; i < 240; i++) {
        const a = traffic.agents[0];
        traffic.update(
          1 / 60,
          i / 60,
          { x: i < 60 ? 50 : 8, y: a.point.y, z: a.point.z },
          0,
          false,
        );
        scene.getPhysicsEngine()!._step(1 / 60);
      }
      const a = traffic.agents[0],
        car = a.visual!;
      car.root.computeWorldMatrix(true);
      // Assert
      expect(a.dynamic).toBe(true);
      expect(
        Math.abs(
          car.root.rotationQuaternion!.toEulerAngles().x +
            Math.atan2(rise, 400),
        ),
      ).toBeLessThan(0.035);
      for (const wheel of car.wheels) {
        wheel.computeWorldMatrix(true);
        const center = wheel.getAbsolutePosition();
        const tyreBottom =
          center.y - car.profile.wheelRadius * Math.cos(a.pitch || 0);
        expect(
          Math.abs(tyreBottom - (20 + (center.z * rise) / 400)),
        ).toBeLessThan(0.065);
      }
    } finally {
      traffic.dispose();
      scene.dispose();
      engine.dispose();
    }
  },
  20000,
);

it.each([true, false])(
  'на пересечении уровней остаётся на своей дороге, мост: %s',
  async (bridge) => {
    // Arrange
    const upper = edge(1, 8),
      lower = edge(2, 0.12);
    const { engine, scene, traffic } = await setup(
      bridge ? [upper, lower] : [lower, upper],
    );
    try {
      // Act
      traffic.update(1 / 60, 0, { x: 50, y: 0, z: 40 }, 0, false);
      scene.getPhysicsEngine()!._step(1 / 60);
      const a = traffic.agents[0];
      // Assert
      expect(a.point.y - a.visual!.profile.rideHeight).toBeCloseTo(
        bridge ? 8 : 0.12,
        3,
      );
      expect(
        a.visual!.root.rotationQuaternion!.equalsWithEpsilon(
          Quaternion.Identity(),
          0.001,
        ),
      ).toBe(true);
    } finally {
      traffic.dispose();
      scene.dispose();
      engine.dispose();
    }
  },
);
it('после вертикального удара возвращается на покрытие, не зависая над ним', async () => {
  // Arrange
  const { engine, scene, traffic } = await setup([edge(1, 0.12)]);
  try {
    for (let i = 0; i < 20; i++) {
      traffic.update(1 / 60, i / 60, { x: 8, y: 1, z: 40 }, 0, false);
      scene.getPhysicsEngine()!._step(1 / 60);
    }
    const a = traffic.agents[0];
    // Act
    a.body!.body.applyImpulse(new Vector3(0, 6000, 0), a.visual!.root.position);
    a.impact = 0.7;
    for (let i = 20; i < 260; i++) {
      traffic.update(1 / 60, i / 60, { x: 8, y: 1, z: a.point.z }, 0, false);
      scene.getPhysicsEngine()!._step(1 / 60);
    }
    // Assert
    expect(a.dynamic).toBe(true);
    expect(a.impact).toBe(0);
    expect(
      a.visual!.root.position.y - a.visual!.profile.rideHeight,
    ).toBeCloseTo(0.12, 1);
    expect(Math.abs(a.body!.body.getLinearVelocity().y)).toBeLessThan(0.1);
  } finally {
    traffic.dispose();
    scene.dispose();
    engine.dispose();
  }
});

it.each([1, -1])(
  'колёса проходят перелом уклона без зависания, направление %s',
  async (direction) => {
    // Arrange
    const road = edge(1, 10);
    road.points = [
      { x: 0, y: 10, z: 0 },
      { x: 0, y: 10 + direction * 5, z: 50 },
      { x: 0, y: 10, z: 100 },
      { x: 0, y: 10, z: 400 },
    ];
    road.length = 300 + 2 * Math.hypot(50, 5);
    const { engine, scene, traffic } = await setup([road]);
    let maximumGap = 0,
      worst = '';
    try {
      // Act
      for (let i = 0; i < 160; i++) {
        const a = traffic.agents[0];
        traffic.update(
          1 / 60,
          i / 60,
          { x: 8, y: a.point.y, z: a.point.z },
          0,
          false,
        );
        scene.getPhysicsEngine()!._step(1 / 60);
        const car = a.visual!;
        car.root.computeWorldMatrix(true);
        const up = car.root.getDirection(Vector3.Up());
        for (const wheel of car.wheels) {
          wheel.computeWorldMatrix(true);
          const p = wheel.getAbsolutePosition();
          const ground =
            10 + direction * Math.max(0, 5 - Math.abs(p.z - 50) * 0.1);
          if (i > 5) {
            const gap = Math.abs(p.y - car.profile.wheelRadius * up.y - ground);
            if (gap > maximumGap) {
              maximumGap = gap;
              worst = JSON.stringify({
                i,
                z: p.z,
                gap,
                wheelY: wheel.position.y,
                pitch: car.root.rotationQuaternion!.toEulerAngles().x,
                target: a.pitch,
                rootY: car.root.position.y,
                velocity: a.body!.body.getLinearVelocity().y,
              });
            }
          }
        }
      }
      // Assert
      expect(traffic.agents[0].visual!.root.position.z).toBeGreaterThan(55);
      expect(maximumGap, worst).toBeLessThan(0.12);
    } finally {
      traffic.dispose();
      scene.dispose();
      engine.dispose();
    }
  },
);
