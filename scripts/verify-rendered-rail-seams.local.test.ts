import { expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { brotliDecompressSync } from 'node:zlib';
import { sampleElevation, toLocal } from '../game/geo';
import { sourceTileBounds, sourceTileCenter } from '../game/source-tiles';
import { decodeTileArtifact } from '../game/tile-artifact';
import { tileElevationForSession } from '../game/region-tile-source';
import { verifyGeometry } from './verify-map-pilot';

const root = 'work/map-overlays/rail-ships-saint-petersburg-20260928';
const moscowRoot = 'work/map-overlays/rail-moscow-20260928';

it.skipIf(!existsSync(`${root}/15/19140/9522.tile.json.br`) || !existsSync(`${moscowRoot}/15/19800/10240.tile.json.br`))('сводит рельеф на городских стыках после объединения DEM-патчей', async () => {
  // Arrange
  const seams = [
    [root, { z: 15, x: 19140, y: 9522 }, { z: 15, x: 19141, y: 9522 }, 'east'],
    [root, { z: 15, x: 19141, y: 9524 }, { z: 15, x: 19142, y: 9524 }, 'east'],
    [root, { z: 15, x: 19145, y: 9524 }, { z: 15, x: 19146, y: 9524 }, 'east'],
    [moscowRoot, { z: 15, x: 19800, y: 10240 }, { z: 15, x: 19801, y: 10240 }, 'east'],
    [moscowRoot, { z: 15, x: 19808, y: 10242 }, { z: 15, x: 19809, y: 10242 }, 'east'],
    [moscowRoot, { z: 15, x: 19810, y: 10245 }, { z: 15, x: 19811, y: 10245 }, 'east'],
  ] as const;
  const report = [];
  for (const [tileRoot, a, b, direction] of seams) {
    const read = async (id: { z: number; x: number; y: number }) => {
      const bytes = await readFile(`${tileRoot}/15/${id.x}/${id.y}.tile.json.br`);
      return decodeTileArtifact(new TextDecoder().decode(brotliDecompressSync(bytes)), id);
    };
    const first = await read(a), second = await read(b);
    const sessionCenter = sourceTileCenter(first);
    const elevation = { width: 2, size: 1, values: new Float32Array(4), patches: [
      tileElevationForSession(first, sessionCenter), tileElevationForSession(second, sessionCenter),
    ] };
    const bounds = sourceTileBounds(first);
    let maximum = 0;
    // Act
    for (let i = 0; i <= 8; i++) {
      const ratio = i / 8;
      const point = direction === 'east'
        ? toLocal(bounds.south + (bounds.north - bounds.south) * ratio, bounds.east, sessionCenter)
        : toLocal(bounds.south, bounds.west + (bounds.east - bounds.west) * ratio, sessionCenter);
      const before = direction === 'east' ? { x: point.x - 0.5, z: point.z } : { x: point.x, z: point.z - 0.5 };
      const after = direction === 'east' ? { x: point.x + 0.5, z: point.z } : { x: point.x, z: point.z + 0.5 };
      maximum = Math.max(maximum, Math.abs(sampleElevation(elevation, before.x, before.z) - sampleElevation(elevation, after.x, after.z)));
    }
    const shared = verifyGeometry(first, second);
    report.push({ dataset: tileRoot === root ? 'Петербург' : 'Москва', seam: `${a.x}/${a.y}/${b.x}/${b.y}`, shared, renderedDeltaMeters: maximum });
    // Assert
    expect(shared).toBeGreaterThan(0);
    expect(maximum).toBeLessThan(0.5);
  }
  await writeFile('work/rail-rendered-seam-verification.json', JSON.stringify(report, null, 2), 'utf8');
}, 30000);
