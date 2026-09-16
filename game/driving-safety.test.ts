import { describe, expect, it } from 'vitest';
import { RecoveryWatchdog, chooseClearRespawn } from './driving-safety';
import type { Edge } from './types';

const edge = {
  id: 1,
  stableId: '1/1/2/0',
  way: 1,
  from: 1,
  to: 2,
  length: 100,
  width: 7,
  lanes: 2,
  speed: 14,
  bridge: false,
  tunnel: false,
  layer: 0,
  points: [
    { x: 0, y: 0, z: 0 },
    { x: 0, y: 0, z: 100 },
  ],
  blocked: false,
} as Edge;

describe('Аварийное восстановление машины', () => {
  it('возвращает машину вскоре после провала под поверхность', () => {
    // Arrange
    const watchdog = new RecoveryWatchdog();
    let reason: string | null = null;

    // Act
    for (let i = 0; i < 10; i++)
      reason = watchdog.update(1 / 60, {
        height: -4,
        surfaceHeight: 0,
        upY: 1,
        grounded: false,
        speed: 20,
      });

    // Assert
    expect(reason).toBe('below-surface');
  });

  it('не трогает нормальный прыжок, но возвращает лежащую на крыше машину', () => {
    // Arrange
    const watchdog = new RecoveryWatchdog();

    // Act / Assert
    for (let i = 0; i < 120; i++)
      expect(
        watchdog.update(1 / 60, {
          height: 2,
          surfaceHeight: 0,
          upY: 0.9,
          grounded: false,
          speed: 15,
        }),
      ).toBeNull();
    for (let i = 0; i < 89; i++)
      expect(
        watchdog.update(1 / 60, {
          height: 0.7,
          surfaceHeight: 0,
          upY: -0.8,
          grounded: true,
          speed: 0.5,
        }),
      ).toBeNull();
    expect(
      watchdog.update(1 / 60, {
        height: 0.7,
        surfaceHeight: 0,
        upY: -0.8,
        grounded: true,
        speed: 0.5,
      }),
    ).toBe('upside-down');
  });
});

it('выбирает свободное место респавна дальше от трафика', () => {
  // Arrange
  const occupied = [{ x: -1.75, y: 0.9, z: 10 }];

  // Act
  const pose = chooseClearRespawn(edge, 'right', occupied, 10, 8);

  // Assert
  expect(pose).toBeDefined();
  expect(
    Math.hypot(pose!.point.x - occupied[0].x, pose!.point.z - occupied[0].z),
  ).toBeGreaterThanOrEqual(8);
  expect(pose!.point.z).toBeGreaterThan(10);
});

it('не возвращает занятую точку, если свободного места на дороге нет', () => {
  // Arrange
  const occupied = Array.from({ length: 11 }, (_, index) => ({
    x: -1.75,
    y: 0.9,
    z: index * 10,
  }));

  // Act
  const pose = chooseClearRespawn(edge, 'right', occupied, 10, 12);

  // Assert
  expect(pose).toBeUndefined();
});
