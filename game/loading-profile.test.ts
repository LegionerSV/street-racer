import { expect, it } from 'vitest';
import { buildWorld } from './network';
import { buildChunk, desiredChunks, criticalChunks } from './chunks';
import type { OSMElement, RegionData } from './types';

// Воспроизводимая плотная сетка улиц. Время выводится для сравнения, а не
// используется как нестабильное ограничение скорости машины, запускающей тест.
export function loadingRegion(): RegionData {
  const elements: OSMElement[] = [];
  let id = 1;
  for (let row = 0; row < 17; row++)
    for (let col = 0; col < 17; col++)
      elements.push({
        type: 'node',
        id: id++,
        lat: (row * 60 - 480) / 111320,
        lon: (col * 60 - 480) / 111320,
      });
  for (let i = 0; i < 17; i++) {
    elements.push({
      type: 'way',
      id: 10000 + i,
      nodes: Array.from({ length: 17 }, (_, j) => i * 17 + j + 1),
      tags: { highway: 'residential', width: '7' },
    });
    elements.push({
      type: 'way',
      id: 11000 + i,
      nodes: Array.from({ length: 17 }, (_, j) => j * 17 + i + 1),
      tags: { highway: 'residential', width: '7' },
    });
  }
  for (let row = 0; row < 16; row++)
    for (let col = 0; col < 16; col++) {
      const nodes: number[] = [];
      for (const [dx, dz] of [
        [13, 13],
        [47, 13],
        [47, 47],
        [13, 47],
      ]) {
        nodes.push(id);
        elements.push({
          type: 'node',
          id: id++,
          lat: (row * 60 - 480 + dz) / 111320,
          lon: (col * 60 - 480 + dx) / 111320,
        });
      }
      elements.push({
        type: 'way',
        id: 12000 + row * 16 + col,
        nodes: [...nodes, nodes[0]],
        tags: { building: 'apartments', height: '18' },
      });
    }
  return {
    center: { lat: 0, lon: 0 },
    elements,
    elevation: { width: 2, size: 5600, values: new Float32Array(4) },
    fetchedAt: 'test',
    drivingSide: 'right',
  };
}
it('измеряет подготовку плотного квартала с домами и тротуарами', () => {
  // Arrange / Act
  const start = performance.now(),
    world = buildWorld(loadingRegion()),
    worldMs = performance.now() - start,
    begin = performance.now();
  const chunks = ['0,0', '-1,0', '0,-1', '-1,-1'].map((key) =>
    buildChunk(world, key, 0),
  );
  const first = desiredChunks({ x: 10, y: 0, z: 10 }, 0, 'high').filter(
    (c) => c.priority < 440 && c.lod === 0,
  );
  // Assert
  expect(world.buildings).toHaveLength(256);
  expect(chunks.every((c) => c.road.indices.length > 0)).toBe(true);
  console.log(
    JSON.stringify({
      worldMs: Math.round(worldMs),
      fourChunksMs: Math.round(performance.now() - begin),
      oldStartupChunks: first.length,
      startupChunks: criticalChunks({ x: 10, y: 0, z: 10 }, 0).length,
      triangles: chunks.reduce(
        (n, c) => n + (c.sidewalks?.indices.length || 0) / 3,
        0,
      ),
    }),
  );
}, 30000);
