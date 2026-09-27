import { expect, it } from 'vitest';
import { buildWorld } from './network';
import { indexWorld } from './chunks';
import {
  indexDrivingWorld,
  prepareDrivingIndex,
  type DrivingSegment,
} from './driving-index';
import { raceGrid } from './fixtures/race-grid';
import { sourceTilesForLocalBounds } from './stream-coverage';
import { sourceTileKey } from './source-tiles';

const query = { minX: -2000, minZ: -2000, maxX: 2000, maxZ: 2000 };
const describeSegments = (segments: DrivingSegment[]) =>
  segments.map(({ a, b, edge }) => [a, b, edge.stableId]);

it.each(['empty', 'full', 'partial'] as const)(
  'индекс физики совпадает с геометрическим: %s',
  (state) => {
    // Arrange
    const world = buildWorld(raceGrid(4, 4), false);
    if (state === 'empty') {
      world.edges = [];
      world.buildings = [];
    }
    if (state === 'partial') world.edges = world.edges.slice(0, 12);
    // Act
    const actual = indexDrivingWorld(world),
      expected = indexWorld(world);
    // Assert
    expect(describeSegments(actual.spatial.query(query))).toEqual(
      describeSegments(expected.spatial.query(query)),
    );
    expect([...actual.segments.keys()]).toEqual([...expected.segments.keys()]);
    expect(actual.buildings).toEqual(expected.buildings);
  },
);

it('сохраняет сегменты неизменённых дорог и заменяет изменённые и удалённые', () => {
  // Arrange
  const world = buildWorld(raceGrid(4, 4), false),
    original = indexDrivingWorld(world);
  const edge = world.edges[0],
    removed = world.edges[2];
  const next = {
    ...world,
    edges: world.edges
      .filter((e) => e !== removed)
      .map((e) => (e === edge ? { ...e, width: e.width + 2 } : e)),
  };
  // Act
  const steps = prepareDrivingIndex(next, world);
  let step = steps.next();
  while (!step.done) step = steps.next();
  const actual = step.value.spatial.query(query),
    before = original.spatial.query(query);
  // Assert
  expect(describeSegments(actual)).toEqual(
    describeSegments(indexWorld(next).spatial.query(query)),
  );
  for (const segment of actual) {
    if (segment.edge === edge || segment.edge === removed)
      throw new Error('Старая дорога осталась в индексе');
    if (before.some((old) => old.edge === segment.edge))
      expect(before).toContain(segment);
  }
  expect(original.spatial.query(query)).toEqual(before);
});

it('прерванная подготовка не публикует частичный индекс', () => {
  // Arrange
  const world = buildWorld(raceGrid(5, 5), false),
    steps = prepareDrivingIndex(world);
  // Act
  expect(steps.next().done).toBe(false);
  steps.return(undefined as never);
  const actual = indexDrivingWorld(world);
  // Assert
  expect(describeSegments(actual.spatial.query(query))).toEqual(
    describeSegments(indexWorld(world).spatial.query(query)),
  );
});

it.each([false, true])(
  'обновляет ограничение покрытия без устаревших ячеек: %s',
  (remove) => {
    // Arrange
    const world = buildWorld(raceGrid(4, 4), false);
    const tiles = sourceTilesForLocalBounds(world.center, query).map(
      sourceTileKey,
    );
    world.loadedTiles = remove ? tiles : [tiles[0]];
    indexDrivingWorld(world);
    const next = { ...world, loadedTiles: remove ? [] : tiles };
    // Act
    const steps = prepareDrivingIndex(next, world);
    let step = steps.next();
    while (!step.done) step = steps.next();
    // Assert
    expect(describeSegments(step.value.spatial.query(query))).toEqual(
      describeSegments(indexWorld(next).spatial.query(query)),
    );
  },
);

it('добавляет дорогу и здание, не меняя уже используемый индекс', () => {
  // Arrange
  const world = buildWorld(raceGrid(4, 4), false),
    original = indexDrivingWorld(world);
  const edge = world.edges[0];
  const building = {
    id: 987654,
    footprint: [
      { x: 0, y: 0, z: 0 },
      { x: 10, y: 0, z: 0 },
      { x: 10, y: 0, z: 10 },
    ],
    height: 12,
    colour: 0x778899,
    roof: 'flat',
  };
  const next = {
    ...world,
    edges: [
      ...world.edges,
      {
        ...edge,
        id: world.edges.length,
        stableId: 'added',
        way: 987654,
        from: 987654,
        to: 987655,
      },
    ],
    buildings: [...world.buildings, building],
  };
  const before = original.spatial.query(query);
  // Act
  const steps = prepareDrivingIndex(next, world);
  let step = steps.next();
  while (!step.done) step = steps.next();
  // Assert
  expect(describeSegments(step.value.spatial.query(query))).toEqual(
    describeSegments(indexWorld(next).spatial.query(query)),
  );
  expect(step.value.buildings).toEqual(indexWorld(next).buildings);
  expect(original.spatial.query(query)).toEqual(before);
});
