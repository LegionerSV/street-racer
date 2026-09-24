import { expect, it } from 'vitest';
import { NullEngine, Scene, Vector3 } from '@babylonjs/core';
import { createCar, createTrafficCar } from './visuals';
import {
  headlightCasters,
  headlightPattern,
  VehicleLighting,
} from './vehicle-lighting';

it('ближний свет имеет горизонтальную отсечку со ступенькой справа', () => {
  // Arrange
  const size = 128;
  // Act
  const pixels = headlightPattern(size);
  const sample = (x: number, y: number) => pixels[(y * size + x) * 4];
  const alpha = (x: number, y: number) => pixels[(y * size + x) * 4 + 3];
  // Assert
  expect(sample(30, 35)).toBeGreaterThan(100);
  expect(sample(30, 62)).toBeLessThan(10);
  expect(sample(98, 54)).toBeGreaterThan(sample(30, 54) + 80);
  expect(alpha(30, 35)).toBeGreaterThan(100);
  expect(alpha(30, 62)).toBe(0);
  expect(alpha(98, 54)).toBeGreaterThan(alpha(30, 54) + 80);
});

it('дневной свет фар не выбеливает асфальт, кузова и ограждения', () => {
  // Arrange
  const engine = new NullEngine(),
    scene = new Scene(engine),
    car = createCar(scene, '#223344', 'player'),
    lights = new VehicleLighting(scene);
  try {
    // Act
    lights.update(1, car, [], 'medium', 1);
    const beam = scene.getLightByName('vehicle-beam-0')!;
    // Assert — в ясный день пучок не конкурирует с солнцем и не даёт белый блик.
    expect(beam.intensity).toBeLessThanOrEqual(0.5);
    expect(beam.isEnabled()).toBe(false);
    expect(beam.specular.asArray()).toEqual([0, 0, 0]);
    expect(beam.shadowEnabled).toBe(false);
    expect(scene.getMeshByName('vehicle-headlight-road-cutoff')?.isEnabled()).toBe(true);
    lights.update(1, car, [], 'medium', 0.45);
    expect(beam.isEnabled()).toBe(true);
    expect(beam.shadowEnabled).toBe(false);
    expect(beam.getShadowGenerator()!.getShadowMap()!.renderList).toHaveLength(
      0,
    );
    lights.update(1, car, [], 'medium', 0);
    expect(beam.intensity).toBeGreaterThan(1);
    expect(beam.intensity).toBeLessThanOrEqual(3);
    expect(beam.shadowEnabled).toBe(true);
  } finally {
    lights.dispose();
    car.dispose();
    scene.dispose();
    engine.dispose();
  }
});

it('переиспользует фары после выгрузки трафика и сохраняет малые карты теней на телефоне', () => {
  // Arrange
  const engine = new NullEngine(),
    scene = new Scene(engine),
    player = createCar(scene, '#223344', 'player'),
    traffic = createTrafficCar(scene, '#556677', 'traffic', 'sedan'),
    lights = new VehicleLighting(scene);
  try {
    // Act
    lights.update(1, player, [traffic], 'mobile', 0);
    const pooled = scene.getLightByName('vehicle-beam-1')!;
    traffic.dispose();
    lights.update(1, player, [], 'mobile', 0);
    // Assert
    expect(scene.getLightByName('vehicle-beam-1')).toBe(pooled);
    expect(pooled.isEnabled()).toBe(false);
    expect(
      scene
        .getLightByName('vehicle-beam-0')!
        .getShadowGenerator()!
        .getShadowMap()!
        .getSize().width,
    ).toBe(256);
  } finally {
    lights.dispose();
    player.dispose();
    scene.dispose();
    engine.dispose();
  }
});
it('машины трафика перекрывают свет фар; скрытые прототипы и своя машина не отбрасывают ложную тень', () => {
  // Arrange
  const engine = new NullEngine(),
    scene = new Scene(engine),
    player = createCar(scene, '#223344', 'player'),
    traffic = createTrafficCar(scene, '#556677', 'traffic', 'van');
  traffic.root.position.z = 15;
  traffic.root.getChildMeshes().forEach((m) => m.computeWorldMatrix(true));
  // Act
  const casters = headlightCasters(scene, Vector3.Zero(), player, 60);
  // Assert
  expect(casters.some((m) => m.name.includes('paint'))).toBe(true);
  expect(casters.every((m) => m.isDescendantOf(traffic.root))).toBe(true);
  expect(casters.every((m) => !m.name.includes('headlight'))).toBe(true);
  player.dispose();
  traffic.dispose();
  scene.dispose();
  engine.dispose();
});

it('рисует ночную cutoff-маску отдельной лентой по поверхности дороги', () => {
  // Arrange
  const engine = new NullEngine(),
    scene = new Scene(engine),
    player = createCar(scene, '#223344', 'player');
  player.root.position.set(2, 1, 3);
  const lights = new VehicleLighting(scene, (x, z) => ({
    height: x * 0.01 + z * 0.02,
    normal: Vector3.Up(),
  }));
  try {
    // Act
    lights.update(1 / 60, player, [], 'medium', 0);
    const beam = scene.getMeshByName('vehicle-headlight-road-cutoff')!,
      positions = Array.from(beam.getVerticesData('position')!);
    // Assert
    expect(beam.isEnabled()).toBe(true);
    expect(beam.getTotalVertices()).toBe(18);
    const width = (row: number) =>
      Math.hypot(
        positions[(row * 2 + 1) * 3] - positions[row * 2 * 3],
        positions[(row * 2 + 1) * 3 + 2] - positions[row * 2 * 3 + 2],
      );
    expect(width(8)).toBeGreaterThan(width(0) * 4);
    for (let i = 0; i < positions.length; i += 3)
      expect(positions[i + 1]).toBeCloseTo(
        positions[i] * 0.01 + positions[i + 2] * 0.02 + 0.028,
        5,
      );
  } finally {
    lights.dispose();
    player.dispose();
    scene.dispose();
    engine.dispose();
  }
});
