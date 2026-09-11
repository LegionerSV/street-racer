import { expect, it } from 'vitest';
import { sourceTileBounds } from '../game/source-tiles';
import {
  TILE_ARTIFACT_SCHEMA_VERSION,
  TILE_BUILD_VERSION,
  type TileArtifactV1,
} from '../game/tile-artifact';
import { verifyTileSeams } from './verify-map-pilot';

function tile(x: number, height: number, name = 'Общая дорога') {
  const id = { z: 15, x, y: 10243 },
    coreBounds = sourceTileBounds(id),
    commonBounds = sourceTileBounds({ z: 15, x: 19808, y: 10243 });
  return {
    ...id,
    schemaVersion: TILE_ARTIFACT_SCHEMA_VERSION,
    tileBuildVersion: TILE_BUILD_VERSION,
    coreBounds,
    bufferedBounds: {
      south: coreBounds.south - 0.01,
      west: coreBounds.west - 0.01,
      north: coreBounds.north + 0.01,
      east: coreBounds.east + 0.01,
    },
    generatedAt: '2026-09-11T00:00:00.000Z',
    osmTimestamp: '2026-09-11T00:00:00.000Z',
    drivingSide: 'right' as const,
    elements: [
      {
        type: 'node' as const,
        id: 1,
        lat: (commonBounds.south + commonBounds.north) / 2,
        lon: commonBounds.east,
      },
      {
        type: 'way' as const,
        id: 2,
        nodes: [1],
        tags: { highway: 'primary', name },
      },
    ],
    elevation: {
      width: 2,
      size: 700,
      values: Float32Array.from([height, height, height, height]),
    },
    checksum: `crc32:${x}`,
  } satisfies TileArtifactV1;
}

it('проверяет общую геометрию и рельеф соседних тайлов', () => {
  // Arrange
  const tiles = [tile(19808, 125), tile(19809, 125)];

  // Act
  const report = verifyTileSeams(tiles);

  // Assert
  expect(report).toEqual({
    tiles: 2,
    seams: 1,
    geometrySharedElements: 2,
    maxElevationDeltaMeters: 0,
  });
});

it('отклоняет расходящийся рельеф и разные версии общей геометрии', () => {
  // Arrange
  const first = tile(19808, 125),
    otherHeight = tile(19809, 127),
    otherGeometry = tile(19809, 125, 'Другая дорога');

  // Act / Assert
  expect(() => verifyTileSeams([first, otherHeight])).toThrow(
    'Перепад рельефа на шве',
  );
  expect(() => verifyTileSeams([first, otherGeometry])).toThrow(
    'Общий OSM-объект отличается',
  );
});

it('отклоняет объект, исчезнувший из halo соседнего тайла', () => {
  // Arrange
  const first = tile(19808, 125),
    incomplete = tile(19809, 125);
  incomplete.elements = incomplete.elements.slice(0, 1);

  // Act / Assert
  expect(() => verifyTileSeams([first, incomplete])).toThrow(
    'OSM-объект way/2 отсутствует',
  );
});
