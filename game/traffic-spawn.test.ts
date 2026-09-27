import { expect, it } from 'vitest';
import {
  trafficSpawnSegments,
  chooseTrafficSpawn,
  laneSpawnClearance,
  prepareTrafficSpawnIndex,
  trafficEntryFrontier,
  trafficEntryAllowed,
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

it('новая машина появляется за видимым потоком, а не в промежутке перед игроком', () => {
  // Arrange
  const player = { x: 0, y: 0, z: 0 };
  const visible = [{ x: 0, y: 0, z: 320 }, { x: 0, y: 0, z: 180 }];
  const frontier = trafficEntryFrontier(player, 0, visible, false);
  // Act / Assert
  expect(frontier).toBe(345);
  expect(trafficEntryAllowed({ x: 0, y: 0, z: 200 }, player, 0, frontier)).toBe(false);
  expect(trafficEntryAllowed({ x: 0, y: 0, z: 340 }, player, 0, frontier)).toBe(false);
  expect(trafficEntryAllowed({ x: 0, y: 0, z: 350 }, player, 0, frontier)).toBe(true);
  expect(trafficEntryAllowed({ x: 0, y: 0, z: -100 }, player, 0, frontier)).toBe(true);
  expect(trafficEntryAllowed({ x: 180, y: 0, z: 50 }, player, 0, frontier)).toBe(true);
});

it('граница появления учитывает поворот, пустой поток и другой уровень развязки', () => {
  // Arrange
  const player = { x: 10, y: 12, z: 20 };
  // Act / Assert
  expect(trafficEntryFrontier(player, Math.PI / 2, [], false)).toBe(280);
  expect(trafficEntryFrontier(player, 0, [], true)).toBe(180);
  expect(trafficEntryFrontier(player, 0, [{ x: 10, y: -5, z: 400 }], false)).toBe(280);
  expect(trafficEntryAllowed({ x: 150, y: 12, z: 20 }, player, Math.PI / 2, 280)).toBe(false);
  expect(trafficEntryAllowed({ x: 10, y: 12, z: 200 }, player, Math.PI / 2, 280)).toBe(true);
});
it('прерванная подготовка спавна не публикует частичный индекс', () => {
  // Arrange
  const edges = Array.from({ length: 80 }, (_, i) => road(i, i));
  const preparation = prepareTrafficSpawnIndex(edges);
  // Act
  expect(preparation.next().done).toBe(false);
  expect(preparation.next().done).toBe(false);
  preparation.return(undefined as never);
  const candidates = trafficSpawnSegments(edges, { x: 0, y: 0, z: 0 }, 0, 100);
  // Assert
  expect(candidates.map((candidate) => candidate.edge)).toEqual(edges);
  expect(prepareTrafficSpawnIndex(edges).next().done).toBe(true);
});

it('ищет текущую улицу за радиусом спавна при большой разнице высот', () => {
  // Arrange
  const raised = road(1, 95, 'Эстакада');
  raised.points = raised.points.map((point) => ({ ...point, y: 7 }));
  const outside = road(2, 129, 'Наземная');
  // Act
  const candidates = trafficSpawnSegments(
    [raised, outside],
    { x: 0, y: 0, z: 0 },
    0,
    100,
  );
  // Assert
  expect(candidates).toHaveLength(1);
  expect(candidates[0].edge).toBe(raised);
  expect(candidates[0].main).toBe(false);
});
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

it('учитывает высоту при выборе текущей улицы и сохраняет порядок сегментов', () => {
  // Arrange
  const bridge = {
    ...road(1, 0, 'Мост'),
    points: [
      { x: 0, y: 30, z: -600 },
      { x: 0, y: 30, z: 600 },
    ],
  };
  const edges = [bridge, road(2, 20, 'Набережная'), road(3, 50, 'Соседняя')];
  // Act
  const below = trafficSpawnSegments(edges, { x: 0, y: 0, z: 0 }, 0, 100);
  const above = trafficSpawnSegments(edges, { x: 0, y: 30, z: 0 }, 0, 100);
  // Assert
  expect(below.map((s) => [s.edge.way, s.main])).toEqual([
    [2, true],
    [3, false],
  ]);
  expect(above.map((s) => [s.edge.way, s.main])).toEqual([[1, true]]);
});

it('обновляет поиск после замены сети и изменения проходимости', () => {
  // Arrange
  const first = road(1, 0),
    second = road(2, 30, 'Другая');
  const edges = [first, second],
    player = { x: 0, y: 0, z: 0 };
  trafficSpawnSegments(edges, player, 0, 100);
  // Act
  first.blocked = true;
  const closed = trafficSpawnSegments(edges, player, 0, 100);
  const replaced = trafficSpawnSegments([road(3, 10)], player, 0, 100);
  const empty = trafficSpawnSegments([], player, 0, 100);
  // Assert
  expect(closed.map((s) => [s.edge.way, s.main])).toEqual([[2, true]]);
  expect(replaced.map((s) => s.edge.way)).toEqual([3]);
  expect(empty).toEqual([]);
});

it('сохраняет станцию на изогнутой дороге и результат за пределами покрытия', () => {
  // Arrange
  const edge = {
    ...road(1, 0),
    points: [
      { x: -200, y: 0, z: 0 },
      { x: 0, y: 0, z: 0 },
      { x: 0, y: 0, z: 200 },
    ],
    length: 400,
  };
  // Act
  const segments = trafficSpawnSegments([edge], { x: 0, y: 0, z: 0 }, 0, 100);
  const outside = trafficSpawnSegments([edge], { x: 3000, y: 0, z: 0 }, 0, 100);
  // Assert
  expect(segments.map((s) => [s.start, s.end])).toEqual([
    [100, 200],
    [200, 300],
  ]);
  expect(outside).toEqual([]);
});
