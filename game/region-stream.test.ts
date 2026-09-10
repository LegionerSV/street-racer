import { expect, it } from 'vitest';
import { criticalChunks, desiredChunks } from './chunks';
import {
  mapTileAt,
  retainTiles,
  startupTiles,
  tileOrder,
  tileReady,
  type MapTile,
} from './region-stream';
import { sourceTileBounds } from './source-tiles';
import {
  TILE_ARTIFACT_SCHEMA_VERSION,
  TILE_BUILD_VERSION,
} from './tile-artifact';

const center = { lat: 55.7558, lon: 37.6173 };

it('близкие точки старта используют одинаковые глобальные XYZ source-тайлы', () => {
  // Arrange
  const nearby = { lat: center.lat + 0.0001, lon: center.lon + 0.0001 };
  // Act
  const first = startupTiles(center),
    second = startupTiles(nearby);
  // Assert
  expect(first).toEqual(second);
  expect(first).toHaveLength(9);
  expect(first.every((key) => /^15\/\d+\/\d+$/.test(key))).toBe(true);
});

it('сдвигает глобальное окно вместе с машиной и отдаёт приоритет направлению движения', () => {
  // Arrange
  const point = { x: 12500, y: 0, z: 12500 },
    northKey = mapTileAt({ x: point.x, z: point.z + 1000 }, center),
    southKey = mapTileAt({ x: point.x, z: point.z - 1000 }, center);
  // Act
  const north = tileOrder(point, 0, 4, center),
    south = tileOrder(point, Math.PI, 4, center);
  // Assert
  expect(north).toHaveLength(16);
  expect(new Set(north).size).toBe(16);
  expect(north.indexOf(northKey)).toBeLessThan(north.indexOf(southKey));
  expect(south.indexOf(southKey)).toBeLessThan(south.indexOf(northKey));
  expect(north).not.toContain(startupTiles(center)[0]);
});

it('открывает локальный квартал только после загрузки всех пересекающих source-тайлов', () => {
  // Arrange
  const chunk = '3,0',
    loaded = new Set(startupTiles(center));
  // Act / Assert
  expect(tileReady(loaded, chunk, center)).toBe(true);
  expect(tileReady(loaded, '40,40', center)).toBe(false);
  expect(criticalChunks({ x: 9990, y: 0, z: 9990 }, 0, true)).toContain(
    '40,40',
  );
  expect(
    desiredChunks({ x: 12500, y: 0, z: 12500 }, 0, 'mobile', true).length,
  ).toBeGreaterThan(0);
});

function tile(key: string, id: number): MapTile {
  const [z, x, y] = key.split('/').map(Number),
    coreBounds = sourceTileBounds({ z, x, y });
  return {
    schemaVersion: TILE_ARTIFACT_SCHEMA_VERSION,
    tileBuildVersion: TILE_BUILD_VERSION,
    z,
    x,
    y,
    coreBounds,
    bufferedBounds: coreBounds,
    generatedAt: '2026-09-10T00:00:00.000Z',
    osmTimestamp: '2026-09-10T00:00:00.000Z',
    drivingSide: 'right',
    elements: [{ type: 'node', id }],
    elevation: { width: 2, size: 1600, values: new Float32Array(4) },
    checksum: 'test',
  };
}

it('выгружает дальние данные по бюджету, сохраняя защищённые source-тайлы', () => {
  // Arrange
  const keys = startupTiles(center).slice(0, 4),
    tiles = new Map<string, MapTile>(
      keys.map((key, index) => [key, tile(key, index)]),
    );
  // Act
  const kept = retainTiles(
    tiles,
    [...keys].reverse(),
    new Set([keys[0]]),
    3,
    3,
  );
  // Assert
  expect([...kept.keys()]).toEqual([keys[0], keys[3], keys[2]]);
  expect(tiles.size).toBe(4);
});
