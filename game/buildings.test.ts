import { expect, it } from 'vitest';
import { buildChunk } from './chunks';
import { buildWorld } from './network';
import { facadeStyle } from './buildings';
import type { Building, World } from './types';
const building: Building = {
  id: 1,
  footprint: [
    { x: 30, y: 0, z: 30 },
    { x: 50, y: 0, z: 30 },
    { x: 50, y: 0, z: 60 },
    { x: 30, y: 0, z: 60 },
  ],
  height: 18,
  roof: 'gabled',
  colour: 0.5,
  levels: 5,
  roofHeight: 3,
};
const world = (b = building) =>
  ({
    center: { lat: 0, lon: 0 },
    nodes: [],
    edges: [],
    restrictions: [],
    buildings: [b],
    areas: [],
    trees: [],
    elevation: { width: 2, size: 5600, values: new Float32Array(4) },
    drivingSide: 'right',
    warnings: [],
    spawnEdge: null,
    routes: [],
  }) as World;
it('использует фасадные текстуры вблизи и силуэты вдали без прямоугольника на каждое окно', () => {
  // Arrange / Act
  const near = buildChunk(world(), '0,0', 0),
    far = buildChunk(world(), '0,0', 2);
  // Assert
  expect(near.facades!.some((m) => m.indices.length > 0)).toBe(true);
  for (const mesh of near.facades!)
    expect(mesh.uvs?.length || 0).toBe((mesh.positions.length / 3) * 2);
  expect(near.windows.positions).toHaveLength(0);
  expect(far.facades!.every((m) => !m.indices.length)).toBe(true);
  expect(far.buildings.indices.length).toBeLessThan(
    near.buildings.indices.length +
      near.facades!.reduce((sum, m) => sum + m.indices.length, 0),
  );
});

it('не рисует жилые окна на триумфальной арке и городской стене', () => {
  // Arrange
  const arch = { ...building, kind: 'triumphal_arch', roof: 'flat' };
  const wall = {
    ...building,
    kind: 'yes',
    roof: 'flat',
    osmTags: { historic: 'citywalls' },
  };
  // Act
  const archChunk = buildChunk(world(arch), '0,0', 0);
  const wallChunk = buildChunk(world(wall), '0,0', 0);
  // Assert
  expect(archChunk.facades!.every((mesh) => mesh.indices.length === 0)).toBe(
    true,
  );
  expect(wallChunk.facades!.every((mesh) => mesh.indices.length === 0)).toBe(
    true,
  );
  expect(archChunk.bareFacades!.some((mesh) => mesh.indices.length > 0)).toBe(
    true,
  );
  expect(wallChunk.bareFacades!.some((mesh) => mesh.indices.length > 0)).toBe(
    true,
  );
  expect(
    buildChunk(world(), '0,0', 0).facades!.some(
      (mesh) => mesh.indices.length > 0,
    ),
  ).toBe(true);
});

it('оставляет центральный проём триумфальных ворот открытым без дорожного тега', () => {
  // Arrange
  const gate = {
    ...building,
    kind: 'triumphal_arch',
    roof: 'flat',
    height: 24,
    footprint: [
      { x: 10, y: 0, z: 10 },
      { x: 50, y: 0, z: 10 },
      { x: 50, y: 0, z: 20 },
      { x: 10, y: 0, z: 20 },
    ],
  };
  // Act
  const chunk = buildChunk(world(gate), '0,0', 0);
  const triangles = [chunk.buildings, ...chunk.bareFacades!].flatMap((mesh) =>
    Array.from({ length: mesh.indices.length / 3 }, (_, i) =>
      mesh.indices.slice(i * 3, i * 3 + 3).map((index) => ({
        x: mesh.positions[index * 3],
        y: mesh.positions[index * 3 + 1],
        z: mesh.positions[index * 3 + 2],
      })),
    ),
  );
  const covers = (x: number, y: number) =>
    triangles.some((t) => {
      if (!t.every((p) => Math.abs(p.z - 10) < 0.01)) return false;
      const cross = (a: (typeof t)[number], b: (typeof t)[number]) =>
        (b.x - a.x) * (y - a.y) - (b.y - a.y) * (x - a.x);
      const signs = [cross(t[0], t[1]), cross(t[1], t[2]), cross(t[2], t[0])];
      return signs.every((n) => n >= -1e-6) || signs.every((n) => n <= 1e-6);
    });
  // Assert
  expect(covers(30, 6)).toBe(false);
  expect(covers(30, 19)).toBe(true);
});

it('в закрытом дворе оставляет коробку здания без дворовых фасадов и сохраняет фасад у улицы', () => {
  // Arrange
  const road = {
    id: 0,
    stableId: '9/1/2/0',
    way: 9,
    from: 1,
    to: 2,
    length: 100,
    width: 7,
    lanes: 2,
    speed: 14,
    name: 'Улица',
    category: 'residential',
    bridge: false,
    tunnel: false,
    layer: 0,
    points: [
      { x: 15, y: 0, z: 10 },
      { x: 15, y: 0, z: 110 },
    ],
    blocked: false,
  };

  // Act
  const yard = buildChunk(world(), '0,0', 0, true),
    street = buildChunk({ ...world(), edges: [road] } as World, '0,0', 0, true);

  // Assert
  expect(yard.facades!.every((mesh) => mesh.indices.length === 0)).toBe(true);
  expect(yard.buildings.indices.length).toBeGreaterThan(0);
  expect(street.facades!.some((mesh) => mesh.indices.length > 0)).toBe(true);
  expect(yard.buildings.indices.length).toBeLessThan(
    buildChunk(world(), '0,0', 0).buildings.indices.length,
  );
});
it.each(['gabled', 'hipped', 'pyramidal', 'skillion'])(
  'строит крышу %s в пределах полной высоты здания',
  (roof) => {
    // Arrange / Act
    const chunk = buildChunk(world({ ...building, roof }), '0,0', 0),
      ys = chunk.buildings.positions.filter((_, i) => i % 3 === 1);
    // Assert
    expect(Math.max(...ys)).toBeCloseTo(18, 6);
    const triangles = Array.from(
      { length: chunk.buildings.indices.length / 3 },
      (_, i) =>
        chunk.buildings.indices
          .slice(i * 3, i * 3 + 3)
          .map((j) => chunk.buildings.positions[j * 3 + 1]),
    );
    expect(
      triangles.some(
        (t) => Math.min(...t) >= 15 && Math.max(...t) - Math.min(...t) > 0.5,
      ),
    ).toBe(true);
    expect(chunk.buildings.positions.every(Number.isFinite)).toBe(true);
  },
);
it('сохраняет материал, цвет, этажность и тип здания из OSM', () => {
  // Arrange
  const elements = [
    ...building.footprint.map((p, i) => ({
      type: 'node' as const,
      id: i + 1,
      lat: p.z / 111320,
      lon: p.x / 111320,
    })),
    {
      type: 'way' as const,
      id: 40,
      nodes: [1, 2, 3, 4, 1],
      tags: {
        building: 'apartments',
        'building:material': 'brick',
        'building:colour': '#aabbcc',
        'building:levels': '5',
        'roof:shape': 'hipped',
        'roof:height': '3',
      },
    },
  ];
  // Act
  const b = buildWorld({
    center: { lat: 0, lon: 0 },
    elements,
    elevation: world().elevation,
    drivingSide: 'right',
    fetchedAt: 'test',
  }).buildings[0];
  // Assert
  expect(b).toMatchObject({
    material: 'brick',
    facadeColour: '#aabbcc',
    levels: 5,
    kind: 'apartments',
    roof: 'hipped',
    roofHeight: 3,
    osmType: 'way',
  });
});
it('рисует доски у стилизованного малого дома и сохраняет указанный кирпич', () => {
  // Arrange
  const cottage = {
    ...building,
    height: 6,
    levels: 2,
    appearance: 'cottage' as const,
    roof: 'gabled',
  };
  const brick = { ...cottage, material: 'brick' };
  // Act
  const woodenChunk = buildChunk(world(cottage), '0,0', 0);
  const brickChunk = buildChunk(world(brick), '0,0', 0);
  // Assert
  expect(facadeStyle(cottage)).toBe(3);
  expect(woodenChunk.facades![3].indices.length).toBeGreaterThan(0);
  expect(facadeStyle(brick)).toBe(0);
  expect(brickChunk.facades![0].indices.length).toBeGreaterThan(0);
  expect(facadeStyle({ ...cottage, colour: 0.9 })).toBe(1);
});

it.each([
  ['brick', '#aabbcc', 0],
  ['stone', '#bd7d58', 1],
  ['glass', '#6598c4', 2],
] as const)(
  'сохраняет цвет %s и материал из OSM в геометрии фасада',
  (material, facadeColour, style) => {
    // Arrange
    const elements = [
      ...building.footprint.map((p, i) => ({
        type: 'node' as const,
        id: i + 1,
        lat: p.z / 111320,
        lon: p.x / 111320,
      })),
      {
        type: 'way' as const,
        id: 40,
        nodes: [1, 2, 3, 4, 1],
        tags: {
          building: 'yes',
          height: '18',
          'building:material': material,
          'building:colour': facadeColour,
          'roof:colour': '#224466',
        },
      },
    ];
    const generated = buildWorld({
      center: { lat: 0, lon: 0 },
      elements,
      elevation: world().elevation,
      drivingSide: 'right',
      fetchedAt: 'test',
    });

    // Act
    const chunk = buildChunk(generated, '0,0', 0),
      facade = chunk.facades![style];
    const colours = (mesh: { colors?: number[] }) =>
      Array.from({ length: (mesh.colors?.length ?? 0) / 4 }, (_, index) =>
        mesh.colors!.slice(index * 4, index * 4 + 3),
      );
    const expected = [1, 3, 5].map(
      (index) => parseInt(facadeColour.slice(index, index + 2), 16) / 255,
    );

    // Assert
    expect(facadeStyle(generated.buildings[0])).toBe(style);
    expect(facade.indices.length).toBeGreaterThan(0);
    expect(colours(facade)).toContainEqual(expected);
    expect(colours(chunk.buildings)).toContainEqual([
      34 / 255,
      68 / 255,
      102 / 255,
    ]);
  },
);
