#!/usr/bin/env node

import {
  appendFile,
  link,
  lstat,
  mkdir,
  readFile,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { brotliCompress, brotliDecompress, constants } from 'node:zlib';
import {
  SOURCE_TILE_ZOOM,
  isValidSourceTileY,
  latLonToSourceTile,
  normalizeSourceTileX,
  parseSourceTileKey,
  sourceTileKey,
  type SourceTileId,
} from '../game/source-tiles.ts';
import {
  decodeTileArtifact,
  encodeTileArtifact,
} from '../game/tile-artifact.ts';
import { prepareTileArtifact } from '../game/tile-preparation.ts';
import type { OSMElement, RegionData } from '../game/types.ts';

const compress = promisify(brotliCompress),
  decompress = promisify(brotliDecompress);

type LocalTile = {
  osmTimestamp: string;
  drivingSide: RegionData['drivingSide'];
  elements: OSMElement[];
  elevation: { width: number; size?: number; values: number[] };
};

type LocalInput = { tiles: Record<string, LocalTile> };

export type GeneratorOptions = {
  staging: string;
  input?: string;
  tiles?: SourceTileId[];
  center?: { lat: number; lon: number };
  width?: number;
  height?: number;
  zoom?: number;
  concurrency: number;
  dryRun?: boolean;
  generatedAt?: string;
  tileMargin?: number;
  elevationSize?: number;
};

export type GeneratorEvent =
  | { kind: 'plan'; count: number; tiles: string[] }
  | {
      kind: 'generated' | 'skipped';
      tile: string;
      bytes: number;
      elements: number;
    }
  | { kind: 'failed'; tile: string; error: string };

export type GeneratorReport = {
  planned: number;
  generated: number;
  skipped: number;
  failed: { tile: string; error: string }[];
  bytes: number;
  sizeBytes: { p50: number; p95: number; max: number };
  elements: number;
  durationMs: number;
};

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function percentile(sorted: number[], part: number) {
  if (sorted.length === 0) return 0;
  return sorted[Math.ceil(sorted.length * part) - 1];
}

function validatePositiveInteger(value: number, name: string) {
  if (!Number.isInteger(value) || value < 1)
    throw new Error(`${name} должен быть положительным целым числом.`);
}

function selectedTiles(options: GeneratorOptions) {
  let tiles: SourceTileId[];
  if (options.tiles?.length) tiles = options.tiles;
  else if (options.center) {
    const width = options.width ?? 10,
      height = options.height ?? 10,
      zoom = options.zoom ?? SOURCE_TILE_ZOOM;
    validatePositiveInteger(width, 'Ширина прямоугольника');
    validatePositiveInteger(height, 'Высота прямоугольника');
    const center = latLonToSourceTile(
        options.center.lat,
        options.center.lon,
        zoom,
      ),
      startX = center.x - Math.floor((width - 1) / 2),
      startY = center.y - Math.floor((height - 1) / 2);
    tiles = Array.from({ length: width * height }, (_, index) => {
      const y = startY + Math.floor(index / width);
      if (!isValidSourceTileY(y, zoom))
        throw new Error('Прямоугольник выходит за границы Web Mercator.');
      return {
        z: zoom,
        x: normalizeSourceTileX(startX + (index % width), zoom),
        y,
      };
    });
  } else
    throw new Error(
      'Укажите хотя бы один --tile либо прямоугольник через --center.',
    );

  const unique = new Map<string, SourceTileId>();
  for (const tile of tiles) {
    let key: string;
    try {
      key = sourceTileKey(parseSourceTileKey(`${tile.z}/${tile.x}/${tile.y}`));
    } catch {
      throw new Error(
        `Некорректный source-тайл: ${tile.z}/${tile.x}/${tile.y}.`,
      );
    }
    unique.set(key, parseSourceTileKey(key));
  }
  return [...unique.values()];
}

function safeArtifactPath(staging: string, tile: SourceTileId) {
  const root = resolve(staging),
    target = resolve(
      root,
      String(tile.z),
      String(tile.x),
      `${tile.y}.tile.json.br`,
    ),
    inside = relative(root, target);
  if (inside.startsWith(`..${sep}`) || inside === '..' || isAbsolute(inside))
    throw new Error('Путь артефакта выходит за пределы staging-каталога.');
  return target;
}

async function assertNoLinks(staging: string, target: string) {
  const root = resolve(staging),
    inside = relative(root, resolve(target));
  if (inside.startsWith(`..${sep}`) || inside === '..' || isAbsolute(inside))
    throw new Error('Путь выходит за пределы staging-каталога.');
  let current = root;
  for (const part of ['', ...inside.split(sep)]) {
    if (part) current = join(current, part);
    try {
      if ((await lstat(current)).isSymbolicLink())
        throw new Error(
          `Staging не должен содержать symlink или junction: ${current}.`,
        );
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT')
        break;
      throw error;
    }
  }
}

async function readLocalInput(path: string | undefined): Promise<LocalInput> {
  if (!path)
    throw new Error(
      'Для генерации укажите локальный JSON-файл через --input. Сетевые источники не используются.',
    );
  const parsed = JSON.parse(
    await readFile(resolve(path), 'utf8'),
  ) as LocalInput;
  if (!parsed || typeof parsed !== 'object' || !parsed.tiles)
    throw new Error('Локальный input должен содержать объект tiles.');
  return parsed;
}

async function validExisting(path: string, tile: SourceTileId) {
  try {
    const compressed = await readFile(path),
      serialized = new TextDecoder().decode(await decompress(compressed)),
      artifact = decodeTileArtifact(serialized, tile);
    return {
      bytes: compressed.byteLength,
      elements: artifact.elements.length,
    };
  } catch {
    return undefined;
  }
}

async function atomicWrite(
  staging: string,
  path: string,
  contents: Uint8Array,
) {
  await mkdir(dirname(path), { recursive: true });
  await assertNoLinks(staging, path);
  const temporary = `${path}.${process.pid}.${crypto.randomUUID()}.tmp`;
  try {
    await writeFile(temporary, contents);
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true });
  }
}

async function acquireStagingLock(staging: string) {
  const lockPath = `${resolve(staging)}.map-tile-generator.lock`,
    token = `${process.pid}:${crypto.randomUUID()}`,
    candidate = `${lockPath}.${process.pid}.${crypto.randomUUID()}.candidate`;
  await mkdir(dirname(lockPath), { recursive: true });
  await writeFile(candidate, `${token}\n`, { encoding: 'utf8', flag: 'wx' });
  try {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        await link(candidate, lockPath);
        return async () => {
          try {
            if ((await readFile(lockPath, 'utf8')).trim() === token)
              await rm(lockPath, { force: true });
          } catch (error) {
            if (
              !(
                error instanceof Error &&
                'code' in error &&
                error.code === 'ENOENT'
              )
            )
              throw error;
          }
        };
      } catch (error) {
        if (
          !(
            error instanceof Error &&
            'code' in error &&
            error.code === 'EEXIST'
          )
        )
          throw error;
        let owner = Number.NaN;
        try {
          owner = Number((await readFile(lockPath, 'utf8')).split(':', 1)[0]);
          process.kill(owner, 0);
          throw new Error(
            `Staging уже используется процессом ${owner}. Дождитесь завершения генерации.`,
          );
        } catch (ownerError) {
          if (
            ownerError instanceof Error &&
            (!('code' in ownerError) || ownerError.code === 'EPERM')
          )
            throw ownerError;
        }
        const stalePath = `${lockPath}.${process.pid}.${crypto.randomUUID()}.stale`;
        try {
          await rename(lockPath, stalePath);
          await rm(stalePath, { force: true });
        } catch (renameError) {
          if (
            !(
              renameError instanceof Error &&
              'code' in renameError &&
              renameError.code === 'ENOENT'
            )
          )
            throw renameError;
        }
      }
    }
    throw new Error('Не удалось получить эксклюзивную блокировку staging.');
  } finally {
    await rm(candidate, { force: true });
  }
}

export async function generateMapTiles(
  options: GeneratorOptions,
  onEvent: (event: GeneratorEvent) => void = () => {},
): Promise<GeneratorReport> {
  if (!options.staging.trim())
    throw new Error('Staging-каталог должен быть указан явно.');
  validatePositiveInteger(options.concurrency, 'Параллелизм');
  const tiles = selectedTiles(options),
    keys = tiles.map(sourceTileKey),
    started = performance.now();
  onEvent({ kind: 'plan', count: tiles.length, tiles: keys });
  if (options.dryRun)
    return {
      planned: tiles.length,
      generated: 0,
      skipped: 0,
      failed: [],
      bytes: 0,
      sizeBytes: { p50: 0, p95: 0, max: 0 },
      elements: 0,
      durationMs: performance.now() - started,
    };

  const releaseStaging = await acquireStagingLock(options.staging);
  try {
    const input = await readLocalInput(options.input),
      staging = resolve(options.staging),
      logPath = resolve(staging, 'generation-log.ndjson'),
      results: GeneratorEvent[] = [],
      generatedAt = options.generatedAt ?? new Date().toISOString();
    await mkdir(staging, { recursive: true });
    let logQueue = Promise.resolve();
    const record = async (event: GeneratorEvent) => {
      logQueue = logQueue.then(() =>
        assertNoLinks(staging, logPath).then(() =>
          appendFile(
            logPath,
            `${JSON.stringify({ at: new Date().toISOString(), ...event })}\n`,
            'utf8',
          ),
        ),
      );
      await logQueue;
      results.push(event);
      onEvent(event);
    };
    let next = 0;
    const worker = async () => {
      while (next < tiles.length) {
        const tile = tiles[next++],
          key = sourceTileKey(tile),
          output = safeArtifactPath(staging, tile);
        await assertNoLinks(staging, output);
        const existing = await validExisting(output, tile);
        if (existing) {
          await record({ kind: 'skipped', tile: key, ...existing });
          continue;
        }
        try {
          const local = input.tiles[key];
          if (!local)
            throw new Error(
              `В локальном input отсутствует source-тайл ${key}.`,
            );
          const artifact = await prepareTileArtifact(
              tile,
              new AbortController().signal,
              {
                tileMargin: options.tileMargin ?? 300,
                elevationSize:
                  options.elevationSize ?? local.elevation.size ?? 700,
                elevationWidth: local.elevation.width,
                generatedAt,
              },
              {
                map: async () => ({
                  savedAt: Date.parse(local.osmTimestamp),
                  elements: local.elements,
                }),
                elevation: async (_center, _signal, shape) => ({
                  ...shape,
                  size: local.elevation.size ?? shape.size,
                  values: new Float32Array(local.elevation.values),
                }),
                drivingSide: async () => ({
                  side: local.drivingSide,
                  resolved: true,
                }),
              },
            ),
            serialized = encodeTileArtifact(artifact),
            compressed = await compress(Buffer.from(serialized, 'utf8'), {
              params: {
                [constants.BROTLI_PARAM_QUALITY]: 6,
              },
            });
          await atomicWrite(staging, output, compressed);
          await record({
            kind: 'generated',
            tile: key,
            bytes: compressed.byteLength,
            elements: artifact.elements.length,
          });
        } catch (error) {
          await record({
            kind: 'failed',
            tile: key,
            error: errorMessage(error),
          });
        }
      }
    };
    await Promise.all(
      Array.from(
        { length: Math.min(options.concurrency, tiles.length) },
        worker,
      ),
    );
    await logQueue;
    const completed = results.filter(
        (event): event is Extract<GeneratorEvent, { bytes: number }> =>
          event.kind === 'generated' || event.kind === 'skipped',
      ),
      sizes = completed.map((event) => event.bytes).sort((a, b) => a - b),
      report: GeneratorReport = {
        planned: tiles.length,
        generated: results.filter((event) => event.kind === 'generated').length,
        skipped: results.filter((event) => event.kind === 'skipped').length,
        failed: results
          .filter(
            (event): event is Extract<GeneratorEvent, { kind: 'failed' }> =>
              event.kind === 'failed',
          )
          .map(({ tile, error }) => ({ tile, error })),
        bytes: sizes.reduce((sum, size) => sum + size, 0),
        sizeBytes: {
          p50: percentile(sizes, 0.5),
          p95: percentile(sizes, 0.95),
          max: sizes.at(-1) ?? 0,
        },
        elements: completed.reduce((sum, event) => sum + event.elements, 0),
        durationMs: performance.now() - started,
      };
    await atomicWrite(
      staging,
      resolve(staging, 'report.json'),
      new TextEncoder().encode(`${JSON.stringify(report, null, 2)}\n`),
    );
    return report;
  } finally {
    await releaseStaging();
  }
}

function argumentValue(arguments_: string[], name: string) {
  const index = arguments_.indexOf(name);
  return index < 0 ? undefined : arguments_[index + 1];
}

function allArgumentValues(arguments_: string[], name: string) {
  return arguments_.flatMap((value, index) =>
    value === name && arguments_[index + 1] ? [arguments_[index + 1]] : [],
  );
}

function numberArgument(arguments_: string[], name: string, fallback: number) {
  const value = argumentValue(arguments_, name);
  return value === undefined ? fallback : Number(value);
}

export function parseGeneratorArguments(
  arguments_: string[],
): GeneratorOptions {
  const staging = argumentValue(arguments_, '--staging'),
    centerValue = argumentValue(arguments_, '--center'),
    centerParts = centerValue?.split(',').map(Number),
    tiles = allArgumentValues(arguments_, '--tile').map(parseSourceTileKey);
  if (!staging) throw new Error('Укажите --staging <каталог>.');
  if (centerValue && (!centerParts || centerParts.length !== 2))
    throw new Error('--center задаётся как <широта,долгота>.');
  return {
    staging,
    input: argumentValue(arguments_, '--input'),
    ...(tiles.length ? { tiles } : {}),
    ...(centerParts
      ? { center: { lat: centerParts[0], lon: centerParts[1] } }
      : {}),
    width: numberArgument(arguments_, '--width', 10),
    height: numberArgument(arguments_, '--height', 10),
    zoom: numberArgument(arguments_, '--zoom', SOURCE_TILE_ZOOM),
    concurrency: numberArgument(arguments_, '--concurrency', 4),
    dryRun: arguments_.includes('--dry-run'),
    generatedAt: argumentValue(arguments_, '--generated-at'),
  };
}

async function main() {
  try {
    const report = await generateMapTiles(
      parseGeneratorArguments(process.argv.slice(2)),
      (event) => console.log(JSON.stringify(event)),
    );
    console.log(JSON.stringify({ kind: 'report', ...report }, null, 2));
    if (report.failed.length) process.exitCode = 1;
  } catch (error) {
    console.error(errorMessage(error));
    process.exitCode = 1;
  }
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  await main();
