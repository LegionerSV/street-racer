import { expect, it } from 'vitest';
import { buildWorld } from './network';
import { crossingClearance, roadCrossings } from './clearance';
import type { Edge, OSMElement, RegionData } from './types';
import birzhevaya from './fixtures/birzhevaya-roads.osm.json';
import dem from './fixtures/birzhevaya-elevation.json';

it('не объединяет короткие мосты, расположенные последовательно без общего пролёта', () => {
  // Arrange — близкие торцы и общее имя ещё не означают встречные полотна.
  const edge = (
    id: number,
    from: number,
    to: number,
    coordinates: number[][],
    bridge: boolean,
  ): Edge => ({
    id,
    way: id,
    from,
    to,
    points: coordinates.map(([x, z]) => ({ x, y: 0, z })),
    length: 10,
    width: 12,
    lanes: 2,
    speed: 10,
    name: 'Мост',
    bridge,
    tunnel: false,
    layer: bridge ? 1 : 0,
    blocked: false,
  });
  const edges = [
    edge(
      10,
      1,
      2,
      [
        [0, 0],
        [10, 0],
      ],
      true,
    ),
    edge(
      11,
      3,
      4,
      [
        [12, 6],
        [22, 6],
      ],
      true,
    ),
    edge(
      12,
      3,
      5,
      [
        [12, 6],
        [12, -100],
      ],
      false,
    ),
  ];
  // Act
  const contacts = roadCrossings(edges);
  // Assert — пересечение первого моста с дорогой под ним требует просвета.
  expect(
    contacts.some((c) => c.upper.edge.way === 10 && c.lower.edge.way === 12),
  ).toBe(true);
});

it('открывает реальные встречные проезжие части Биржевого и Дворцового мостов', () => {
  // Arrange
  const data: RegionData = {
    center: birzhevaya.center,
    elements: birzhevaya.elements as OSMElement[],
    elevation: { width: 2, size: 5600, values: new Float32Array(4) },
    drivingSide: 'right',
    fetchedAt: 'test',
  };
  // Act
  const world = buildWorld(data);
  const bridges = world.edges.filter((e) =>
    [362785969, 362785970, 362796524, 362796525].includes(e.way),
  );
  // Assert — плоский DEM изолирует ошибку топологии от ошибок исходных высот.
  expect(new Set(bridges.map((e) => e.way)).size).toBe(4);
  expect(bridges.every((e) => !e.blocked)).toBe(true);
  expect(world.warnings.filter((w) => w.includes('просвет'))).toEqual([]);
  for (const e of bridges) {
    expect(e.points[0].y).toBeCloseTo(0.12, 6);
    expect(e.points.at(-1)!.y).toBeCloseTo(0.12, 6);
  }
});

it.each([false, true])(
  'оставляет реальные мосты открытыми на исходном DEM, обратный порядок OSM: %s',
  (reverse) => {
    // Arrange
    const elements = birzhevaya.elements as OSMElement[];
    // Act
    const world = buildWorld({
      center: birzhevaya.center,
      elements: reverse ? [...elements].reverse() : elements,
      elevation: { ...dem, values: Float32Array.from(dem.values) },
      drivingSide: 'right',
      fetchedAt: 'test',
    });
    const bridges = world.edges.filter((e) =>
      [362785969, 362785970, 362796524, 362796525].includes(e.way),
    );
    // Assert
    expect(new Set(bridges.map((e) => e.way)).size).toBe(4);
    expect(
      bridges
        .filter((e) => e.blocked)
        .map((e) => ({
          way: e.way,
          reasons: e.blockedReasons,
          issue: e.clearanceIssue,
        })),
    ).toEqual([]);
    expect(world.warnings.filter((w) => w.includes('просвет'))).toEqual([]);
  },
);

it('совместно поднимает встречные полотна над настоящей дорогой под мостом', () => {
  // Arrange
  const coordinates = [
    [-450, 0],
    [-150, 0],
    [150, 0],
    [450, 0],
    [-450, 12],
    [-150, 12],
    [150, 12],
    [450, 12],
    [-130, -100],
    [-130, 100],
  ];
  const elements: OSMElement[] = coordinates.map(([x, z], i) => ({
    type: 'node',
    id: i + 1,
    lat: z / 111320,
    lon: x / 111320,
  }));
  for (const [id, nodes, bridge] of [
    [10, [2, 3], true],
    [11, [6, 7], true],
    [12, [1, 2], false],
    [13, [3, 4], false],
    [14, [5, 6], false],
    [15, [7, 8], false],
    [16, [9, 10], false],
  ] as [number, number[], boolean][])
    elements.push({
      type: 'way',
      id,
      nodes,
      tags: {
        highway: 'primary',
        width: '12',
        name: bridge ? 'Тестовый мост' : 'Набережная',
        ...(bridge ? { bridge: 'yes', layer: '1' } : {}),
      },
    });
  // Act
  const world = buildWorld({
    center: { lat: 0, lon: 0 },
    elements,
    elevation: { width: 2, size: 5600, values: new Float32Array(4) },
    drivingSide: 'right',
    fetchedAt: 'test',
  });
  const contacts = roadCrossings(world.edges).filter(
    (c) => c.lower.edge.way === 16,
  );
  // Assert
  expect(new Set(contacts.map((c) => c.upper.edge.way))).toEqual(
    new Set([10, 11]),
  );
  expect(contacts.every((c) => crossingClearance(c) >= 3.5)).toBe(true);
  expect(world.edges.every((e) => !e.blocked)).toBe(true);
  expect(world.edges.find((e) => e.way === 10)!.points.map((p) => p.y)).toEqual(
    world.edges.find((e) => e.way === 11)!.points.map((p) => p.y),
  );
});

it.each([false, true])(
  'не принимает поворот сразу за коротким подходом к мосту за дорогу под мостом, обратный порядок: %s',
  (reverse) => {
    // Arrange — OSM разбивает примыкание на короткий соединитель и отдельный поворот.
    const coordinates = [
      [-100, 0],
      [0, 0],
      [3, 0],
      [3, 100],
    ];
    const elements: OSMElement[] = coordinates.map(([x, z], i) => ({
      type: 'node',
      id: i + 1,
      lat: z / 111320,
      lon: x / 111320,
    }));
    elements.push(
      {
        type: 'way',
        id: 10,
        nodes: [1, 2],
        tags: {
          highway: 'residential',
          bridge: 'yes',
          layer: '1',
          width: '12',
        },
      },
      {
        type: 'way',
        id: 11,
        nodes: [2, 3],
        tags: { highway: 'residential', width: '12' },
      },
      {
        type: 'way',
        id: 12,
        nodes: [3, 4],
        tags: { highway: 'residential', width: '12' },
      },
    );
    const data: RegionData = {
      center: { lat: 0, lon: 0 },
      elements,
      elevation: { width: 2, size: 5600, values: new Float32Array(4) },
      drivingSide: 'right',
      fetchedAt: 'test',
    };
    // Act
    const world = buildWorld({
      ...data,
      elements: reverse ? [...elements].reverse() : elements,
    });
    // Assert
    expect(world.edges.filter((e) => e.bridge).every((e) => !e.blocked)).toBe(
      true,
    );
    expect(world.warnings.some((w) => w.includes('просвет'))).toBe(false);
    expect(
      Math.max(...world.edges.flatMap((e) => e.points.map((p) => p.y))),
    ).toBeLessThan(3);
  },
);
it('сохраняет проверку настоящего проезда под мостом, соединённого с ним через съезд', () => {
  // Arrange — съезд сначала отходит от моста, затем возвращается под середину пролёта.
  const coordinates = [
    [-100, 0],
    [0, 0],
    [3, 0],
    [3, 100],
    [-50, 100],
    [-50, -100],
  ];
  const elements: OSMElement[] = coordinates.map(([x, z], i) => ({
    type: 'node',
    id: i + 1,
    lat: z / 111320,
    lon: x / 111320,
  }));
  elements.push(
    {
      type: 'way',
      id: 10,
      nodes: [1, 2],
      tags: { highway: 'residential', bridge: 'yes', layer: '1', width: '12' },
    },
    {
      type: 'way',
      id: 11,
      nodes: [2, 3],
      tags: { highway: 'residential', width: '12' },
    },
    {
      type: 'way',
      id: 12,
      nodes: [3, 4, 5, 6],
      tags: { highway: 'residential', width: '12' },
    },
  );
  // Act
  const world = buildWorld({
    center: { lat: 0, lon: 0 },
    elements,
    elevation: { width: 2, size: 5600, values: new Float32Array(4) },
    drivingSide: 'right',
    fetchedAt: 'test',
  });
  const crossings = roadCrossings(world.edges).filter(
    (c) =>
      [5, 6].includes(c.lower.edge.from) && [5, 6].includes(c.lower.edge.to),
  );
  // Assert
  expect(crossings.length).toBeGreaterThan(0);
  expect(crossings.every((c) => crossingClearance(c) >= 3.5)).toBe(true);
  expect(world.edges.filter((e) => e.bridge).every((e) => !e.blocked)).toBe(
    true,
  );
});
