import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import sharpImport from 'sharp';
import { decodeTerrarium, lerp, toGeo } from '../game/geo.ts';
import { ROAD_TYPES } from '../game/map-object-filters.ts';
import type { MapBox } from '../game/map-source.ts';
import type { Center, ElevationGrid, OSMElement } from '../game/types.ts';

const executeFile = promisify(execFile);
type ImageDecoder = {
  removeAlpha(): ImageDecoder;
  raw(): ImageDecoder;
  toBuffer(options: { resolveWithObject: true }): Promise<{
    data: Buffer;
    info: { width: number; height: number; channels: number };
  }>;
};
const decodeImage = sharpImport as unknown as (
  input: Uint8Array,
) => ImageDecoder;
const DEM_ZOOM = 12;
const DEM_TILE_SIZE = 256;
const DEM_BASE_URL = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium';

export const OSMIUM_FILTER_EXPRESSIONS = [
  `w/highway=${ROAD_TYPES.join(',')}`,
  'n/highway=traffic_signals',
  'r/type=restriction',
  'w/building',
  'w/building:part',
  'r/building',
  'nwr/natural=water,wood,tree',
  'nwr/waterway=riverbank',
  'nwr/landuse=forest,grass,meadow,reservoir',
  'nwr/leisure=park',
] as const;

export type CommandRunner = (
  executable: string,
  arguments_: string[],
  signal: AbortSignal,
) => Promise<void>;

export type PbfSourceOptions = {
  pbf: string;
  cache: string;
  osmiumPath?: string;
  osmTimestamp: string;
};

export type DemSourceOptions = {
  cache: string;
  downloadMissing: boolean;
  fetcher?: typeof fetch;
};

export type ElevationShape = {
  size: number;
  width: number;
  offsetX: number;
  offsetZ: number;
};

const defaultRunner: CommandRunner = async (executable, arguments_, signal) => {
  await executeFile(executable, arguments_, {
    signal,
    windowsHide: true,
    maxBuffer: 8 * 1024 * 1024,
  });
};

function xmlValue(value: string) {
  return value.replace(
    /&(quot|apos|lt|gt|amp|#\d+|#x[\da-f]+);/gi,
    (entity, name: string) => {
      if (name[0] === '#')
        return String.fromCodePoint(
          Number.parseInt(
            name.slice(name[1] === 'x' ? 2 : 1),
            name[1] === 'x' ? 16 : 10,
          ),
        );
      return { quot: '"', apos: "'", lt: '<', gt: '>', amp: '&' }[
        name.toLowerCase()
      ]!;
    },
  );
}

function attributes(source: string) {
  const result: Record<string, string> = {};
  for (const match of source.matchAll(/([\w:-]+)=(?:"([^"]*)"|'([^']*)')/g))
    result[match[1]] = xmlValue(match[2] ?? match[3]);
  return result;
}

function tags(body: string) {
  const result: Record<string, string> = {};
  for (const match of body.matchAll(/<tag\s+([^>]*?)\s*\/?\s*>/g)) {
    const value = attributes(match[1]);
    if (value.k !== undefined && value.v !== undefined)
      result[value.k] = value.v;
  }
  return Object.keys(result).length ? result : undefined;
}

export function parseOsmXml(source: string): OSMElement[] {
  const elements: OSMElement[] = [];
  for (const match of source.matchAll(
    /<(node|way|relation)\b([^>]*?)(?:\/>|>([\s\S]*?)<\/\1>)/g,
  )) {
    const type = match[1] as OSMElement['type'],
      header = attributes(match[2]),
      body = match[3] ?? '',
      id = Number(header.id);
    if (!Number.isSafeInteger(id))
      throw new Error('OSM XML содержит некорректный id.');
    if (type === 'node') {
      const lat = Number(header.lat),
        lon = Number(header.lon);
      if (!Number.isFinite(lat) || !Number.isFinite(lon))
        throw new Error(`OSM node ${id} не содержит координаты.`);
      elements.push({
        type,
        id,
        lat,
        lon,
        ...(tags(body) ? { tags: tags(body) } : {}),
      });
      continue;
    }
    if (type === 'way') {
      const nodes = [...body.matchAll(/<nd\s+([^>]*?)\s*\/?\s*>/g)].map(
        (node) => Number(attributes(node[1]).ref),
      );
      if (nodes.some((node) => !Number.isSafeInteger(node)))
        throw new Error(`OSM way ${id} содержит некорректную ссылку на node.`);
      const elementTags = tags(body);
      elements.push({
        type,
        id,
        nodes,
        ...(elementTags ? { tags: elementTags } : {}),
      });
      continue;
    }
    const members = [...body.matchAll(/<member\s+([^>]*?)\s*\/?\s*>/g)].map(
      (member) => {
        const value = attributes(member[1]),
          ref = Number(value.ref);
        if (
          !['node', 'way', 'relation'].includes(value.type) ||
          !Number.isSafeInteger(ref)
        )
          throw new Error(
            `OSM relation ${id} содержит некорректного участника.`,
          );
        return { type: value.type, ref, role: value.role ?? '' };
      },
    );
    const elementTags = tags(body);
    elements.push({
      type,
      id,
      members,
      ...(elementTags ? { tags: elementTags } : {}),
    });
  }
  return elements;
}

export function inputFingerprint(value: unknown) {
  return createHash('sha256')
    .update(JSON.stringify(value))
    .digest('hex')
    .slice(0, 20);
}

async function exists(path: string) {
  try {
    return (await stat(path)).isFile();
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT')
      return false;
    throw error;
  }
}

async function atomicCommandOutput(
  output: string,
  executable: string,
  arguments_: string[],
  signal: AbortSignal,
  runner: CommandRunner,
) {
  await mkdir(dirname(output), { recursive: true });
  const temporary = `${output}.${process.pid}.${crypto.randomUUID()}.tmp${output.endsWith('.pbf') ? '.osm.pbf' : '.osm'}`;
  try {
    await runner(executable, [...arguments_, '-o', temporary], signal);
    await rename(temporary, output);
  } finally {
    await rm(temporary, { force: true });
  }
}

export async function createPbfMapSource(
  options: PbfSourceOptions,
  signal: AbortSignal,
  runner: CommandRunner = defaultRunner,
) {
  const pbf = resolve(options.pbf),
    cache = resolve(options.cache),
    executable = options.osmiumPath ?? 'osmium';
  if (!(await exists(pbf))) throw new Error(`PBF-файл не найден: ${pbf}`);
  if (!Number.isFinite(Date.parse(options.osmTimestamp)))
    throw new Error('--osm-timestamp должен содержать дату в ISO-формате.');
  const sourceInfo = await stat(pbf),
    fingerprint = inputFingerprint(
      `${pbf}:${sourceInfo.size}:${sourceInfo.mtimeMs}:${OSMIUM_FILTER_EXPRESSIONS.join('|')}`,
    ),
    filtered = join(cache, `filtered-${fingerprint}.osm.pbf`);
  if (!(await exists(filtered)))
    await atomicCommandOutput(
      filtered,
      executable,
      ['tags-filter', pbf, ...OSMIUM_FILTER_EXPRESSIONS, '--overwrite'],
      signal,
      runner,
    );

  const load = async (bounds: MapBox) => {
    signal.throwIfAborted();
    const key = [bounds.west, bounds.south, bounds.east, bounds.north]
        .map((value) => value.toFixed(7))
        .join(','),
      xml = join(
        cache,
        'extracts',
        `${inputFingerprint(`${fingerprint}:${key}`)}.osm`,
      );
    let elements: OSMElement[] | undefined;
    if (await exists(xml)) {
      try {
        elements = parseOsmXml(await readFile(xml, 'utf8'));
      } catch {
        elements = undefined;
      }
    }
    if (!elements) {
      await atomicCommandOutput(
        xml,
        executable,
        [
          'extract',
          '--bbox',
          key,
          '--strategy',
          'smart',
          '--option',
          'types=any',
          '--overwrite',
          filtered,
          '--output-format',
          'osm',
        ],
        signal,
        runner,
      );
      elements = parseOsmXml(await readFile(xml, 'utf8'));
    }
    return { elements, savedAt: Date.parse(options.osmTimestamp) };
  };
  return { load, fingerprint };
}

function terrainCoordinate(lat: number, lon: number) {
  const count = 2 ** DEM_ZOOM,
    radians = (lat * Math.PI) / 180;
  return {
    x: ((lon + 180) / 360) * count,
    y: ((1 - Math.asinh(Math.tan(radians)) / Math.PI) / 2) * count,
  };
}

export function createDemElevationSource(options: DemSourceOptions) {
  const cache = resolve(options.cache),
    fetcher = options.fetcher ?? fetch,
    pending = new Map<string, Promise<Uint8Array>>();
  const tile = async (x: number, y: number, signal: AbortSignal) => {
    const key = `${DEM_ZOOM}/${x}/${y}`,
      path = join(cache, String(DEM_ZOOM), String(x), `${y}.png`);
    let job = pending.get(key);
    if (!job) {
      job = (async () => {
        if (await exists(path)) return readFile(path);
        if (!options.downloadMissing)
          throw new Error(
            `DEM-тайл ${key} отсутствует в локальном кэше. Повторите с --download-dem для явной загрузки.`,
          );
        const response = await fetcher(`${DEM_BASE_URL}/${key}.png`, {
          signal,
        });
        if (!response.ok)
          throw new Error(
            `Не удалось загрузить DEM-тайл ${key}: HTTP ${response.status}.`,
          );
        const bytes = new Uint8Array(await response.arrayBuffer());
        await mkdir(dirname(path), { recursive: true });
        const temporary = `${path}.${process.pid}.${crypto.randomUUID()}.tmp`;
        await writeFile(temporary, bytes);
        await rename(temporary, path);
        return bytes;
      })();
      pending.set(key, job);
      job.catch(() => pending.delete(key));
    }
    return job;
  };

  return async (
    center: Center,
    signal: AbortSignal,
    shape: ElevationShape,
  ): Promise<ElevationGrid> => {
    const southWest = toGeo(
        {
          x: shape.offsetX - shape.size / 2,
          y: 0,
          z: shape.offsetZ - shape.size / 2,
        },
        center,
      ),
      northEast = toGeo(
        {
          x: shape.offsetX + shape.size / 2,
          y: 0,
          z: shape.offsetZ + shape.size / 2,
        },
        center,
      ),
      northWestTile = terrainCoordinate(northEast.lat, southWest.lon),
      southEastTile = terrainCoordinate(southWest.lat, northEast.lon),
      images = new Map<string, Uint8Array>();
    const jobs: Promise<void>[] = [];
    for (
      let x = Math.floor(northWestTile.x);
      x <= Math.floor(southEastTile.x + 1 / DEM_TILE_SIZE);
      x++
    )
      for (
        let y = Math.floor(northWestTile.y);
        y <= Math.floor(southEastTile.y + 1 / DEM_TILE_SIZE);
        y++
      )
        jobs.push(
          tile(x, y, signal).then(async (bytes) => {
            const decoded = await decodeImage(bytes)
              .removeAlpha()
              .raw()
              .toBuffer({ resolveWithObject: true });
            if (
              decoded.info.width !== DEM_TILE_SIZE ||
              decoded.info.height !== DEM_TILE_SIZE ||
              decoded.info.channels !== 3
            )
              throw new Error(
                `DEM-тайл ${DEM_ZOOM}/${x}/${y} должен быть RGB PNG 256×256.`,
              );
            images.set(`${x},${y}`, decoded.data);
          }),
        );
    await Promise.all(jobs);
    signal.throwIfAborted();
    const sourceHeight = (pixelX: number, pixelY: number) => {
        const x = Math.floor(pixelX / DEM_TILE_SIZE),
          y = Math.floor(pixelY / DEM_TILE_SIZE),
          pixels = images.get(`${x},${y}`);
        if (!pixels) return undefined;
        const index =
          ((pixelY - y * DEM_TILE_SIZE) * DEM_TILE_SIZE +
            pixelX -
            x * DEM_TILE_SIZE) *
          3;
        return decodeTerrarium(
          pixels[index],
          pixels[index + 1],
          pixels[index + 2],
        );
      },
      values = new Float32Array(shape.width * shape.width);
    for (let row = 0; row < shape.width; row++)
      for (let column = 0; column < shape.width; column++) {
        const point = toGeo(
            {
              x:
                shape.offsetX + (column / (shape.width - 1) - 0.5) * shape.size,
              y: 0,
              z: shape.offsetZ + (row / (shape.width - 1) - 0.5) * shape.size,
            },
            center,
          ),
          coordinate = terrainCoordinate(point.lat, point.lon),
          pixelX = coordinate.x * DEM_TILE_SIZE,
          pixelY = coordinate.y * DEM_TILE_SIZE,
          x = Math.floor(pixelX),
          y = Math.floor(pixelY),
          a = sourceHeight(x, y);
        if (a === undefined)
          throw new Error('Для выбранной территории нет полных данных DEM.');
        const b = sourceHeight(x + 1, y) ?? a,
          c = sourceHeight(x, y + 1) ?? a,
          d = sourceHeight(x + 1, y + 1) ?? a;
        values[row * shape.width + column] = lerp(
          lerp(a, b, pixelX - x),
          lerp(c, d, pixelX - x),
          pixelY - y,
        );
      }
    return { ...shape, values };
  };
}

export function inputDataMetadata(options: {
  pbf: string;
  osmTimestamp: string;
  source: string;
  license: string;
  fingerprint: string;
  demTimestamp: string;
  demLicense: string;
}) {
  return {
    fingerprint: options.fingerprint,
    osm: {
      file: basename(resolve(options.pbf)),
      timestamp: new Date(options.osmTimestamp).toISOString(),
      source: options.source,
      license: options.license,
    },
    dem: {
      source: DEM_BASE_URL,
      format: 'Terrarium RGB PNG',
      timestamp: new Date(options.demTimestamp).toISOString(),
      license: options.demLicense,
      attribution:
        'Elevation data from SRTM, GMTED, NED and ETOPO1; processing by Mapzen/Tilezen.',
    },
  };
}
