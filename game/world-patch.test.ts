import { expect, it } from 'vitest';
import { buildWorld } from './network';
import type { RegionData } from './types';
import { createWorldPatch } from './world-patch';

const region = (way: number, loadedTiles: string[]): RegionData => ({
  center: { lat: 0, lon: 0 },
  elements: [
    { type: 'node', id: 1, lat: 0, lon: 0 },
    { type: 'node', id: 2, lat: 0, lon: 0.001 },
    { type: 'way', id: way, nodes: [1, 2], tags: { highway: 'residential' } },
  ],
  elevation: { width: 2, size: 1000, values: new Float32Array(4) },
  drivingSide: 'right',
  fetchedAt: 'test',
  loadedTiles,
  heightDatum: 0,
});

it('возвращает типизированные изменения и точные dirty chunks', () => {
  // Arrange
  const before = buildWorld(region(10, ['15/16384/16384'])),
    after = buildWorld(region(11, ['15/16384/16384', '15/16385/16384']));
  before.trees = [{ x: 1, y: 0, z: 1 }];
  after.trees = [{ x: 2, y: 0, z: 2 }];
  before.elevation.patches = [
    { width: 2, size: 1000, offsetX: -500, values: new Float32Array(4) },
  ];
  after.elevation.patches = [
    { width: 2, size: 1000, offsetX: 500, values: new Float32Array(4) },
  ];
  // Act
  const patch = createWorldPatch(before, after);
  // Assert
  expect(patch.coverageAdded).toEqual(['15/16385/16384']);
  expect(patch.edgesRemoved).toEqual(before.edges.map((edge) => edge.stableId));
  expect(patch.edgesAddedOrUpdated.map((edge) => edge.stableId)).toEqual(
    after.edges.map((edge) => edge.stableId),
  );
  expect(patch.dirtyChunks.length).toBeGreaterThan(0);
  expect(patch.dirtyChunks).not.toContain('20,20');
  expect(patch.treesRemoved).toEqual(before.trees);
  expect(patch.treesAdded).toEqual(after.trees);
  expect(patch.elevationPatchesRemoved).toEqual(['-500,0']);
});
