import { describe, expect, it } from 'vitest';
import { appendShip, isShipTags, shipShape } from './ships';
import { buildWorld } from './network';
import { buildChunk } from './chunks';
import { reduceMapElements } from './map-element-filter';
import type {
  Building,
  MeshData,
  OSMElement,
  Point,
  RegionData,
  Tags,
} from './types';

const footprint: Point[] = [
  { x: -38, y: 0, z: -6 },
  { x: 31, y: 0, z: -6 },
  { x: 42, y: 0, z: 0 },
  { x: 31, y: 0, z: 6 },
  { x: -38, y: 0, z: 6 },
  { x: -42, y: 0, z: 0 },
];
const ship = (tags: Record<string, string>): Building => ({
  id: 1,
  osmType: 'way',
  footprint,
  height: 9,
  colour: 0.2,
  roof: 'flat',
  kind: tags.building || 'ship',
  osmTags: tags,
});

describe('суда OSM', () => {
  it('узнаёт корабль по building, historic или ship:type, но не обычный дом', () => {
    // Arrange
    const examples: Tags[] = [
      { building: 'ship' },
      { historic: 'ship' },
      { 'ship:type': 'tugboat' },
      { building: 'houseboat' },
      { building: 'house' },
      {},
    ];
    // Act
    const actual = examples.map(isShipTags);
    // Assert
    expect(actual).toEqual([true, true, true, true, false, false]);
  });

  it('строит низкий корпус по контуру вместо девятиэтажной призмы', () => {
    // Arrange
    const mesh: MeshData = { positions: [], indices: [], colors: [] };
    // Act
    appendShip(ship({ building: 'ship', historic: 'ship' }), mesh, 0);
    // Assert
    expect(mesh.indices.length).toBeGreaterThan(24);
    expect(
      Math.min(...mesh.positions.filter((_, i) => i % 3 === 1)),
    ).toBeLessThan(0);
    expect(
      Math.max(...mesh.positions.filter((_, i) => i % 3 === 1)),
    ).toBeLessThan(20);
    expect(shipShape(footprint)?.length).toBeGreaterThan(75);
  });

  it('пропускает неполный или вырожденный контур', () => {
    // Arrange
    const mesh: MeshData = { positions: [], indices: [], colors: [] };
    // Act
    appendShip(
      { ...ship({ historic: 'ship' }), footprint: footprint.slice(0, 2) },
      mesh,
      0,
    );
    // Assert
    expect(mesh.indices).toEqual([]);
    expect(
      shipShape([
        { x: 0, y: 0, z: 0 },
        { x: 1, y: 0, z: 0 },
        { x: 2, y: 0, z: 0 },
      ]),
    ).toBeUndefined();
  });

  it('сохраняет историческое судно без building при фильтрации и строит корпус в чанке', () => {
    // Arrange
    const elements: OSMElement[] = [
      { type: 'node', id: 1, lat: 0, lon: 0 },
      { type: 'node', id: 2, lat: 0, lon: 0.0006 },
      { type: 'node', id: 3, lat: 0.0001, lon: 0.0007 },
      { type: 'node', id: 4, lat: 0.0002, lon: 0.0006 },
      { type: 'node', id: 5, lat: 0.0002, lon: 0 },
      {
        type: 'way',
        id: 10,
        nodes: [1, 2, 3, 4, 5, 1],
        tags: { historic: 'ship', name: 'Судно' },
      },
    ];
    const center = { lat: 0, lon: 0 };
    const region: RegionData = {
      center,
      elements,
      drivingSide: 'right',
      fetchedAt: 'test',
      elevation: { width: 2, size: 5600, values: new Float32Array(4) },
    };
    // Act
    const retained = reduceMapElements(elements, center, 'roads').elements;
    const world = buildWorld({ ...region, elements: retained });
    const chunk = buildChunk(world, '0,0', 0);
    const distant = buildChunk(world, '0,0', 3);
    // Assert
    expect(retained.some((e) => e.id === 10)).toBe(true);
    expect(world.buildings.find((b) => b.id === 10)?.kind).toBe('ship');
    expect(chunk.structures.positions.length).toBeGreaterThan(0);
    expect(distant.structures.indices.length).toBeGreaterThan(0);
    expect(distant.buildings.indices).toEqual([]);
  });

  it('собирает корпус из частей мультиполигона и ждёт недостающую часть', () => {
    // Arrange
    const elements: OSMElement[] = [
      { type: 'node', id: 1, lat: 0, lon: 0 },
      { type: 'node', id: 2, lat: 0, lon: 0.0006 },
      { type: 'node', id: 3, lat: 0.0001, lon: 0.0007 },
      { type: 'node', id: 4, lat: 0.0002, lon: 0.0006 },
      { type: 'node', id: 5, lat: 0.0002, lon: 0 },
      { type: 'way', id: 11, nodes: [1, 2, 3] },
      { type: 'way', id: 12, nodes: [3, 4, 5, 1] },
      {
        type: 'relation',
        id: 42,
        tags: { type: 'multipolygon', building: 'ship', historic: 'ship' },
        members: [
          { type: 'way', ref: 11, role: 'outer' },
          { type: 'way', ref: 12, role: 'outer' },
        ],
      },
    ];
    const region: RegionData = {
      center: { lat: 0, lon: 0 },
      elements,
      drivingSide: 'right',
      fetchedAt: 'test',
      elevation: { width: 2, size: 5600, values: new Float32Array(4) },
    };
    // Act
    const complete = buildWorld(region);
    const partial = buildWorld({
      ...region,
      elements: elements.filter((e) => e.id !== 12),
    });
    // Assert
    expect(complete.buildings.find((b) => b.id === 42)?.kind).toBe('ship');
    expect(
      buildChunk(complete, '0,0', 0).structures.indices.length,
    ).toBeGreaterThan(0);
    expect(partial.buildings.find((b) => b.id === 42)).toBeUndefined();
  });
});
