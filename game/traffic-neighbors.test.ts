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
