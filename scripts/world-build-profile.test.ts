import { it, expect } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { brotliDecompressSync, brotliCompressSync } from 'node:zlib';
import { Session } from 'node:inspector/promises';
import { decodeTileArtifact } from '../game/tile-artifact';
import { tileElevationForSession } from '../game/region-tile-source';
import { SourceTileRegistry } from '../game/source-tile-registry';
import { buildWorld } from '../game/network';
import { indexWorld } from '../game/chunks';
import { toLocal } from '../game/geo';
import type { RegionData, SourceTileData } from '../game/types';

// Ручной замер на локальных исходных тайлах, без сети и ограничения времени CI.
it.skipIf(!process.env.WORLD_PROFILE)(
  'профилирует построение района Синопской набережной',
  async () => {
    const center = { lat: 59.92938803927515, lon: 30.389196117371867 };
    const tiles: SourceTileData[] = [];
    for (let x = 19146; x <= 19154; x++)
      for (let y = 9524; y <= 9532; y++) {
        const key = `15/${x}/${y}`;
        const tile = decodeTileArtifact(
          brotliDecompressSync(
            readFileSync(`work/map-full/saint-petersburg/${key}.tile.json.br`),
          ).toString(),
        );
        tiles.push({
          key,
          elements: tile.elements,
          elevation: tileElevationForSession(tile, center),
        });
      }
    const metadata: RegionData = {
      center,
      fetchedAt: 'test',
      drivingSide: 'right',
      elements: [],
      sourceTiles: tiles,
      elevation: { width: 2, size: 1, values: new Float32Array(4) },
    };
    const registry = SourceTileRegistry.fromRegion(metadata)!;
    const region = registry.regionFor(registry.keys(), metadata);
    if (process.env.WORLD_FIXTURE) {
      const ways = region.elements.filter(
        (e) =>
          e.type === 'way' &&
          [1461352096, 317407182, 1461352095].includes(e.id),
      );
      const ids = new Set(ways.flatMap((e) => e.nodes ?? []));
      const nodes = region.elements.filter(
        (e) => e.type === 'node' && ids.has(e.id),
      );
      const patches = new Set(
        nodes.map((n) => {
          const p = toLocal(n.lat!, n.lon!, center);
          return tiles
            .map((t) => t.elevation)
            .sort(
              (a, b) =>
                Math.hypot(p.x - a.offsetX!, p.z - a.offsetZ!) -
                Math.hypot(p.x - b.offsetX!, p.z - b.offsetZ!),
            )[0];
        }),
      );
      const fixture = {
        center,
        fetchedAt: '2026-09-13',
        drivingSide: 'right',
        heightDatum: 19.68136097441782,
        elements: [...nodes, ...ways],
        elevation: {
          width: 2,
          size: 1,
          values: [0, 0, 0, 0],
          patches: [...patches].map((p) => ({ ...p, values: [...p.values] })),
        },
      };
      writeFileSync(
        'game/fixtures/sinopskaya.json.br',
        brotliCompressSync(Buffer.from(JSON.stringify(fixture))),
      );
    }
    const session = new Session();
    session.connect();
    await session.post('Profiler.enable');
    await session.post('Profiler.start');
    const start = performance.now(),
      world = buildWorld(region),
      built = performance.now();
    indexWorld(world);
    const indexed = performance.now();
    const { profile } = await session.post('Profiler.stop');
    session.disconnect();
    writeFileSync(
      `work/world-${process.env.WORLD_PROFILE}.cpuprofile`,
      JSON.stringify(profile),
    );
    const result = {
      elements: region.elements.length,
      edges: world.edges.length,
      buildMs: Math.round(built - start),
      indexMs: Math.round(indexed - built),
    };
    writeFileSync(
      `work/world-${process.env.WORLD_PROFILE}.json`,
      JSON.stringify(result),
    );
    console.log(result);
    expect(world.edges.length).toBeGreaterThan(10000);
  },
  240000,
);
