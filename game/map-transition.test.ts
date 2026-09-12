import { expect, it } from 'vitest';
import { mapTransitionChunks } from './runtime';

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
