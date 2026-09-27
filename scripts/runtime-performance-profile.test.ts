import { expect, it } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { NullEngine, Scene, InstancedMesh } from '@babylonjs/core';
import { buildWorld } from '../game/network';
import { raceGrid } from '../game/fixtures/race-grid';
import { indexWorld } from '../game/chunks';
import { indexDrivingWorld, prepareDrivingIndex } from '../game/driving-index';
import { createTrafficCar } from '../game/visuals';

it.skipIf(!process.env.STREET_RACER_PROFILE)(
  'измеряет индекс физики и группы отрисовки без снижения детализации',
  () => {
    // Arrange
    const world = buildWorld(raceGrid(12, 12), false);
    const full: number[] = [],
      driving: number[] = [],
      incremental: number[] = [];
    // Act
    for (let i = 0; i < 5; i++) {
      const reference = structuredClone(world),
        candidate = structuredClone(world);
      let start = performance.now();
      indexWorld(reference);
      full.push(performance.now() - start);
      start = performance.now();
      indexDrivingWorld(candidate);
      driving.push(performance.now() - start);
      const next = {
        ...candidate,
        edges: candidate.edges.map((edge, n) =>
          n === 0 ? { ...edge, width: edge.width + 1 } : edge,
        ),
      };
      start = performance.now();
      const steps = prepareDrivingIndex(next, candidate);
      while (!steps.next().done) {
        /* Замер чистого времени без пауз планировщика. */
      }
      incremental.push(performance.now() - start);
    }
    const engine = new NullEngine(),
      scene = new Scene(engine);
    try {
      const colors = [
        '#447788',
        '#bb4433',
        '#336633',
        '#999999',
        '#222222',
        '#eeeeee',
      ];
      const cars = colors.map((color, i) =>
        createTrafficCar(scene, color, `profile-${i}`, 'sedan'),
      );
      const sources = cars.flatMap((car) =>
        car.root
          .getChildMeshes()
          .map((mesh) => (mesh as InstancedMesh).sourceMesh),
      );
      const median = (values: number[]) =>
        [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
      const report = {
        roads: world.edges.length,
        fullIndexMs: { median: median(full), samples: full },
        drivingIndexMs: { median: median(driving), samples: driving },
        incrementalDrivingIndexMs: {
          median: median(incremental),
          samples: incremental,
        },
        traffic: {
          cars: cars.length,
          previousSourceGroups: sources.length,
          sharedSourceGroups: new Set(sources).size,
          trianglesPerCar: cars.map((car) =>
            car.root
              .getChildMeshes()
              .reduce((sum, mesh) => sum + mesh.getTotalIndices() / 3, 0),
          ),
        },
      };
      // Assert
      expect(report.traffic.sharedSourceGroups).toBeLessThan(
        report.traffic.previousSourceGroups,
      );
      expect(new Set(report.traffic.trianglesPerCar).size).toBe(1);
      mkdirSync('outputs', { recursive: true });
      writeFileSync(
        'outputs/runtime-performance-profile.json',
        JSON.stringify(report, null, 2),
        'utf8',
      );
      console.log(JSON.stringify(report));
    } finally {
      scene.dispose();
      engine.dispose();
    }
  },
  60000,
);
