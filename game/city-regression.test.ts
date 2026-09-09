import { expect, it } from 'vitest';
import { buildWorld } from './network';
import { buildChunk } from './chunks';
import type { OSMElement, MeshData } from './types';
function passageWorld(passage = true) {
  const nodes = [
    [1, 0, 50],
    [2, 160, 50],
    [3, 20, 20],
    [4, 120, 20],
    [5, 120, 90],
    [6, 20, 90],
  ].map(([id, x, z]) => ({
    type: 'node' as const,
    id,
    lon: x / 111320,
    lat: z / 111320,
  }));
  const elements: OSMElement[] = [
    ...nodes,
    {
      type: 'way',
      id: 10,
      nodes: [1, 2],
      tags: {
        highway: 'service',
        width: '7',
        ...(passage ? { tunnel: 'building_passage' } : {}),
      },
    },
    {
      type: 'way',
      id: 20,
      nodes: [3, 4, 5, 6, 3],
      tags: { building: 'apartments', height: '18' },
    },
  ];
  return buildWorld({
    center: { lat: 0, lon: 0 },
    elements,
    elevation: { width: 2, size: 5600, values: new Float32Array(4) },
    fetchedAt: 'test',
    drivingSide: 'right',
  });
}
const triangles = (mesh: MeshData) =>
  Array.from({ length: mesh.indices.length / 3 }, (_, i) =>
    mesh.indices
      .slice(i * 3, i * 3 + 3)
      .map((j) => ({
        x: mesh.positions[j * 3],
        y: mesh.positions[j * 3 + 1],
        z: mesh.positions[j * 3 + 2],
      })),
  );
it.each([true, false])(
  'сохраняет дом с локальным проездом вместо подъёма или удаления всего дома: %s',
  (passage) => {
    // Arrange / Act
    const world = passageWorld(passage),
      chunk = buildChunk(world, '0,0', 0),
      walls = chunk.facades!.flatMap(triangles);
    // Assert
    expect(world.buildings).toHaveLength(1);
    expect(world.buildings[0].minHeight).toBe(0);
    expect(
      walls.some((t) => t.some((p) => p.y < 0.1 && Math.abs(p.z - 20) < 0.1)),
    ).toBe(true);
    for (const t of walls) {
      const c = {
        x: t.reduce((n, p) => n + p.x, 0) / 3,
        y: t.reduce((n, p) => n + p.y, 0) / 3,
        z: t.reduce((n, p) => n + p.z, 0) / 3,
      };
      if (Math.abs(c.z - 50) < 3.5) expect(c.y).toBeGreaterThan(4.5);
    }
  },
);
it.each([0,1,2])('строит непрозрачные боковые стены внутри проезда сквозь дом на LOD %s', (lod) => {
  // Arrange
  const world = passageWorld(true);
  // Act
  const structures = buildChunk(world, '0,0', lod).structures;
  const walls = triangles(structures);
  // Assert
  expect(walls.some(t => t.every(p => Math.abs(Math.abs(p.z - 50) - 3.8) < .01) && t.some(p => p.y > 5))).toBe(true);
});
it('заземляет фасад на изменённом рельефе рядом с дорогой', () => {
  // Arrange
  const world = passageWorld();
  world.buildings[0].footprint = world.buildings[0].footprint.map((p) => ({
    ...p,
    y: 8,
  }));
  // Act
  const chunk = buildChunk(world, '0,0', 0),
    ys = chunk.facades!.flatMap((m) =>
      m.positions.filter((_, i) => i % 3 === 1),
    );
  // Assert
  expect(Math.min(...ys)).toBeLessThan(0);
});
it('совпадающие тротуары оставляют одну поверхность на одном уровне', () => {
  // Arrange — между дорогами 1,5 м перекрытия тротуаров.
  const world = passageWorld();
  world.buildings = [];
  const base = {
    ...world.edges[0],
    sidewalkLeft: true,
    sidewalkRight: true,
    bridge: false,
    tunnel: false,
    from: 1,
    to: 2,
    width: 7,
    points: [
      { x: 100, y: 0, z: 20 },
      { x: 100, y: 0, z: 120 },
    ],
  };
  world.edges = [
    base,
    {
      ...base,
      id: 1,
      way: 11,
      from: 3,
      to: 4,
      points: base.points.map((p) => ({ ...p, x: 110 })),
    },
  ];
  // Act
  const mesh = buildChunk(world, '0,0', 0).sidewalks!,
    area = triangles(mesh)
      .filter((t) => t.every((p) => Math.abs(p.y - 0.15) < 1e-6))
      .reduce(
        (n, [a, b, c]) =>
          n +
          Math.abs((b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x)) / 2,
        0,
      );
  // Assert — 4 полосы по 2,2 м, перекрытие 1,4 м, длина 100 м.
  expect(area).toBeCloseTo((4 * 2.2 - 1.4) * 100, 4);
});
it.each([0, 6])(
  'сшивает тротуары соседних кварталов только на одном уровне: перепад %s м',
  (height) => {
    // Arrange
    const world = passageWorld();
    world.buildings = [];
    const base = {
      ...world.edges[0],
      sidewalkLeft: true,
      sidewalkRight: true,
      from: 1,
      to: 2,
      width: 7,
      points: [
        { x: 247, y: 0, z: 20 },
        { x: 247, y: 0, z: 120 },
      ],
    };
    world.edges = [
      base,
      {
        ...base,
        id: 1,
        way: 11,
        from: 3,
        to: 4,
        bridge: height > 0,
        points: base.points.map((p) => ({ ...p, x: 257, y: height })),
      },
    ];
    // Act — другой порядок загрузки и разные LOD не влияют на владельца перекрытия.
    const meshes = [
      buildChunk(world, '1,0', 1),
      buildChunk(world, '0,0', 0),
    ].map((c) => c.sidewalks!);
    const area = meshes
      .flatMap(triangles)
      .filter((t) => t.every((p) => Math.abs(p.y - t[0].y) < 1e-6))
      .reduce(
        (n, [a, b, c]) =>
          n +
          Math.abs((b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x)) / 2,
        0,
      );
    // Assert
    expect(area).toBeCloseTo((4 * 2.2 - (height ? 0 : 1.4)) * 100, 4);
  },
);
it('учитывает рельеф у дальнего края дома за границей его квартала', () => {
  // Arrange
  const world = passageWorld();
  world.elevation.values.fill(8);
  world.edges[0].points = [
    { x: 370, y: 0, z: 0 },
    { x: 370, y: 0, z: 180 },
  ];
  world.buildings[0].footprint = [
    { x: 20, y: 8, z: 30 },
    { x: 390, y: 8, z: 30 },
    { x: 390, y: 8, z: 130 },
    { x: 20, y: 8, z: 130 },
  ];
  // Act
  const chunk = buildChunk(world, '0,0', 0),
    ys = chunk.facades!.flatMap((m) =>
      m.positions.filter((_, i) => i % 3 === 1),
    );
  // Assert — фундамент остаётся ниже земли, мягко подогнанной к дороге.
  expect(Math.min(...ys)).toBeCloseTo(-0.6, 6);
});
it('надземная часть здания не удаляет нижние этажи общей оболочки', () => {
  // Arrange
  const world = passageWorld(),
    b = world.buildings[0],
    nodes = b.footprint.map((p, i) => ({
      type: 'node' as const,
      id: i + 1,
      lon: p.x / 111320,
      lat: p.z / 111320,
    }));
  const elements: OSMElement[] = [
    ...nodes,
    {
      type: 'way',
      id: 10,
      nodes: [1, 2, 3, 4, 1],
      tags: { building: 'apartments', height: '18' },
    },
    {
      type: 'way',
      id: 20,
      nodes: [1, 2, 3, 4, 1],
      tags: { 'building:part': 'yes', min_height: '6', height: '18' },
    },
  ];
  // Act
  const result = buildWorld({
    center: world.center,
    elements,
    elevation: world.elevation,
    fetchedAt: 'test',
    drivingSide: 'right',
  });
  // Assert
  expect(result.buildings.map((b) => b.id)).toEqual([10, 20]);
});
it.each([false, true])(
  'части здания удаляют общую оболочку только при полном покрытии: %s',
  (complete) => {
    // Arrange — две перекрывающиеся части нельзя считать как сумму их площадей.
    const elements: OSMElement[] = [];
    let node = 1;
    for (const [id, x0, x1, part] of [
      [10, 20, 120, 0],
      [20, 20, 100, 1],
      [30, 80, complete ? 120 : 100, 1],
    ]) {
      const ids: number[] = [];
      for (const [x, z] of [
        [x0, 20],
        [x1, 20],
        [x1, 90],
        [x0, 90],
      ]) {
        ids.push(node);
        elements.push({
          type: 'node',
          id: node++,
          lon: x / 111320,
          lat: z / 111320,
        });
      }
      elements.push({
        type: 'way',
        id,
        nodes: [...ids, ids[0]],
        tags: part
          ? { 'building:part': 'yes', height: '18' }
          : { building: 'apartments', height: '18' },
      });
    }
    // Act
    const world = buildWorld({
      center: { lat: 0, lon: 0 },
      elements,
      elevation: { width: 2, size: 5600, values: new Float32Array(4) },
      fetchedAt: 'test',
      drivingSide: 'right',
    });
    // Assert
    expect(world.buildings.some((b) => b.id === 10)).toBe(!complete);
  },
);
