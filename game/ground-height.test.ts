import { expect, it } from 'vitest';
import { blendGroundHeight } from './ground-height';

it('плавно смешивает соседние наземные полотна вместо резкого провала к ближайшему', () => {
  // Arrange
  const roads = [
    { height: 0, influence: 1 },
    { height: -3, influence: 1 },
  ];
  // Act / Assert
  expect(blendGroundHeight(1, roads)).toBe(-1.5);
  expect(blendGroundHeight(1, [{ height: -3, influence: 0.1 }])).toBeCloseTo(0.6);
  expect(blendGroundHeight(1, [])).toBe(1);
});
