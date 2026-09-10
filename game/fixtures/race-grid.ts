import type { OSMElement, RegionData } from '../types';
import { sourceTileKeysForLocalBounds } from '../stream-coverage';

export function raceGrid(columns = 2, rows = 2): RegionData {
  const elements: OSMElement[] = [];
  for (let x = 0; x < columns * 2; x++)
    for (let z = 0; z < rows * 2; z++) {
      const id = 1 + x * 100 + z;
      elements.push({
        type: 'node',
        id,
        lon: (150 + x * 500) / 111320,
        lat: (150 + z * 500) / 111320,
      });
      for (const [dx, dz] of [
        [1, 0],
        [0, 1],
      ])
        if (x + dx < columns * 2 && z + dz < rows * 2)
          elements.push({
            type: 'way',
            id: 100000 + id * 10 + dx,
            nodes: [id, id + dx * 100 + dz],
            tags: { highway: 'primary', name: `Улица ${x},${z}`, lanes: '2' },
          });
    }
  return {
    center: { lat: 0, lon: 0 },
    elements,
    elevation: { width: 2, size: 12000, values: new Float32Array(4) },
    drivingSide: 'right',
    fetchedAt: 'test',
    loadedTiles: sourceTileKeysForLocalBounds(
      { lat: 0, lon: 0 },
      { minX: 0, minZ: 0, maxX: columns * 1000, maxZ: rows * 1000 },
    ),
  };
}
