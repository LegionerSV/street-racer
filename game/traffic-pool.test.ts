import { expect, it, vi } from 'vitest';
import {
  NullEngine,
  Scene,
  Vector3,
  HavokPlugin,
  PhysicsMotionType,
  type IPhysicsCollisionEvent,
} from '@babylonjs/core';
import type { PhysicsEngine } from '@babylonjs/core/Physics/v2/physicsEngine';
import HavokPhysics from '@babylonjs/havok';
import { readFile } from 'node:fs/promises';
import { TrafficCarPool } from './traffic-pool';
import { createTrafficCar } from './visuals';

it('пул ограничен, скрывает коллизии и перепривязывает события новому владельцу', async () => {
  // Arrange
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
  scene.enablePhysics(Vector3.Zero(), new HavokPlugin(true, havok));
  const pool = new TrafficCarPool(scene, 1),
    firstImpact = vi.fn(),
    nextImpact = vi.fn();
  const create = () => createTrafficCar(scene, '#447788', 'pooled', 'sedan');
  const physics = scene.getPhysicsEngine() as PhysicsEngine;
  const ray = () =>
    physics.raycast(new Vector3(0, 5, 0), new Vector3(0, -5, 0));
  try {
    // Act
    const first = pool.take('first', create);
    pool.activate(first, firstImpact);
    scene._advancePhysicsEngineStep(1000 / 60);
    // Assert
    expect(ray().hasHit).toBe(true);
    // Act
    pool.release(first);
    scene._advancePhysicsEngineStep(1000 / 60);
    // Assert
    expect(ray().hasHit).toBe(false);
    first.body.body
      .getCollisionObservable()
      .notifyObservers({ impulse: 500 } as IPhysicsCollisionEvent);
    expect(firstImpact).not.toHaveBeenCalled();
    // Act
    const reused = pool.take('first', () => {
      throw new Error('Повторное создание');
    });
    pool.activate(reused, nextImpact);
    scene._advancePhysicsEngineStep(1000 / 60);
    reused.body.body
      .getCollisionObservable()
      .notifyObservers({ impulse: 500 } as IPhysicsCollisionEvent);
    // Assert
    expect(reused).toBe(first);
    expect(ray().hasHit).toBe(true);
    expect(firstImpact).not.toHaveBeenCalled();
    expect(nextImpact).toHaveBeenCalledTimes(1);
    // Act — перенос после ещё не исполненной анимированной цели.
    reused.body.body.setTargetTransform(
      new Vector3(50, 0, 0),
      reused.visual.root.rotationQuaternion!,
    );
    pool.release(reused);
    scene._advancePhysicsEngineStep(1000 / 60);
    const relocated = pool.take('first', create);
    relocated.visual.root.position.set(1000, 0, 1000);
    pool.activate(relocated, nextImpact);
    relocated.body.body.setMotionType(PhysicsMotionType.DYNAMIC);
    relocated.body.body.setLinearVelocity(new Vector3(0, 0, 10));
    scene._advancePhysicsEngineStep(1000 / 60);
    // Assert
    expect(relocated.visual.root.position.x).toBeCloseTo(1000, 3);
    expect(relocated).toBe(first);
    expect(relocated.visual.root.position.z).toBeCloseTo(1000 + 10 / 60, 3);
    expect(relocated.body.body.getLinearVelocity().z).toBeCloseTo(10, 3);
    // Act
    pool.release(reused);
    const second = pool.take('first', create);
    expect(second).not.toBe(first);
    pool.release(second);
    // Assert
    expect(first.visual.root.isDisposed()).toBe(true);
    expect(second.visual.root.isDisposed()).toBe(false);
    pool.dispose();
    expect(second.visual.root.isDisposed()).toBe(true);
    pool.dispose();
  } finally {
    pool.dispose();
    scene.dispose();
    engine.dispose();
  }
});
