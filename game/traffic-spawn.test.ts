import { expect, it } from 'vitest';
import {
  trafficSpawnSegments,
  chooseTrafficSpawn,
  laneSpawnClearance,
} from './traffic-spawn';
import type { Edge } from './types';
const road = (way: number, x: number, name = 'Главная'): Edge =>
  ({
    id: way,
    way,
    name,
    points: [
      { x, y: 0, z: -600 },
      { x, y: 0, z: 600 },
    ],
    length: 1200,
    width: 12,
    lanes: 3,
    oneWay: true,
    from: way,
    to: way + 1,
  }) as Edge;
it('не объединяет разные безымянные улицы в одну текущую дорогу', () => {
  // Arrange
  const edges = [
    road(1, 0, 'Безымянная улица'),
    road(2, 80, 'Безымянная улица'),
  ];
  // Act
  const candidates = trafficSpawnSegments(edges, { x: 0, y: 0, z: 0 }, 0, 420);
  // Assert
  expect(
    candidates
      .filter((candidate) => candidate.main)
      .map((candidate) => candidate.edge.way),
  ).toEqual([1]);
});
it('выделяет большинство спавнов текущей улице, сохраняя соседние', () => {
  // Arrange
  const edges = [
    road(1, 0),
    ...Array.from({ length: 20 }, (_, i) =>
      road(i + 2, 40 + i * 12, 'Соседняя'),
    ),
  ];
  const candidates = trafficSpawnSegments(edges, { x: 0, y: 0, z: 0 }, 0, 420);
  // Act
  const choices = Array.from({ length: 100 }, (_, i) =>
    chooseTrafficSpawn(candidates, i / 100, 0.5),
  );
  // Assert
  expect(
    choices.filter((c) => c?.edge.way === 1).length,
  ).toBeGreaterThanOrEqual(65);
  expect(choices.some((c) => c?.edge.way !== 1)).toBe(true);
  expect(
    choices.every((c) => c && c.distance >= 180 && c.distance <= 1020),
  ).toBe(true);
});
it('пустая или закрытая сеть не порождает машин', () => {
  // Arrange / Act / Assert
  expect(chooseTrafficSpawn([], 0, 0.5)).toBeUndefined();
  expect(
    trafficSpawnSegments(
      [{ ...road(1, 0), blocked: true }],
      { x: 0, y: 0, z: 0 },
      0,
      420,
    ),
  ).toEqual([]);
});
it('соседние полосы и разные уровни допускаются, наложение машин запрещено', () => {
  // Arrange
  const player = { x: 0, y: 0, z: 0 },
    a = { point: { x: 0, y: 0, z: 200 }, heading: 0 };
  // Act / Assert
  expect(
    laneSpawnClearance(a, player, [
      { point: { x: 3.5, y: 0, z: 200 }, heading: 0 },
    ]),
  ).toBe(true);
  expect(
    laneSpawnClearance(a, player, [
      { point: { x: 0, y: 0, z: 205 }, heading: 0 },
    ]),
  ).toBe(false);
  expect(
    laneSpawnClearance(a, player, [
      { point: { x: 0, y: 6, z: 200 }, heading: 0 },
    ]),
  ).toBe(true);
  expect(laneSpawnClearance({ ...a, point: player }, player, [])).toBe(false);
});

it('обрезает спавн на дороге, начало которой находится у края радиуса', () => {
  // Arrange
  const edge = {
    ...road(1, 0),
    points: [
      { x: 0, y: 0, z: 400 },
      { x: 0, y: 0, z: 1000 },
    ],
    length: 600,
  };
  // Act
  const segments = trafficSpawnSegments([edge], { x: 0, y: 0, z: 0 }, 0, 420);
  const spawn = chooseTrafficSpawn(segments, 0.5, 0.99);
  // Assert
  expect(spawn).toBeDefined();
  expect(spawn!.distance).toBeLessThanOrEqual(20);
});
