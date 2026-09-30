import { it, expect } from 'vitest';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { brotliDecompressSync } from 'node:zlib';
import { buildRailways } from '../game/railways';
import { toGeo, toLocal } from '../game/geo';
import { decodeTileArtifact } from '../game/tile-artifact';
import { tileElevationForSession } from '../game/region-tile-source';
import { SourceTileRegistry } from '../game/source-tile-registry';
import { sourceTileCenter, parseSourceTileKey } from '../game/source-tiles';
import { createDemElevationSource } from './local-map-data';
import { buildWorld } from '../game/network';
import { buildChunk } from '../game/chunks';
import type { SourceTileData } from '../game/types';
import type { RegionData } from '../game/types';

it.skipIf(
  !existsSync(
    'work/map-overlays/rail-ships-saint-petersburg-20260928/15/19145/9532.tile.json.br',
  ),
)(
  'измеряет разрывы железной дороги у Боровой на данных из логов',
  async () => {
    // Arrange
    const center = { lat: 59.905710308951676, lon: 30.33939882152322 };
    const elements = new Map<string, RegionData['elements'][number]>();
    const sourceTiles: SourceTileData[] = [];
    for (let x = 19143; x <= 19146; x++)
      for (let y = 9530; y <= 9534; y++) {
        const path = `work/map-overlays/rail-ships-saint-petersburg-20260928/15/${x}/${y}.tile.json.br`;
        if (!existsSync(path)) continue;
        const tile = decodeTileArtifact(
          brotliDecompressSync(readFileSync(path)).toString(),
        );
        sourceTiles.push({
          key: `15/${x}/${y}`,
          elements: tile.elements,
          elevation: tileElevationForSession(tile, center),
        });
        for (const element of tile.elements)
          elements.set(`${element.type}/${element.id}`, element);
      }
    const ways = [...elements.values()].filter(
      (e) => e.type === 'way' && e.tags?.railway === 'rail',
    );
    const ids = new Set(ways.flatMap((e) => e.nodes ?? []));
    const data: RegionData = {
      center,
      elements: [...elements.values()].filter((e) =>
        e.type === 'node' ? ids.has(e.id) : ways.includes(e),
      ),
      drivingSide: 'right',
      fetchedAt: '',
      elevation: { width: 2, size: 10000, values: new Float32Array(4) },
    };
    const heights = new Map<number, { way: number; y: number }[]>();
    // Act
    const lines = buildRailways(data, data.elevation);
    for (const line of lines)
      for (let i = 0; i < line.nodes.length; i++) {
        const entries = heights.get(line.nodes[i]) ?? [];
        const node = elements.get(`node/${line.nodes[i]}`)!;
        const point = toLocal(node.lat!, node.lon!, center);
        const sample = line.points.find(
          (p) => Math.hypot(p.x - point.x, p.z - point.z) < 0.001,
        )!;
        entries.push({ way: line.id, y: sample.y });
        heights.set(line.nodes[i], entries);
      }
    const seams = [...heights]
      .flatMap(([node, entries]) => {
        const delta =
          Math.max(...entries.map((e) => e.y)) -
          Math.min(...entries.map((e) => e.y));
        const source = elements.get(`node/${node}`)!;
        const point = toLocal(source.lat!, source.lon!, center);
        return delta > 0.001
          ? [
              {
                node,
                delta,
                entries,
                ...toGeo(point, center),
                distance: Math.hypot(point.x, point.z),
              },
            ]
          : [];
      })
      .sort((a, b) => a.distance - b.distance);
    writeFileSync(
      'work/borovaya-rail-seams.json',
      JSON.stringify({ lines: lines.length, seams }, null, 2),
    );
    if (process.env.RAIL_SCENE_CAPTURE) {
      const dem = createDemElevationSource({
        cache: 'work/map-cache/terrarium',
        downloadMissing: false,
      });
      for (const source of sourceTiles) {
        const id = parseSourceTileKey(source.key);
        const shape = await dem(
          sourceTileCenter(id),
          new AbortController().signal,
          { width: 131, size: 10400, offsetX: 0, offsetZ: 0 },
        );
        const offset = source.elevation;
        source.elevation = {
          ...shape,
          offsetX: offset.offsetX,
          offsetZ: offset.offsetZ,
        };
      }
      const metadata = { ...data, sourceTiles };
      const registry = SourceTileRegistry.fromRegion(metadata)!;
      const world = buildWorld(registry.regionFor(registry.keys(), metadata));
      const chunks = [];
      for (let x = -2; x <= 1; x++)
        for (let z = -3; z <= 3; z++)
          chunks.push(buildChunk(world, `${x},${z}`, 1));
      writeFileSync(
        'work/borovaya-rail-scene.json',
        JSON.stringify({ center, heightDatum: world.heightDatum, chunks }),
      );
      writeFileSync(
        'work/borovaya-rail-profile.json',
        JSON.stringify(world.railways),
      );
    }
    // Assert
    expect(lines.length).toBeGreaterThan(0);
    expect(seams).toEqual([]);
  },
  180000,
);
