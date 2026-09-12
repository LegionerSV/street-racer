import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { expect, it } from 'vitest';
import { generateMapTiles } from './generate-map-tiles';
import {
  MAP_FULL_COVERAGE_CONFIG,
  type FullCoverageName,
} from './map-full-coverage-config';

it.each(Object.keys(MAP_FULL_COVERAGE_CONFIG.regions) as FullCoverageName[])(
  'строит воспроизводимый план полного покрытия %s',
  async (name) => {
    // Arrange
    const region = MAP_FULL_COVERAGE_CONFIG.regions[name],
      body = await readFile(region.boundary.file);

    // Act
    const report = await generateMapTiles({
      staging: `work/map-full/${name}`,
      boundary: region.boundary.file,
      zoom: MAP_FULL_COVERAGE_CONFIG.zoom,
      concurrency: region.concurrency,
      maxTileBytes: MAP_FULL_COVERAGE_CONFIG.maxTileBytes,
      dryRun: true,
    });

    // Assert
    expect(report).toMatchObject({
      planned: region.plannedTiles,
      generated: 0,
      failed: [],
    });
    expect(createHash('sha256').update(body).digest('hex')).toBe(
      region.boundary.sha256,
    );
  },
  20_000,
);
