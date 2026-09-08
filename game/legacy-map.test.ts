import { expect, it } from 'vitest';
import { selectLegacyMap } from './legacy-map';
import type { OSMElement } from './types';

it('переносит местные объекты вместе с полными дорогами и кольцами отношений', () => {
  // Arrange
  const elements: OSMElement[] = [
    { type: 'node', id: 1, lat: 0, lon: 0 },
    { type: 'node', id: 2, lat: 5, lon: 5 },
    { type: 'node', id: 3, lat: 6, lon: 6 },
    { type: 'node', id: 4, lat: 7, lon: 7 },
    { type: 'way', id: 10, nodes: [1, 2], tags: { highway: 'residential' } },
    { type: 'way', id: 11, nodes: [2, 3, 2] },
    {
      type: 'relation',
      id: 20,
      members: [
        { type: 'way', ref: 10, role: 'outer' },
        { type: 'way', ref: 11, role: 'inner' },
      ],
    },
  ];
  // Act
  const selected = selectLegacyMap(elements, {
    south: -1,
    west: -1,
    north: 1,
    east: 1,
  });
  // Assert
  expect(selected?.map((e) => `${e.type}/${e.id}`)).toEqual([
    'node/1',
    'node/2',
    'node/3',
    'way/10',
    'way/11',
    'relation/20',
  ]);
});
it('не выдаёт неполный старый кэш за готовый участок', () => {
  // Arrange / Act
  const selected = selectLegacyMap(
    [
      { type: 'node', id: 1, lat: 0, lon: 0 },
      { type: 'way', id: 10, nodes: [1, 2] },
    ],
    { south: -1, west: -1, north: 1, east: 1 },
  );
  // Assert
  expect(selected).toBeNull();
});
