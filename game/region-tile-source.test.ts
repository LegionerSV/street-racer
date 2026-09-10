import { expect, it, vi } from 'vitest';
import { toGeo, toLocal } from './geo';
import {
  createRegionTileSource,
  tileElevationForSession,
} from './region-tile-source';
import { sourceTileBounds, sourceTileCenter } from './source-tiles';
import {
  TILE_ARTIFACT_SCHEMA_VERSION,
  TILE_BUILD_VERSION,
  encodeTileArtifact,
  type TileArtifactV1,
} from './tile-artifact';

const tileId = { z: 15, x: 19808, y: 10243 };

it('загружает опубликованный S3-тайл без Overpass и DEM и сохраняет его в кэш', async () => {
  // Arrange
  const coreBounds = sourceTileBounds(tileId),
    encoded = encodeTileArtifact({
      schemaVersion: TILE_ARTIFACT_SCHEMA_VERSION,
      tileBuildVersion: TILE_BUILD_VERSION,
      ...tileId,
      coreBounds,
      bufferedBounds: coreBounds,
      generatedAt: '2026-09-10T00:00:00.000Z',
      osmTimestamp: '2026-09-09T00:00:00.000Z',
      drivingSide: 'right',
      elements: [],
      elevation: {
        width: 2,
        size: 690,
        values: new Float32Array(4),
      },
    }),
    parsed = JSON.parse(encoded),
    catalog = {
      schemaVersion: 1,
      generatedAt: '2026-09-10T01:00:00.000Z',
      activeDatasets: ['pilot'],
      datasets: [
        {
          datasetId: 'pilot',
          schemaVersion: TILE_ARTIFACT_SCHEMA_VERSION,
          tileBuildVersion: TILE_BUILD_VERSION,
          path: 'maps/v1/build/pilot',
          tiles: {
            '15/19808/10243': {
              bytes: encoded.length,
              checksum: parsed.checksum,
            },
          },
        },
      ],
    },
    request = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(catalog)))
      .mockResolvedValueOnce(new Response(encoded)),
    mapCell = vi.fn(),
    loadElevation = vi.fn(),
    drivingSide = vi.fn(),
    put = vi.fn(async () => {}),
    source = createRegionTileSource({
      elevationSize: 2600,
      elevationWidth: 3,
      tileMargin: 300,
      tileBaseUrl: 'https://maps.example',
      tileFetch: request,
      get: async () => undefined,
      put,
      mapCell,
      loadElevation,
      drivingSide,
    });

  // Act
  const result = await source.load(tileId, new AbortController().signal);

  // Assert
  expect(result.kind).toBe('hit');
  expect(result.source).toBe('s3');
  expect(mapCell).not.toHaveBeenCalled();
  expect(loadElevation).not.toHaveBeenCalled();
  expect(drivingSide).not.toHaveBeenCalled();
  expect(put).toHaveBeenCalledTimes(1);
});

it('определяет сторону движения по центру глобального тайла, а не сессии', async () => {
  // Arrange
  const drivingSide = vi.fn(async () => ({
      side: 'right' as const,
      resolved: true,
    })),
    source = createRegionTileSource({
      elevationSize: 2600,
      elevationWidth: 3,
      tileMargin: 300,
      get: async () => undefined,
      put: async () => {},
      mapCell: async () => ({ elements: [], savedAt: 123456789 }),
      loadElevation: async (_center, _signal, shape) => ({
        ...shape,
        values: new Float32Array(shape.width ** 2),
      }),
      drivingSide,
    });

  // Act
  const result = await source.load(tileId, new AbortController().signal);

  // Assert
  expect(result.kind).toBe('hit');
  expect(drivingSide).toHaveBeenCalledExactlyOnceWith(
    sourceTileCenter(tileId),
    expect.any(AbortSignal),
  );
  if (result.kind === 'hit')
    expect(result.tile.osmTimestamp).toBe(new Date(123456789).toISOString());
  if (result.kind === 'hit')
    expect(result.tile.drivingSideSource).toBe('tile-center');
});

it('сохраняет географический масштаб DEM вдали от центра высокоширотной сессии', () => {
  // Arrange
  const highLatitudeTile = { z: 15, x: 16384, y: 1780 },
    coreBounds = sourceTileBounds(highLatitudeTile),
    tileCenter = sourceTileCenter(highLatitudeTile),
    sessionCenter = { lat: tileCenter.lat - 0.36, lon: tileCenter.lon },
    tile: TileArtifactV1 = {
      schemaVersion: TILE_ARTIFACT_SCHEMA_VERSION,
      tileBuildVersion: TILE_BUILD_VERSION,
      ...highLatitudeTile,
      coreBounds,
      bufferedBounds: coreBounds,
      generatedAt: '2026-09-10T00:00:00.000Z',
      osmTimestamp: '2026-09-10T00:00:00.000Z',
      drivingSide: 'right',
      elements: [],
      elevation: {
        width: 2,
        size: 2600,
        values: new Float32Array(4),
      },
      checksum: 'test',
    },
    geographicEastEdge = toGeo({ x: 1300, y: 0, z: 0 }, tileCenter);

  // Act
  const patch = tileElevationForSession(tile, sessionCenter),
    localEastEdge = toLocal(
      geographicEastEdge.lat,
      geographicEastEdge.lon,
      sessionCenter,
    );

  // Assert
  expect(tileCenter.lat - sessionCenter.lat).toBeCloseTo(0.36, 8);
  expect(patch.sizeX).not.toBeCloseTo(patch.size, 3);
  expect(localEastEdge.x).toBeCloseTo(patch.offsetX! + patch.sizeX! / 2, 6);
});
