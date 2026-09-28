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
import { TrainTraffic } from './train-traffic';
import { sourceTileKeysForLocalBounds } from './stream-coverage';
import type { World } from './types';

it('поезд ждёт полного покрытия, стоит на паузе и сталкивается с машиной', async () => {
  // Arrange
  const engine = new NullEngine();
  const scene = new Scene(engine);
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
  const world: World = {
    center: { lat: 0, lon: 0 },
    nodes: [],
    edges: [],
    restrictions: [],
    buildings: [],
    areas: [],
    trees: [],
    elevation: { width: 2, size: 5600, values: new Float32Array(4) },
    drivingSide: 'right',
    warnings: [],
    spawnEdge: null,
    routes: [],
    railways: [
      {
        id: 1,
        nodes: [1, 2],
        points: [
          { x: 0, y: 0, z: 0 },
          { x: 0, y: 0, z: 600 },
        ],
        bridge: false,
        service: '',
      },
    ],
  };
  const train = new TrainTraffic(scene, world);
  const camera = new FreeCamera('view', new Vector3(0, 3, 300), scene);
  const player = new Vector3(0, 0, 300);
  const state = train as unknown as {
    elapsed: number;
    nextAt: number;
    active: { progress: number; cars: { body: PhysicsAggregate }[] } | null;
  };
  state.elapsed = 479.9;
  state.nextAt = 480;
  const obstacle = MeshBuilder.CreateBox(
    'test-car',
    { width: 2.5, height: 2, depth: 4.5 },
    scene,
  );
  obstacle.position.set(0, 1.5, 100);
  const body = new PhysicsAggregate(
    obstacle,
    PhysicsShapeType.BOX,
    { mass: 1200 },
    scene,
  );
  body.body.setCollisionCallbackEnabled(true);
  let collisions = 0;
  body.body.getCollisionObservable().add(() => collisions++);
  try {
    // Act
    train.step(0.2, false, player, camera);
    const withoutCoverage = state.active;
    const coveredTiles = sourceTileKeysForLocalBounds(world.center, {
      minX: -2,
      maxX: 2,
      minZ: -2,
      maxZ: 602,
    });
    train.setWorld({ ...world, loadedTiles: coveredTiles.slice(0, 1) });
    state.nextAt = state.elapsed;
    train.step(0.1, false, player, camera);
    const withPartialCoverage = state.active;
    train.setWorld({ ...world, loadedTiles: coveredTiles });
    state.nextAt = state.elapsed;
    train.step(0.1, false, player, camera);
    const beforePause = state.active?.progress;
    train.step(5, true, player, camera);
    const afterPause = state.active?.progress;
    for (let i = 0; i < 170; i++) {
      train.step(1 / 60, false, player, camera);
      scene.getPhysicsEngine()!._step(1 / 60);
    }
    // Assert
    expect(withoutCoverage).toBeNull();
    expect(withPartialCoverage).toBeNull();
    expect(beforePause).toBeDefined();
    expect(beforePause).toBeGreaterThanOrEqual(65);
    expect(afterPause).toBe(beforePause);
    expect(state.active?.progress).toBeGreaterThan(beforePause!);
    expect(collisions).toBeGreaterThan(0);
    // Act
    train.setWorld({ ...world, loadedTiles: coveredTiles, railways: [] });
    const retryAt = state.nextAt;
    train.setWorld({ ...world, loadedTiles: coveredTiles });
    train.step(5, false, player, camera);
    // Assert
    expect(state.active).toBeNull();
    expect(retryAt - state.elapsed).toBeGreaterThanOrEqual(475);
    expect(retryAt - state.elapsed).toBeLessThanOrEqual(895);
  } finally {
    body.dispose();
    obstacle.dispose();
    train.dispose();
    scene.dispose();
    engine.dispose();
  }
}, 30000);
