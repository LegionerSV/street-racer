import { expect, it } from 'vitest';
import { raceGeometryValid } from './race-quality';
const points = (pairs: readonly (readonly number[])[]) =>
  pairs.map(([x, z]) => ({ x, y: 0, z }));
it.each([
  [
    'короткий спринт',
    [
      [0, 0],
      [1999, 0],
    ],
    'sprint',
    false,
  ],
  [
    'полный спринт',
    [
      [0, 0],
      [2100, 0],
    ],
    'sprint',
    true,
  ],
  ['пусто', [], 'circuit', false],
  [
    'неизвестная координата',
    [
      [0, 0],
      [NaN, 0],
    ],
    'sprint',
    false,
  ],
  [
    'короткое кольцо',
    [
      [0, 0],
      [100, 0],
      [100, 100],
      [0, 100],
      [0, 0],
    ],
    'circuit',
    false,
  ],
  [
    'полноценный квартал',
    [
      [0, 0],
      [700, 0],
      [700, 700],
      [0, 700],
      [0, 0],
    ],
    'circuit',
    true,
  ],
  [
    'узкий разворот',
    [
      [0, 0],
      [1300, 0],
      [1300, 7],
      [0, 7],
      [0, 0],
    ],
    'circuit',
    false,
  ],
  [
    'самопересечение',
    [
      [0, 0],
      [1000, 1000],
      [0, 1000],
      [1000, 0],
      [0, 0],
    ],
    'circuit',
    false,
  ],
] as const)('%s', (_name, coordinates, kind, expected) => {
  // Arrange
  const path = points(coordinates);
  // Act
  const valid = raceGeometryValid(path, kind);
  // Assert
  expect(valid).toBe(expected);
});
