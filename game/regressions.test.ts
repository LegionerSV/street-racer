import { expect, it } from 'vitest';
import { buildChunk } from './chunks';
import { buildWorld } from './network';
import { sampleElevation, polygonContains } from './geo';
import type { RegionData } from './types';

const region = (): RegionData => ({ center: { lat: 0, lon: 0 }, fetchedAt: 'test', drivingSide: 'right', elevation: { width: 9, size: 500, values: Float32Array.from({ length: 81 }, (_, i) => i === 40 ? 35 : 0) }, elements: [] });
it('сглаживает одиночный выброс высоты, не превращая городскую дорогу в трамплин', () => {
  // Arrange
  const input = region();
  // Act
  const world = buildWorld(input);
  // Assert
  expect(Math.abs(sampleElevation(world.elevation, 0, 0) - sampleElevation(world.elevation, 100, 0))).toBeLessThan(8);
});
it('держит всю землю под асфальтом на поперечном склоне', () => {
  // Arrange
  const input = region(); input.elevation.values = Float32Array.from({ length: 81 }, (_, i) => (Math.floor(i / 9) - 4) * 12);
  input.elements = [{ type: 'node', id: 1, lat: .00018, lon: 0 }, { type: 'node', id: 2, lat: .00018, lon: .002 }, { type: 'way', id: 10, nodes: [1, 2], tags: { highway: 'primary', width: '14' } }];
  const world = buildWorld(input), edge = world.edges[0];
  // Act
  const chunk = buildChunk(world, '0,0', 0);
  // Assert — все вершины ячеек, пересекающих полотно, ниже дороги.
  for (let i = 0; i < chunk.terrain.positions.length; i += 3) {
    const [x, y, z] = chunk.terrain.positions.slice(i, i + 3);
    if (x > 30 && x < 200 && Math.abs(z - edge.points[0].z) < edge.width / 2 + 1) expect(y).toBeLessThan(edge.points[0].y - .1);
  }
});
it('создаёт воду по контуру реки и опускает дно под её поверхность', () => {
  // Arrange
  const input = region(); input.elevation.values.fill(5); const world = buildWorld(input);
  const polygon = [{ x: 30, y: 0, z: 30 }, { x: 200, y: 0, z: 70 }, { x: 200, y: 0, z: 190 }, { x: 30, y: 0, z: 150 }];
  world.areas = [{ id: 1, kind: 'water', points: polygon }];
  // Act
  const chunk = buildChunk(world, '0,0', 0);
  // Assert
  expect(chunk.water.indices.length).toBeGreaterThan(0);
  const waterY = chunk.water.positions[1];
  for (let i = 0; i < chunk.terrain.positions.length; i += 3) {
    const [x, y, z] = chunk.terrain.positions.slice(i, i + 3);
    if (polygonContains({ x, y, z }, polygon)) expect(y).toBeLessThan(waterY - 1);
  }
  expect(chunk.water.positions.some((v, i) => i % 3 === 0 && v === 30)).toBe(true);
});
