import { expect, it } from 'vitest';
import { buildWorld, createRaceRoute } from './network';
import { prepareWorldIndex, indexWorld, buildChunk } from './chunks';
import { raceGrid } from './fixtures/race-grid';
import { edgeById } from './road-graph';
it('готовит индекс частями и публикует только законченный результат', () => {
  // Arrange
  const world = buildWorld(raceGrid(5, 5), false),
    steps = prepareWorldIndex(world);
  let yields = 0,
    step = steps.next();
  // Act
  while (!step.done) {
    yields++;
    step = steps.next();
  }
  // Assert
  expect(yields).toBeGreaterThan(1);
  expect(indexWorld(world)).toBe(step.value);
  expect(
    step.value.spatial.query({
      minX: -1000,
      minZ: -1000,
      maxX: 1000,
      maxZ: 1000,
    }).length,
  ).toBeGreaterThan(0);
  expect(buildChunk(world, '0,0', 0).road.indices.length).toBeGreaterThan(0);
});
it('лёгкие старты остаются доступны, а настоящая трасса рассчитывается по запросу', () => {
  // Arrange
  const world = buildWorld(raceGrid(5, 5), false);
  const invitation = world.routes.find((route) => route.kind === 'sprint')!;
  // Act
  const route = createRaceRoute(world, invitation.edges[0], 'sprint');
  // Assert
  expect(world.routes.length).toBeGreaterThan(0);
  expect(
    world.routes.every(
      (route) => route.length === 0 && !!edgeById(world, route.edges[0]),
    ),
  ).toBe(true);
  expect(route?.length).toBeGreaterThanOrEqual(2000);
});
