import { expect, it } from 'vitest';
import { mapTransitionBlocksDriving, mapTransitionChunks } from './runtime';

it('prepares all visible dirty chunks before switching the map', () => {
  // Arrange
  const installed = new Map([
    ['0,0', { lod: 2 }],
    ['1,0', { lod: 1 }],
    ['4,0', { lod: 2 }],
    ['2,0', { lod: 0 }],
  ]);

  // Act
  const result = mapTransitionChunks(
    ['0,0', '1,0', '3,0', '4,0'],
    ['0,0', '3,0'],
    installed,
  );

  // Assert
  expect(result).toEqual([
    { key: '0,0', lod: 0 },
    { key: '1,0', lod: 1 },
    { key: '4,0', lod: 2 },
    { key: '3,0', lod: 0 },
  ]);
});

it('не останавливает машину ради перестройки далёких кварталов', () => {
  // Arrange
  const critical = ['0,0', '0,1'];
  // Act / Assert
  expect(mapTransitionBlocksDriving(['4,4', '5,4'], critical)).toBe(false);
  expect(mapTransitionBlocksDriving(['4,4', '0,1'], critical)).toBe(true);
});
