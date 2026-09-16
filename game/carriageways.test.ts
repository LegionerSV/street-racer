import { expect, it } from 'vitest';
import { buildWorld } from './network';
import { buildChunk, indexWorld } from './chunks';
import { laneCaption } from './lanes';
import { projectOnSegment } from './geo';
import {
  alignCarriagewayElevations,
  alignGroundIntersections,
} from './carriageways';
import { reconcileWorld } from './world-update';
import type { Edge, RegionData } from './types';

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
it('согласует подгруженное встречное направление с сохранённой дорогой', () => {
  // Arrange — соседнего направления ещё не было в исходном окне данных.
  const region = input(3, 18);
  region.elements.at(-1)!.tags!.lanes = '3';
  region.elevation = {
    width: 61,
    size: 1200,
    values: Float32Array.from(
      { length: 61 * 61 },
      (_, i) => (Math.floor(i / 61) * 20 - 600) * 0.18,
    ),
  };
  const previous = buildWorld({
    ...region,
    elements: region.elements.filter((e) => e.type !== 'way' || e.id === 10),
  });
  const before = structuredClone(previous.edges.map((e) => e.points));
  // Act
  const next = reconcileWorld(
    previous,
    buildWorld({ ...region, heightDatum: previous.heightDatum }),
  );
  // Assert — старое полотно неподвижно, новое согласовано с ним по всей ширине улицы.
  expect(previous.edges.map((e) => e.points)).toEqual(before);
  expect(next.edges.filter((e) => e.way === 10).map((e) => e.points)).toEqual(
    before,
  );
  const heights = next.edges.flatMap((e) => e.points.map((p) => p.y));
  expect(Math.max(...heights) - Math.min(...heights)).toBeLessThan(0.05);
});
it.each(['right', 'left'] as const)(
  'согласует высоты встречных направлений, сохраняя продольный склон: %s',
  (side) => {
    // Arrange — поперечный перепад DEM 3,2 м, разные узлы встречных направлений.
    const region = input(3, 18);
    region.drivingSide = side;
    region.elements.at(-1)!.tags!.lanes = '3';
    region.elevation = {
      width: 61,
      size: 1200,
      values: Float32Array.from(
        { length: 61 * 61 },
        (_, i) =>
          ((i % 61) * 20 - 600) * 0.02 + (Math.floor(i / 61) * 20 - 600) * 0.18,
      ),
    };
    region.elements.push({
      type: 'node',
      id: 5,
      lon: 123.17 / 111320,
      lat: 91 / 111320,
    });
    region.elements.find((e) => e.id === 10)!.nodes = [1, 5, 2];
    if (side === 'left')
      for (const e of region.elements) if (e.type === 'way') e.nodes!.reverse();
    // Act
    const world = buildWorld(region);
    // Assert — проверяем профиль, а не только совпадение концов или видимость меша.
    const other = world.edges.filter((e) => e.way === 20);
    for (const edge of world.edges.filter((e) => e.way === 10))
      for (const p of edge.points) {
        const q = other
          .flatMap((e) =>
            e.points
              .slice(1)
              .map((b, i) => projectOnSegment(p, e.points[i], b)),
          )
          .sort((a, b) => a.distance - b.distance)[0];
        expect(Math.abs(p.y - q.point.y)).toBeLessThan(0.05);
      }
    const heights = world.edges
      .filter((e) => e.way === 10)
      .flatMap((e) => e.points.map((p) => p.y));
    expect(Math.max(...heights) - Math.min(...heights)).toBeGreaterThan(3.5);
  },
);

it('согласует высоты геометрически пересекающихся наземных дорог без общего OSM-узла', () => {
  // Arrange
  const edge = (id: number, way: number, points: Edge['points']): Edge => ({
    id,
    stableId: `${way}/1/2/0`,
    way,
    from: way * 10,
    to: way * 10 + 1,
    length: 40,
    width: 7,
    lanes: 2,
    speed: 14,
    name: 'Улица',
    bridge: false,
    tunnel: false,
    layer: 0,
    blocked: false,
    points,
  });
  const horizontal = edge(0, 1, [
    { x: -30, y: 0, z: 0 },
    { x: 0, y: 0, z: 0 },
    { x: 30, y: 0, z: 0 },
  ]);
  const vertical = edge(1, 2, [
    { x: 0, y: 2, z: -30 },
    { x: 0, y: 2, z: 0 },
    { x: 0, y: 2, z: 30 },
  ]);
  // Act
  alignGroundIntersections([horizontal, vertical]);
  // Assert
  expect(
    Math.abs(horizontal.points[1].y - vertical.points[1].y),
  ).toBeLessThanOrEqual(0.15);
  expect(horizontal.points[0].y).toBeCloseTo(0, 6);
  expect(vertical.points[0].y).toBeCloseTo(2, 6);
});
it('не создаёт ступень на цепочке коротких боковых примыканий', () => {
  // Arrange
  const region = input(3, 18);
  region.elements.at(-1)!.tags!.lanes = '3';
  region.elevation = {
    width: 2,
    size: 5600,
    values: Float32Array.from([-280, -280, 280, 280]),
  };
  region.elements.push(
    { type: 'node', id: 6, lon: 20 / 111320, lat: 86 / 111320 },
    { type: 'node', id: 7, lon: 20 / 111320, lat: 81 / 111320 },
    { type: 'way', id: 30, nodes: [1, 6, 7], tags: { highway: 'service' } },
  );
  // Act
  const world = buildWorld(region);
  // Assert — все рёбра одного узла совпадают, независимо от направления.
  for (const id of [1, 6, 7]) {
    const points = world.edges.flatMap((e) =>
      [
        e.from === id ? e.points[0] : null,
        e.to === id ? e.points.at(-1)! : null,
      ].filter((p) => p !== null),
    );
    expect(
      Math.max(...points.map((p) => p.y)) - Math.min(...points.map((p) => p.y)),
    ).toBeLessThan(1e-6);
  }
});
it('согласует плавно расходящиеся направления, а не только строго параллельные оси', () => {
  // Arrange — угол около 3°, продольный сдвиг обычной проекции превышает 25 см.
  const region = input(3, 12);
  region.elements.at(-1)!.tags!.lanes = '3';
  region.elements.find((e) => e.type === 'node' && e.id === 3)!.lat =
    116 / 111320;
  region.elevation = {
    width: 2,
    size: 5600,
    values: Float32Array.from([-280, -280, 280, 280]),
  };
  // Act
  const world = buildWorld(region),
    a = world.edges.find((e) => e.way === 10)!,
    b = world.edges.find((e) => e.way === 20)!;
  // Assert — общие поперечные сечения по x, без зависимости от исходного DEM-перепада.
  for (const p of a.points.slice(2, -2)) {
    const segment = b.points
      .slice(1)
      .map((q, i) => [b.points[i], q])
      .find(([u, v]) => p.x <= u.x && p.x >= v.x)!;
    const [u, v] = segment,
      t = (p.x - u.x) / (v.x - u.x),
      height = u.y + (v.y - u.y) * t;
    expect(
      Math.abs(p.y - height),
      `x=${p.x}, первая=${p.y}, встречная=${height}`,
    ).toBeLessThan(0.05);
  }
});
it.each([
  'разное имя',
  'разный слой',
  'мост',
  'тоннель',
  'проезд в здании',
  'съезд',
  'попутные',
  'далёкие',
])('сохраняет самостоятельную высоту проездов: %s', (kind) => {
  // Arrange — различные уровни заданы в геометрии явно.
  const world = buildWorld(input()),
    other = world.edges.find((e) => e.way === 20)!;
  other.points = other.points.map((p) => ({ ...p, y: p.y + 3 }));
  if (kind === 'разное имя') other.name = 'Другая улица';
  if (kind === 'разный слой') other.layer = 1;
  if (kind === 'мост') other.bridge = true;
  if (kind === 'тоннель') other.tunnel = true;
  if (kind === 'проезд в здании') other.passage = true;
  if (kind === 'съезд') other.category = 'primary_link';
  if (kind === 'попутные') other.points.reverse();
  if (kind === 'далёкие')
    other.points = other.points.map((p) => ({ ...p, z: p.z + 50 }));
  const before = structuredClone(world.edges.map((e) => e.points));
  // Act
  alignCarriagewayElevations(
    world.edges,
    new Map(world.nodes.map((n) => [n.id, n])),
    world.elevation,
    'right',
  );
  // Assert
  expect(world.edges.map((e) => e.points)).toEqual(before);
});
it('не создаёт горб на поперечном проезде с промежуточным узлом между встречными направлениями', () => {
  // Arrange — оба конца должны стать одной высоты; поправки DEM противоположны.
  const region = input(3, 18);
  region.elements.at(-1)!.tags!.lanes = '3';
  region.elevation = {
    width: 61,
    size: 1200,
    values: Float32Array.from(
      { length: 61 * 61 },
      (_, i) => (Math.floor(i / 61) * 20 - 600) * 0.4,
    ),
  };
  region.elements.push(
    { type: 'node', id: 8, lon: 20 / 111320, lat: 100 / 111320 },
    { type: 'way', id: 30, nodes: [1, 8, 4], tags: { highway: 'service' } },
  );
  // Act
  const world = buildWorld(region),
    cross = world.edges.filter((e) => e.way === 30);
  // Assert
  const heights = cross.flatMap((e) => e.points.map((p) => p.y));
  expect(Math.max(...heights) - Math.min(...heights)).toBeLessThan(0.05);
  expect(cross.every((e) => !e.blocked)).toBe(true);
});
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
