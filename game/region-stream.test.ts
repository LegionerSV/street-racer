import { expect, it } from 'vitest';
import {
  startupTiles,
  tileOrder,
  tileReady,
  retainTiles,
  type MapTile,
} from './region-stream';
import { criticalChunks, desiredChunks } from './chunks';

it('начинает с четырёх километровых клеток вокруг выбранной точки', () => {
  // Arrange / Act / Assert
  expect(new Set(startupTiles())).toEqual(
    new Set(['-1,-1', '-1,0', '0,-1', '0,0']),
  );
});
it('сдвигает окно вместе с машиной и отдаёт приоритет направлению движения', () => {
  // Arrange
  const p = { x: 12500, y: 0, z: 12500 };
  // Act
  const north = tileOrder(p, 0, 4),
    south = tileOrder(p, Math.PI, 4);
  // Assert
  expect(north).toHaveLength(16);
  expect(new Set(north).size).toBe(16);
  expect(north.indexOf('12,13')).toBeLessThan(north.indexOf('12,11'));
  expect(south.indexOf('12,11')).toBeLessThan(south.indexOf('12,13'));
  expect(north).not.toContain('0,0');
});
it('не открывает границу до получения соседнего участка и его физических кварталов', () => {
  // Arrange
  const loaded = new Set(['0,0']);
  // Act / Assert
  expect(tileReady(loaded, '3,0')).toBe(true);
  expect(tileReady(loaded, '4,0')).toBe(false);
  expect(criticalChunks({ x: 9990, y: 0, z: 9990 }, 0, true)).toContain(
    '40,40',
  );
  expect(
    desiredChunks({ x: 12500, y: 0, z: 12500 }, 0, 'mobile', true).length,
  ).toBeGreaterThan(0);
});
it('выгружает дальние данные по бюджету, сохраняя защищённые клетки', () => {
  // Arrange
  const tiles = new Map<string, MapTile>(
    ['0,0', '1,0', '2,0', '3,0'].map((key) => [
      key,
      {
        key,
        elements: [{ type: 'node', id: Number(key[0]) }],
        elevation: { width: 2, size: 1600, values: new Float32Array(4) },
      },
    ]),
  );
  // Act
  const kept = retainTiles(
    tiles,
    ['3,0', '2,0', '1,0', '0,0'],
    new Set(['0,0']),
    3,
    3,
  );
  // Assert
  expect([...kept.keys()]).toEqual(['0,0', '3,0', '2,0']);
  expect(tiles.size).toBe(4);
});
