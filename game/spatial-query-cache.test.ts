import { expect, it } from 'vitest';
import { SpatialGrid, type Bounds } from './geometry';

const box = (minX: number, minZ: number, maxX: number, maxZ: number): Bounds =>
  ({ minX, minZ, maxX, maxZ });

it('повторный запрос тех же клеток проверяет точные границы и сохраняет порядок', () => {
  // Arrange
  const cached = new SpatialGrid<number>(32, undefined, 2);
  const reference = new SpatialGrid<number>(32);
  for (const grid of [cached, reference]) {
    grid.add(1, box(1, 1, 4, 4));
    grid.add(2, box(20, 20, 25, 25));
    grid.add(3, box(-20, -20, 40, 40));
    grid.add(1, box(26, 26, 28, 28));
  }
  // Act / Assert
  for (const bounds of [box(0, 0, 5, 5), box(19, 19, 29, 29), box(8, 8, 9, 9)])
    expect(cached.query(bounds)).toEqual(reference.query(bounds));
  expect(cached.query(box(19, 19, 29, 29))).toEqual([2, 3, 1]);
});

it('добавление объектов сбрасывает даже закэшированную пустую выборку', () => {
  // Arrange
  const grid = new SpatialGrid<number>(32, undefined, 2), bounds = box(0, 0, 4, 4);
  const empty = grid.query(bounds);
  // Act
  grid.add(1, bounds);
  const first = grid.query(bounds);
  grid.add(2, bounds);
  // Assert
  expect(empty).toEqual([]);
  expect(first).toEqual([1]);
  expect(grid.query(bounds)).toEqual([1, 2]);
});

it('вытеснение выборок и частичное покрытие не меняют найденные объекты', () => {
  // Arrange
  const coverage = [box(-10, -10, 100, 100)];
  const cached = new SpatialGrid<number>(32, coverage, 2);
  const reference = new SpatialGrid<number>(32, coverage);
  for (const grid of [cached, reference]) {
    grid.add(1, box(-100, -100, 200, 200));
    grid.add(2, box(95, 95, 100, 100));
    grid.add(3, box(120, 120, 130, 130));
  }
  // Act / Assert
  for (const bounds of [box(0, 0, 1, 1), box(90, 90, 99, 99), box(120, 120, 130, 130), box(-9, -9, -8, -8), box(0, 0, 1, 1)])
    expect(cached.query(bounds)).toEqual(reference.query(bounds));
});
