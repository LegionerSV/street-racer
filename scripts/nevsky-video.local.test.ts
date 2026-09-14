import { it, expect } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { brotliCompressSync, brotliDecompressSync } from 'node:zlib';
import { decodeTileArtifact } from '../game/tile-artifact';
import { tileElevationForSession } from '../game/region-tile-source';
import {
  latLonToSourceTile,
  sourceTileKey,
  sourceTileCenter,
} from '../game/source-tiles';
import { createDemElevationSource } from './local-map-data';
import { SourceTileRegistry } from '../game/source-tile-registry';
import { buildWorld } from '../game/network';
import { distance2, toLocal } from '../game/geo';
import type { RegionData, SourceTileData } from '../game/types';

// Повторяемый разбор исходных локальных тайлов участка из записи 13.09.2026.
it.skipIf(!process.env.NEVSKY_FIXTURE)(
  'сохраняет дорожный участок Невского из локального архива',
  async () => {
    const center = { lat: 59.9345, lon: 30.3355 },
      id = latLonToSourceTile(center.lat, center.lon);
    const tiles: SourceTileData[] = [];
    const dem = createDemElevationSource({
      cache: 'work/map-cache/terrarium',
      downloadMissing: false,
    });
    for (let x = id.x - 2; x <= id.x + 2; x++)
      for (let y = id.y - 2; y <= id.y + 2; y++) {
        const key = sourceTileKey({ ...id, x, y });
        const tile = decodeTileArtifact(
          brotliDecompressSync(
            readFileSync(`work/map-full/saint-petersburg/${key}.tile.json.br`),
          ).toString(),
        );
        tile.elevation = await dem(
          sourceTileCenter({ ...id, x, y }),
          new AbortController().signal,
          { width: 131, size: 2600, offsetX: 0, offsetZ: 0 },
        );
        tiles.push({
          key,
          elements: tile.elements,
          elevation: tileElevationForSession(tile, center),
        });
      }
    const metadata: RegionData = {
      center,
      elements: [],
      sourceTiles: tiles,
      elevation: { width: 2, size: 1, values: new Float32Array(4) },
      drivingSide: 'right',
      fetchedAt: '2026-09-13',
    };
    const registry = SourceTileRegistry.fromRegion(metadata)!,
      region = registry.regionFor(registry.keys(), metadata);
    const nodes = new Map(
      region.elements.filter((e) => e.type === 'node').map((e) => [e.id, e]),
    );
    const ways = region.elements.filter(
      (e) =>
        e.type === 'way' &&
        e.tags?.highway &&
        e.nodes?.some((id) => {
          const node = nodes.get(id);
          if (!node?.lat || !node.lon) return false;
          const p = toLocal(node.lat, node.lon, center);
          return Math.abs(p.x) < 1100 && Math.abs(p.z) < 350;
        }),
    );
    const ids = new Set(ways.flatMap((e) => e.nodes ?? []));
    region.elements = [
      ...region.elements.filter((e) => e.type === 'node' && ids.has(e.id)),
      ...ways,
    ];
    delete region.sourceTiles;
    const used = new Set(
      region.elements
        .filter((e) => e.type === 'node')
        .map((n) => {
          const p = toLocal(n.lat!, n.lon!, center);
          return region.elevation.patches!.reduce((a, b) =>
            Math.hypot(p.x - a.offsetX!, p.z - a.offsetZ!) <
            Math.hypot(p.x - b.offsetX!, p.z - b.offsetZ!)
              ? a
              : b,
          );
        }),
    );
    region.elevation.patches = [...used];
    writeFileSync(
      'game/fixtures/nevsky-video.json.br',
      brotliCompressSync(
        Buffer.from(
          JSON.stringify(region, (_key, value) =>
            value instanceof Float32Array ? [...value] : value,
          ),
        ),
      ),
    );
    const world = buildWorld(region),
      edges = world.edges.filter((e) => e.name === 'Невский проспект');
    const points = edges.flatMap((e) => e.points);
    console.log({
      nodes: ids.size,
      ways: ways.length,
      min: Math.min(...points.map((p) => p.y)),
      max: Math.max(...points.map((p) => p.y)),
      grade: Math.max(
        ...edges.flatMap((e) =>
          e.points
            .slice(1)
            .map(
              (p, i) =>
                Math.abs(p.y - e.points[i].y) / distance2(p, e.points[i]),
            ),
        ),
      ),
      blocked: edges
        .filter((e) => e.blocked)
        .map((e) => ({ way: e.way, reasons: e.blockedReasons })),
    });
    expect(edges.length).toBeGreaterThan(20);
  },
  120000,
);
