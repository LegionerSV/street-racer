import type { ElevationGrid, OSMElement, RegionData } from './types';
import {
  sourceTileBounds,
  type SourceTileBounds,
  type SourceTileId,
} from './source-tiles';

export const TILE_ARTIFACT_SCHEMA_VERSION = 1 as const;
// Версия исходных геоданных не связана с версией рендера MAP_BUILD_VERSION.
export const TILE_BUILD_VERSION = '2026-09-09-source-tile-1';

export type TileArtifactV1Input = SourceTileId & {
  schemaVersion: typeof TILE_ARTIFACT_SCHEMA_VERSION;
  tileBuildVersion: string;
  coreBounds: SourceTileBounds;
  bufferedBounds: SourceTileBounds;
  generatedAt: string;
  osmTimestamp: string;
  drivingSide: RegionData['drivingSide'];
  elements: OSMElement[];
  elevation: ElevationGrid;
};

export type TileArtifactV1 = TileArtifactV1Input & { checksum: string };

export type TileArtifactErrorCode =
  | 'invalid-json'
  | 'incompatible-schema'
  | 'incompatible-build'
  | 'tile-mismatch'
  | 'invalid-tile-id'
  | 'invalid-bounds'
  | 'invalid-metadata'
  | 'invalid-elements'
  | 'invalid-elevation'
  | 'checksum-mismatch';

export class TileArtifactError extends Error {
  constructor(
    readonly code: TileArtifactErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'TileArtifactError';
  }
}

type EncodedFloat32 = {
  encoding: 'float32-le';
  length: number;
  data: string;
};

type EncodedElevationGrid = Omit<ElevationGrid, 'values' | 'patches'> & {
  values: EncodedFloat32;
  patches?: EncodedElevationGrid[];
};

const BASE64 =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function fail(code: TileArtifactErrorCode, message: string): never {
  throw new TileArtifactError(code, message);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function tileKey(tile: SourceTileId) {
  return `${tile.z}/${tile.x}/${tile.y}`;
}

function validateTileId(tile: SourceTileId) {
  if (
    !Number.isInteger(tile.z) ||
    tile.z < 0 ||
    tile.z > 30 ||
    !Number.isInteger(tile.x) ||
    tile.x < 0 ||
    tile.x >= 2 ** tile.z ||
    !Number.isInteger(tile.y) ||
    tile.y < 0 ||
    tile.y >= 2 ** tile.z
  )
    fail('invalid-tile-id', 'Source-тайл содержит некорректный XYZ.');
}

function validateBounds(bounds: SourceTileBounds, label: string) {
  if (
    !isObject(bounds) ||
    ![bounds.south, bounds.west, bounds.north, bounds.east].every(
      Number.isFinite,
    ) ||
    bounds.south < -90 ||
    bounds.north > 90 ||
    bounds.south >= bounds.north ||
    bounds.west >= bounds.east
  )
    fail('invalid-bounds', `${label} содержат некорректные координаты.`);
}

function validateElements(elements: OSMElement[]) {
  if (!Array.isArray(elements))
    fail('invalid-elements', 'OSM elements должны быть массивом.');
  for (const element of elements) {
    if (
      !isObject(element) ||
      !['node', 'way', 'relation'].includes(element.type) ||
      !Number.isSafeInteger(element.id) ||
      (element.lat !== undefined && !Number.isFinite(element.lat)) ||
      (element.lon !== undefined && !Number.isFinite(element.lon)) ||
      (element.nodes !== undefined &&
        (!Array.isArray(element.nodes) ||
          !element.nodes.every(Number.isSafeInteger))) ||
      (element.tags !== undefined &&
        (!isObject(element.tags) ||
          !Object.values(element.tags).every(
            (value) => typeof value === 'string',
          ))) ||
      (element.members !== undefined &&
        (!Array.isArray(element.members) ||
          !element.members.every(
            (member) =>
              isObject(member) &&
              typeof member.type === 'string' &&
              Number.isSafeInteger(member.ref) &&
              typeof member.role === 'string',
          )))
    )
      fail(
        'invalid-elements',
        'Source-тайл содержит некорректный OSM element.',
      );
  }
}

function validateElevation(grid: ElevationGrid) {
  if (
    !isObject(grid) ||
    !Number.isInteger(grid.width) ||
    grid.width < 2 ||
    !Number.isFinite(grid.size) ||
    grid.size <= 0 ||
    !(grid.values instanceof Float32Array) ||
    grid.values.length !== grid.width * grid.width
  )
    fail(
      'invalid-elevation',
      'Сетка высот source-тайла имеет некорректный размер.',
    );
  if (![...grid.values].every(Number.isFinite))
    fail(
      'invalid-elevation',
      'Высоты source-тайла должны быть конечными числами.',
    );
  if (
    (grid.offsetX !== undefined && !Number.isFinite(grid.offsetX)) ||
    (grid.offsetZ !== undefined && !Number.isFinite(grid.offsetZ))
  )
    fail(
      'invalid-elevation',
      'Смещение сетки высот должно быть конечным числом.',
    );
  if (grid.patches !== undefined) {
    if (!Array.isArray(grid.patches))
      fail('invalid-elevation', 'Патчи сетки высот должны быть массивом.');
    for (const patch of grid.patches) validateElevation(patch);
  }
}

function validateArtifact(input: TileArtifactV1Input) {
  validateTileId(input);
  validateBounds(input.coreBounds, 'Core bounds');
  validateBounds(input.bufferedBounds, 'Buffered bounds');
  const exact = sourceTileBounds(input);
  if (
    input.coreBounds.south !== exact.south ||
    input.coreBounds.west !== exact.west ||
    input.coreBounds.north !== exact.north ||
    input.coreBounds.east !== exact.east
  )
    fail('invalid-bounds', 'Core bounds не соответствуют XYZ source-тайла.');
  if (
    input.bufferedBounds.south > input.coreBounds.south ||
    input.bufferedBounds.west > input.coreBounds.west ||
    input.bufferedBounds.north < input.coreBounds.north ||
    input.bufferedBounds.east < input.coreBounds.east
  )
    fail(
      'invalid-bounds',
      'Buffered bounds должны полностью содержать core bounds.',
    );
  if (
    typeof input.generatedAt !== 'string' ||
    !Number.isFinite(Date.parse(input.generatedAt)) ||
    typeof input.osmTimestamp !== 'string' ||
    input.osmTimestamp.length === 0 ||
    !['left', 'right'].includes(input.drivingSide)
  )
    fail('invalid-metadata', 'Source-тайл содержит некорректные метаданные.');
  validateElements(input.elements);
  validateElevation(input.elevation);
}

function encodeBase64(bytes: Uint8Array) {
  let result = '';
  for (let index = 0; index < bytes.length; index += 3) {
    const a = bytes[index],
      b = bytes[index + 1],
      c = bytes[index + 2],
      block = (a << 16) | ((b ?? 0) << 8) | (c ?? 0);
    result += BASE64[(block >>> 18) & 63];
    result += BASE64[(block >>> 12) & 63];
    result += b === undefined ? '=' : BASE64[(block >>> 6) & 63];
    result += c === undefined ? '=' : BASE64[block & 63];
  }
  return result;
}

function decodeBase64(value: string) {
  if (
    value.length % 4 !== 0 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
      value,
    )
  )
    fail('invalid-elevation', 'Данные высот содержат некорректный base64.');
  const padding = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0,
    bytes = new Uint8Array((value.length / 4) * 3 - padding);
  let target = 0;
  for (let index = 0; index < value.length; index += 4) {
    const a = BASE64.indexOf(value[index]),
      b = BASE64.indexOf(value[index + 1]),
      c = value[index + 2] === '=' ? 0 : BASE64.indexOf(value[index + 2]),
      d = value[index + 3] === '=' ? 0 : BASE64.indexOf(value[index + 3]),
      block = (a << 18) | (b << 12) | (c << 6) | d;
    if (target < bytes.length) bytes[target++] = (block >>> 16) & 255;
    if (target < bytes.length) bytes[target++] = (block >>> 8) & 255;
    if (target < bytes.length) bytes[target++] = block & 255;
  }
  return bytes;
}

function encodeElevation(grid: ElevationGrid): EncodedElevationGrid {
  const bytes = new Uint8Array(grid.values.length * 4),
    view = new DataView(bytes.buffer);
  grid.values.forEach((value, index) =>
    view.setFloat32(index * 4, value, true),
  );
  return {
    width: grid.width,
    size: grid.size,
    ...(grid.offsetX === undefined ? {} : { offsetX: grid.offsetX }),
    ...(grid.offsetZ === undefined ? {} : { offsetZ: grid.offsetZ }),
    values: {
      encoding: 'float32-le',
      length: grid.values.length,
      data: encodeBase64(bytes),
    },
    ...(grid.patches === undefined
      ? {}
      : { patches: grid.patches.map(encodeElevation) }),
  };
}

function decodeElevation(value: unknown): ElevationGrid {
  if (!isObject(value) || !isObject(value.values))
    fail('invalid-elevation', 'Сетка высот source-тайла повреждена.');
  const encoded = value.values;
  if (
    encoded.encoding !== 'float32-le' ||
    !Number.isInteger(encoded.length) ||
    (encoded.length as number) < 0 ||
    typeof encoded.data !== 'string'
  )
    fail('invalid-elevation', 'Сетка высот source-тайла повреждена.');
  const bytes = decodeBase64(encoded.data),
    length = encoded.length as number;
  if (bytes.length !== length * 4)
    fail('invalid-elevation', 'Размер данных высот source-тайла не совпадает.');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength),
    values = new Float32Array(length);
  for (let index = 0; index < length; index++)
    values[index] = view.getFloat32(index * 4, true);
  const grid: ElevationGrid = {
    width: value.width as number,
    size: value.size as number,
    values,
    ...(value.offsetX === undefined
      ? {}
      : { offsetX: value.offsetX as number }),
    ...(value.offsetZ === undefined
      ? {}
      : { offsetZ: value.offsetZ as number }),
    ...(value.patches === undefined
      ? {}
      : {
          patches: Array.isArray(value.patches)
            ? value.patches.map(decodeElevation)
            : fail(
                'invalid-elevation',
                'Патчи сетки высот должны быть массивом.',
              ),
        }),
  };
  validateElevation(grid);
  return grid;
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (isObject(value))
    return `{${Object.keys(value)
      .filter((key) => value[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(',')}}`;
  return JSON.stringify(value);
}

function checksum(value: unknown) {
  let crc = 0xffffffff;
  for (const byte of new TextEncoder().encode(canonicalJson(value))) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++)
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return `crc32:${((crc ^ 0xffffffff) >>> 0).toString(16).padStart(8, '0')}`;
}

function withoutChecksum(value: Record<string, unknown>) {
  const { checksum: _checksum, ...payload } = value;
  return payload;
}

export function encodeTileArtifact(input: TileArtifactV1Input) {
  if (input.schemaVersion !== TILE_ARTIFACT_SCHEMA_VERSION)
    fail(
      'incompatible-schema',
      `Несовместимая версия формата source-тайла: ${String(input.schemaVersion)}.`,
    );
  if (input.tileBuildVersion !== TILE_BUILD_VERSION)
    fail(
      'incompatible-build',
      `Несовместимая версия сборки source-тайла: ${input.tileBuildVersion}.`,
    );
  validateArtifact(input);
  const { checksum: _checksum, ...source } = input as TileArtifactV1;
  const payload = { ...source, elevation: encodeElevation(input.elevation) };
  return JSON.stringify({ ...payload, checksum: checksum(payload) });
}

export function decodeTileArtifact(
  serialized: string,
  expectedTile?: SourceTileId,
): TileArtifactV1 {
  let parsed: unknown;
  try {
    parsed = JSON.parse(serialized);
  } catch {
    fail('invalid-json', 'Source-тайл содержит некорректный JSON.');
  }
  if (!isObject(parsed))
    fail('invalid-json', 'Source-тайл содержит некорректный JSON.');
  if (parsed.schemaVersion !== TILE_ARTIFACT_SCHEMA_VERSION)
    fail(
      'incompatible-schema',
      `Несовместимая версия формата source-тайла: ${String(parsed.schemaVersion)}.`,
    );
  if (parsed.tileBuildVersion !== TILE_BUILD_VERSION)
    fail(
      'incompatible-build',
      `Несовместимая версия сборки source-тайла: ${String(parsed.tileBuildVersion)}.`,
    );
  const id = {
    z: parsed.z as number,
    x: parsed.x as number,
    y: parsed.y as number,
  };
  validateTileId(id);
  if (
    expectedTile &&
    (id.z !== expectedTile.z ||
      id.x !== expectedTile.x ||
      id.y !== expectedTile.y)
  )
    fail(
      'tile-mismatch',
      `Ожидался source-тайл ${tileKey(expectedTile)}, получен ${tileKey(id)}.`,
    );
  if (
    typeof parsed.checksum !== 'string' ||
    parsed.checksum !== checksum(withoutChecksum(parsed))
  )
    fail('checksum-mismatch', 'Контрольная сумма source-тайла не совпадает.');
  const artifact: TileArtifactV1 = {
    ...(withoutChecksum(parsed) as Omit<
      TileArtifactV1,
      'elevation' | 'checksum'
    >),
    elevation: decodeElevation(parsed.elevation),
    checksum: parsed.checksum,
  };
  validateArtifact(artifact);
  return artifact;
}
