import { expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { brotliDecompressSync } from 'node:zlib';
import { decodeTileArtifact } from '../game/tile-artifact';
import { sourceTileCenter } from '../game/source-tiles';
import { buildWorld } from '../game/network';
import { buildChunk } from '../game/chunks';
import { tileKey } from '../game/geo';

it.skipIf(
  !existsSync(
    'work/map-overlays/rail-ships-saint-petersburg-20260928/15/19145/9524.tile.json.br',
  ),
)(
  'строит корпуса Авроры и Магадана из готовых source-тайлов',
  async () => {
    // Arrange
    const root = 'work/map-overlays/rail-ships-saint-petersburg-20260928';
    const samples = [
      { name: 'Аврора', x: 19145, y: 9524 },
      { name: 'Магадан', x: 19142, y: 9525 },
    ];
    const report = [];
    for (const sample of samples) {
      const id = { z: 15, x: sample.x, y: sample.y };
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
      const ship = world.buildings.find(
        (b) =>
          b.kind === 'ship' && (b.osmTags?.name || '').includes(sample.name),
      );
      const center = ship?.footprint.reduce(
        (v, p) => ({
          x: v.x + p.x / ship.footprint.length,
          y: 0,
          z: v.z + p.z / ship.footprint.length,
        }),
        { x: 0, y: 0, z: 0 },
      );
      const chunk = center && buildChunk(world, tileKey(center.x, center.z), 0);
      // Assert
      expect(ship, `${sample.name}: модель отсутствует`).toBeDefined();
      expect(
        chunk?.structures.indices.length,
        `${sample.name}: корпус отсутствует`,
      ).toBeGreaterThan(0);
      report.push({
        name: sample.name,
        id: ship!.id,
        kind: ship!.kind,
        points: ship!.footprint.length,
        structureTriangles: chunk!.structures.indices.length / 3,
        tileBytes: bytes.length,
      });
    }
    await writeFile(
      'work/ship-tile-verification.json',
      JSON.stringify(report, null, 2),
      'utf8',
    );
  },
  30000,
);
