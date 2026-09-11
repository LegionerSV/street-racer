import { expect, it } from 'vitest';
import { minimapWorldBounds } from './Minimap';

it('переводит XYZ source-тайлы в локальные границы миникарты', () => {
  // Arrange
  const center = { lat: 55.751244, lon: 37.618423 },
    loadedTiles = [
      '15/19808/10243',
      '15/19809/10243',
      '15/19808/10244',
      '15/19809/10244',
    ];

  // Act
  const bounds = minimapWorldBounds(loadedTiles, center);

  // Assert
  expect(bounds.minX).toBeGreaterThan(-2_000);
  expect(bounds.maxX).toBeLessThan(2_000);
  expect(bounds.minZ).toBeGreaterThan(-2_000);
  expect(bounds.maxZ).toBeLessThan(2_000);
  expect(bounds.maxX - bounds.minX).toBeGreaterThan(1_000);
  expect(bounds.maxZ - bounds.minZ).toBeGreaterThan(1_000);
});

it('использует прежнее окно по умолчанию без source-тайлов', () => {
  // Arrange
  const center = { lat: 0, lon: 0 };

  // Act
  const bounds = minimapWorldBounds(undefined, center);

  // Assert
  expect(bounds).toEqual({ minX: -2500, maxX: 2500, minZ: -2500, maxZ: 2500 });
});
