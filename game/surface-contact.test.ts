import { expect, it } from 'vitest';
import { worldSurfaceSampler } from './surface-contact';
import type { Edge, World } from './types';

const road = (id: number, y: number, x = 0): Edge => ({
  id,
  stableId: `surface-${id}`,
  way: id,
  from: id * 2,
  to: id * 2 + 1,
  points: [
    { x, y, z: -100 },
    { x, y: y + 10, z: 100 },
  ],
  length: Math.hypot(200, 10),
  width: 8,
  lanes: 2,
  speed: 20,
  name: 'Дорога',
  bridge: y > 0,
  tunnel: y < 0,
  layer: 0,
  blocked: false,
});
const world = (edges: Edge[]): World => ({
  center: { lat: 0, lon: 0 },
  edges,
  nodes: [],
  restrictions: [],
  buildings: [],
  areas: [],
  trees: [],
  elevation: { width: 2, size: 10000, values: new Float32Array(4).fill(-20) },
  drivingSide: 'right',
  warnings: [],
  routes: [],
  spawnEdge: edges[0]?.stableId ?? null,
});

it.each([0, 15, -15])('сохраняет уклон и уровень дороги %s', (y) => {
  // Arrange
  const map = world([road(1, 0), road(2, 15), road(3, -15)]);
  // Act
  const sample = worldSurfaceSampler(map, 0, 0, y + 5.8, 8);
  // Assert
  expect(sample(0, 0)).toBeCloseTo(y + 5, 10);
  expect(sample(3, 4)).toBeCloseTo(y + 5.2, 10);
  expect(sample(5.5, 0)).toBeCloseTo(y + 5, 10);
  expect(sample(5.5001, 0)).toBe(-20);
});

it.each(['empty', 'partial', 'full', 'unknown'] as const)(
  'выбирает дорогу или рельеф при покрытии %s',
  (state) => {
    // Arrange
    const map = world(
      state === 'empty'
        ? []
        : [road(1, 0), ...(state === 'full' ? [road(2, 15)] : [])],
    );
    if (state === 'unknown') map.loadedTiles = [];
    // Act
    const sample = worldSurfaceSampler(map, 0, 0, 5.8);
    // Assert
    expect(sample(0, 0)).toBe(
      state === 'empty' || state === 'unknown' ? -20 : 5,
    );
  },
);

it('не оставляет старую поверхность после замены или удаления дороги', () => {
  // Arrange
  const previous = world([road(1, 0)]);
  const before = worldSurfaceSampler(previous, 0, 0, 5.8);
  // Act
  const changed = worldSurfaceSampler(
    { ...previous, edges: [road(1, 10)] },
    0,
    0,
    15.8,
  );
  const removed = worldSurfaceSampler({ ...previous, edges: [] }, 0, 0, 5.8);
  // Assert
  expect(before(0, 0)).toBe(5);
  expect(changed(0, 0)).toBe(15);
  expect(removed(0, 0)).toBe(-20);
  expect(before(0, 0)).toBe(5);
});
