import { expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { brotliDecompressSync } from 'node:zlib';
import { decodeTileArtifact } from '../game/tile-artifact';
import { sourceTileCenter } from '../game/source-tiles';
import { buildWorld } from '../game/network';

const root = 'work/map-overlays/rail-ships-saint-petersburg-20260928';

it.skipIf(!existsSync(`${root}/15/19141/9532.tile.json.br`))('ставит вагоны на настоящем станционном запасном пути Петербурга', async () => {
  // Arrange
  const id = { z: 15, x: 19141, y: 9532 };
  const bytes = await readFile(`${root}/15/${id.x}/${id.y}.tile.json.br`);
  const tile = decodeTileArtifact(
    new TextDecoder().decode(brotliDecompressSync(bytes)),
    id,
  );
  // Act
  const world = buildWorld({
    center: sourceTileCenter(id),
    elements: tile.elements,
    elevation: tile.elevation,
    drivingSide: tile.drivingSide,
    fetchedAt: tile.osmTimestamp,
  });
  const wagonsByLine = Map.groupBy(world.parkedWagons ?? [], (wagon) => wagon.id.split(':')[0]);
  const report = {
    station: 'Санкт-Петербург-Балтийский',
    railways: world.railways?.length ?? 0,
    wagonGroups: [...wagonsByLine.values()].map((wagons) => wagons.length),
  };
  // Assert
  expect(report.railways).toBeGreaterThan(0);
  expect(report.wagonGroups.length).toBeGreaterThan(0);
  for (const count of report.wagonGroups) {
    expect(count).toBeGreaterThanOrEqual(2);
    expect(count).toBeLessThanOrEqual(4);
  }
  await writeFile('work/station-wagon-verification.json', JSON.stringify(report, null, 2), 'utf8');
}, 30000);
