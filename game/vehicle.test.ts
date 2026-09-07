import { describe, it, expect } from 'vitest';
import { NullEngine, Scene, Vector3, MeshBuilder, PhysicsAggregate, PhysicsShapeType, HavokPlugin } from '@babylonjs/core';
import HavokPhysics from '@babylonjs/havok';
import { readFile } from 'node:fs/promises';
import { PlayerCar } from './vehicle';

describe('Физическая машина', () => {
  it('держится на подвеске, разгоняется и тормозит на настоящем Havok', async () => {
    // Arrange
    const havok = await HavokPhysics({ wasmBinary: Uint8Array.from(await readFile(new URL('../node_modules/@babylonjs/havok/lib/esm/HavokPhysics.wasm', import.meta.url))).buffer });
    const engine = new NullEngine(), scene = new Scene(engine);
    scene.enablePhysics(new Vector3(0, -9.81, 0), new HavokPlugin(true, havok));
    const floor = MeshBuilder.CreateGround('floor', { width: 5000, height: 5000 }, scene);
    const ground = new PhysicsAggregate(floor, PhysicsShapeType.MESH, { mass: 0, friction: .7 }, scene);
    const car = new PlayerCar(scene); car.teleport({ x: 0, y: .9, z: 0 }, 0);
    const step = (keys: Set<string>, count: number) => { for (let i = 0; i < count; i++) { car.step(1 / 60, keys, false); scene.getPhysicsEngine()!._step(1 / 60); car.afterPhysics(); } };
    try {
      // Act
      step(new Set(), 180);
      // Assert
      expect(car.position.y).toBeGreaterThan(.5); expect(car.position.y).toBeLessThan(1.3); expect(car.grounded).toBe(true);
      // Act
      step(new Set(['KeyW']), 600); const fast = car.speed;
      // Assert
      expect(fast).toBeGreaterThan(20); expect(car.position.z).toBeGreaterThan(100);
      // Act
      step(new Set(['KeyS']), 120);
      // Assert
      expect(car.speed).toBeLessThan(fast - 8); expect(car.position.y).toBeGreaterThan(.4);
    } finally { car.dispose(); ground.dispose(); scene.dispose(); engine.dispose(); }
  }, 20000);
});
