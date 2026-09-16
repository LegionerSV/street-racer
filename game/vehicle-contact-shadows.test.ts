import { expect, it } from 'vitest';
import { NullEngine, Scene, Vector3 } from '@babylonjs/core';
import { createCar } from './visuals';
import { VehicleContactShadows } from './vehicle-contact-shadows';

it('оставляет видимую мягкую тень под машиной даже на низком качестве', () => {
  // Arrange
  const engine = new NullEngine(),
    scene = new Scene(engine);
  const player = createCar(scene, '#268fba', 'player');
  player.root.position.set(4, 0.9, 12);
  const shadows = new VehicleContactShadows(scene);
  try {
    // Act
    shadows.update(player, [], 1);
    const mesh = scene.getMeshByName('vehicle-contact-shadow-0')!;
    // Assert
    expect(mesh.isEnabled()).toBe(true);
    expect(mesh.position.x).toBe(4);
    expect(mesh.position.y).toBeCloseTo(0.07);
    expect(mesh.position.z).toBe(12);
    expect(mesh.material!.alpha).toBeGreaterThan(0.3);
    shadows.update(player, [], 0);
    expect(mesh.material!.alpha).toBeLessThan(0.3);
  } finally {
    shadows.dispose();
    player.dispose();
    scene.dispose();
    engine.dispose();
  }
});

it('проецирует пятно кузова и колёс на высоту и нормаль наклонной поверхности', () => {
  // Arrange
  const engine = new NullEngine(),
    scene = new Scene(engine),
    player = createCar(scene, '#268fba', 'player');
  player.root.position.set(4, 3, 12);
  const normal = new Vector3(-0.2, 1, 0).normalize(),
    shadows = new VehicleContactShadows(scene, (x) => ({
      height: x * 0.2,
      normal,
    }));
  try {
    // Act
    shadows.update(player, [], 1);
    const body = scene.getMeshByName('vehicle-contact-shadow-0')!,
      wheels = scene.meshes.filter((mesh) =>
        mesh.name.startsWith('vehicle-contact-shadow-0-wheel'),
      );
    // Assert
    expect(body.position.y).toBeCloseTo(0.818, 3);
    expect(wheels).toHaveLength(4);
    expect(wheels.every((mesh) => mesh.isEnabled())).toBe(true);
    expect(body.getDirection(Vector3.Up()).normalize().asArray()).toEqual(
      expect.arrayContaining(
        normal.asArray().map((value) => expect.closeTo(value, 5)),
      ),
    );
  } finally {
    shadows.dispose();
    player.dispose();
    scene.dispose();
    engine.dispose();
  }
});
