import { expect, it } from 'vitest';
import { NullEngine, Scene, Vector3 } from '@babylonjs/core';
import { createCar, createTrafficCar } from './visuals';
import { headlightCasters, headlightPattern, VehicleLighting } from './vehicle-lighting';

it('ближний свет имеет горизонтальную отсечку со ступенькой справа', () => {
  // Arrange
  const size = 128;
  // Act
  const pixels = headlightPattern(size);
  const sample = (x: number, y: number) => pixels[(y * size + x) * 4];
  // Assert
  expect(sample(30, 35)).toBeLessThan(10);
  expect(sample(30, 62)).toBeGreaterThan(100);
  expect(sample(98, 44)).toBeGreaterThan(sample(30, 44) + 80);
  expect(sample(98, 62)).toBeGreaterThan(100);
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
    expect(beam.specular.asArray()).toEqual([0, 0, 0]);
    expect(beam.shadowEnabled).toBe(false);
    lights.update(1, car, [], 'medium', 0.45);
    expect(beam.isEnabled()).toBe(true);
    expect(beam.shadowEnabled).toBe(false);
    expect(beam.getShadowGenerator()!.getShadowMap()!.renderList).toHaveLength(0);
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
