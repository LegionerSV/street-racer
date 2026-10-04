import { expect, it } from 'vitest';
import { trafficPathLengths } from './traffic-paths';
import type { Point, World } from './types';

const world = () => ({}) as World;
const points = (height = 0): Point[] => [
  { x: 0, y: 0, z: 0 },
  { x: 3, y: height, z: 4 },
];

it.each(([[], [{ x: 0, y: 0, z: 0 }], points()] as Point[][]).map(geometry => ({ geometry })))(
  'сохраняет длины пустой, частичной и готовой геометрии: %j',
  ({ geometry }) => {
    // Arrange
    const active = world();
    // Act
    const first = trafficPathLengths(active, geometry);
    const repeated = trafficPathLengths(active, geometry);
    // Assert
    expect(first).toEqual(geometry.length > 1 ? [0, 5] : [0]);
    expect(repeated).toBe(first);
  },
);

it('пересчитывает длины при замене точек дороги в активной карте', () => {
  // Arrange
  const active = world(), before = points(), after = points(12);
  // Act
  const oldLengths = trafficPathLengths(active, before);
  const newLengths = trafficPathLengths(active, after);
  // Assert
  expect(oldLengths).toEqual([0, 5]);
  expect(newLengths).toEqual([0, 13]);
});

it('изолирует подготовленную карту и пересчитывает даже переиспользованные точки новой версии', () => {
  // Arrange
  const active = world(), prepared = world(), geometry = points();
  const original = trafficPathLengths(active, geometry);
  // Act
  const candidate = trafficPathLengths(prepared, geometry);
  const cancelled = trafficPathLengths(active, geometry);
  const retry = trafficPathLengths(world(), geometry);
  // Assert
  expect(candidate).toEqual(original);
  expect(candidate).not.toBe(original);
  expect(cancelled).toBe(original);
  expect(retry).toEqual(original);
  expect(retry).not.toBe(candidate);
});
