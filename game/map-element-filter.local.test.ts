import { expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { brotliDecompressSync } from 'node:zlib';
import { resolve } from 'node:path';
import { reduceMapElements } from './map-element-filter';
import { sourceTileCenter, parseSourceTileKey } from './source-tiles';
import { startupTiles, mapStreamingPolicy } from './region-stream';
import type { OSMElement } from './types';
import { ROAD_TYPES } from './map-object-filters';

const pilotRoot = resolve('work/map-pilots/saint-petersburg');
const pilotCenter = { lat: 59.9343, lon: 30.3351 };
const pilotKeys = startupTiles(
  pilotCenter,
  mapStreamingPolicy('mobile').blockingRadiusMeters,
);
const pilotComplete = pilotKeys.every((key) => {
  const id = parseSourceTileKey(key);
  return existsSync(
    resolve(pilotRoot, String(id.z), String(id.x), `${id.y}.tile.json.br`),
  );
});

it.skipIf(!pilotComplete)(
  'укладывает реальный старт Петербурга в мобильный бюджет',
  () => {
    // Arrange
    const raw = new Map<string, OSMElement>();
    const kept = new Map<string, OSMElement>();

    // Act
    for (const key of pilotKeys) {
      const id = parseSourceTileKey(key);
      const file = resolve(
        pilotRoot,
        String(id.z),
        String(id.x),
        `${id.y}.tile.json.br`,
      );
      const tile = JSON.parse(
        brotliDecompressSync(readFileSync(file)).toString(),
      ) as { elements: OSMElement[] };
      const filtered = reduceMapElements(tile.elements, sourceTileCenter(id));
      for (const element of tile.elements)
        raw.set(`${element.type}/${element.id}`, element);
      for (const element of filtered.elements)
        kept.set(`${element.type}/${element.id}`, element);
    }

    // Assert
    expect(raw.size).toBeLessThanOrEqual(
      mapStreamingPolicy('mobile').maxElements,
    );
    expect(kept.size).toBeLessThanOrEqual(raw.size);
    expect(kept.size).toBeLessThanOrEqual(
      mapStreamingPolicy('mobile').maxElements,
    );
    const roadTypes = new Set<string>(ROAD_TYPES);
    for (const element of raw.values()) {
      const tags = element.tags ?? {};
      if (
        element.type !== 'way' ||
        !roadTypes.has(tags.highway) ||
        tags.area === 'yes' ||
        tags.access === 'no' ||
        tags.access === 'private' ||
        tags.motor_vehicle === 'no' ||
        tags.motorcar === 'no'
      )
        continue;
      expect(kept.has(`way/${element.id}`)).toBe(true);
    }
    for (const element of kept.values()) {
      for (const node of element.nodes ?? [])
        expect(kept.has(`node/${node}`)).toBe(true);
      for (const member of element.members ?? [])
        if (raw.has(`${member.type}/${member.ref}`))
          expect(kept.has(`${member.type}/${member.ref}`)).toBe(true);
    }
  },
  30_000,
);
