import { describe, expect, it } from 'vitest';
import { MAP_BUILD_VERSION } from './map-version';
import { sourceTileBounds } from './source-tiles';
import {
  TILE_ARTIFACT_SCHEMA_VERSION,
  TILE_BUILD_VERSION,
  TileArtifactError,
  decodeTileArtifact,
  encodeTileArtifact,
  type TileArtifactV1Input,
} from './tile-artifact';

const tileId = { z: 15, x: 19808, y: 10243 } as const;

function artifact(): TileArtifactV1Input {
  const coreBounds = sourceTileBounds(tileId);
  return {
    schemaVersion: TILE_ARTIFACT_SCHEMA_VERSION,
    tileBuildVersion: TILE_BUILD_VERSION,
    ...tileId,
    coreBounds,
    bufferedBounds: {
      south: coreBounds.south - 0.003,
      west: coreBounds.west - 0.005,
      north: coreBounds.north + 0.003,
      east: coreBounds.east + 0.005,
    },
    generatedAt: '2026-09-09T20:00:00.000Z',
    osmTimestamp: '2026-09-08T00:00:00Z',
    drivingSide: 'right',
    elements: [
      { type: 'node', id: 11, lat: 55.75, lon: 37.61 },
      {
        type: 'way',
        id: 22,
        nodes: [11, 12],
        tags: { highway: 'primary', name: 'Тверская улица' },
      },
      {
        type: 'relation',
        id: 33,
        members: [{ type: 'way', ref: 22, role: 'from' }],
        tags: { type: 'restriction' },
      },
    ],
    elevation: {
      width: 2,
      size: 690,
      sizeX: 688.5,
      sizeZ: 691.5,
      offsetX: 12.5,
      offsetZ: -7.25,
      values: new Float32Array([-0, 1.5, 123.25, -42.75]),
    },
  };
}

function expectArtifactError(
  operation: () => unknown,
  code: TileArtifactError['code'],
  message: string,
) {
  try {
    operation();
    throw new Error('Ожидалась ошибка TileArtifactError.');
  } catch (error) {
    expect(error).toBeInstanceOf(TileArtifactError);
    expect((error as TileArtifactError).code).toBe(code);
    expect((error as Error).message).toBe(message);
  }
}

describe('TileArtifactV1', () => {
  it('точно восстанавливает OSM и Float32Array после JSON round-trip', () => {
    // Arrange
    const input = artifact();

    // Act
    const encoded = encodeTileArtifact(input);
    const decoded = decodeTileArtifact(encoded, tileId);

    // Assert
    expect(decoded.elements).toEqual(input.elements);
    expect(decoded.elevation.values).toBeInstanceOf(Float32Array);
    expect([...decoded.elevation.values]).toEqual([-0, 1.5, 123.25, -42.75]);
    expect(Object.is(decoded.elevation.values[0], -0)).toBe(true);
    expect(decoded.elevation).toEqual(input.elevation);
    expect(decoded.checksum).toMatch(/^crc32:[0-9a-f]{8}$/);
    expect(JSON.parse(encoded).elevation.values.encoding).toBe('float32-le');
  });

  it('использует отдельную версию сборки source-тайлов', () => {
    // Arrange / Act / Assert
    expect(TILE_BUILD_VERSION).not.toBe(MAP_BUILD_VERSION);
    expect(artifact().tileBuildVersion).toBe(TILE_BUILD_VERSION);
  });

  it('повторно кодирует уже декодированный артефакт', () => {
    // Arrange
    const decoded = decodeTileArtifact(encodeTileArtifact(artifact()), tileId);

    // Act
    const encodedAgain = encodeTileArtifact(decoded);
    const decodedAgain = decodeTileArtifact(encodedAgain, tileId);

    // Assert
    expect(decodedAgain.elements).toEqual(decoded.elements);
    expect(decodedAgain.elevation).toEqual(decoded.elevation);
    expect(decodedAgain.checksum).toBe(decoded.checksum);
  });

  it('отклоняет несовместимые версии детерминированными ошибками', () => {
    // Arrange
    const wrongSchema = JSON.parse(encodeTileArtifact(artifact()));
    wrongSchema.schemaVersion = 2;
    const wrongBuild = JSON.parse(encodeTileArtifact(artifact()));
    wrongBuild.tileBuildVersion = 'legacy-tile-build';

    // Act / Assert
    expectArtifactError(
      () => decodeTileArtifact(JSON.stringify(wrongSchema), tileId),
      'incompatible-schema',
      'Несовместимая версия формата source-тайла: 2.',
    );
    expectArtifactError(
      () => decodeTileArtifact(JSON.stringify(wrongBuild), tileId),
      'incompatible-build',
      'Несовместимая версия сборки source-тайла: legacy-tile-build.',
    );
  });

  it('отклоняет артефакт другого tile ID', () => {
    // Arrange
    const encoded = encodeTileArtifact(artifact());

    // Act / Assert
    expectArtifactError(
      () => decodeTileArtifact(encoded, { ...tileId, x: tileId.x + 1 }),
      'tile-mismatch',
      'Ожидался source-тайл 15/19809/10243, получен 15/19808/10243.',
    );
  });

  it('отклоняет нечисловые высоты и некорректные bounds до кодирования', () => {
    // Arrange
    const invalidHeight = artifact();
    invalidHeight.elevation.values[2] = Number.NaN;
    const invalidBounds = artifact();
    invalidBounds.bufferedBounds = {
      ...invalidBounds.bufferedBounds,
      north: invalidBounds.coreBounds.north - 0.001,
    };
    const impossibleLatitude = artifact();
    impossibleLatitude.bufferedBounds = {
      ...impossibleLatitude.bufferedBounds,
      south: -91,
    };

    // Act / Assert
    expectArtifactError(
      () => encodeTileArtifact(invalidHeight),
      'invalid-elevation',
      'Высоты source-тайла должны быть конечными числами.',
    );
    expectArtifactError(
      () => encodeTileArtifact(invalidBounds),
      'invalid-bounds',
      'Buffered bounds должны полностью содержать core bounds.',
    );
    expectArtifactError(
      () => encodeTileArtifact(impossibleLatitude),
      'invalid-bounds',
      'Buffered bounds содержат некорректные координаты.',
    );
  });

  it('обнаруживает повреждение payload по контрольной сумме', () => {
    // Arrange
    const payload = JSON.parse(encodeTileArtifact(artifact()));
    payload.elements[0].lat = 55.76;

    // Act / Assert
    expectArtifactError(
      () => decodeTileArtifact(JSON.stringify(payload), tileId),
      'checksum-mismatch',
      'Контрольная сумма source-тайла не совпадает.',
    );
  });

  it('детерминированно отклоняет повреждённый JSON', () => {
    // Arrange / Act / Assert
    expectArtifactError(
      () => decodeTileArtifact('{bad json', tileId),
      'invalid-json',
      'Source-тайл содержит некорректный JSON.',
    );
  });
});
