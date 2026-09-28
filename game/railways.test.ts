import { expect, it } from 'vitest';
import {
  advanceTrainProgress,
  buildRailways,
  parkedWagons,
  trainCooldown,
  trainOpportunity,
} from './railways';
import type { RegionData } from './types';
import { reduceMapElements } from './map-element-filter';
import { mapCellQuery } from './map-source';
import { OSMIUM_FILTER_EXPRESSIONS } from '../scripts/local-map-data';
import { buildWorld } from './network';
import { buildChunk } from './chunks';
import { toLocal } from './geo';

const region = (elements: RegionData['elements']): RegionData => ({
  center: { lat: 59.93, lon: 30.3 },
  elements,
  drivingSide: 'right',
  fetchedAt: '',
  elevation: { width: 2, size: 1000, values: new Float32Array(4) },
});

it('строит пути и мост, но исключает подземные и недостроенные линии', () => {
  // Arrange
  const nodes = [0, 1, 2, 3].map((id) => ({
    type: 'node' as const,
    id,
    lat: 59.93,
    lon: 30.3 + id * 0.001,
  }));
  const data = region([
    ...nodes,
    {
      type: 'way',
      id: 10,
      nodes: [0, 1, 2],
      tags: { railway: 'rail', bridge: 'yes' },
    },
    {
      type: 'way',
      id: 11,
      nodes: [2, 3],
      tags: { railway: 'subway', tunnel: 'yes' },
    },
    { type: 'way', id: 12, nodes: [2, 3], tags: { railway: 'construction' } },
  ]);
  // Act
  const lines = buildRailways(data, data.elevation);
  // Assert
  expect(lines).toHaveLength(1);
  expect(lines[0]).toMatchObject({ id: 10, bridge: true, nodes: [0, 1, 2] });
  expect(lines[0].points[1].y).toBeGreaterThan(0);
});

it('сохраняет одну высоту на соединённых участках железнодорожного моста', () => {
  // Arrange
  const data = region([
    ...[0, 1, 2].map((id) => ({
      type: 'node' as const,
      id,
      lat: 59.93,
      lon: 30.3 + id * 0.002,
    })),
    { type: 'way', id: 10, nodes: [0, 1], tags: { railway: 'rail', bridge: 'yes' } },
    { type: 'way', id: 11, nodes: [1, 2], tags: { railway: 'rail', bridge: 'yes' } },
  ]);
  data.elevation.values = new Float32Array([0, 100, 0, 100]);
  // Act
  const lines = buildRailways(data, data.elevation);
  // Assert
  expect(lines[0].points.at(-1)!.y).toBe(lines[1].points[0].y);
  expect(lines[0].points[0].y).toBeGreaterThan(0);
});

it('не поднимает уже загруженный мост после появления соседнего участка', () => {
  // Arrange
  const data = region([
    ...[0, 1, 2].map((id) => ({
      type: 'node' as const,
      id,
      lat: 59.93,
      lon: 30.3 + id * 0.004,
    })),
    { type: 'way', id: 10, nodes: [0, 1], tags: { railway: 'rail', bridge: 'yes' } },
    { type: 'way', id: 11, nodes: [1, 2], tags: { railway: 'rail', bridge: 'yes' } },
  ]);
  data.elevation.values = new Float32Array([0, 100, 0, 100]);
  // Act
  const partial = buildRailways({ ...data, elements: data.elements.filter((e) => e.id !== 11) }, data.elevation);
  const complete = buildRailways(data, data.elevation);
  // Assert
  expect(complete[0].points).toEqual(partial[0].points);
  expect(complete[0].points.at(-1)!.y).toBe(complete[1].points[0].y);
});

it('запрашивает и сохраняет пути с узлами даже в облегчённом режиме карты', () => {
  // Arrange
  const elements = [
    { type: 'node' as const, id: 1, lat: 59.93, lon: 30.3 },
    { type: 'node' as const, id: 2, lat: 59.93, lon: 30.301 },
    {
      type: 'node' as const,
      id: 3,
      lat: 59.93,
      lon: 30.3,
      tags: { railway: 'station' },
    },
    { type: 'way' as const, id: 10, nodes: [1, 2], tags: { railway: 'rail' } },
  ];
  // Act
  const query = mapCellQuery({
    south: 59.9,
    west: 30.2,
    north: 60,
    east: 30.4,
  });
  const reduced = reduceMapElements(
    elements,
    { lat: 59.93, lon: 30.3 },
    'roads',
  );
  // Assert
  expect(query).toContain('way["railway"');
  expect(OSMIUM_FILTER_EXPRESSIONS).toContain('w/railway=rail,narrow_gauge');
  expect(reduced.elements).toEqual(elements);
});

it('ставит вагоны только у вокзала на запасном пути', () => {
  // Arrange
  const nodes = [0, 1, 2, 3].map((id) => ({
    type: 'node' as const,
    id,
    lat: 59.93,
    lon: 30.3 + id * 0.001,
  }));
  const data = region([
    ...nodes,
    {
      type: 'node',
      id: 100,
      lat: 59.93,
      lon: 30.301,
      tags: { railway: 'station' },
    },
    {
      type: 'way',
      id: 20,
      nodes: [0, 1, 2, 3],
      tags: { railway: 'rail', service: 'siding' },
    },
  ]);
  // Act
  const wagons = parkedWagons(buildRailways(data, data.elevation), data);
  // Assert
  expect(wagons.length).toBeGreaterThanOrEqual(2);
  expect(wagons.length).toBeLessThanOrEqual(4);
  expect(
    parkedWagons(buildRailways(region(nodes), data.elevation), region(nodes)),
  ).toEqual([]);
});

it('не принимает станцию метро за грузовой вокзал', () => {
  // Arrange
  const data = region([
    { type: 'node', id: 1, lat: 59.93, lon: 30.3 },
    { type: 'node', id: 2, lat: 59.93, lon: 30.303 },
    { type: 'node', id: 3, lat: 59.93, lon: 30.301, tags: { railway: 'station', station: 'subway' } },
    { type: 'way', id: 10, nodes: [1, 2], tags: { railway: 'rail', service: 'siding' } },
  ]);
  // Act
  const wagons = parkedWagons(buildRailways(data, data.elevation), data);
  // Assert
  expect(wagons).toEqual([]);
});

it('находит запасной путь у вокзала между редко размеченными узлами', () => {
  // Arrange
  const data = region([
    { type: 'node', id: 1, lat: 59.93, lon: 30.3 },
    { type: 'node', id: 2, lat: 59.93, lon: 30.312 },
    { type: 'node', id: 3, lat: 59.93, lon: 30.306, tags: { railway: 'station' } },
    { type: 'way', id: 10, nodes: [1, 2], tags: { railway: 'rail', service: 'siding' } },
  ]);
  // Act
  const wagons = parkedWagons(buildRailways(data, data.elevation), data);
  // Assert
  expect(wagons).toHaveLength(4);
  const station = toLocal(59.93, 30.306, data.center);
  expect(Math.max(...wagons.map((wagon) => Math.abs(wagon.point.x - station.x)))).toBeLessThan(40);
});

it('распознаёт вокзал, размеченный полигоном', () => {
  // Arrange
  const nodes = [0, 1, 2, 3].map((id) => ({
    type: 'node' as const,
    id,
    lat: 59.93,
    lon: 30.3 + id * 0.001,
  }));
  const data = region([
    ...nodes,
    { type: 'way', id: 100, nodes: [0, 1, 2, 0], tags: { railway: 'station' } },
    {
      type: 'way',
      id: 20,
      nodes: [0, 1, 2, 3],
      tags: { railway: 'rail', service: 'siding' },
    },
  ]);
  // Act
  const wagons = parkedWagons(buildRailways(data, data.elevation), data);
  // Assert
  expect(wagons.length).toBeGreaterThanOrEqual(2);
});

it('распознаёт вокзал, размеченный отношением с контуром', () => {
  // Arrange
  const nodes = [0, 1, 2, 3].map((id) => ({
    type: 'node' as const, id, lat: 59.93, lon: 30.3 + id * 0.001,
  }));
  const data = region([
    ...nodes,
    { type: 'way', id: 100, nodes: [0, 1, 2, 0] },
    { type: 'relation', id: 101, members: [{ type: 'way', ref: 100, role: 'outer' }], tags: { type: 'multipolygon', railway: 'station' } },
    { type: 'way', id: 20, nodes: [0, 1, 2, 3], tags: { railway: 'rail', service: 'siding' } },
  ]);
  // Act
  const wagons = parkedWagons(buildRailways(data, data.elevation), data);
  // Assert
  expect(wagons.length).toBeGreaterThanOrEqual(2);
});

it('разрешает поезд только после задержки на видимых полностью загруженных путях', () => {
  // Arrange
  const line = {
    id: 10,
    nodes: [1, 2],
    points: [
      { x: -200, y: 0, z: 200 },
      { x: 400, y: 0, z: 200 },
    ],
    bridge: false,
    service: '',
  };
  const visible = () => true;
  // Act / Assert
  expect(trainOpportunity([line], 479, visible, () => true)).toBeNull();
  expect(trainOpportunity([line], 480, visible, () => false)).toBeNull();
  expect(
    trainOpportunity(
      [line],
      480,
      () => false,
      () => true,
    ),
  ).toBeNull();
  expect(trainOpportunity([line], 480, visible, () => true)?.id).toBe(10);
});

it('останавливает поезд на паузе и выдерживает редкий интервал', () => {
  // Arrange
  const progress = 80;
  // Act
  const paused = advanceTrainProgress(progress, 1, true);
  const moving = advanceTrainProgress(progress, 1, false);
  // Assert
  expect(paused).toBe(80);
  expect(moving).toBe(94);
  expect(trainCooldown(0)).toBe(480);
  expect(trainCooldown(1)).toBe(900);
});

it('рисует путь, мост и запаркованный вагон в геометрии чанка', () => {
  // Arrange
  const world = buildWorld(region([]));
  world.railways = [
    {
      id: 10,
      nodes: [1, 2],
      points: [
        { x: 10, y: 8, z: 10 },
        { x: 130, y: 8, z: 10 },
      ],
      bridge: true,
      service: 'siding',
    },
  ];
  world.parkedWagons = [
    { id: '10:0', point: { x: 60, y: 8, z: 10 }, heading: Math.PI / 2 },
  ];
  // Act
  const chunk = buildChunk(world, '0,0', 0);
  const distant = buildChunk(world, '0,0', 3);
  // Assert
  expect(chunk.structures.positions.length).toBeGreaterThan(0);
  expect(chunk.structures.indices.length).toBeGreaterThan(0);
  expect(distant.structures.indices.length).toBeGreaterThan(0);
});

it('рисует боковины настила железнодорожного моста вблизи и вдали', () => {
  // Arrange
  const world = buildWorld(region([]));
  world.railways = [
    {
      id: 10,
      nodes: [1, 2],
      bridge: true,
      service: '',
      points: [
        { x: 10, y: 8, z: 10 },
        { x: 30, y: 8, z: 10 },
      ],
    },
  ];
  const verticalFace = (lod: number) => {
    const mesh = buildChunk(world, '0,0', lod).structures;
    return Array.from({ length: mesh.indices.length / 3 }, (_, index) => {
      const heights = mesh.indices
        .slice(index * 3, index * 3 + 3)
        .map((vertex) => mesh.positions[vertex * 3 + 1]);
      return Math.max(...heights) - Math.min(...heights);
    }).some((height) => height >= 0.8);
  };
  // Act / Assert
  expect(verticalFace(0)).toBe(true);
  expect(verticalFace(3)).toBe(true);
});

it('опускает опоры железнодорожного моста до дна водоёма', () => {
  // Arrange
  const world = buildWorld(region([]));
  world.railways = [
    {
      id: 10,
      nodes: [1, 2],
      bridge: true,
      service: '',
      points: [
        { x: 10, y: 8, z: 50 },
        { x: 130, y: 8, z: 50 },
      ],
    },
  ];
  world.areas = [
    {
      id: 1,
      kind: 'water',
      railing: 'river',
      waterKind: 'canal',
      points: [
        { x: 0, y: 0, z: 0 },
        { x: 180, y: 0, z: 0 },
        { x: 180, y: 0, z: 100 },
        { x: 0, y: 0, z: 100 },
      ],
    },
  ];
  // Act
  const mesh = buildChunk(world, '0,0', 0).structures;
  const supportY = Array.from(
    { length: mesh.positions.length / 3 },
    (_, index) => index,
  )
    .filter((index) => Math.abs(mesh.colors![index * 4] - 0.32) < 0.001)
    .map((index) => mesh.positions[index * 3 + 1]);
  // Assert
  expect(supportY.length).toBeGreaterThan(0);
  expect(Math.min(...supportY)).toBeLessThanOrEqual(-3.4);
});
