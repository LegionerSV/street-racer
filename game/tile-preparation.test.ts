import { expect, it, vi } from 'vitest';
import { createRegionTileSource } from './region-tile-source';
import { sourceTileBounds, sourceTileCenter } from './source-tiles';
import { decodeTileArtifact, encodeTileArtifact } from './tile-artifact';
import {
  prepareTileArtifact,
  type TilePreparationAdapters,
} from './tile-preparation';

const tileId = { z: 15, x: 19808, y: 10243 } as const;
const generatedAt = '2026-09-10T12:00:00.000Z';
const savedAt = Date.parse('2026-09-09T08:30:00.000Z');

function fixtureAdapters(): TilePreparationAdapters {
  return {
    map: async () => ({
      savedAt,
      elements: [
        { type: 'node', id: 1, lat: 55.75, lon: 37.61 },
        {
          type: 'way',
          id: 2,
          nodes: [1],
          tags: { highway: 'service', name: 'Тестовый проезд' },
        },
      ],
    }),
    elevation: async (_center, _signal, shape) => ({
      ...shape,
      values: new Float32Array([100, 101, 102, 103]),
    }),
    drivingSide: async () => ({ side: 'right', resolved: true }),
  };
}

it('готовит TileArtifactV1 в Node без browser globals', async () => {
  // Arrange
  const adapters = fixtureAdapters();

  // Act
  const input = await prepareTileArtifact(
    tileId,
    new AbortController().signal,
    {
      tileMargin: 300,
      elevationSize: 700,
      elevationWidth: 2,
      generatedAt,
    },
    adapters,
  );
  const artifact = decodeTileArtifact(encodeTileArtifact(input), tileId);

  // Assert
  expect(artifact.coreBounds).toEqual(sourceTileBounds(tileId));
  expect(artifact.bufferedBounds.south).toBeLessThan(artifact.coreBounds.south);
  expect(artifact.bufferedBounds.west).toBeLessThan(artifact.coreBounds.west);
  expect(artifact.bufferedBounds.north).toBeGreaterThan(
    artifact.coreBounds.north,
  );
  expect(artifact.bufferedBounds.east).toBeGreaterThan(
    artifact.coreBounds.east,
  );
  expect(artifact.osmTimestamp).toBe(new Date(savedAt).toISOString());
  expect(artifact.elevation.values).toEqual(
    new Float32Array([100, 101, 102, 103]),
  );
});

it('даёт семантически идентичный артефакт через Node-ядро и browser fallback', async () => {
  // Arrange
  const adapters = fixtureAdapters(),
    browserMap = vi.fn(adapters.map),
    browserElevation = vi.fn(adapters.elevation),
    browserDrivingSide = vi.fn(adapters.drivingSide),
    signal = new AbortController().signal,
    options = {
      tileMargin: 300,
      elevationSize: 700,
      elevationWidth: 2,
      generatedAt,
    };

  // Act
  const nodeInput = await prepareTileArtifact(
      tileId,
      signal,
      options,
      adapters,
    ),
    browserSource = createRegionTileSource({
      ...options,
      now: () => new Date(generatedAt),
      get: async () => undefined,
      put: async () => {},
      mapCell: browserMap,
      loadElevation: browserElevation,
      drivingSide: browserDrivingSide,
    }),
    browserResult = await browserSource.load(tileId, signal),
    nodeArtifact = decodeTileArtifact(encodeTileArtifact(nodeInput), tileId);

  // Assert
  expect(browserResult.kind).toBe('hit');
  if (browserResult.kind !== 'hit') return;
  expect(browserResult.tile).toEqual(nodeArtifact);
  expect(browserMap).toHaveBeenCalledExactlyOnceWith(
    nodeArtifact.bufferedBounds,
    `Source-тайл ${tileId.z}/${tileId.x}/${tileId.y}`,
    expect.any(AbortSignal),
  );
  expect(browserElevation).toHaveBeenCalledTimes(1);
  expect(browserElevation.mock.calls[0][0]).toEqual(sourceTileCenter(tileId));
  expect(browserElevation.mock.calls[0][1]).toBeInstanceOf(AbortSignal);
  expect(browserElevation.mock.calls[0][2]).toEqual({
    size: 700,
    width: 2,
    offsetX: 0,
    offsetZ: 0,
  });
  expect(browserDrivingSide).toHaveBeenCalledExactlyOnceWith(
    sourceTileCenter(tileId),
    expect.any(AbortSignal),
  );
});

it('передаёт отмену всем адаптерам подготовки', async () => {
  // Arrange
  const control = new AbortController(),
    cancelled = new Error('Подготовка отменена.'),
    map = vi.fn(
      (_bounds, _stage, signal: AbortSignal) =>
        new Promise<never>((_resolve, reject) =>
          signal.addEventListener('abort', () => reject(signal.reason), {
            once: true,
          }),
        ),
    ),
    drivingSide = vi.fn(async (_center, _signal: AbortSignal) => ({
      side: 'right' as const,
      resolved: true,
    }));

  // Act
  const preparation = prepareTileArtifact(
    tileId,
    control.signal,
    {
      tileMargin: 300,
      elevationSize: 700,
      elevationWidth: 2,
      generatedAt,
    },
    { ...fixtureAdapters(), map, drivingSide },
  );
  control.abort(cancelled);

  // Assert
  await expect(preparation).rejects.toBe(cancelled);
  expect(map.mock.calls[0][2]).toBe(control.signal);
  expect(drivingSide.mock.calls[0][1]).toBe(control.signal);
});

it('разделяет OSM-запрос halo на валидные bbox у антимеридиана', async () => {
  // Arrange
  const edgeTile = { z: 15, x: 0, y: 10243 },
    olderSavedAt = savedAt - 24 * 60 * 60 * 1000,
    map = vi
      .fn()
      .mockResolvedValueOnce({
        savedAt,
        elements: [{ type: 'node' as const, id: 1, lat: 55.75, lon: 179.999 }],
      })
      .mockResolvedValueOnce({
        savedAt: olderSavedAt,
        elements: [{ type: 'node' as const, id: 1, lat: 55.75, lon: 179.999 }],
      });

  // Act
  const input = await prepareTileArtifact(
    edgeTile,
    new AbortController().signal,
    {
      tileMargin: 300,
      elevationSize: 700,
      elevationWidth: 2,
      generatedAt,
    },
    { ...fixtureAdapters(), map },
  );
  const artifact = decodeTileArtifact(encodeTileArtifact(input), edgeTile);

  // Assert
  expect(artifact.bufferedBounds.west).toBeLessThan(-180);
  expect(map).toHaveBeenCalledTimes(2);
  for (const [bounds] of map.mock.calls) {
    expect(bounds.west).toBeGreaterThanOrEqual(-180);
    expect(bounds.east).toBeLessThanOrEqual(180);
    expect(bounds.west).toBeLessThan(bounds.east);
  }
  expect(artifact.elements).toHaveLength(1);
  expect(artifact.osmTimestamp).toBe(new Date(olderSavedAt).toISOString());
});
