// Воспроизводит широкую сетку из уже сохранённых Terrarium PNG, без сети.
// Запуск из корня: node --experimental-transform-types scripts/nevsky-wide-elevation.local.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { brotliDecompressSync, brotliCompressSync } from 'node:zlib';
import { createDemElevationSource } from './local-map-data.ts';
import { toGeo } from '../game/geo.ts';
import {
  TERRAIN_GRID_SIZE,
  TERRAIN_GRID_WIDTH,
} from '../game/terrain-policy.ts';

const region = JSON.parse(
  brotliDecompressSync(
    readFileSync('game/fixtures/nevsky-video.json.br'),
  ).toString(),
);
const dem = createDemElevationSource({
  cache: 'work/map-cache/terrarium',
  downloadMissing: false,
});
const patches = [];
for (const patch of region.elevation.patches) {
  const center = toGeo(
    { x: patch.offsetX, z: patch.offsetZ, y: 0 },
    region.center,
  );
  const grid = await dem(center, new AbortController().signal, {
    width: TERRAIN_GRID_WIDTH,
    size: TERRAIN_GRID_SIZE,
    offsetX: 0,
    offsetZ: 0,
  });
  patches.push({
    ...grid,
    offsetX: patch.offsetX,
    offsetZ: patch.offsetZ,
    sizeX: (grid.size * (patch.sizeX ?? patch.size)) / patch.size,
    sizeZ: (grid.size * (patch.sizeZ ?? patch.size)) / patch.size,
    values: [...grid.values],
  });
}
const path = 'game/fixtures/nevsky-wide-elevation.json.br';
writeFileSync(
  path,
  brotliCompressSync(
    Buffer.from(JSON.stringify({ ...region.elevation, patches })),
  ),
);
console.log({ patches: patches.length, bytes: readFileSync(path).length });
