import { expect, it } from 'vitest';
import {
  BreakableDamage,
  breakableKey,
  ImpactSpeeds,
  shouldBreak,
} from './breakables';

it('парковое ограждение сбивается при умеренном ударе', () => {
  // Arrange
  const fence = { kind: 'fence' as const, fenceType: 'park' as const };
  // Act
  const broken = shouldBreak(fence, 180, 30);
  // Assert
  expect(broken).toBe(true);
});

it('ограждение набережной выдерживает удар при 120 км/ч и ниже', () => {
  // Arrange
  const fence = { kind: 'fence' as const, fenceType: 'embankment' as const };
  // Act
  const slow = shouldBreak(fence, 10000, 120 / 3.6);
  const fast = shouldBreak(fence, 10000, 121 / 3.6);
  // Assert
  expect(slow).toBe(false);
  expect(fast).toBe(true);
});

it('быстрый скользящий контакт не сбивает ограждение набережной', () => {
  // Arrange
  const fence = { kind: 'fence' as const, fenceType: 'embankment' as const };
  // Act
  const broken = shouldBreak(fence, 200, 140 / 3.6);
  // Assert
  expect(broken).toBe(false);
});

it('берёт скорость до физического шага, даже если столкновение уже затормозило машину', () => {
  // Arrange
  const impact = new ImpactSpeeds();
  const velocity = { x: 130 / 3.6, z: 0 };
  const car = { getLinearVelocity: () => velocity };
  const fence = { kind: 'fence' as const, fenceType: 'embankment' as const };
  impact.capture(car);
  // Act — Havok вызывает обработчик после шага, когда скорость уже упала.
  velocity.x = 70 / 3.6;
  const broken = shouldBreak(fence, 10000, impact.atContact(car));
  // Assert
  expect(broken).toBe(true);
});

it('сохраняет сбитую ограду при пересборке рельефа', () => {
  // Arrange
  const fence = {
    kind: 'fence' as const,
    fenceType: 'park' as const,
    point: { x: 12.345, y: 1, z: -67.891 },
    heading: 0.25,
    length: 2,
  };

  // Act
  const before = breakableKey(fence);
  const after = breakableKey({ ...fence, point: { ...fence.point, y: 4.5 } });
  const damage = new BreakableDamage();
  damage.markBroken(before);

  // Assert
  expect(after).toBe(before);
  expect(damage.isBroken({ ...fence, point: { ...fence.point, y: 4.5 } })).toBe(
    true,
  );
  expect(breakableKey({ ...fence, fenceType: 'embankment' })).not.toBe(before);
  expect(breakableKey({ ...fence, kind: 'pole', fenceType: undefined })).not.toBe(
    before,
  );
});
