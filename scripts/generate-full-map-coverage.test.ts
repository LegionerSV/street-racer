import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { MAP_FULL_COVERAGE_CONFIG } from './map-full-coverage-config';
import {
  fullCoverageGeneratorOptions,
  verifyFullCoverageInputs,
} from './generate-full-map-coverage';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((path) =>
      rm(path, { recursive: true, force: true }),
    ),
  );
});

it('строит параметры генератора строго из зафиксированной конфигурации', () => {
  // Arrange
  const region = MAP_FULL_COVERAGE_CONFIG.regions['olonetsky-district'];

  // Act
  const options = fullCoverageGeneratorOptions(
    'olonetsky-district',
    {
      dataRoot: 'work/map-data',
      cacheRoot: 'work/map-cache',
      stagingRoot: 'work/map-full',
      osmiumPath: 'osmium',
    },
    { downloadDem: true },
  );

  // Assert
  expect(options).toMatchObject({
    boundary: expect.stringMatching(/olonets-ilyinsky\.geojson$/),
    pbf: expect.stringMatching(/karelia-republic-2026-09-11\.osm\.pbf$/),
    osmTimestamp: region.pbf.timestamp,
    concurrency: 4,
    maxTileBytes: 4_194_304,
    downloadDem: true,
  });
});

it('проверяет содержимое boundary и PBF по зафиксированным checksum', async () => {
  // Arrange
  const root = await mkdtemp(join(tmpdir(), 'map-full-inputs-')),
    boundary = join(root, 'boundary.geojson'),
    pbf = join(root, 'region.osm.pbf'),
    boundaryContents = '{"type":"Polygon"}',
    pbfContents = 'fixture-pbf',
    region = MAP_FULL_COVERAGE_CONFIG.regions['olonetsky-district'],
    originalBoundaryChecksum = region.boundary.sha256,
    originalPbfChecksum = region.pbf.checksum;
  temporaryDirectories.push(root);
  await Promise.all([
    writeFile(boundary, boundaryContents, 'utf8'),
    writeFile(pbf, pbfContents, 'utf8'),
  ]);
  region.boundary.sha256 = createHash('sha256')
    .update(boundaryContents)
    .digest('hex');
  region.pbf.checksum = `md5:${createHash('md5').update(pbfContents).digest('hex')}`;

  try {
    // Act & Assert
    await expect(
      verifyFullCoverageInputs('olonetsky-district', { boundary, pbf }),
    ).resolves.toBeUndefined();
    await writeFile(boundary, '{"type":"tampered"}', 'utf8');
    await expect(
      verifyFullCoverageInputs('olonetsky-district', { boundary, pbf }),
    ).rejects.toThrow('SHA-256 границы');
    await Promise.all([
      writeFile(boundary, boundaryContents, 'utf8'),
      writeFile(pbf, 'tampered-pbf', 'utf8'),
    ]);
    await expect(
      verifyFullCoverageInputs('olonetsky-district', { boundary, pbf }),
    ).rejects.toThrow('MD5 PBF');
  } finally {
    region.boundary.sha256 = originalBoundaryChecksum;
    region.pbf.checksum = originalPbfChecksum;
  }
});
