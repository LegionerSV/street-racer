import { expect, it } from 'vitest';
import {
  FreeCamera,
  HavokPlugin,
  MeshBuilder,
  NullEngine,
  PhysicsAggregate,
  PhysicsShapeType,
  Scene,
  Vector3,
} from '@babylonjs/core';
import HavokPhysics from '@babylonjs/havok';
import { readFile } from 'node:fs/promises';
import { advanceDrivingPhysics, ChasePosition } from './driving-frame';

it.each([8, 24, 60, 120])(
  'камера сохраняет дистанцию при 180 км/ч и %s FPS',
  (fps) => {
    // Arrange
    const rig = new ChasePosition(),
      camera = Vector3.Zero(),
      target = Vector3.Zero();
    // Act
    for (let i = 0; i < fps * 10; i++) {
      const p = new Vector3(0, 0, (i / fps) * 50);
      rig.update(
        p,
        p.add(new Vector3(0, 1.85, -7.2)),
        p.add(new Vector3(0, 0.55, 3)),
        camera,
        target,
        1 / fps,
      );
      // Assert — движущийся автомобиль не удаляется от камеры из-за сглаживания.
      expect(p.z - camera.z).toBeCloseTo(7.2, 6);
      expect(target.z - p.z).toBeCloseTo(3, 6);
    }
  },
);
it('камера сразу приближается перед препятствием и сбрасывается при телепортации', () => {
  // Arrange
  const rig = new ChasePosition(),
    camera = Vector3.Zero(),
    target = Vector3.Zero(),
    p = Vector3.Zero();
  rig.update(
    p,
    new Vector3(0, 2, -7),
    Vector3.Forward(),
    camera,
    target,
    1 / 60,
  );
  // Act
  rig.update(
    p,
    new Vector3(0, 1, -2),
    Vector3.Forward(),
    camera,
    target,
    1 / 60,
    true,
  );
  // Assert
  expect(camera.z).toBe(-2);
  const next = new Vector3(100, 0, 100);
  rig.update(
    next,
    next.add(new Vector3(0, 2, -7)),
    next.add(Vector3.Forward()),
    camera,
    target,
    1 / 60,
  );
  expect(camera.z).toBe(93);
  expect(target.x).toBe(100);
});
it.each([8, 24, 60, 120, 'неровном'])(
  '180 км/ч дают 500 м за 10 секунд при %s FPS без повторного шага в render',
  async (fps) => {
    // Arrange
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
    new FreeCamera('camera', new Vector3(0, 10, -10), scene);
    scene.enablePhysics(Vector3.Zero(), new HavokPlugin(true, havok));
    scene.getPhysicsEngine()!.setSubTimeStep(1000 / 60);
    const mesh = MeshBuilder.CreateBox('car', {}, scene),
      body = new PhysicsAggregate(
        mesh,
        PhysicsShapeType.BOX,
        { mass: 1000 },
        scene,
      );
    body.body.setLinearVelocity(new Vector3(0, 0, 50));
    let elapsed = 0,
      frame = 0;
    try {
      // Act
      while (elapsed < 10000 - 1e-6) {
        const dt = Math.min(
          10000 - elapsed,
          typeof fps === 'number' ? 1000 / fps : [16, 84, 40, 160][frame++ % 4],
        );
        advanceDrivingPhysics(scene, dt, true);
        scene.render();
        elapsed += dt;
      }
      // Assert
      expect(mesh.position.z).toBeGreaterThan(499);
      expect(mesh.position.z).toBeLessThan(501);
      const before = mesh.position.z;
      advanceDrivingPhysics(scene, 5000, false);
      scene.render();
      expect(mesh.position.z).toBe(before);
      advanceDrivingPhysics(scene, 5000, true);
      expect(mesh.position.z - before).toBeLessThanOrEqual(
        50 * (0.25 + 1 / 60) + 0.01,
      );
    } finally {
      body.dispose();
      scene.dispose();
      engine.dispose();
    }
  },
  20000,
);
