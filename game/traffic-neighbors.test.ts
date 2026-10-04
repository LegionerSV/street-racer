import { expect, it } from 'vitest';
import { TrafficNeighborIndex } from './traffic-neighbors';

it('находит машины через границу клетки и сохраняет порядок исходного снимка', () => {
  // Arrange
  const cars = [
    { id: 1, point: { x: 129, z: 0 } },
    { id: 2, point: { x: -1, z: 0 } },
    { id: 3, point: { x: 400, z: 0 } },
    { id: 4, point: { x: 127, z: 2 } },
  ];
  const index = new TrafficNeighborIndex(cars);
  // Act
  const nearby = index.query({ x: 127, z: 0 }, 130);
  // Assert
  expect(nearby.map(car => car.id)).toEqual([1, 2, 4]);
});

it('ограничивает дорожный снимок ближними машинами при плотном потоке', () => {
  // Arrange
  const cars = Array.from({ length: 144 }, (_, id) => ({ id, point: { x: id * 20, z: 0 } }));
  const index = new TrafficNeighborIndex(cars);
  // Act
  const nearby = index.query({ x: 1000, z: 0 }, 130);
  // Assert
  expect(nearby.length).toBeLessThan(20);
  expect(nearby.some(car => car.id === 50)).toBe(true);
  expect(nearby.some(car => car.id === 0)).toBe(false);
});

it('обновляет снимок после перемещения, удаления и появления машин', () => {
  // Arrange
  const first = { id: 1, point: { x: 0, z: 0 } },
    second = { id: 2, point: { x: 129, z: 0 } };
  const index = new TrafficNeighborIndex([first, second]);
  const before = index.query({ x: 0, z: 0 }, 130);
  // Act
  first.point.x = 1000;
  const added = { id: 3, point: { x: -129, z: 0 } };
  index.reset([added, first]);
  const after = index.query({ x: 0, z: 0 }, 130);
  index.reset([]);
  const empty = index.query({ x: 0, z: 0 }, 130);
  index.reset([second, added]);
  // Assert
  expect(before.map(car => car.id)).toEqual([1, 2]);
  expect(after.map(car => car.id)).toEqual([3]);
  expect(empty).toEqual([]);
  expect(index.query({ x: 0, z: 0 }, 130).map(car => car.id)).toEqual([2, 3]);
});

it('переиспользует буфер запроса без оставшихся соседей', () => {
  // Arrange
  const cars = [{ id: 1, point: { x: 0, z: 0 } }, { id: 2, point: { x: 500, z: 0 } }];
  const index = new TrafficNeighborIndex(cars), buffer = [cars[1]];
  // Act
  const first = index.query({ x: 0, z: 0 }, 130, buffer);
  const ids = first.map(car => car.id);
  const second = index.query({ x: 1000, z: 0 }, 130, buffer);
  // Assert
  expect(first).toBe(buffer);
  expect(ids).toEqual([1]);
  expect(second).toBe(buffer);
  expect(second).toEqual([]);
});

it('сохраняет состав снимка до явного обновления исходного массива', () => {
  // Arrange
  const first = { id: 1, point: { x: 0, z: 0 } },
    second = { id: 2, point: { x: 0, z: 0 } };
  const cars = [first], index = new TrafficNeighborIndex(cars);
  // Act
  cars[0] = second;
  const old = index.query({ x: 0, z: 0 }, 130);
  index.reset(cars);
  const next = index.query({ x: 0, z: 0 }, 130);
  // Assert
  expect(old).toEqual([first]);
  expect(next).toEqual([second]);
});
