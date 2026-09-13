import { expect, it } from 'vitest';
import { reduceMapElements } from './map-element-filter';
import type { OSMElement } from './types';

const center = { lat: 0, lon: 0 };

it('сохраняет проезжие улицы, ограничения поворотов и их точки', () => {
  // Arrange
  const elements: OSMElement[] = [
    { type: 'node', id: 1, lat: 0, lon: 0 },
    { type: 'node', id: 2, lat: 0.001, lon: 0 },
    { type: 'node', id: 3, lat: 0.001, lon: 0.001 },
    { type: 'way', id: 10, nodes: [1, 2], tags: { highway: 'residential' } },
    { type: 'way', id: 11, nodes: [2, 3], tags: { highway: 'service' } },
    {
      type: 'relation',
      id: 20,
      tags: { type: 'restriction', restriction: 'no_left_turn' },
      members: [
        { type: 'way', ref: 10, role: 'from' },
        { type: 'node', ref: 2, role: 'via' },
        { type: 'way', ref: 11, role: 'to' },
      ],
    },
  ];

  // Act
  const result = reduceMapElements(elements, center);

  // Assert
  expect(result.elements).toEqual(elements);
  expect(result.stats.raw.total).toBe(6);
  expect(result.stats.kept.total).toBe(6);
});

it('убирает дворовые здания, деревья и ставшие ненужными точки, сохраняя фасад на улице', () => {
  // Arrange
  const elements: OSMElement[] = [
    { type: 'node', id: 1, lat: -0.001, lon: 0 },
    { type: 'node', id: 2, lat: 0.001, lon: 0 },
    { type: 'way', id: 10, nodes: [1, 2], tags: { highway: 'residential' } },
    { type: 'node', id: 3, lat: 0, lon: 0.0002 },
    { type: 'node', id: 4, lat: 0.0001, lon: 0.0002 },
    { type: 'node', id: 5, lat: 0.0001, lon: 0.0003 },
    { type: 'way', id: 11, nodes: [3, 4, 5, 3], tags: { building: 'yes' } },
    { type: 'node', id: 6, lat: 0, lon: 0.0016 },
    { type: 'node', id: 7, lat: 0.0001, lon: 0.0016 },
    { type: 'node', id: 8, lat: 0.0001, lon: 0.0017 },
    { type: 'way', id: 12, nodes: [6, 7, 8, 6], tags: { building: 'garage' } },
    { type: 'node', id: 9, lat: 0, lon: 0.0001, tags: { natural: 'tree' } },
    { type: 'node', id: 13, lat: 0, lon: 0.0018, tags: { natural: 'tree' } },
  ];

  // Act
  const result = reduceMapElements(elements, center);

  // Assert
  expect(
    result.elements.map((element) => `${element.type}/${element.id}`),
  ).toEqual([
    'node/1',
    'node/2',
    'way/10',
    'node/3',
    'node/4',
    'node/5',
    'way/11',
    'node/9',
  ]);
  expect(result.stats.raw.total).toBe(13);
  expect(result.stats.kept.total).toBe(8);
  expect(elements).toHaveLength(13);
});

it('сохраняет геометрию отношения здания у улицы, включая внешний контур и отверстие', () => {
  // Arrange
  const elements: OSMElement[] = [
    { type: 'node', id: 1, lat: -0.001, lon: 0 },
    { type: 'node', id: 2, lat: 0.001, lon: 0 },
    { type: 'way', id: 10, nodes: [1, 2], tags: { highway: 'residential' } },
    { type: 'node', id: 3, lat: 0, lon: 0.0002 },
    { type: 'node', id: 4, lat: 0.0001, lon: 0.0002 },
    { type: 'node', id: 5, lat: 0.0001, lon: 0.0003 },
    { type: 'way', id: 11, nodes: [3, 4, 5, 3] },
    { type: 'node', id: 6, lat: 0.00003, lon: 0.00023 },
    { type: 'node', id: 7, lat: 0.00004, lon: 0.00023 },
    { type: 'node', id: 8, lat: 0.00004, lon: 0.00024 },
    { type: 'way', id: 12, nodes: [6, 7, 8, 6] },
    {
      type: 'relation',
      id: 20,
      tags: { type: 'multipolygon', building: 'yes' },
      members: [
        { type: 'way', ref: 11, role: 'outer' },
        { type: 'way', ref: 12, role: 'inner' },
      ],
    },
  ];

  // Act
  const result = reduceMapElements(elements, center);

  // Assert
  expect(result.elements).toEqual(elements);
});

it('оставляет приметное здание вдали от улицы и не опустошает клетку без улиц', () => {
  // Arrange
  const elements: OSMElement[] = [
    { type: 'node', id: 1, lat: -0.001, lon: 0 },
    { type: 'node', id: 2, lat: 0.001, lon: 0 },
    { type: 'way', id: 10, nodes: [1, 2], tags: { highway: 'residential' } },
    { type: 'node', id: 3, lat: 0, lon: 0.003 },
    { type: 'node', id: 4, lat: 0.0001, lon: 0.003 },
    { type: 'node', id: 5, lat: 0.0001, lon: 0.0031 },
    {
      type: 'way',
      id: 11,
      nodes: [3, 4, 5, 3],
      tags: { building: 'yes', name: 'Музей' },
    },
  ];

  // Act
  const withRoad = reduceMapElements(elements, center);
  const withoutRoad = reduceMapElements(elements.slice(3), center);

  // Assert
  expect(withRoad.elements).toEqual(elements);
  expect(withoutRoad.elements).toEqual(elements.slice(3));
});

it('удаляет дворовый газон, но сохраняет парк и воду вместе с их контурами', () => {
  // Arrange
  const elements: OSMElement[] = [
    { type: 'node', id: 1, lat: -0.001, lon: 0 },
    { type: 'node', id: 2, lat: 0.001, lon: 0 },
    { type: 'way', id: 10, nodes: [1, 2], tags: { highway: 'residential' } },
    { type: 'node', id: 3, lat: 0, lon: 0.002 },
    { type: 'node', id: 4, lat: 0.0001, lon: 0.002 },
    { type: 'node', id: 5, lat: 0.0001, lon: 0.0021 },
    { type: 'way', id: 11, nodes: [3, 4, 5, 3], tags: { landuse: 'grass' } },
    { type: 'node', id: 6, lat: 0, lon: 0.003 },
    { type: 'node', id: 7, lat: 0.0001, lon: 0.003 },
    { type: 'node', id: 8, lat: 0.0001, lon: 0.0031 },
    { type: 'way', id: 12, nodes: [6, 7, 8, 6], tags: { leisure: 'park' } },
    { type: 'node', id: 9, lat: 0, lon: 0.004 },
    { type: 'node', id: 13, lat: 0.0001, lon: 0.004 },
    { type: 'node', id: 14, lat: 0.0001, lon: 0.0041 },
    { type: 'way', id: 15, nodes: [9, 13, 14, 9], tags: { natural: 'water' } },
  ];

  // Act
  const result = reduceMapElements(elements, center);

  // Assert
  expect(
    result.elements.map((element) => `${element.type}/${element.id}`),
  ).toEqual([
    'node/1',
    'node/2',
    'way/10',
    'node/6',
    'node/7',
    'node/8',
    'way/12',
    'node/9',
    'node/13',
    'node/14',
    'way/15',
  ]);
});

it('при переполнении сначала убирает удалённые фасады, затем оставляет только дорожную основу', () => {
  // Arrange
  const elements: OSMElement[] = [
    { type: 'node', id: 1, lat: -0.001, lon: 0 },
    { type: 'node', id: 2, lat: 0.001, lon: 0 },
    { type: 'way', id: 10, nodes: [1, 2], tags: { highway: 'residential' } },
    { type: 'node', id: 3, lat: 0, lon: 0.0002 },
    { type: 'node', id: 4, lat: 0.0001, lon: 0.0002 },
    { type: 'node', id: 5, lat: 0.0001, lon: 0.0003 },
    { type: 'way', id: 11, nodes: [3, 4, 5, 3], tags: { building: 'yes' } },
  ];

  // Act
  const standard = reduceMapElements(elements, center);
  const minimal = reduceMapElements(elements, center, 'minimal');
  const roads = reduceMapElements(elements, center, 'roads');

  // Assert
  expect(standard.elements).toHaveLength(7);
  expect(minimal.elements.map((element) => element.id)).toEqual([1, 2, 10]);
  expect(roads.elements.map((element) => element.id)).toEqual([1, 2, 10]);
});
