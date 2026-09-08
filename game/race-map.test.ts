import { expect, it } from 'vitest';
import {
  buildWorld,
  createRaceRoute,
  allowedTurn,
  advanceTurnHistory,
} from './network';
import { reconcileWorld } from './world-update';
import { routeHasCoverage } from './stream-coverage';
import { raceGrid } from './fixtures/race-grid';

it('размещает старты по загруженным километровым участкам', () => {
  // Arrange / Act
  const world = buildWorld(raceGrid(4, 3));
  const starts = world.routes.map((r) => world.edges[r.edges[0]].points[0]);
  // Assert
  expect(
    new Set(
      starts.map((p) => `${Math.floor(p.x / 1000)},${Math.floor(p.z / 1000)}`),
    ).size,
  ).toBe(12);
  expect(world.routes.length).toBeLessThanOrEqual(24);
  expect(new Set(world.routes.map((r) => r.id)).size).toBe(world.routes.length);
  expect(
    world.routes.every((r) => routeHasCoverage(r.points, world.loadedTiles)),
  ).toBe(true);
});
it.each(['sprint', 'circuit'] as const)(
  'при запуске %s от старого старта использует новые части карты',
  (kind) => {
    // Arrange
    const before = buildWorld(raceGrid()),
      after = buildWorld(raceGrid(4, 3));
    const invitation = before.routes.find((r) => r.kind === kind)!;
    const start = before.edges[invitation.edges[0]];
    const next = reconcileWorld(before, after);
    // Act
    const route = createRaceRoute(next, start, kind);
    // Assert
    expect(route).toBeDefined();
    expect(route!.points.some((p) => p.x > 2000 || p.z > 2000)).toBe(true);
    expect(route!.length).toBeGreaterThan(invitation.length);
    expect(next.edges[route!.edges[0]]).toMatchObject({
      way: start.way,
      from: start.from,
      to: start.to,
    });
    expect(routeHasCoverage(route!.points, next.loadedTiles)).toBe(true);
    expect(route!.id).not.toBe(invitation.id);
  },
);
it('после подгрузки добавляет другие старты, а после выгрузки убирает недоступные', () => {
  // Arrange
  const before = buildWorld(raceGrid()),
    expanded = buildWorld(raceGrid(4, 3));
  // Act
  const next = reconcileWorld(before, expanded);
  const smaller = reconcileWorld(next, buildWorld(raceGrid()));
  // Assert
  expect(next.routes.length).toBeGreaterThan(before.routes.length);
  expect(
    next.routes.some((r) => next.edges[r.edges[0]].points[0].x > 2000),
  ).toBe(true);
  expect(
    smaller.routes.every((r) =>
      routeHasCoverage(r.points, smaller.loadedTiles),
    ),
  ).toBe(true);
  expect(
    smaller.routes.every((r) =>
      r.edges.every((id) => smaller.edges[id] && !smaller.edges[id].blocked),
    ),
  ).toBe(true);
});
it('обходит незагруженную клетку, даже когда через неё проходит короткий путь', () => {
  // Arrange
  const region = raceGrid(3, 2);
  region.loadedTiles = region.loadedTiles!.filter((k) => k !== '1,0');
  const world = buildWorld(region),
    start = world.edges.find((e) => e.from === 1 && e.to === 2)!;
  // Act
  const route = createRaceRoute(world, start, 'sprint');
  // Assert
  expect(route).toBeDefined();
  expect(route!.points.some((p) => p.x > 2000)).toBe(true);
  expect(routeHasCoverage(route!.points, region.loadedTiles)).toBe(true);
});
it('сохраняет ограничения поворотов при построении большого кольца, включая стык кругов', () => {
  // Arrange
  const region = raceGrid(3, 2);
  region.elements.push({
    type: 'relation',
    id: 999999,
    tags: { type: 'restriction', restriction: 'no_left_turn' },
    members: [
      { type: 'way', ref: 100011, role: 'from' },
      { type: 'node', ref: 101, role: 'via' },
      { type: 'way', ref: 101010, role: 'to' },
    ],
  });
  const world = buildWorld(region),
    start = world.edges.find((e) => e.from === 1 && e.to === 101)!;
  // Act
  const route = createRaceRoute(world, start, 'circuit')!;
  // Assert
  expect(route).toBeDefined();
  expect(route.length).toBeGreaterThan(4000);
  let history = advanceTurnHistory(world, [], start.way);
  for (let i = 1; i < route.edges.length * 2; i++) {
    const from = world.edges[route.edges[(i - 1) % route.edges.length]],
      to = world.edges[route.edges[i % route.edges.length]];
    expect(allowedTurn(world, from, to, history)).toBe(true);
    history = advanceTurnHistory(world, history, to.way);
  }
});
it('после сохранения старой геометрии обновляет высоты контрольных точек', () => {
  // Arrange
  const old = buildWorld(raceGrid()),
    fresh = buildWorld(raceGrid());
  for (const e of old.edges)
    e.points = e.points.map((p) => ({ ...p, y: p.y + 2 }));
  // Act
  const next = reconcileWorld(old, fresh);
  // Assert
  for (const route of next.routes)
    expect(route.points[0]).toEqual(next.edges[route.edges[0]].points[0]);
});
