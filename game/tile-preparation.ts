import { toGeo, toLocal } from './geo';
import type { MapBox } from './map-source';
import {
  sourceTileBounds,
  sourceTileCenter,
  type SourceTileBounds,
  type SourceTileId,
} from './source-tiles';
import {
  TILE_ARTIFACT_SCHEMA_VERSION,
  TILE_BUILD_VERSION,
  type TileArtifactV1Input,
} from './tile-artifact';
import type { Center, ElevationGrid, OSMElement, RegionData } from './types';

type ElevationShape = {
  size: number;
  width: number;
  offsetX: number;
  offsetZ: number;
};

export type TilePreparationOptions = {
  tileMargin: number;
  elevationSize: number;
  elevationWidth: number;
  generatedAt: string;
};

export type TilePreparationAdapters = {
  map: (
    bounds: MapBox,
    stage: string,
    signal: AbortSignal,
  ) => Promise<{ elements: OSMElement[]; savedAt: number }>;
  elevation: (
    center: Center,
    signal: AbortSignal,
    shape: ElevationShape,
  ) => Promise<ElevationGrid>;
  drivingSide: (
    center: Center,
    signal: AbortSignal,
  ) => Promise<{ side: RegionData['drivingSide']; resolved: boolean }>;
};

function unwrapLongitude(lon: number, center: number) {
  while (lon - center > 180) lon -= 360;
  while (lon - center < -180) lon += 360;
  return lon;
}

export function bufferedSourceTileBounds(
  id: SourceTileId,
  margin: number,
): SourceTileBounds {
  if (!Number.isFinite(margin) || margin < 0)
    throw new Error('Halo source-тайла должен быть неотрицательным числом.');
  const core = sourceTileBounds(id),
    center = sourceTileCenter(id),
    southWest = toGeo(
      {
        x: toLocal(center.lat, core.west, center).x - margin,
        y: 0,
        z: toLocal(core.south, center.lon, center).z - margin,
      },
      center,
    ),
    northEast = toGeo(
      {
        x: toLocal(center.lat, core.east, center).x + margin,
        y: 0,
        z: toLocal(core.north, center.lon, center).z + margin,
      },
      center,
    );
  return {
    south: southWest.lat,
    west: unwrapLongitude(southWest.lon, center.lon),
    north: northEast.lat,
    east: unwrapLongitude(northEast.lon, center.lon),
  };
}

function overpassBounds(bounds: SourceTileBounds): MapBox[] {
  if (bounds.west < -180)
    return [
      { ...bounds, west: bounds.west + 360, east: 180 },
      { ...bounds, west: -180 },
    ];
  if (bounds.east > 180)
    return [
      { ...bounds, east: 180 },
      { ...bounds, west: -180, east: bounds.east - 360 },
    ];
  return [bounds];
}

export async function prepareTileArtifact(
  id: SourceTileId,
  signal: AbortSignal,
  options: TilePreparationOptions,
  adapters: TilePreparationAdapters,
): Promise<TileArtifactV1Input> {
  signal.throwIfAborted();
  const coreBounds = sourceTileBounds(id),
    tileCenter = sourceTileCenter(id),
    bounds = bufferedSourceTileBounds(id, options.tileMargin),
    stage = `Source-тайл ${id.z}/${id.x}/${id.y}`,
    mapPromise = Promise.all(
      overpassBounds(bounds).map((box) => adapters.map(box, stage, signal)),
    ).then((parts) => ({
      savedAt: Math.min(...parts.map((part) => part.savedAt)),
      elements: [
        ...new Map(
          parts.flatMap((part) =>
            part.elements.map((element) => [
              `${element.type}/${element.id}`,
              element,
            ]),
          ),
        ).values(),
      ],
    })),
    [map, elevation, drivingSide] = await Promise.all([
      mapPromise,
      adapters.elevation(tileCenter, signal, {
        size: options.elevationSize,
        width: options.elevationWidth,
        offsetX: 0,
        offsetZ: 0,
      }),
      adapters.drivingSide(tileCenter, signal),
    ]);
  signal.throwIfAborted();
  return {
    schemaVersion: TILE_ARTIFACT_SCHEMA_VERSION,
    tileBuildVersion: TILE_BUILD_VERSION,
    ...id,
    coreBounds,
    bufferedBounds: bounds,
    generatedAt: options.generatedAt,
    osmTimestamp: new Date(map.savedAt).toISOString(),
    drivingSide: drivingSide.side,
    drivingSideSource: drivingSide.resolved ? 'tile-center' : 'default',
    elements: map.elements,
    elevation,
  };
}
