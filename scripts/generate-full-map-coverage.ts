#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSourceTileKey, type SourceTileId } from '../game/source-tiles.ts';
import {
  generateMapTiles,
  type GeneratorOptions,
} from './generate-map-tiles.ts';
import {
  MAP_FULL_COVERAGE_CONFIG,
  type FullCoverageName,
} from './map-full-coverage-config.ts';

function argumentValue(arguments_: string[], name: string) {
  const index = arguments_.indexOf(name);
  return index < 0 ? undefined : arguments_[index + 1];
}

function allArgumentValues(arguments_: string[], name: string) {
  return arguments_.flatMap((value, index) =>
    value === name && arguments_[index + 1] ? [arguments_[index + 1]] : [],
  );
}

function required(arguments_: string[], name: string) {
  const value = argumentValue(arguments_, name);
  if (!value) throw new Error(`Укажите ${name} <путь>.`);
  return value;
}

async function fileChecksum(path: string, algorithm: 'md5' | 'sha256') {
  const hash = createHash(algorithm);
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}

export async function verifyFullCoverageInputs(
  name: FullCoverageName,
  options: Pick<GeneratorOptions, 'boundary' | 'pbf'>,
) {
  const region = MAP_FULL_COVERAGE_CONFIG.regions[name];
  if (!region) throw new Error(`Неизвестный регион полного покрытия: ${name}.`);
  const expectedPbfChecksum = region.pbf.checksum.slice('md5:'.length),
    [boundaryChecksum, pbfChecksum] = await Promise.all([
      options.boundary
        ? fileChecksum(options.boundary, 'sha256')
        : Promise.resolve(undefined),
      fileChecksum(options.pbf!, 'md5'),
    ]);
  if (boundaryChecksum && boundaryChecksum !== region.boundary.sha256)
    throw new Error(
      `SHA-256 границы ${name} не совпадает с зафиксированной конфигурацией.`,
    );
  if (pbfChecksum !== expectedPbfChecksum)
    throw new Error(
      `MD5 PBF ${name} не совпадает с зафиксированной конфигурацией.`,
    );
}

export function fullCoverageGeneratorOptions(
  name: FullCoverageName,
  paths: {
    dataRoot: string;
    cacheRoot: string;
    stagingRoot: string;
    osmiumPath?: string;
  },
  flags: { dryRun?: boolean; downloadDem?: boolean } = {},
): GeneratorOptions {
  const region = MAP_FULL_COVERAGE_CONFIG.regions[name];
  if (!region) throw new Error(`Неизвестный регион полного покрытия: ${name}.`);
  return {
    staging: resolve(paths.stagingRoot, name),
    boundary: resolve(region.boundary.file),
    pbf: resolve(paths.dataRoot, region.pbf.file),
    osmCache: resolve(paths.cacheRoot, `${name}-osm`),
    demCache: resolve(paths.cacheRoot, 'terrarium'),
    osmiumPath: paths.osmiumPath,
    osmTimestamp: region.pbf.timestamp,
    inputSource: region.pbf.source,
    inputLicense: region.pbf.license,
    demTimestamp: MAP_FULL_COVERAGE_CONFIG.dem.timestamp,
    demLicense: MAP_FULL_COVERAGE_CONFIG.dem.license,
    drivingSide: 'right',
    zoom: MAP_FULL_COVERAGE_CONFIG.zoom,
    concurrency: region.concurrency,
    maxTileBytes: MAP_FULL_COVERAGE_CONFIG.maxTileBytes,
    generatedAt: MAP_FULL_COVERAGE_CONFIG.generatedAt,
    dryRun: flags.dryRun,
    downloadDem: flags.downloadDem,
  };
}

export function overlayCoverageGeneratorOptions(
  name: FullCoverageName,
  paths: {
    dataRoot: string;
    cacheRoot: string;
    stagingRoot: string;
    osmiumPath?: string;
  },
  overlayId: string,
  tiles: SourceTileId[],
  flags: { dryRun?: boolean; downloadDem?: boolean } = {},
): GeneratorOptions {
  if (!/^[a-z0-9][a-z0-9._-]*$/i.test(overlayId))
    throw new Error(
      'Некорректный идентификатор overlay: используйте буквы, цифры, точку, дефис или подчёркивание.',
    );
  if (!tiles.length)
    throw new Error('Для overlay укажите хотя бы один тайл через --tile.');
  return {
    ...fullCoverageGeneratorOptions(name, paths, flags),
    staging: resolve(paths.stagingRoot, overlayId),
    boundary: undefined,
    tiles,
  };
}

async function main() {
  const arguments_ = process.argv.slice(2),
    name = argumentValue(arguments_, '--region') as FullCoverageName,
    paths = {
      dataRoot: required(arguments_, '--data-root'),
      cacheRoot: required(arguments_, '--cache-root'),
      stagingRoot: required(arguments_, '--staging-root'),
      osmiumPath: argumentValue(arguments_, '--osmium'),
    },
    flags = {
      dryRun: arguments_.includes('--dry-run'),
      downloadDem: arguments_.includes('--download-dem'),
    },
    tileValues = allArgumentValues(arguments_, '--tile'),
    overlayId = argumentValue(arguments_, '--overlay-id');
  if (tileValues.length && !overlayId)
    throw new Error('Для выборочной генерации укажите --overlay-id <id>.');
  const options = overlayId
    ? overlayCoverageGeneratorOptions(
        name,
        paths,
        overlayId,
        tileValues.map(parseSourceTileKey),
        flags,
      )
    : fullCoverageGeneratorOptions(name, paths, flags);
  await verifyFullCoverageInputs(name, options);
  const report = await generateMapTiles(options, (event) =>
    console.log(JSON.stringify(event)),
  );
  console.log(JSON.stringify({ kind: 'report', ...report }, null, 2));
  if (report.failed.length) process.exitCode = 1;
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  await main();
