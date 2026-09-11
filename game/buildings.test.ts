import { expect, it } from 'vitest';
import { buildChunk } from './chunks';
import { buildWorld } from './network';
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
