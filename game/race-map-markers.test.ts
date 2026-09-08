import { expect, it } from 'vitest';
import {
  minimapOpponent,
  opponentMarkers,
  RACER_COLOURS,
  raceMarkerPosition,
} from './race-map-markers';
import { buildWorld } from './network';
import type { RegionData } from './types';

it('передаёт все позиции соперников независимо от наличия модели машины и исключает обычный трафик', () => {
  // Arrange
  const point = { x: 500, y: 1, z: 600 };
  const agents = [
    { id: 0, point, heading: 1, race: { finished: false } },
    { id: 1, point, heading: 2, race: { finished: true } },
    { id: 2, point, heading: 3, race: { finished: false } },
    { id: 20, point, heading: 0 },
  ];
  // Act
  const markers = opponentMarkers(agents);
  point.x = 0;
  // Assert
  expect(markers.map((m) => m.id)).toEqual([0, 1, 2]);
  expect(markers.map((m) => m.colour)).toEqual(RACER_COLOURS);
  expect(markers.every((m) => m.point.x === 500)).toBe(true);
  expect(markers[1].finished).toBe(true);
  expect(opponentMarkers([])).toEqual([]);
});
it('показывает соперника в координатах карты, а дальнего — у края в его направлении', () => {
  // Arrange
  const player = { x: 1000, y: 0, z: 1000 },
    marker = {
      id: 0,
      point: { x: 1100, y: 0, z: 1200 },
      heading: 1,
      colour: '#fff',
      finished: false,
    };
  // Act
  const near = minimapOpponent(marker, player),
    far = minimapOpponent(
      { ...marker, point: { x: 11000, y: 0, z: 11000 } },
      player,
    );
  // Assert
  expect(near).toEqual({ x: 173, y: 74, offscreen: false, heading: 1 });
  expect(far.x).toBeCloseTo(258, 5);
  expect(far.y).toBeCloseTo(12, 5);
  expect(far.heading).toBeCloseTo(Math.PI / 4, 5);
  expect(far.offscreen).toBe(true);
});
it('для видимой машины берёт фактическое положение после столкновения', () => {
  // Arrange
  const agents = [
    {
      id: 0,
      point: { x: 0, y: 0, z: 0 },
      heading: 0,
      race: { finished: false },
      visual: { root: { position: { x: 12, y: 1, z: 7 } } },
    },
  ];
  // Act
  const markers = opponentMarkers(agents);
  // Assert
  expect(markers[0].point).toEqual({ x: 12, y: 1, z: 7 });
});
it('привязывает маркер к своему старту независимо от порядка списка гонок', () => {
  // Arrange
  const region: RegionData = {
    center: { lat: 0, lon: 0 },
    elements: [
      { type: 'node', id: 1, lat: 0.002, lon: 0.002 },
      { type: 'node', id: 2, lat: 0.002, lon: 0.01 },
      { type: 'node', id: 3, lat: 0.01, lon: 0.01 },
      { type: 'node', id: 4, lat: 0.01, lon: 0.002 },
      {
        type: 'way',
        id: 10,
        nodes: [1, 2, 3, 4, 1],
        tags: { highway: 'primary' },
      },
    ],
    elevation: { width: 2, size: 5600, values: new Float32Array(4) },
    drivingSide: 'right',
    fetchedAt: 'test',
  };
  const world = buildWorld(region),
    route = world.routes[0];
  // Act
  const before = raceMarkerPosition(world, route);
  world.routes.reverse();
  const after = raceMarkerPosition(world, route);
  // Assert
  expect(before).toEqual(after);
  expect(before.x).toBeGreaterThan(200);
});
