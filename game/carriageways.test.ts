import { expect, it } from 'vitest';
import { buildWorld } from './network';
import { buildChunk, indexWorld } from './chunks';
import { laneCaption } from './lanes';
import type { RegionData } from './types';

function input(lanes = 2, separation = 7.8): RegionData {
  return {
    center: { lat: 0, lon: 0 },
    fetchedAt: 'test',
    drivingSide: 'right',
    elevation: { width: 2, size: 5600, values: new Float32Array(4) },
    elements: [
      ...[
        [20, 100 - separation / 2],
        [220, 100 - separation / 2],
        [220, 100 + separation / 2],
        [20, 100 + separation / 2],
      ].map(([x, z], i) => ({
        type: 'node' as const,
        id: i + 1,
        lat: z / 111320,
        lon: x / 111320,
      })),
      {
        type: 'way',
        id: 10,
        nodes: [1, 2],
        tags: {
          highway: 'primary',
          name: 'Проспект',
          oneway: 'yes',
          lanes: String(lanes),
        },
      },
      {
        type: 'way',
        id: 20,
        nodes: [3, 4],
        tags: {
          highway: 'primary',
          name: 'Проспект',
          oneway: 'yes',
          lanes: '2',
        },
      },
    ],
  };
}
it.each([
  [2, 7.8, 4],
  [3, 9.5, 5],
  [2, 6, 4],
])(
  'объединяет %s+2 полосы общим полотном и только внешними тротуарами',
  (lanes, separation, total) => {
    // Arrange
    const world = buildWorld(input(lanes, separation));
    const original = world.edges.map((e) => ({
      from: e.from,
      to: e.to,
      offsets: [...e.laneProfile!.offsets],
    }));
    // Act
    const index = indexWorld(world),
      chunk = buildChunk(world, '0,0', 0);
    // Assert
    expect([...index.owned.values()].flat().every((s) => !!s.join)).toBe(true);
    expect(laneCaption(world.edges[0])).toBe(
      `${total} ${total === 4 ? 'полосы' : 'полос'} · ${lanes} в вашем направлении`,
    );
    expect(
      world.edges.map((e) => ({
        from: e.from,
        to: e.to,
        offsets: e.laneProfile!.offsets,
      })),
    ).toEqual(original);
    const innerZ = 100 + (lanes - 2) * 0.85;
    for (let i = 0; i < chunk.sidewalks!.positions.length; i += 3)
      expect(
        Math.abs(chunk.sidewalks!.positions[i + 2] - innerZ),
      ).toBeGreaterThan(3);
    expect(
      chunk.road.positions.some(
        (v, i) => i % 3 === 2 && Math.abs(v - innerZ) < 1,
      ),
    ).toBe(true);
    for (let i = 0; i < chunk.road.indices.length; i += 3) {
      const [a, b, c] = chunk.road.indices
        .slice(i, i + 3)
        .map((n) => chunk.road.positions.slice(n * 3, n * 3 + 3));
      const normalY =
        (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]);
      expect(normalY).toBeGreaterThanOrEqual(-1e-6);
    }
    // В середине объединения ровно один верхний асфальт, без наложенных полос.
    const px = 123.17,
      pz = innerZ + 0.123;
    let hits = 0;
    for (let i = 0; i < chunk.road.indices.length; i += 3) {
      const [a, b, c] = chunk.road.indices
        .slice(i, i + 3)
        .map((n) => chunk.road.positions.slice(n * 3, n * 3 + 3));
      if ([a, b, c].some((p) => Math.abs(p[1] - 0.12) > 0.001)) continue;
      const cross = (u: number[], v: number[]) =>
        (v[0] - u[0]) * (pz - u[2]) - (v[2] - u[2]) * (px - u[0]);
      const signs = [cross(a, b), cross(b, c), cross(c, a)];
      if (signs.every((v) => v >= 0) || signs.every((v) => v <= 0)) hits++;
    }
    expect(hits).toBe(1);
  },
);
it.each([
  'разные улицы',
  'разные уровни',
  'попутные',
  'широкая разделительная',
  'тоннель',
])('не объединяет: %s', (kind) => {
  // Arrange
  const region = input(2, kind === 'широкая разделительная' ? 15 : 7.8);
  const way = region.elements.at(-1)!;
  if (kind === 'разные улицы') way.tags!.name = 'Другая улица';
  if (kind === 'разные уровни') way.tags!.layer = '1';
  if (kind === 'попутные') way.nodes!.reverse();
  if (kind === 'тоннель') way.tags!.tunnel = 'yes';
  // Act
  const index = indexWorld(buildWorld(region));
  // Assert
  expect([...index.owned.values()].flat().some((s) => s.join)).toBe(false);
});
it.each(['right', 'left'] as const)(
  'сохраняет объединение при разной разбивке встречных дорог на узлы: %s',
  (side) => {
    // Arrange
    const region = input();
    region.drivingSide = side;
    const first = region.elements.find((e) => e.type === 'way' && e.id === 10)!;
    region.elements.push({
      type: 'node',
      id: 5,
      lon: 123.17 / 111320,
      lat: 96.1 / 111320,
    });
    first.nodes = [1, 5, 2];
    if (side === 'left')
      for (const e of region.elements) if (e.type === 'way') e.nodes!.reverse();
    // Act
    const world = buildWorld(region),
      segments = [...indexWorld(world).owned.values()].flat();
    // Assert
    expect(segments.every((s) => !!s.join)).toBe(true);
    expect(world.edges.every((e) => e.combinedLanes === 4)).toBe(true);
  },
);
