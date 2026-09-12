import { expect, it } from 'vitest';
import { sourceTileBounds } from '../game/source-tiles';
import { tilesIntersectingBoundary } from './map-coverage';

it('выбирает только source-тайлы, пересекающие полигон', () => {
  // Arrange
  const first = { z: 15, x: 19808, y: 10243 },
    bounds = sourceTileBounds(first),
    document = {
      type: 'FeatureCollection' as const,
      features: [
        {
          geometry: {
            type: 'Polygon' as const,
            coordinates: [
              [
                [bounds.west + 0.001, bounds.south + 0.001] as [number, number],
                [bounds.east + 0.001, bounds.south + 0.001] as [number, number],
                [bounds.east + 0.001, bounds.north - 0.001] as [number, number],
                [bounds.west + 0.001, bounds.north - 0.001] as [number, number],
                [bounds.west + 0.001, bounds.south + 0.001] as [number, number],
              ],
            ],
          },
        },
      ],
    };

  // Act
  const tiles = tilesIntersectingBoundary(document);

  // Assert
  expect(tiles).toEqual([first, { z: 15, x: first.x + 1, y: first.y }]);
});

it('отклоняет пустую границу', () => {
  // Arrange
  const document = { type: 'FeatureCollection' as const, features: [] };

  // Act / Assert
  expect(() => tilesIntersectingBoundary(document)).toThrow(
    'GeoJSON не содержит непустой Polygon или MultiPolygon.',
  );
});
