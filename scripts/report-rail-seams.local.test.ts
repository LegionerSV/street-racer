import { expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { brotliDecompressSync } from 'node:zlib';
import { sampleElevation, toLocal } from '../game/geo';
import { parseSourceTileKey, sourceTileBounds, sourceTileCenter, sourceTileKey } from '../game/source-tiles';
import { decodeTileArtifact, type TileArtifactV1 } from '../game/tile-artifact';
import { tileElevationForSession } from '../game/region-tile-source';
import { verifyGeometry } from './verify-map-pilot';

const staging = 'work/map-overlays/rail-ships-saint-petersburg-20260928';

it.skipIf(!existsSync(`${staging}/staging-manifest-v1.json`))('проверяет геометрию городских стыков overlay и измеряет перепады высот', async () => {
  // Arrange
  const manifest = JSON.parse(await readFile(`${staging}/staging-manifest-v1.json`, 'utf8')) as {
    tiles: Record<string, { path: string }>;
  };
  const entries = manifest.tiles;
  const focus = new Set(Object.keys(entries).filter((key) => {
    const { x, y } = parseSourceTileKey(key);
    return x >= 19140 && x <= 19150 && y >= 9518 && y <= 9530;
  }));
  const cache = new Map<string, TileArtifactV1>();
  const load = async (key: string) => {
    let tile = cache.get(key);
    if (tile) return tile;
    const bytes = await readFile(`${staging}/${entries[key].path}`);
    tile = decodeTileArtifact(new TextDecoder().decode(brotliDecompressSync(bytes)), parseSourceTileKey(key));
    cache.set(key, tile);
    if (cache.size > 8) cache.delete(cache.keys().next().value!);
    return tile;
  };
  const worst: { seam: string; meters: number }[] = [];
  let seams = 0, sharedElements = 0, aboveHalfMeter = 0, maxCityDelta = 0;
  let maxRenderedDelta = 0, aboveHalfMeterRendered = 0;
  // Act
  for (const key of focus) {
    const id = parseSourceTileKey(key);
    for (const [neighbor, direction] of [
      [{ ...id, x: id.x + 1 }, 'east'],
      [{ ...id, y: id.y + 1 }, 'south'],
    ] as const) {
      const neighborKey = sourceTileKey(neighbor);
      if (!focus.has(neighborKey)) continue;
      const first = await load(key), second = await load(neighborKey);
      sharedElements += verifyGeometry(first, second);
      const bounds = sourceTileBounds(first), firstCenter = sourceTileCenter(first), secondCenter = sourceTileCenter(second);
      const rendered = { width: 2, size: 1, values: new Float32Array(4), patches: [
        tileElevationForSession(first, firstCenter), tileElevationForSession(second, firstCenter),
      ] };
      let maximum = 0, renderedMaximum = 0;
      for (let i = 0; i <= 8; i++) {
        const ratio = i / 8;
        const geo = direction === 'east'
          ? { lat: bounds.south + (bounds.north - bounds.south) * ratio, lon: bounds.east }
          : { lat: bounds.south, lon: bounds.west + (bounds.east - bounds.west) * ratio };
        const a = toLocal(geo.lat, geo.lon, firstCenter), b = toLocal(geo.lat, geo.lon, secondCenter);
        maximum = Math.max(maximum, Math.abs(sampleElevation(first.elevation, a.x, a.z) - sampleElevation(second.elevation, b.x, b.z)));
        renderedMaximum = Math.max(renderedMaximum, Math.abs(
          sampleElevation(rendered, a.x - (direction === 'east' ? 0.5 : 0), a.z - (direction === 'south' ? 0.5 : 0)) -
          sampleElevation(rendered, a.x + (direction === 'east' ? 0.5 : 0), a.z + (direction === 'south' ? 0.5 : 0)),
        ));
      }
      seams++;
      if (maximum > 0.5) aboveHalfMeter++;
      if (renderedMaximum > 0.5) aboveHalfMeterRendered++;
      maxRenderedDelta = Math.max(maxRenderedDelta, renderedMaximum);
      if (id.x >= 19138 && id.x <= 19155 && id.y >= 9518 && id.y <= 9532)
        maxCityDelta = Math.max(maxCityDelta, maximum);
      worst.push({ seam: `${key}/${neighborKey}`, meters: maximum });
    }
  }
  const report = { tiles: focus.size, seams, sharedElements,
    aboveHalfMeter, maxCityDelta, maxRenderedDelta, aboveHalfMeterRendered,
    worst: worst.sort((a, b) => b.meters - a.meters).slice(0, 12) };
  await writeFile('work/rail-ship-seam-report.json', JSON.stringify(report, null, 2), 'utf8');
  // Assert
  expect(seams).toBeGreaterThan(0);
  expect(sharedElements).toBeGreaterThan(0);
  expect(maxRenderedDelta).toBeLessThan(0.5);
}, 180000);
