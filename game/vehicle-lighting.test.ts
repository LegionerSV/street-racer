import { expect, it } from 'vitest';
import { NullEngine, Scene, Vector3 } from '@babylonjs/core';
import { createCar, createTrafficCar } from './visuals';
import { headlightCasters, VehicleLighting } from './vehicle-lighting';

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
