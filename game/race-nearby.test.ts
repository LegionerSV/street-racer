import { expect, it } from 'vitest';
import {
  buildWorld,
  createRaceRoute,
  createRaceLocations,
  findRaceRouteNear,
} from './network';
import { raceGrid } from './fixtures/race-grid';

function fixture(offset = 0) {
  const input = raceGrid(3, 3);
  input.loadedTiles = undefined;
  input.elements.push(
    {
      type: 'node',
      id: 90001,
      lon: (200 + offset) / 111320,
      lat: 200 / 111320,
    },
    {
      type: 'node',
      id: 90002,
      lon: (240 + offset) / 111320,
      lat: 200 / 111320,
    },
    {
      type: 'way',
      id: 90000,
      nodes: [90001, 90002],
      tags: { highway: 'residential', lanes: '2' },
    },
  );
  const world = buildWorld(input, false);
  return {
    world,
    start: world.edges.find((edge) => edge.way === 90000)!.stableId,
  };
}

it.each(['sprint', 'circuit'] as const)(
  'находит %s рядом с изолированной стартовой меткой',
  (kind) => {
    // Arrange
    const { world, start } = fixture();
    expect(createRaceRoute(world, start, kind)).toBeUndefined();
    // Act
    const route = findRaceRouteNear(world, start, kind);
    // Assert
    expect(route?.kind).toBe(kind);
    expect(route!.length).toBeGreaterThanOrEqual(2000);
    expect(route!.edges[0]).not.toBe(start);
  },
);

it('не переносит старт на другую сторону района, если рядом нет связных дорог', () => {
  // Arrange
  const { world, start } = fixture(-1500);
  // Act / Assert
  expect(findRaceRouteNear(world, start, 'sprint')).toBeUndefined();
  expect(findRaceRouteNear(world, 'unknown', 'circuit')).toBeUndefined();
});

it('не показывает ленивую стартовую метку на изолированном коротком участке', () => {
  // Arrange
  const { world, start } = fixture();
  // Act
  const invitations = createRaceLocations(world, [start]);
  // Assert
  expect(invitations.length).toBeGreaterThan(0);
  expect(invitations.some((route) => route.edges[0] === start)).toBe(false);
});

it('сохраняет компактное кольцо длиной более двух километров', () => {
  // Arrange
  const input = raceGrid(1, 1);
  input.loadedTiles = undefined;
  for (const element of input.elements)
    if (element.type === 'node') {
      element.lat! *= 1.1;
      element.lon! *= 1.1;
    }
  // Act
  const world = buildWorld(input, false);
  // Assert
  expect(
    world.routes.some(
      (route) => route.kind === 'circuit' && route.length >= 2000,
    ),
  ).toBe(true);
});
