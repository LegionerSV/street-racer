import { expect, it, vi } from 'vitest';
import { buildWorld } from './network';
import {
  buildIncrementalWorld,
  SourceTileRegistry,
} from './source-tile-registry';
import type { OSMElement, RegionData, SourceTileData } from './types';

const center = { lat: 0, lon: 0 };
const elevation = (offsetX = 0) => ({
  width: 2,
  size: 1000,
  offsetX,
  values: new Float32Array(4),
});
const tile = (
  key: string,
  elements: OSMElement[],
  checksum = key,
): SourceTileData => ({
  key,
  elements,
  elevation: elevation(),
  checksum,
});
const region = (sourceTiles: SourceTileData[]): RegionData => ({
  center,
  sourceTiles,
  elements: [
    ...new Map(
      sourceTiles
        .flatMap((entry) => entry.elements)
        .map((e) => [`${e.type}/${e.id}`, e]),
    ).values(),
  ],
  elevation: {
    width: 2,
    size: 1,
    values: new Float32Array(4),
    patches: sourceTiles.map((entry) => entry.elevation),
  },
  loadedTiles: sourceTiles.map((entry) => entry.key),
  drivingSide: 'right',
  fetchedAt: 'test',
  heightDatum: 0,
});
const road: OSMElement[] = [
  { type: 'node', id: 1, lat: 0, lon: 0 },
  { type: 'node', id: 2, lat: 0, lon: 0.001 },
  { type: 'way', id: 10, nodes: [1, 2], tags: { highway: 'residential' } },
];

it('дедуплицирует halo-объект и удаляет его только после последней ссылки', () => {
  // Arrange
  const first = region([
      tile('15/16384/16384', road),
      tile('15/16385/16384', road),
    ]),
    registry = SourceTileRegistry.fromRegion(first)!;
  // Act
  const staged = registry.stage(region([tile('15/16385/16384', road)]));
  // Assert
  expect(registry.referenceCount('way/10')).toBe(2);
  expect(staged.registry.referenceCount('way/10')).toBe(1);
  expect(staged.changed).toEqual(['15/16384/16384']);
  expect(
    staged.registry.regionFor(staged.registry.keys(), first).elements,
  ).toHaveLength(3);
});

it('удаляет OSM-объект и его рёбра после выгрузки последнего owning tile', () => {
  // Arrange
  const first = region([tile('15/16384/16384', road)]),
    registry = SourceTileRegistry.fromRegion(first)!,
    staged = registry.stage(region([]));
  // Act
  const after = buildIncrementalWorld(
    buildWorld(first),
    staged.registry,
    staged.registry.affectedTiles(staged.changed),
    first,
    staged.changedElements,
  );
  // Assert
  expect(staged.registry.referenceCount('way/10')).toBe(0);
  expect(after.edges).toHaveLength(0);
  expect(after.loadedTiles).toEqual([]);
});

it('перестраивает только затронутые тайлы, включая соседний halo', () => {
  // Arrange
  const first = region([
      tile('15/16384/16384', road),
      tile('15/16385/16384', road),
      tile('15/16400/16384', [
        { type: 'node', id: 990, lat: -0.001, lon: 0.18 },
        { type: 'node', id: 991, lat: -0.002, lon: 0.18 },
        {
          type: 'way',
          id: 99,
          nodes: [990, 991],
          tags: { highway: 'residential' },
        },
      ]),
    ]),
    registry = SourceTileRegistry.fromRegion(first)!,
    staged = registry.stage(
      region([...first.sourceTiles!, tile('15/16384/16383', [], 'new')]),
    ),
    affected = staged.registry.affectedTiles(staged.changed),
    builder = vi.fn(buildWorld),
    previous = buildWorld(first),
    previousIds = previous.edges.map((edge) => edge.id);
  // Act
  buildIncrementalWorld(
    previous,
    staged.registry,
    affected,
    first,
    staged.changedElements,
    builder,
  );
  // Assert
  expect(builder).toHaveBeenCalledOnce();
  expect(
    builder.mock.calls[0][0].elements.some((element) => element.id === 99),
  ).toBe(false);
  expect(affected).not.toContain('15/16400/16384');
  expect(previous.edges.map((edge) => edge.id)).toEqual(previousIds);
});

it('сохраняет длинный мост из halo и ограничение поворота при удалении общей клетки', () => {
  // Arrange
  const bridge: OSMElement[] = [
      { type: 'node', id: 1, lat: -0.001, lon: 0 },
      { type: 'node', id: 2, lat: -0.001, lon: 0.025 },
      { type: 'node', id: 3, lat: -0.002, lon: 0.026 },
      {
        type: 'way',
        id: 10,
        nodes: [1, 2],
        tags: { highway: 'primary', bridge: 'yes' },
      },
      { type: 'way', id: 11, nodes: [2, 3], tags: { highway: 'primary' } },
      {
        type: 'relation',
        id: 50,
        tags: { type: 'restriction', restriction: 'no_left_turn' },
        members: [
          { type: 'way', ref: 10, role: 'from' },
          { type: 'node', ref: 2, role: 'via' },
          { type: 'way', ref: 11, role: 'to' },
        ],
      },
    ],
    shared = tile('15/16384/16384', bridge),
    remoteHalo = tile('15/16386/16384', bridge),
    first = region([shared, remoteHalo]),
    before = buildWorld(first),
    registry = SourceTileRegistry.fromRegion(first)!,
    staged = registry.stage(region([remoteHalo]));
  // Act
  const after = buildIncrementalWorld(
    before,
    staged.registry,
    staged.registry.affectedTiles(staged.changed, staged.changedElements),
    first,
    staged.changedElements,
  );
  // Assert
  expect(after.edges.some((edge) => edge.way === 10 && edge.bridge)).toBe(true);
  expect(after.restrictions).toContainEqual(
    expect.objectContaining({ fromWay: 10, toWay: 11, via: 2 }),
  );
  expect(staged.registry.referenceCount('way/10')).toBe(1);
  expect(
    staged.registry.affectedTiles(staged.changed, staged.changedElements),
  ).toContain(remoteHalo.key);
});

it('заменяет DEM-патч на общей границе без изменения незатронутой клетки', () => {
  // Arrange
  const left = tile('15/16384/16384', road, 'left'),
    right = tile('15/16385/16384', road, 'right');
  left.elevation = elevation(-500);
  right.elevation = elevation(500);
  const first = region([left, right]),
    registry = SourceTileRegistry.fromRegion(first)!,
    updatedRight = {
      ...right,
      checksum: 'right-2',
      elevation: {
        ...right.elevation,
        values: Float32Array.from([1, 1, 1, 1]),
      },
    },
    staged = registry.stage(region([left, updatedRight])),
    after = buildIncrementalWorld(
      buildWorld(first),
      staged.registry,
      staged.registry.affectedTiles(staged.changed),
      first,
      staged.changedElements,
    );
  // Act
  const patches = after.elevation.patches!;
  // Assert
  expect(patches.find((patch) => patch.offsetX === -500)?.values[0]).toBe(0);
  expect(patches.find((patch) => patch.offsetX === 500)?.values[0]).toBe(1);
});

it('не смешивает одинаковые OSM id областей way и relation', () => {
  // Arrange
  const park: OSMElement[] = [
      { type: 'node', id: 420, lat: -0.001, lon: 0.001 },
      { type: 'node', id: 421, lat: -0.001, lon: 0.002 },
      { type: 'node', id: 422, lat: -0.002, lon: 0.002 },
      { type: 'way', id: 42, nodes: [420, 421, 422, 420], tags: { leisure: 'park' } },
    ],
    nextRegion = region([tile('15/16384/16384', park)]),
    registry = SourceTileRegistry.fromRegion(nextRegion)!,
    previous = buildWorld(region([]));
  previous.areas = [
    {
      id: 42,
      osmType: 'relation',
      kind: 'water',
      points: [
        { x: 10, y: 0, z: 10 },
        { x: 20, y: 0, z: 10 },
        { x: 20, y: 0, z: 20 },
      ],
    },
  ];
  // Act
  const after = buildIncrementalWorld(
    previous,
    registry,
    registry.keys(),
    nextRegion,
    new Set(['way/42']),
  );
  // Assert
  expect(after.areas.map((area) => `${area.osmType}/${area.id}`).sort()).toEqual([
    'relation/42',
    'way/42',
  ]);
});
