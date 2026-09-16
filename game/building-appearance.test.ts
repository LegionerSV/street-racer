import { expect, it } from 'vitest';
import { applyBuildingAppearances } from './building-appearance';
import type { Building } from './types';

const building = (
  id: number,
  x: number,
  z: number,
  tags: Record<string, string> = { building: 'yes' },
  width = 10,
  depth = 12,
): Building => ({
  id,
  footprint: [
    { x, y: 0, z },
    { x: x + width, y: 0, z },
    { x: x + width, y: 0, z: z + depth },
    { x, y: 0, z: z + depth },
  ],
  height: 6,
  levels: 2,
  roof: tags['roof:shape'] || 'flat',
  material: tags['building:material'],
  kind: tags.building,
  colour: id / 100,
  osmTags: tags,
});

it('даёт небольшим домам в разреженном квартале скатную крышу независимо от координат и OSM building=yes', () => {
  // Arrange
  const houses = [0, 35, 70, 105, 140].map((x, i) =>
    building(i + 1, 10000 + x, -5000),
  );
  // Act
  applyBuildingAppearances(houses);
  // Assert
  expect(
    houses.map((b) => [b.appearance, b.roof, b.height, b.levels, b.roofHeight]),
  ).toEqual(
    Array.from({ length: 5 }, () => ['cottage', 'gabled', 4.5, 1, 1.5]),
  );
});

it('сохраняет крупные, нежилые и явно описанные здания', () => {
  // Arrange
  const houses = [0, 35, 70, 105].map((x, i) => building(i + 1, x, 0));
  const large = building(10, 140, 0, { building: 'house' }, 30, 20);
  const shop = building(11, 175, 0, { building: 'yes', shop: 'supermarket' });
  const chapel = building(15, 50, 35, { building: 'yes', historic: 'chapel' });
  const grouped = building(16, 105, 40);
  grouped.group = '99';
  const brick = building(12, 210, 0, {
    building: 'house',
    'building:material': 'brick',
    'roof:shape': 'flat',
  });
  const tall = { ...building(13, 245, 0), height: 18, levels: 6 };
  const measured = building(14, 80, 40, {
    building: 'house',
    height: '8',
    'building:levels': '2',
  });
  measured.height = 8;
  // Act
  applyBuildingAppearances([
    ...houses,
    large,
    shop,
    chapel,
    grouped,
    brick,
    tall,
    measured,
  ]);
  // Assert
  expect([large.appearance, large.roof]).toEqual([undefined, 'flat']);
  expect([shop.appearance, shop.roof]).toEqual([undefined, 'flat']);
  expect([chapel.appearance, chapel.roof]).toEqual([undefined, 'flat']);
  expect([grouped.appearance, grouped.roof]).toEqual([undefined, 'flat']);
  expect([brick.material, brick.roof]).toEqual(['brick', 'flat']);
  expect([tall.appearance, tall.roof]).toEqual([undefined, 'flat']);
  expect([measured.height, measured.levels]).toEqual([8, 2]);
});

it('ограничивает рассчитанную двускатную крышу половиной ширины узкого дома', () => {
  // Arrange
  const houses = [0, 30, 60, 90, 120].map((x, i) =>
    building(i + 1, x, 0, undefined, 2.5, 24),
  );
  // Act
  applyBuildingAppearances(houses);
  // Assert
  expect(houses.map((house) => [house.height, house.roofHeight])).toEqual(
    Array.from({ length: 5 }, () => [4.25, 1.25]),
  );
});

it('не превращает плотную застройку из маленьких контуров в деревянный посёлок', () => {
  // Arrange
  const buildings = Array.from({ length: 30 }, (_, i) =>
    building(i + 1, (i % 6) * 16, Math.floor(i / 6) * 16),
  );
  // Act
  applyBuildingAppearances(buildings);
  // Assert
  expect(buildings.every((b) => !b.appearance && b.roof === 'flat')).toBe(true);
});
