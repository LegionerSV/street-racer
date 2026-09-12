import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { brotliDecompressSync } from 'node:zlib';
import { pathToFileURL } from 'node:url';
import { sampleElevation, toLocal } from '../game/geo.ts';
import {
  parseSourceTileKey,
  sourceTileBounds,
  sourceTileCenter,
  sourceTileKey,
  type SourceTileId,
} from '../game/source-tiles.ts';
import {
  decodeTileArtifact,
  type TileArtifactV1,
} from '../game/tile-artifact.ts';

const MAX_ELEVATION_DELTA_METERS = 0.5;

export type SeamVerificationReport = {
  tiles: number;
  seams: number;
  geometrySharedElements: number;
  maxElevationDeltaMeters: number;
};

type StagingManifest = {
  complete: boolean;
  planned: number;
  tiles: Record<string, { path: string }>;
};

function elementKey(element: TileArtifactV1['elements'][number]) {
  return `${element.type}/${element.id}`;
}

function expectedOverlapKeys(
  tile: TileArtifactV1,
  neighbour: TileArtifactV1,
) {
  const bounds = neighbour.bufferedBounds,
    overlap = new Set<string>(),
    elements = new Map(tile.elements.map((element) => [elementKey(element), element]));
  for (const element of tile.elements)
    if (
      element.type === 'node' &&
      element.lat !== undefined &&
      element.lon !== undefined &&
      element.lat >= bounds.south &&
      element.lat <= bounds.north &&
      element.lon >= bounds.west &&
      element.lon <= bounds.east
    )
      overlap.add(elementKey(element));
  for (const element of tile.elements)
    if (
      element.type === 'way' &&
      element.nodes?.some((id) => overlap.has(`node/${id}`))
    )
      overlap.add(elementKey(element));
  for (const element of tile.elements)
    if (
      element.type === 'relation' &&
      element.members?.some((member) =>
        overlap.has(`${member.type}/${member.ref}`),
      )
    )
      overlap.add(elementKey(element));
  return { overlap, elements };
}

function verifyGeometry(first: TileArtifactV1, second: TileArtifactV1) {
  const firstExpected = expectedOverlapKeys(first, second),
    secondExpected = expectedOverlapKeys(second, first),
    secondElements = secondExpected.elements;
  for (const key of firstExpected.overlap)
    if (!secondElements.has(key))
      throw new Error(
        `OSM-объект ${key} отсутствует на соседней стороне шва ${sourceTileKey(first)}/${sourceTileKey(second)}.`,
      );
  for (const key of secondExpected.overlap)
    if (!firstExpected.elements.has(key))
      throw new Error(
        `OSM-объект ${key} отсутствует на соседней стороне шва ${sourceTileKey(first)}/${sourceTileKey(second)}.`,
      );
  let shared = 0;
  for (const element of first.elements) {
    const other = secondElements.get(elementKey(element));
    if (!other) continue;
    shared++;
    if (JSON.stringify(element) !== JSON.stringify(other))
      throw new Error(
        `Общий OSM-объект отличается на шве ${sourceTileKey(first)}/${sourceTileKey(second)}: ${elementKey(element)}.`,
      );
  }
  return shared;
}

function seamPoints(
  first: TileArtifactV1,
  second: TileArtifactV1,
  direction: 'east' | 'south',
) {
  const firstBounds = sourceTileBounds(first),
    secondBounds = sourceTileBounds(second);
  if (direction === 'east' && firstBounds.east !== secondBounds.west)
    throw new Error('Границы соседних source-тайлов не совпадают.');
  if (direction === 'south' && firstBounds.south !== secondBounds.north)
    throw new Error('Границы соседних source-тайлов не совпадают.');
  if (
    first.bufferedBounds.east < secondBounds.west ||
    second.bufferedBounds.west > firstBounds.east ||
    first.bufferedBounds.south > secondBounds.north ||
    second.bufferedBounds.north < firstBounds.south
  )
    throw new Error('Буферы соседних source-тайлов не перекрываются.');

  return Array.from({ length: 9 }, (_, index) => {
    const ratio = index / 8;
    return direction === 'east'
      ? {
          lat:
            firstBounds.south + (firstBounds.north - firstBounds.south) * ratio,
          lon: firstBounds.east,
        }
      : {
          lat: firstBounds.south,
          lon: firstBounds.west + (firstBounds.east - firstBounds.west) * ratio,
        };
  });
}

function elevationDelta(
  first: TileArtifactV1,
  second: TileArtifactV1,
  direction: 'east' | 'south',
) {
  const firstCenter = sourceTileCenter(first),
    secondCenter = sourceTileCenter(second);
  let maximum = 0;
  for (const point of seamPoints(first, second, direction)) {
    const firstLocal = toLocal(point.lat, point.lon, firstCenter),
      secondLocal = toLocal(point.lat, point.lon, secondCenter),
      delta = Math.abs(
        sampleElevation(first.elevation, firstLocal.x, firstLocal.z) -
          sampleElevation(second.elevation, secondLocal.x, secondLocal.z),
      );
    maximum = Math.max(maximum, delta);
  }
  if (maximum > MAX_ELEVATION_DELTA_METERS)
    throw new Error(
      `Перепад рельефа на шве ${sourceTileKey(first)}/${sourceTileKey(second)}: ${maximum.toFixed(3)} м.`,
    );
  return maximum;
}

export function verifyTileSeams(
  tiles: TileArtifactV1[],
): SeamVerificationReport {
  const indexed = new Map(tiles.map((tile) => [sourceTileKey(tile), tile]));
  let seams = 0,
    geometrySharedElements = 0,
    maxElevationDeltaMeters = 0;
  for (const tile of tiles) {
    const neighbours: [SourceTileId, 'east' | 'south'][] = [
      [{ z: tile.z, x: tile.x + 1, y: tile.y }, 'east'],
      [{ z: tile.z, x: tile.x, y: tile.y + 1 }, 'south'],
    ];
    for (const [id, direction] of neighbours) {
      const neighbour = indexed.get(sourceTileKey(id));
      if (!neighbour) continue;
      seams++;
      geometrySharedElements += verifyGeometry(tile, neighbour);
      maxElevationDeltaMeters = Math.max(
        maxElevationDeltaMeters,
        elevationDelta(tile, neighbour, direction),
      );
    }
  }
  if (!seams)
    throw new Error('В наборе нет соседних source-тайлов для проверки.');
  return {
    tiles: tiles.length,
    seams,
    geometrySharedElements,
    maxElevationDeltaMeters,
  };
}

export async function verifyMapPilot(stagingDirectory: string) {
  const staging = resolve(stagingDirectory),
    manifest = JSON.parse(
      await readFile(resolve(staging, 'staging-manifest-v1.json'), 'utf8'),
    ) as StagingManifest;
  if (
    !manifest.complete ||
    Object.keys(manifest.tiles).length !== manifest.planned
  )
    throw new Error('Staging manifest не завершён или содержит не все тайлы.');
  const entries = new Map(Object.entries(manifest.tiles)),
    load = async (key: string) => {
      const descriptor = entries.get(key);
      if (!descriptor) return undefined;
      const compressed = await readFile(resolve(staging, descriptor.path));
      return decodeTileArtifact(
        new TextDecoder().decode(brotliDecompressSync(compressed)),
        parseSourceTileKey(key),
      );
    };
  let seams = 0,
    geometrySharedElements = 0,
    maxElevationDeltaMeters = 0,
    prefetchedEast:
      | { key: string; tile: TileArtifactV1 }
      | undefined;
  for (const key of entries.keys()) {
    const tile =
        prefetchedEast?.key === key
          ? prefetchedEast.tile
          : (await load(key))!,
      neighbours: [SourceTileId, 'east' | 'south'][] = [
        [{ z: tile.z, x: tile.x + 1, y: tile.y }, 'east'],
        [{ z: tile.z, x: tile.x, y: tile.y + 1 }, 'south'],
      ];
    prefetchedEast = undefined;
    for (const [id, direction] of neighbours) {
      const neighbourKey = sourceTileKey(id),
        neighbour = await load(neighbourKey);
      if (!neighbour) continue;
      if (direction === 'east')
        prefetchedEast = { key: neighbourKey, tile: neighbour };
      seams++;
      geometrySharedElements += verifyGeometry(tile, neighbour);
      maxElevationDeltaMeters = Math.max(
        maxElevationDeltaMeters,
        elevationDelta(tile, neighbour, direction),
      );
    }
  }
  if (!seams)
    throw new Error('В наборе нет соседних source-тайлов для проверки.');
  return {
    tiles: entries.size,
    seams,
    geometrySharedElements,
    maxElevationDeltaMeters,
  };
}

async function main() {
  const staging = process.argv[2];
  if (!staging) throw new Error('Укажите каталог staging первым аргументом.');
  console.log(JSON.stringify(await verifyMapPilot(staging), null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  await main();
