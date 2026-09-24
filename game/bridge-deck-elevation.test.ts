import { expect, it } from 'vitest';
import { buildWorld } from './network';
import { polygonContains, projectOnSegment } from './geo';
import { reconcileWorld } from './world-update';
import { fitBridgeBuildingUnderDeck } from './clearance';
import { buildChunk } from './chunks';
import type { Building, Edge, OSMElement, RegionData, World } from './types';

function roadRegion(building?: { height?: string; minHeight?: string; layer?: string; kind?: string; shape?: 'narrow' | 'edge' }): RegionData {
  const buildingPoints = building?.shape === 'narrow'
    ? [[160.6, 94], [161.2, 94], [161.2, 124], [160.6, 124]]
    : building?.shape === 'edge'
      ? [[160, 103], [300, 103], [300, 105], [160, 105]]
      : [[160, 94], [300, 94], [300, 124], [160, 124]];
  const coordinates = [
    [20, 100], [420, 100],
    [420, 118], [240, 118], [20, 118],
    ...buildingPoints,
  ];
  const elements: OSMElement[] = coordinates.map(([x, z], i) => ({
    type: 'node', id: i + 1, lat: z / 111320, lon: x / 111320,
  }));
  elements.push(
    { type: 'way', id: 10, nodes: [1, 2], tags: { highway: 'primary', name: 'Общий мост', bridge: 'yes', layer: '2', oneway: 'yes', lanes: '3' } },
    { type: 'way', id: 20, nodes: [3, 4, 5], tags: { highway: 'primary', name: 'Общий мост', bridge: 'yes', layer: '2', oneway: 'yes', lanes: '3' } },
  );
  if (building) elements.push({
    type: 'way', id: 30, nodes: [6, 7, 8, 9, 6],
    tags: { building: building.kind ?? 'bridge', layer: building.layer ?? '1', ...(building.height ? { height: building.height } : {}), ...(building.minHeight ? { min_height: building.minHeight } : {}) },
  });
  const width = 61;
  return {
    center: { lat: 0, lon: 0 }, elements,
    elevation: { width, size: 1200, values: Float32Array.from({ length: width * width }, (_, i) =>
      (Math.floor(i / width) * 20 - 600) * 0.18) },
    drivingSide: 'right', fetchedAt: 'test',
  };
}

it('выравнивает встречные полотна одного моста при разном разбиении OSM', () => {
  // Arrange
  const region = roadRegion();
  // Act
  const world = buildWorld(region);
  const first = world.edges.find((edge) => edge.way === 10)!;
  const second = world.edges.filter((edge) => edge.way === 20);
  const point = first.points[Math.floor(first.points.length / 2)];
  const opposite = second.flatMap((edge) => edge.points.slice(1).map((p, i) =>
    projectOnSegment(point, edge.points[i], p))).sort((a, b) => a.distance - b.distance)[0];
  // Assert
  expect(Math.abs(point.y - opposite.point.y)).toBeLessThan(0.25);
  expect(first.blocked).toBe(false);
  expect(second.every((edge) => !edge.blocked)).toBe(true);
});

it('сохраняет общий уровень на двух подъездах после выравнивания моста', () => {
  // Arrange
  const region = roadRegion();
  region.elements.push(
    { type: 'node', id: 10, lat: 100 / 111320, lon: -100 / 111320 },
    { type: 'node', id: 11, lat: 118 / 111320, lon: -100 / 111320 },
    { type: 'way', id: 11, nodes: [10, 1], tags: { highway: 'primary', name: 'Общий мост', oneway: 'yes', lanes: '3' } },
    { type: 'way', id: 21, nodes: [5, 11], tags: { highway: 'primary', name: 'Общий мост', oneway: 'yes', lanes: '3' } },
  );
  // Act
  const world = buildWorld(region);
  const approach = world.edges.find((edge) => edge.way === 11)!;
  const other = world.edges.find((edge) => edge.way === 21)!;
  const point = approach.points.at(-3)!;
  const opposite = other.points.slice(1).map((p, i) => projectOnSegment(point, other.points[i], p))
    .sort((a, b) => a.distance - b.distance)[0];
  // Assert
  expect(Math.abs(point.y - opposite.point.y)).toBeLessThan(0.25);
});

it.each([
  { label: 'явная высота', building: { height: '15', layer: '1' }, expectedHeight: 15 },
  { label: 'расчётная высота', building: { layer: '1' }, expectedHeight: undefined },
])('поднимает дорогу над нижним зданием моста: $label', ({ building, expectedHeight }) => {
  // Arrange
  const region = roadRegion(building);
  // Act
  const world = buildWorld(region);
  const roof = world.buildings.find((item) => item.id === 30)!;
  const top = Math.max(...roof.footprint.map((point) => point.y)) + roof.height;
  const covered = world.edges.filter((edge) => [10, 20].includes(edge.way))
    .flatMap((edge) => edge.points.filter((point) => point.x >= 170 && point.x <= 290));
  // Assert
  expect(roof.height).toBe(expectedHeight ?? roof.height);
  expect(covered.length).toBeGreaterThan(10);
  expect(Math.min(...covered.map((point) => point.y))).toBeGreaterThan(top + 0.5);
  if (expectedHeight === undefined) {
    const baseline = buildWorld(roadRegion());
    const original = baseline.edges.filter((edge) => [10, 20].includes(edge.way))
      .flatMap((edge) => edge.points.filter((point) => point.x >= 170 && point.x <= 290));
    expect(covered.map((point) => point.y)).toEqual(original.map((point) => point.y));
  }
});

it('после подгрузки нижнее здание остаётся под сохранённым полотном', () => {
  // Arrange
  const region = roadRegion({ layer: '1' });
  const previous = buildWorld(region);
  for (const edge of previous.edges.filter((item) => [10, 20].includes(item.way)))
    edge.points = edge.points.map((point) => ({ ...point, y: point.y - 1 }));
  const next = buildWorld(region);

  // Act
  reconcileWorld(previous, next);

  // Assert
  const building = next.buildings.find((item) => item.id === 30)!;
  const top = Math.max(...building.footprint.map((point) => point.y)) + building.height;
  const road = next.edges.filter((edge) => [10, 20].includes(edge.way))
    .flatMap((edge) => edge.points.filter((point) => point.x >= 170 && point.x <= 290));
  expect(Math.min(...road.map((point) => point.y))).toBeGreaterThan(top + 0.5);
});

it('не пропускает новое здание с явной высотой сквозь уже открытую дорогу', () => {
  // Arrange
  const previous = buildWorld(roadRegion());
  const next = buildWorld(roadRegion({ height: '15', layer: '1' }));
  const oldRoad = previous.edges.filter((edge) => [10, 20].includes(edge.way))
    .flatMap((edge) => edge.points.map((point) => point.y));

  // Act
  reconcileWorld(previous, next);

  // Assert
  const building = next.buildings.find((item) => item.id === 30)!;
  const top = Math.max(...building.footprint.map((point) => point.y)) + building.height;
  const road = next.edges.filter((edge) => [10, 20].includes(edge.way))
    .flatMap((edge) => edge.points.filter((point) => point.x >= 170 && point.x <= 290));
  expect(next.edges.filter((edge) => [10, 20].includes(edge.way))
    .flatMap((edge) => edge.points.map((point) => point.y))).toEqual(oldRoad);
  expect(Math.min(...road.map((point) => point.y))).toBeGreaterThan(top + 0.5);
  expect(building.osmTags?.height).toBe('15');
  expect(building.height).toBeLessThan(15);
});

it.each([
  { shape: 'narrow' as const, height: '15' },
  { shape: 'edge' as const, height: '15' },
  { shape: 'narrow' as const, height: undefined },
  { shape: 'edge' as const, height: undefined },
])('учитывает здание между узлами и под краем полотна: $shape height=$height', ({ shape, height }) => {
  // Arrange
  const region = roadRegion({ shape, height, layer: '1' });
  const baseline = buildWorld(roadRegion());
  const outline = region.elements.filter((element) => element.type === 'node').slice(5, 9)
    .map((element) => ({ x: element.lon! * 111320, y: 0, z: element.lat! * 111320 }));
  expect(baseline.edges.filter((edge) => [10, 20].includes(edge.way))
    .flatMap((edge) => edge.points).some((point) => polygonContains(point, outline))).toBe(false);

  // Act
  const world = buildWorld(region);

  // Assert
  const building = world.buildings.find((item) => item.id === 30)!;
  const top = Math.max(...building.footprint.map((point) => point.y)) + building.height;
  const road = world.edges.filter((edge) => [10, 20].includes(edge.way));
  const probes = shape === 'narrow'
    ? [{ x: 160.9, y: 0, z: 100 }]
    : building.footprint;
  const contacts = road.flatMap((edge) => probes.flatMap((vertex) => edge.points
    .slice(1).map((point, index) => projectOnSegment(vertex, edge.points[index], point))
    .filter((hit) => hit.distance <= edge.width / 2).map((hit) => hit.point.y)));
  expect(contacts.length).toBeGreaterThan(0);
  expect(Math.min(...contacts)).toBeGreaterThan(top + 0.5);
});

it('не оставляет основание расчётного здания выше крыши после подгонки', () => {
  // Arrange
  const region = roadRegion({ minHeight: '14', layer: '1' });
  // Act
  const world = buildWorld(region);
  // Assert
  const building = world.buildings.find((item) => item.id === 30)!;
  expect(building.height).toBeGreaterThan(building.minHeight || 0);
  expect(building.minHeight).toBeLessThan(14);
});

it('опускает основание нижнего здания, если DEM поднял его выше полотна', () => {
  // Arrange
  const building = {
    id: 1, kind: 'bridge', height: 8, osmTags: { building: 'bridge', layer: '1' },
    footprint: [
      { x: 20, y: 10, z: 20 }, { x: 40, y: 10, z: 20 },
      { x: 40, y: 10, z: 24 }, { x: 20, y: 10, z: 24 },
    ],
    holes: [], colour: 0, roof: 'flat',
  } as Building;
  const road = {
    id: 2, stableId: '2/1/2/0', way: 2, from: 1, to: 2,
    bridge: true, tunnel: false, blocked: false, layer: 2, width: 9,
    lanes: 2, speed: 14, length: 30, name: 'Мост', category: 'service',
    points: [{ x: 15, y: 5, z: 22 }, { x: 45, y: 5, z: 22 }],
  } as Edge;

  // Act
  fitBridgeBuildingUnderDeck([road], [building]);

  // Assert
  expect(Math.max(...building.footprint.map((point) => point.y)) + building.height)
    .toBeLessThanOrEqual(5 - 0.55 - 0.2 + 1e-6);
  expect(building.height).toBeGreaterThan(0);
  const world = {
    center: { lat: 0, lon: 0 }, nodes: [], edges: [road], restrictions: [],
    buildings: [building], areas: [], trees: [],
    elevation: { width: 2, size: 5600, values: new Float32Array([10, 10, 10, 10]) },
    drivingSide: 'right', warnings: [], spawnEdge: null, routes: [],
  } as World;
  const mesh = buildChunk(world, '0,0', 0).buildings;
  expect(mesh.positions.length).toBeGreaterThan(0);
  expect(Math.max(...mesh.positions.filter((_, index) => index % 3 === 1)))
    .toBeLessThanOrEqual(5 - 0.55 - 0.2 + 1e-6);
  const closed = buildChunk(world, '0,0', 0, true).buildings;
  expect(closed.positions.length).toBeGreaterThan(0);
  expect(Math.max(...closed.positions.filter((_, index) => index % 3 === 1)))
    .toBeLessThanOrEqual(5 - 0.55 - 0.2 + 1e-6);
});

it.each([
  { kind: 'bridge', layer: '2' },
  { kind: 'house', layer: '1' },
])('не поднимает мост над зданием без нижнего слоя и типа моста: $kind $layer', ({ kind, layer }) => {
  // Arrange
  const region = roadRegion({ height: '15', layer, kind });
  // Act
  const world = buildWorld(region);
  const baseline = buildWorld(roadRegion());
  const points = world.edges.filter((edge) => edge.way === 10).flatMap((edge) => edge.points)
    .filter((point) => point.x >= 170 && point.x <= 290);
  const original = baseline.edges.filter((edge) => edge.way === 10).flatMap((edge) => edge.points)
    .filter((point) => point.x >= 170 && point.x <= 290);
  // Assert
  expect(points.map((point) => point.y)).toEqual(original.map((point) => point.y));
});
