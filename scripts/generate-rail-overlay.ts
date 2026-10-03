#!/usr/bin/env node

import { execFile } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { mkdir, rename, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import {
  latLonToSourceTile,
  sourceTileKey,
  type SourceTileId,
} from '../game/source-tiles.ts';
import { readBoundaryTiles } from './map-coverage.ts';
import { generateMapTiles } from './generate-map-tiles.ts';
import { MAP_FULL_COVERAGE_CONFIG } from './map-full-coverage-config.ts';
import {
  overlayCoverageGeneratorOptions,
  verifyFullCoverageInputs,
} from './generate-full-map-coverage.ts';

type RailRegion = 'moscow' | 'saint-petersburg';
type Feature = {
  geometry?: { type: string; coordinates: unknown };
  properties?: Record<string, string>;
};
const execute = promisify(execFile);

export function railFeatureTiles(
  feature: Feature,
  coverage: Set<string>,
): string[] {
  const railway = feature.properties?.railway;
  const trainPlatform =
    feature.properties?.public_transport === 'platform' &&
    feature.properties?.train === 'yes';
  const ship =
    ['ship', 'houseboat'].includes(feature.properties?.building || '') ||
    feature.properties?.historic === 'ship' ||
    !!feature.properties?.['ship:type'];
  if (
    (!['rail', 'narrow_gauge', 'station', 'platform'].includes(railway || '') &&
      !trainPlatform &&
      !ship) ||
    !feature.geometry
  )
    return [];
  if (
    ship &&
    !['Polygon', 'MultiPolygon', 'LineString'].includes(feature.geometry.type)
  )
    return [];
  const isCoordinate = (value: unknown): value is [number, number] =>
    Array.isArray(value) &&
    value.length >= 2 &&
    typeof value[0] === 'number' &&
    Number.isFinite(value[0]) &&
    typeof value[1] === 'number' &&
    Number.isFinite(value[1]);
  const paths: [number, number][][] = [];
  const collect = (value: unknown) => {
    if (isCoordinate(value)) {
      paths.push([value]);
      return;
    }
    if (!Array.isArray(value)) return;
    if (value.every(isCoordinate)) {
      paths.push(value);
      return;
    }
    for (const part of value) collect(part);
  };
  collect(feature.geometry.coordinates);
  if (feature.geometry.type === 'MultiPoint') {
    for (const path of paths.splice(0))
      for (const point of path) paths.push([point]);
  }
  if (
    ship &&
    feature.geometry.type === 'LineString' &&
    ((paths[0]?.length ?? 0) < 4 ||
      paths[0][0][0] !== paths[0].at(-1)![0] ||
      paths[0][0][1] !== paths[0].at(-1)![1])
  )
    return [];
  const keys = new Set<string>();
  for (const path of paths)
    for (let i = 0; i < path.length; i++) {
      const [lonA, latA] = path[i],
        [lonB, latB] = path[i + 1] ?? path[i];
      const latitude = (latA + latB) / 2;
      const latMargin = 300 / 111320,
        lonMargin = 300 / (111320 * Math.cos((latitude * Math.PI) / 180));
      const northWest = latLonToSourceTile(
        Math.max(latA, latB) + latMargin,
        Math.min(lonA, lonB) - lonMargin,
      );
      const southEast = latLonToSourceTile(
        Math.min(latA, latB) - latMargin,
        Math.max(lonA, lonB) + lonMargin,
      );
      for (let y = northWest.y; y <= southEast.y; y++)
        for (let x = northWest.x; x <= southEast.x; x++) {
          const key = sourceTileKey({ z: 15, x, y });
          if (coverage.has(key)) keys.add(key);
        }
    }
  return [...keys];
}

async function runOsmium(executable: string, arguments_: string[]) {
  await execute(executable, arguments_, {
    windowsHide: true,
    maxBuffer: 1024 * 1024,
  });
}

async function preparedSelection(
  region: RailRegion,
  dataRoot: string,
  cacheRoot: string,
  osmium: string,
) {
  const definition = MAP_FULL_COVERAGE_CONFIG.regions[region];
  const pbf = resolve(dataRoot, definition.pbf.file);
  const cache = resolve(cacheRoot, 'rail-ship-selection');
  await mkdir(cache, { recursive: true });
  const checksum = definition.pbf.checksum.slice(4, 16);
  const filtered = join(cache, `${region}-${checksum}-platforms-2.osm.pbf`);
  const exported = join(cache, `${region}-${checksum}-platforms-2.geojsonseq`);
  try {
    await stat(filtered);
  } catch {
    const temporary = `${filtered}.tmp.osm.pbf`;
    await runOsmium(osmium, [
      'tags-filter',
      pbf,
      'w/railway=rail,narrow_gauge',
      'nwr/railway=station',
      'nwr/railway=platform',
      'nwr/public_transport=platform',
      ...(region === 'saint-petersburg'
        ? [
            'nwr/historic=ship',
            'nwr/ship:type',
            'w/building=ship,houseboat',
            'r/building=ship,houseboat',
          ]
        : []),
      '-o',
      temporary,
      '--overwrite',
    ]);
    await rename(temporary, filtered);
  }
  try {
    await stat(exported);
  } catch {
    const temporary = `${exported}.tmp.geojsonseq`;
    await runOsmium(osmium, [
      'export',
      filtered,
      '-f',
      'geojsonseq',
      '-o',
      temporary,
      '--overwrite',
    ]);
    await rename(temporary, exported);
  }
  return exported;
}

export async function selectRailOverlayTiles(
  region: RailRegion,
  dataRoot: string,
  cacheRoot: string,
  osmium: string,
): Promise<SourceTileId[]> {
  const definition = MAP_FULL_COVERAGE_CONFIG.regions[region];
  const allowed = new Set(
    (await readBoundaryTiles(resolve(definition.boundary.file))).map(
      sourceTileKey,
    ),
  );
  const file = await preparedSelection(region, dataRoot, cacheRoot, osmium);
  const selected = new Set<string>();
  const lines = createInterface({
    input: createReadStream(file, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  });
  for await (const line of lines) {
    if (!line.trim()) continue;
    const feature = JSON.parse(
      line.charCodeAt(0) === 30 ? line.slice(1) : line,
    ) as Feature;
    for (const key of railFeatureTiles(feature, allowed)) selected.add(key);
  }
  return [...selected].sort().map((key) => {
    const [z, x, y] = key.split('/').map(Number);
    return { z, x, y };
  });
}

async function main() {
  const args = process.argv.slice(2);
  const get = (name: string) => {
    const index = args.indexOf(name);
    return index < 0 ? undefined : args[index + 1];
  };
  const region = get('--region') as RailRegion;
  if (!['moscow', 'saint-petersburg'].includes(region))
    throw new Error('Укажите --region moscow или saint-petersburg.');
  const dataRoot = get('--data-root') || 'work/map-data';
  const cacheRoot = get('--cache-root') || 'work/map-cache';
  const stagingRoot = get('--staging-root') || 'work/map-overlays';
  const osmium = get('--osmium') || 'osmium';
  const overlayId = get('--overlay-id');
  if (!overlayId) throw new Error('Укажите --overlay-id.');
  const pbf = resolve(
    dataRoot,
    MAP_FULL_COVERAGE_CONFIG.regions[region].pbf.file,
  );
  await verifyFullCoverageInputs(region, { pbf });
  const tiles = await selectRailOverlayTiles(
    region,
    dataRoot,
    cacheRoot,
    osmium,
  );
  console.log(
    JSON.stringify({ region, selectedTiles: tiles.length, overlayId }),
  );
  const options = overlayCoverageGeneratorOptions(
    region,
    { dataRoot, cacheRoot, stagingRoot, osmiumPath: osmium },
    overlayId,
    tiles,
    {
      dryRun: args.includes('--dry-run'),
      downloadDem: args.includes('--download-dem'),
    },
  );
  options.generatedAt = new Date().toISOString();
  const report = await generateMapTiles(options, (event) => {
    if (event.kind === 'failed') console.log(JSON.stringify(event));
  });
  console.log(JSON.stringify(report));
  if (report.failed.length) process.exitCode = 1;
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  await main();
