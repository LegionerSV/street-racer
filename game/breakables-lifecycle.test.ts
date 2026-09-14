import { Vector3 } from '@babylonjs/core';
import { expect, it, vi } from 'vitest';
import { Game } from './runtime';

it('освобождает сбитую секцию вдали от машины и не создаёт её заново при возвращении', () => {
  // Arrange
  const dispose = vi.fn();
  const setEnabled = vi.fn();
  const prop = {
    mesh: { position: new Vector3(120, 0, 0), setEnabled },
    pole: false,
    broken: true,
    body: { dispose },
  };
  const game = Object.create(Game.prototype);
  Object.assign(game, {
    chunks: new Map([['0,0', { breakables: [prop] }]]),
    player: { position: Vector3.Zero() },
  });
  // Act
  game.updateBreakables();
  prop.mesh.position.x = 1;
  game.updateBreakables();
  // Assert
  expect(dispose).toHaveBeenCalledTimes(1);
  expect(setEnabled).toHaveBeenCalledWith(false);
  expect(prop.body).toBeUndefined();
});
