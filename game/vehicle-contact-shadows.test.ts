import { expect, it } from 'vitest';
import { NullEngine, Scene } from '@babylonjs/core';
import { createCar } from './visuals';
import { VehicleContactShadows } from './vehicle-contact-shadows';

it('оставляет видимую мягкую тень под машиной даже на низком качестве', () => {
  // Arrange
  const engine = new NullEngine(), scene = new Scene(engine);
  const player = createCar(scene, '#268fba', 'player');
  player.root.position.set(4, .9, 12);
  const shadows = new VehicleContactShadows(scene);
  try {
    // Act
    shadows.update(player, [], 1);
    const mesh = scene.getMeshByName('vehicle-contact-shadow-0')!;
    // Assert
    expect(mesh.isEnabled()).toBe(true);
    expect(mesh.position.x).toBe(4);
    expect(mesh.position.y).toBeCloseTo(.07);
    expect(mesh.position.z).toBe(12);
    expect(mesh.material!.alpha).toBeGreaterThan(.3);
    shadows.update(player, [], 0);
    expect(mesh.material!.alpha).toBeLessThan(.3);
  } finally {
    shadows.dispose(); player.dispose(); scene.dispose(); engine.dispose();
  }
});
