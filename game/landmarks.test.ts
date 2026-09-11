import { expect, it } from 'vitest';
import { prepareLandmarks, type LandmarkAsset } from './landmarks';
import type { World } from './types';
const world: World = {
  center: { lat: 0, lon: 0 },
  buildings: [
    {
      id: 10,
      osmType: 'way',
      height: 10,
      colour: 0,
      roof: 'flat',
      footprint: [
        { x: 20, y: 5, z: 20 },
        { x: 30, y: 5, z: 20 },
        { x: 25, y: 5, z: 30 },
      ],
    },
  ],
  edges: [],
  nodes: [],
  restrictions: [],
  areas: [],
  trees: [],
  elevation: { width: 2, size: 5600, values: new Float32Array(4) },
  drivingSide: 'right',
  warnings: [],
  spawnEdge: null,
  routes: [],
};
const model: LandmarkAsset = {
  id: 'test',
  kind: 'building',
  osm: [{ type: 'way', id: 10 }],
  anchor: { lat: 0, lon: 0 },
  source: 'Контрольная синтетическая геометрия',
  license: 'CC0',
  near: { positions: [0, 0, 0, 1, 0, 0, 0, 1, 0], indices: [0, 1, 2] },
};
it('подключает модель только по точному типу и ID OSM, сохраняет источник и опорную высоту', () => {
  // Arrange / Act
  const selected = prepareLandmarks(world, [
    model,
    { ...model, id: 'wrong', osm: [{ type: 'relation', id: 10 }] },
  ]);
  // Assert
  expect(selected).toHaveLength(1);
  expect(selected[0].asset.id).toBe('test');
  expect(selected[0].origin.y).toBe(5);
  expect(selected[0].key).toBe('0,0');
});
it('повреждённая модель и отсутствие модели оставляют процедурный объект', () => {
  // Arrange / Act / Assert
  expect(prepareLandmarks(world, [])).toEqual([]);
  expect(
    prepareLandmarks(world, [
      { ...model, near: { positions: [NaN, 0, 0], indices: [0, 1, 2] } },
    ]),
  ).toEqual([]);
  expect(prepareLandmarks(world, [{ ...model, license: '' }])).toEqual([]);
});
