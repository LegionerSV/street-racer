import { expect, it } from 'vitest';
import { junctionSurfaces } from './junction-surfaces';
import { polygonContains } from './geo';
import type { Edge } from './types';
import { buildWorld } from './network';
import { buildChunk } from './chunks';
import { tileKey } from './geo';
import roads from './fixtures/palace-junction.osm.json';
import type { OSMElement } from './types';

function crossing(): Edge[] {
  const points = [
    { x: 0, y: 0, z: 0 },
    { x: 14, y: 0, z: 0 },
    { x: 14, y: 0, z: 14 },
    { x: 0, y: 0, z: 14 },
  ];
  return points.flatMap((p, i) => {
    const base = {
      id: i,
      stableId: String(i),
      way: i,
      from: i,
      width: 10,
      lanes: 3,
      length: 14,
      speed: 15,
      name: 'Улица',
      bridge: false,
      tunnel: false,
      layer: 0,
      blocked: false,
    };
    return [
      { ...base, to: (i + 1) % 4, points: [p, points[(i + 1) % 4]] },
      {
        ...base,
        id: i + 4,
        way: i + 4,
        to: i + 4,
        length: 100,
        points: [p, { ...p, x: p.x + (i < 2 ? -100 : 100) }],
      },
    ];
  });
}
it('объединяет четыре узла одного пересечения в общую проезжую площадку', () => {
  // Arrange / Act
  const surfaces = junctionSurfaces(crossing());
  // Assert
  expect(surfaces).toHaveLength(1);
  expect(polygonContains({ x: 7, y: 0, z: 7 }, surfaces[0])).toBe(true);
});
it('сохраняет тег кругового движения из источника', () => {
  // Arrange
  const elements: OSMElement[] = [
    { type: 'node', id: 1, lat: 0, lon: 0 },
    { type: 'node', id: 2, lat: 0, lon: 0.001 },
    {
      type: 'way',
      id: 3,
      nodes: [1, 2],
      tags: { highway: 'primary', junction: 'roundabout' },
    },
  ];
  // Act
  const world = buildWorld({
    center: { lat: 0, lon: 0 },
    elements,
    elevation: { width: 2, size: 5600, values: new Float32Array(4) },
    drivingSide: 'right',
    fetchedAt: 'test',
  });
  // Assert
  expect(world.edges.length).toBeGreaterThan(0);
  expect(world.edges.every((e) => e.roundabout)).toBe(true);
});
it.each(['empty', 'partial', 'roundabout', 'grade', 'wide'])(
  'не заполняет самостоятельные или неполные пересечения: %s',
  (state) => {
    // Arrange
    let edges = crossing();
    if (state === 'empty') edges = [];
    if (state === 'partial') edges = edges.filter((e) => e.id !== 0);
    if (state === 'roundabout')
      edges = edges.map((e) => ({ ...e, roundabout: e.id < 4 }));
    if (state === 'grade')
      edges = edges.map((e) => ({
        ...e,
        points: e.points.map((p) => ({ ...p, y: p.x > 0 ? 5 : 0 })),
      }));
    if (state === 'wide')
      edges = edges.map((e) => ({
        ...e,
        length: e.length * 5,
        points: e.points.map((p) => ({ ...p, x: p.x * 5, z: p.z * 5 })),
      }));
    // Act / Assert
    expect(junctionSurfaces(edges)).toEqual([]);
  },
);

it('вырезает тротуарные островки внутри реального пересечения у Дворцового моста', () => {
  // Arrange
  const world = buildWorld({
    center: roads.center,
    elements: roads.elements as OSMElement[],
    elevation: { width: 2, size: 5600, values: new Float32Array(4) },
    drivingSide: 'right',
    fetchedAt: 'test',
  });
  const edges = [237296230, 237296229].map((way) =>
    world.edges.find((e) => e.way === way)!,
  );
  const center = edges
    .flatMap((e) => [e.points[0], e.points.at(-1)!])
    .reduce(
      (sum, p) => ({
        x: sum.x + p.x / 4,
        y: sum.y + p.y / 4,
        z: sum.z + p.z / 4,
      }),
      { x: 0, y: 0, z: 0 },
    );
  // Act
  const surface = junctionSurfaces(world.edges).find((r) =>
    polygonContains(center, r),
  );
  const chunk = buildChunk(world, tileKey(center.x, center.z), 0);
  // Assert
  expect(surface).toBeDefined();
  const mesh = chunk.sidewalks!;
  const intrusions = [];
  for (let i = 0; i < mesh.indices.length; i += 3) {
    const p = mesh.indices.slice(i, i + 3).reduce(
      (p, id) => ({
        x: p.x + mesh.positions[id * 3] / 3,
        y: p.y + mesh.positions[id * 3 + 1] / 3,
        z: p.z + mesh.positions[id * 3 + 2] / 3,
      }),
      { x: 0, y: 0, z: 0 },
    );
    if (polygonContains(p, surface!) && Math.abs(p.y - center.y) < 0.5)
      intrusions.push(p);
  }
  expect(intrusions.length).toBe(0);
  expect(
    chunk.lamps.every((p) =>
      chunk.breakables.some(
        (b) => b.kind === 'pole' && b.point.x === p.x && b.point.z === p.z,
      ),
    ),
  ).toBe(true);
});
