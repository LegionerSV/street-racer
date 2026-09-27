import { expect, it } from 'vitest';
import { buildWorld } from './network';
import { edgeById, nodeById } from './road-graph';
import type { OSMElement, RegionData } from './types';

const region = (elements: OSMElement[]): RegionData => ({
  center: { lat: 0, lon: 0 },
  elements,
  elevation: { width: 2, size: 5600, values: new Float32Array(4) },
  fetchedAt: 'test',
  drivingSide: 'right',
});

it('индекс узлов различает отсутствующий узел и замену частичной сети', () => {
  // Arrange
  const world = buildWorld(region([]));
  const node = { id: 42, x: 1, y: 2, z: 3, signal: false };
  const partial = { ...world, nodes: [node] };
  // Act / Assert
  expect(nodeById(world, 42)).toBeUndefined();
  expect(nodeById(partial, 42)).toBe(node);
  expect(nodeById(partial, 43)).toBeUndefined();
  expect(nodeById({ ...partial, nodes: [{ ...node, y: 9 }] }, 42)?.y).toBe(9);
  expect(nodeById({ ...partial, nodes: [] }, 42)).toBeUndefined();
  expect(nodeById(partial, 42)?.y).toBe(2);
});

it('создаёт стабильные ключи для направлений и повторяющихся сегментов OSM way', () => {
  // Arrange
  const nodes: OSMElement[] = [
    { type: 'node', id: 1, lat: 0, lon: 0 },
    { type: 'node', id: 2, lat: 0, lon: 0.001 },
  ];
  const way: OSMElement = {
    type: 'way',
    id: 50,
    nodes: [1, 2, 1, 2],
    tags: { highway: 'residential' },
  };
  // Act
  const first = buildWorld(region([...nodes, way]));
  const reordered = buildWorld(region([way, ...nodes.reverse()]));
  // Assert
  expect(
    first.edges
      .map((edge) => edge.stableId)
      .sort((a, b) => a!.localeCompare(b!)),
  ).toEqual(
    reordered.edges
      .map((edge) => edge.stableId)
      .sort((a, b) => a!.localeCompare(b!)),
  );
  expect(new Set(first.edges.map((edge) => edge.stableId)).size).toBe(
    first.edges.length,
  );
  expect(
    first.edges.find((edge) => edge.from === 1 && edge.to === 2)?.stableId,
  ).not.toBe(
    first.edges.find((edge) => edge.from === 2 && edge.to === 1)?.stableId,
  );
  expect(
    first.edges
      .filter((edge) => edge.from === 1 && edge.to === 2)
      .map((edge) => edge.stableId),
  ).toEqual(expect.arrayContaining(['50/1/2/0', '50/1/2/2']));
});

it('находит маршрут по стабильным ключам после перестановки массива edges', () => {
  // Arrange
  const world = buildWorld(
    region([
      { type: 'node', id: 1, lat: 0, lon: 0 },
      { type: 'node', id: 2, lat: 0.01, lon: 0 },
      { type: 'way', id: 10, nodes: [1, 2], tags: { highway: 'primary' } },
    ]),
  );
  const stableId = world.edges[0].stableId!;
  expect(edgeById(world, stableId)).toBe(world.edges[0]);
  // Act
  world.edges.reverse();
  world.edges.forEach((edge, index) => (edge.id = index));
  // Assert
  expect(edgeById(world, stableId)?.stableId).toBe(stableId);
});
