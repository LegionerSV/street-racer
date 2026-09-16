import { describe, it, expect } from 'vitest';
import {
  buildWorld,
  outgoing,
  allowedTurn,
  createRoutes,
  advanceTurnHistory,
} from './network';
import type { RegionData, OSMElement } from './types';
import { edgeById, edgeStableId } from './road-graph';

const node = (
  id: number,
  lon: number,
  lat: number,
  signal = false,
): OSMElement => ({
  type: 'node',
  id,
  lon,
  lat,
  tags: signal ? { highway: 'traffic_signals' } : {},
});
const road = (id: number, nodes: number[], tags = {}): OSMElement => ({
  type: 'way',
  id,
  nodes,
  tags: { highway: 'residential', ...tags },
});
const region = (elements: OSMElement[]): RegionData => ({
  center: { lat: 0, lon: 0 },
  elements,
  elevation: { size: 5600, width: 2, values: new Float32Array(4) },
  fetchedAt: '2026-09-05',
  drivingSide: 'right',
});

describe('Дорожная сеть', () => {
  it('оставляет здания без указанной высоты низкими и сохраняет явные этажи', () => {
    // Arrange
    const elements: OSMElement[] = [];
    for (const [id, lon, tags] of [
      [10, 0, { building: 'yes' }],
      [20, 0.002, { building: 'detached' }],
      [30, 0.004, { building: 'bungalow' }],
      [40, 0.006, { building: 'yes', 'building:levels': '5' }],
      [50, 0.008, { building: 'yes', height: '18' }],
      [60, 0.01, { building: 'apartments' }],
      [70, 0.012, { building: 'semidetached_house' }],
      [80, 0.014, { building: 'shed' }],
    ] as const) {
      const ids = [1, 2, 3, 4].map((n) => id + n);
      [
        [lon, 0],
        [lon + 0.001, 0],
        [lon + 0.001, 0.001],
        [lon, 0.001],
      ].forEach(([x, y], i) => elements.push(node(ids[i], x, y)));
      elements.push({ type: 'way', id, nodes: [...ids, ids[0]], tags });
    }
    // Act
    const buildings = buildWorld(region(elements)).buildings;
    // Assert
    expect(buildings.map((b) => [b.id, b.height, b.levels])).toEqual([
      [10, 6.8, 2],
      [20, 6.8, 2],
      [30, 6.8, 2],
      [40, 15.8, 5],
      [50, 18, 6],
      [60, expect.any(Number), expect.any(Number)],
      [70, 6.8, 2],
      [80, 3.8, 1],
    ]);
    expect(buildings.find((b) => b.id === 60)!.height).toBeGreaterThan(9);
  });
  it('сохраняет класс дороги и не назначает тротуар дворовым проездам', () => {
    // Arrange
    const input = region([
      node(1, 0, 0),
      node(2, 0.003, 0),
      node(3, 0, 0.003),
      node(4, -0.003, 0),
      road(10, [1, 2], { highway: 'service' }),
      road(11, [1, 3], { highway: 'living_street', sidewalk: 'left' }),
      road(12, [1, 4], { highway: 'living_street', 'sidewalk:both': 'no' }),
    ]);
    // Act
    const w = buildWorld(input);
    // Assert
    expect(
      w.edges
        .filter((e) => e.way === 10)
        .every(
          (e) =>
            e.category === 'service' && !e.sidewalkLeft && !e.sidewalkRight,
        ),
    ).toBe(true);
    const forward = w.edges.find((e) => e.way === 11 && e.from === 1)!,
      backward = w.edges.find((e) => e.way === 11 && e.from === 3)!;
    expect([forward.sidewalkLeft, forward.sidewalkRight]).toEqual([
      true,
      false,
    ]);
    expect([backward.sidewalkLeft, backward.sidewalkRight]).toEqual([
      false,
      true,
    ]);
    expect(
      w.edges
        .filter((e) => e.way === 12)
        .every((e) => !e.sidewalkLeft && !e.sidewalkRight),
    ).toBe(true);
  });
  it('не придумывает тротуар без явного тега и не приклеивает sidewalk=separate', () => {
    // Arrange
    const input = region([
      node(1, 0, 0),
      node(2, 0.003, 0),
      node(3, 0, 0.003),
      node(4, -0.003, 0),
      road(10, [1, 2], { highway: 'primary' }),
      road(11, [1, 3], { highway: 'secondary', sidewalk: 'separate' }),
      road(12, [1, 4], { highway: 'secondary', 'sidewalk:right': 'yes' }),
    ]);
    // Act
    const world = buildWorld(input);
    // Assert
    expect(
      world.edges
        .filter((e) => e.way === 10)
        .every((e) => !e.sidewalkLeft && !e.sidewalkRight),
    ).toBe(true);
    expect(
      world.edges
        .filter((e) => e.way === 11)
        .every((e) => !e.sidewalkLeft && !e.sidewalkRight),
    ).toBe(true);
    expect(
      world.edges.some(
        (e) => e.way === 12 && (e.sidewalkLeft || e.sidewalkRight),
      ),
    ).toBe(true);
  });
  it('отличает ограждаемые парки и реки от скверного озеленения и водоёмов', () => {
    // Arrange
    const elements: OSMElement[] = [];
    for (const [id, x, tags] of [
      [10, 0, { leisure: 'park', name: 'Екатерининский парк' }],
      [20, 0.002, { landuse: 'grass' }],
      [30, 0.004, { natural: 'water', water: 'river' }],
      [40, 0.006, { natural: 'water' }],
      [50, 0.008, { leisure: 'park', name: 'Лицейский сквер' }],
      [60, 0.01, { leisure: 'park' }],
    ] as const) {
      const ids = [1, 2, 3, 4].map((n) => id + n);
      [
        [x, 0],
        [x + 0.001, 0],
        [x + 0.001, 0.001],
        [x, 0.001],
      ].forEach(([lon, lat], i) => elements.push(node(ids[i], lon, lat)));
      elements.push({ type: 'way', id, nodes: [...ids, ids[0]], tags });
    }
    // Act
    const areas = buildWorld(region(elements)).areas;
    // Assert
    expect(areas.map((a) => [a.id, a.kind, a.railing])).toEqual([
      [10, 'park', 'park'],
      [20, 'park', undefined],
      [30, 'water', 'river'],
      [40, 'water', undefined],
      [50, 'park', undefined],
      [60, 'park', undefined],
    ]);
  });
  it('сохраняет мощёную пешеходную площадь с нормализованным покрытием', () => {
    // Arrange
    const elements: OSMElement[] = [
      node(1, 0, 0),
      node(2, 0.002, 0),
      node(3, 0.002, 0.002),
      node(4, 0, 0.002),
      {
        type: 'way',
        id: 1577673,
        nodes: [1, 2, 3, 4, 1],
        tags: {
          place: 'square',
          'area:highway': 'pedestrian',
          surface: 'sett',
        },
      },
    ];
    // Act
    const world = buildWorld(region(elements));
    // Assert
    expect(world.areas).toEqual([
      expect.objectContaining({ id: 1577673, kind: 'paved', surface: 'sett' }),
    ]);
  });

  it('применяет торговый профиль этажей и технический верх к ТЦ без явной высоты', () => {
    // Arrange
    const elements: OSMElement[] = [
      node(1, 0, 0),
      node(2, 0.002, 0),
      node(3, 0.002, 0.001),
      node(4, 0, 0.001),
      {
        type: 'way',
        id: 158077342,
        nodes: [1, 2, 3, 4, 1],
        tags: { building: 'yes', 'building:levels': '2', shop: 'mall' },
      },
    ];
    // Act
    const mall = buildWorld(region(elements)).buildings[0];
    // Assert
    expect(mall).toMatchObject({
      id: 158077342,
      levels: 2,
      floorHeight: 4.2,
      technicalHeight: 0.8,
      material: 'glass',
    });
    expect(mall.height).toBeCloseTo(9.2, 6);
  });
  it('добавляет рассчитанной одноэтажной двускатной крыше пол-этажа, но уважает явную высоту', () => {
    // Arrange
    const outline = [
      node(1, 0, 0),
      node(2, 0.0002, 0),
      node(3, 0.0002, 0.0001),
      node(4, 0, 0.0001),
    ];
    const elements: OSMElement[] = [
      ...outline,
      {
        type: 'way',
        id: 31,
        nodes: [1, 2, 3, 4, 1],
        tags: {
          building: 'house',
          'building:levels': '1',
          'roof:shape': 'gabled',
        },
      },
      {
        type: 'way',
        id: 32,
        nodes: [1, 2, 3, 4, 1],
        tags: {
          building: 'house',
          'building:levels': '1',
          'roof:shape': 'gabled',
          height: '4',
        },
      },
    ];
    // Act
    const buildings = buildWorld(region(elements)).buildings;
    // Assert
    expect(buildings.find((building) => building.id === 31)).toMatchObject({
      height: 4.5,
      roofHeight: 1.5,
    });
    expect(buildings.find((building) => building.id === 32)).toMatchObject({
      height: 4,
    });
  });
  it('строит линейную городскую стену как узкий текстурированный объект без окон', () => {
    // Arrange
    const elements: OSMElement[] = [
      node(1, 0, 0),
      node(2, 0.002, 0),
      node(3, 0.003, 0.001),
      {
        type: 'way',
        id: 77,
        nodes: [1, 2, 3],
        tags: { historic: 'citywalls', barrier: 'wall' },
      },
    ];
    // Act
    const wall = buildWorld(region(elements)).buildings[0];
    // Assert
    expect(wall).toMatchObject({
      id: 77,
      kind: 'wall',
      material: 'brick',
      height: 6,
      windowPolicy: 'forbid',
    });
    expect(wall.footprint.length).toBe(6);
  });
  it('наследует материал и цвет линейной стены от соединённой башни', () => {
    // Arrange
    const elements: OSMElement[] = [
      node(1, 0, 0),
      node(2, 0.002, 0),
      node(3, 0.003, 0.001),
      node(4, -0.0003, 0.0003),
      node(5, -0.0003, -0.0003),
      {
        type: 'way',
        id: 70,
        nodes: [1, 4, 5, 1],
        tags: {
          building: 'tower',
          historic: 'castle',
          'building:material': 'stone',
          'building:colour': 'darkred',
        },
      },
      { type: 'way', id: 77, nodes: [1, 2, 3], tags: { barrier: 'wall' } },
    ];
    // Act
    const wall = buildWorld(region(elements)).buildings.find(
      (building) => building.id === 77,
    );
    // Assert
    expect(wall).toMatchObject({
      material: 'stone',
      facadeColour: 'darkred',
      windowPolicy: 'forbid',
    });
  });
  it('не прокладывает гонку через двор, сохраняя его доступным для свободной езды', () => {
    // Arrange — длинный service-срез короче периметра из обычных улиц.
    const input = region([
      node(1, -0.004, -0.004),
      node(2, 0.004, -0.004),
      node(3, 0.004, 0.004),
      node(4, -0.004, 0.004),
      road(10, [1, 2, 3, 4, 1], { highway: 'residential', oneway: 'yes' }),
      road(20, [1, 3], { highway: 'service', oneway: 'yes' }),
    ]);
    // Act
    const w = buildWorld(input),
      routes = createRoutes(
        w,
        edgeStableId(w.edges.find((e) => e.way === 10)!),
        true,
      );
    // Assert
    expect(w.edges.some((e) => e.way === 20 && !e.blocked)).toBe(true);
    expect(routes.length).toBeGreaterThan(0);
    expect(
      routes.flatMap((r) => r.edges).every((id) => edgeById(w, id)!.way !== 20),
    ).toBe(true);
  });
  it('сохраняет запрет поворота через промежуточную дорогу только для нужного въезда', () => {
    // Arrange
    const input = region([
      node(1, -0.003, 0),
      node(2, 0, 0),
      node(3, 0.003, 0),
      node(4, 0.003, 0.003),
      node(5, 0.003, -0.003),
      road(10, [1, 2]),
      road(11, [2, 3]),
      road(12, [3, 4]),
      road(13, [3, 5]),
      {
        type: 'relation',
        id: 99,
        tags: { type: 'restriction', restriction: 'no_left_turn' },
        members: [
          { type: 'way', role: 'from', ref: 10 },
          { type: 'way', role: 'via', ref: 11 },
          { type: 'way', role: 'to', ref: 12 },
        ],
      },
    ]);
    const w = buildWorld(input),
      from = w.edges.find((e) => e.from === 1)!,
      via = w.edges.find((e) => e.from === 2 && e.to === 3)!;
    // Act
    const history = advanceTurnHistory(
      w,
      advanceTurnHistory(w, [], from.way),
      via.way,
    );
    // Assert
    expect(
      allowedTurn(
        w,
        via,
        w.edges.find((e) => e.from === 3 && e.to === 4)!,
        history,
      ),
    ).toBe(false);
    expect(
      allowedTurn(
        w,
        via,
        w.edges.find((e) => e.from === 3 && e.to === 5)!,
        history,
      ),
    ).toBe(true);
    expect(
      allowedTurn(
        w,
        via,
        w.edges.find((e) => e.from === 3 && e.to === 4)!,
        [],
      ),
    ).toBe(true);
  });
  it('сохраняет одностороннее движение и не соединяет пересечение под мостом', () => {
    // Arrange
    const input = region([
      node(1, -0.003, 0),
      node(2, 0.003, 0),
      node(3, 0, -0.003),
      node(4, 0, 0.003),
      road(10, [1, 2], { oneway: 'yes' }),
      road(11, [3, 4], { bridge: 'yes', layer: '1' }),
    ]);
    // Act
    const w = buildWorld(input);
    // Assert
    expect(w.edges.filter((e) => e.way === 10)).toHaveLength(1);
    expect(outgoing(w, 2).filter((e) => e.way === 11)).toHaveLength(0);
    const bridge = w.edges.find((e) => e.way === 11)!;
    expect(Math.max(...bridge.points.map((p) => p.y))).toBeGreaterThan(5);
  });
  it('соблюдает запрет и обязательное направление поворота', () => {
    // Arrange
    const input = region([
      node(1, -0.003, 0),
      node(2, 0, 0),
      node(3, 0.003, 0),
      node(4, 0, 0.003),
      road(10, [1, 2]),
      road(11, [2, 3]),
      road(12, [2, 4]),
      {
        type: 'relation',
        id: 99,
        tags: { type: 'restriction', restriction: 'only_straight_on' },
        members: [
          { type: 'way', role: 'from', ref: 10 },
          { type: 'node', role: 'via', ref: 2 },
          { type: 'way', role: 'to', ref: 11 },
        ],
      },
    ]);
    // Act
    const w = buildWorld(input),
      incoming = w.edges.find((e) => e.from === 1)!;
    // Assert
    expect(
      allowedTurn(
        w,
        incoming,
        w.edges.find((e) => e.from === 2 && e.to === 3)!,
      ),
    ).toBe(true);
    expect(
      allowedTurn(
        w,
        incoming,
        w.edges.find((e) => e.from === 2 && e.to === 4)!,
      ),
    ).toBe(false);
  });
  it('строит кольцо только из замкнутой связной сети', () => {
    // Arrange
    const input = region([
      node(1, -0.008, -0.008),
      node(2, 0.008, -0.008),
      node(3, 0.008, 0.008),
      node(4, -0.008, 0.008),
      road(10, [1, 2, 3, 4, 1], { oneway: 'yes' }),
    ]);
    // Act
    const w = buildWorld(input),
      routes = createRoutes(w);
    // Assert
    const ring = routes.find((r) => r.kind === 'circuit');
    expect(ring).toBeDefined();
    expect(ring!.laps).toBe(3);
    expect(ring!.length).toBeGreaterThan(6000);
  });
  it('не принимает дорогу без достаточной длины за полноценный район', () => {
    // Arrange
    const input = region([
      node(1, 0, 0),
      node(2, 0.00001, 0),
      road(10, [1, 2]),
    ]);
    // Act
    const w = buildWorld(input);
    // Assert
    expect(w.warnings).toContain(
      'Недостаточно связанных дорог для заезда. Выберите другой участок.',
    );
  });
  it('держит весь тоннель вместе с порталами под рельефом', () => {
    // Arrange
    const input = region([
      node(1, -0.004, 0),
      node(2, 0.004, 0),
      road(10, [1, 2], { tunnel: 'yes', layer: '-1' }),
    ]);
    // Act
    const w = buildWorld(input),
      e = w.edges[0];
    // Assert
    expect(e.points[0].y + 5.7).toBeLessThan(-0.5);
    expect(e.points.at(-1)!.y).toBeCloseTo(e.points[0].y, 6);
    expect(e.points[0].y).toBeCloseTo(
      w.nodes.find((n) => n.id === e.from)!.y,
      6,
    );
    expect(Math.min(...e.points.map((p) => p.y))).toBeLessThan(-5);
    expect(e.blocked).toBe(false);
  });
  it('запрет разворота не запрещает продолжать движение по той же улице', () => {
    // Arrange
    const input = region([
      node(1, -0.003, 0),
      node(2, 0, 0),
      node(3, 0.003, 0),
      road(10, [1, 2, 3]),
      {
        type: 'relation',
        id: 99,
        tags: { type: 'restriction', restriction: 'no_u_turn' },
        members: [
          { type: 'way', role: 'from', ref: 10 },
          { type: 'node', role: 'via', ref: 2 },
          { type: 'way', role: 'to', ref: 10 },
        ],
      },
    ]);
    // Act
    const w = buildWorld(input),
      incoming = w.edges.find((e) => e.from === 1)!;
    // Assert
    expect(
      allowedTurn(
        w,
        incoming,
        w.edges.find((e) => e.from === 2 && e.to === 3)!,
      ),
    ).toBe(true);
    expect(
      allowedTurn(
        w,
        incoming,
        w.edges.find((e) => e.from === 2 && e.to === 1)!,
      ),
    ).toBe(false);
  });
});
