import { expect, it } from 'vitest';
import { criticalChunks, desiredChunks } from './chunks';
import {
  mapStreamingPolicy,
  mapForwardRows,
  mapRadiusAtSpeed,
  mapTileAt,
  retainTiles,
  startupTiles,
  tileOrder,
  tileReady,
  type MapTile,
} from './region-stream';
import {
  latLonToSourceTile,
  parseSourceTileKey,
  sourceTileBounds,
  sourceTileCenter,
  sourceTileKey,
} from './source-tiles';
import { toLocal } from './geo';
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
  const shared = first.filter((key) => second.includes(key));
  expect(latLonToSourceTile(center.lat, center.lon)).toEqual(
    latLonToSourceTile(nearby.lat, nearby.lon),
  );
  expect(shared.length).toBeGreaterThanOrEqual(
    Math.min(first.length, second.length) - 3,
  );
  expect(first.length).toBeGreaterThanOrEqual(9);
  expect([...first, ...second].every((key) => /^15\/\d+\/\d+$/.test(key))).toBe(
    true,
  );
});

it.each([
  ['mobile', 1000, 4],
  ['low', 2000, 8],
  ['medium', 2500, 10],
  ['high', 700, 2],
] as const)(
  'на качестве %s стартовое окно покрывает квадрат радиусом %i м',
  (quality, radius, chunks) => {
    // Arrange
    const start = { lat: 59.92328049468514, lon: 30.38644871921713 };
    // Act
    const policy = mapStreamingPolicy(quality);
    const loaded = new Set(startupTiles(start, policy.blockingRadiusMeters));
    // Assert
    expect(policy.blockingRadiusMeters).toBe(radius);
    for (let x = -chunks; x < chunks; x++)
      for (let z = -chunks; z < chunks; z++)
        expect(tileReady(loaded, `${x},${z}`, start)).toBe(true);
  },
);

it('высокое качество хранит только ближайшие source-тайлы и сохраняет запас по ходу движения', () => {
  // Arrange
  const start = { lat: 59.934, lon: 30.335 },
    previousWindow = startupTiles(start, 1500),
    point = { x: 0, y: 0, z: 0 };
  // Act
  const policy = mapStreamingPolicy('high'),
    initial = startupTiles(start, policy.blockingRadiusMeters),
    ahead = tileOrder(
      point,
      0,
      policy.targetRadiusMeters,
      policy.forwardTileRows,
      start,
    );
  // Assert
  expect(policy.targetRadiusMeters).toBe(800);
  expect(policy.maxElements).toBe(140000);
  expect(initial.length).toBeLessThan(previousWindow.length);
  expect(ahead).toContain(mapTileAt({ x: 0, z: 800 }, start));
  const kremlinTiles = startupTiles(
    { lat: 55.7534, lon: 37.6228 },
    policy.blockingRadiusMeters,
  );
  expect(kremlinTiles).toContain('15/19808/10243');
  expect(kremlinTiles.length).toBeLessThan(12);
  const southernWallTiles = startupTiles(
    { lat: 55.7528, lon: 37.6216 },
    policy.blockingRadiusMeters,
  );
  expect(southernWallTiles).toContain('15/19808/10243');
  expect(southernWallTiles.length).toBeLessThan(12);
});

it('плавно увеличивает окно source-тайлов вместе со скоростью', () => {
  // Arrange
  const policy = mapStreamingPolicy('high');
  // Act
  const parked = mapForwardRows(policy, 0),
    crawling = mapForwardRows(policy, 1),
    city = mapForwardRows(policy, 12),
    fast = mapForwardRows(policy, 40);
  // Assert
  expect(parked).toBe(0);
  expect(crawling).toBe(0);
  expect(city).toBe(1);
  expect(fast).toBe(1);
  expect(mapRadiusAtSpeed(policy, 0)).toBe(policy.blockingRadiusMeters);
  expect(mapRadiusAtSpeed(policy, 1)).toBe(policy.blockingRadiusMeters);
  expect(mapRadiusAtSpeed(policy, 12)).toBeGreaterThan(
    policy.blockingRadiusMeters,
  );
  expect(mapRadiusAtSpeed(policy, 12)).toBeLessThan(policy.targetRadiusMeters);
  expect(mapRadiusAtSpeed(policy, 200)).toBe(policy.targetRadiusMeters);
});

it('не раскрывает четыре дальних ряда source-тайлов сразу после начала движения', () => {
  // Arrange
  const policy = mapStreamingPolicy('mobile');
  // Act / Assert
  expect(mapForwardRows(policy, 0)).toBe(0);
  expect(mapForwardRows(policy, 3)).toBe(1);
  expect(mapForwardRows(policy, 12)).toBe(2);
  expect(mapForwardRows(policy, 30)).toBe(4);
});

it('не расширяет окно при неизвестной или отрицательной скорости', () => {
  // Arrange
  const policy = mapStreamingPolicy('mobile');
  // Act / Assert
  for (const speed of [Number.NaN, Number.POSITIVE_INFINITY, -10]) {
    expect(mapForwardRows(policy, speed)).toBe(0);
    expect(mapRadiusAtSpeed(policy, speed)).toBe(policy.blockingRadiusMeters);
  }
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

it('ограничивает пакет обновления карты на мощных устройствах', () => {
  // Arrange / Act
  const mobile = mapStreamingPolicy('mobile'),
    low = mapStreamingPolicy('low'),
    medium = mapStreamingPolicy('medium'),
    high = mapStreamingPolicy('high');
  // Assert
  expect([
    mobile.maxConcurrentTiles,
    low.maxConcurrentTiles,
    medium.maxConcurrentTiles,
    high.maxConcurrentTiles,
  ]).toEqual([4, 6, 8, 6]);
  expect([
    mobile.maxUpdateTiles,
    low.maxUpdateTiles,
    medium.maxUpdateTiles,
    high.maxUpdateTiles,
  ]).toEqual([4, 6, 8, 2]);
  expect([
    mobile.forwardTileRows,
    low.forwardTileRows,
    medium.forwardTileRows,
    high.forwardTileRows,
  ]).toEqual([4, 4, 4, 1]);
});
it('не запрашивает в высоком качестве дальние тайлы сверх бюджета элементов', () => {
  // Arrange
  const policy = mapStreamingPolicy('high');
  const petersburg = { lat: 59.934, lon: 30.335 };
  // Act
  const moving = tileOrder(
    { x: 0, y: 0, z: 0 },
    0,
    policy.targetRadiusMeters,
    policy.forwardTileRows,
    petersburg,
  );
  // Assert
  expect(policy.targetRadiusMeters).toBe(800);
  expect(moving.length).toBeLessThanOrEqual(55);
});
it('ставит четыре клетки по ходу движения перед соседними боковыми клетками', () => {
  // Arrange
  const current = latLonToSourceTile(center.lat, center.lon),
    tileCenter = sourceTileCenter(current),
    point = toLocal(tileCenter.lat, tileCenter.lon, center),
    ahead = sourceTileKey({ ...current, y: current.y - 4 }),
    side = sourceTileKey({ ...current, x: current.x + 3 });
  // Act
  const order = tileOrder(point, 0, 2500, 4, center);
  // Assert
  expect(order).toContain(ahead);
  expect(order).toContain(side);
  expect(order.indexOf(ahead)).toBeLessThan(order.indexOf(side));
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
