import { expect, it } from 'vitest';
import { criticalChunks, desiredChunks } from './chunks';
import {
  mapStreamingPolicy,
  mapTileAt,
  retainTiles,
  startupTiles,
  tileOrder,
  tileReady,
  type MapTile,
} from './region-stream';
import { parseSourceTileKey, sourceTileBounds } from './source-tiles';
import {
  TILE_ARTIFACT_SCHEMA_VERSION,
  TILE_BUILD_VERSION,
} from './tile-artifact';

const center = { lat: 55.7558, lon: 37.6173 };

it('близкие точки старта используют одинаковые глобальные XYZ source-тайлы', () => {
  // Arrange
  const nearby = { lat: center.lat + 0.0001, lon: center.lon + 0.0001 };
  // Act
  const radius = mapStreamingPolicy('high').blockingRadiusMeters,
    first = startupTiles(center, radius),
    second = startupTiles(nearby, radius);
  // Assert
  expect(first).toEqual(second);
  expect(first.length).toBeGreaterThan(9);
  expect(first.every((key) => /^15\/\d+\/\d+$/.test(key))).toBe(true);
});

it('метровое стартовое окно не сужается на высокой широте', () => {
  // Arrange
  const radius = mapStreamingPolicy('mobile').blockingRadiusMeters,
    equator = { lat: 0, lon: 30 },
    north = { lat: 70, lon: 30 };
  // Act
  const equatorTiles = startupTiles(equator, radius),
    northTiles = startupTiles(north, radius);
  // Assert
  expect(northTiles.length).toBeGreaterThanOrEqual(equatorTiles.length);
});

it('сохраняет полный запас рядов по направлению движения на высокой широте', () => {
  // Arrange
  const north = { lat: 70, lon: 30 },
    point = { x: 0, y: 0, z: 0 };
  // Act
  const base = tileOrder(point, 0, 2500, 0, north).map(parseSourceTileKey),
    buffered = tileOrder(point, 0, 2500, 2, north).map(parseSourceTileKey);
  // Assert
  expect(Math.min(...buffered.map((tile) => tile.y))).toBe(
    Math.min(...base.map((tile) => tile.y)) - 2,
  );
});

it('сдвигает глобальное окно вместе с машиной и отдаёт приоритет направлению движения', () => {
  // Arrange
  const point = { x: 12500, y: 0, z: 12500 },
    northKey = mapTileAt({ x: point.x, z: point.z + 1000 }, center),
    southKey = mapTileAt({ x: point.x, z: point.z - 1000 }, center);
  // Act
  const north = tileOrder(point, 0, 2500, 1, center),
    south = tileOrder(point, Math.PI, 2500, 1, center);
  // Assert
  expect(north.length).toBeGreaterThan(16);
  expect(new Set(north).size).toBe(north.length);
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

it('считает повторяющиеся halo-объекты один раз при ограничении памяти', () => {
  // Arrange
  const keys = startupTiles(center).slice(0, 3),
    tiles = new Map<string, MapTile>(keys.map((key) => [key, tile(key, 42)]));

  // Act
  const kept = retainTiles(tiles, keys, new Set(), 3, 1);

  // Assert
  expect([...kept.keys()]).toEqual(keys);
});
