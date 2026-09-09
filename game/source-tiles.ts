export const SOURCE_TILE_ZOOM = 15;
export const WEB_MERCATOR_MAX_LATITUDE = 85.0511287798066;

export type SourceTileId = {
  z: number;
  x: number;
  y: number;
};

export type SourceTileBounds = {
  south: number;
  west: number;
  north: number;
  east: number;
};

const MAX_SOURCE_TILE_ZOOM = 30;
const DEGREES = 180 / Math.PI;
const FLOAT_BUFFER = new ArrayBuffer(8);
const FLOAT_VIEW = new DataView(FLOAT_BUFFER);

function tileCount(z: number) {
  if (!Number.isInteger(z) || z < 0 || z > MAX_SOURCE_TILE_ZOOM)
    throw new Error(
      `Zoom source-тайла должен быть целым числом от 0 до ${MAX_SOURCE_TILE_ZOOM}.`,
    );
  return 2 ** z;
}

function normalizeLongitude(lon: number) {
  return ((((lon + 180) % 360) + 360) % 360) - 180;
}

function nextDown(value: number) {
  if (value === -Infinity) return value;
  if (value === 0) return -Number.MIN_VALUE;
  FLOAT_VIEW.setFloat64(0, value);
  let high = FLOAT_VIEW.getUint32(0),
    low = FLOAT_VIEW.getUint32(4);
  if (value > 0) {
    if (low === 0) {
      high--;
      low = 0xffffffff;
    } else low--;
  } else {
    if (low === 0xffffffff) {
      high++;
      low = 0;
    } else low++;
  }
  FLOAT_VIEW.setUint32(0, high);
  FLOAT_VIEW.setUint32(4, low);
  return FLOAT_VIEW.getFloat64(0);
}

function projectedTileY(lat: number, count: number) {
  const radians = (lat * Math.PI) / 180;
  return ((1 - Math.asinh(Math.tan(radians)) / Math.PI) / 2) * count;
}

function latitudeAtTileBoundary(y: number, count: number) {
  let latitude =
    Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / count))) * DEGREES;
  while (y < count && projectedTileY(latitude, count) < y)
    latitude = nextDown(latitude);
  return latitude;
}

export function normalizeSourceTileX(x: number, z: number) {
  const count = tileCount(z);
  if (!Number.isInteger(x))
    throw new Error('X source-тайла должен быть целым числом.');
  return ((x % count) + count) % count;
}

export function isValidSourceTileY(y: number, z: number) {
  const count = tileCount(z);
  return Number.isInteger(y) && y >= 0 && y < count;
}

export function latLonToSourceTile(
  lat: number,
  lon: number,
  z = SOURCE_TILE_ZOOM,
): SourceTileId {
  const count = tileCount(z);
  if (!Number.isFinite(lat) || !Number.isFinite(lon))
    throw new Error('Широта и долгота должны быть конечными числами.');

  const boundedLat = Math.max(
      -WEB_MERCATOR_MAX_LATITUDE,
      Math.min(WEB_MERCATOR_MAX_LATITUDE, lat),
    ),
    rawX = ((normalizeLongitude(lon) + 180) / 360) * count,
    rawY = projectedTileY(boundedLat, count);

  return {
    z,
    x: normalizeSourceTileX(Math.floor(rawX), z),
    y: Math.max(0, Math.min(count - 1, Math.floor(rawY))),
  };
}

export function sourceTileBounds(id: SourceTileId): SourceTileBounds {
  const count = tileCount(id.z);
  if (!isValidSourceTileY(id.y, id.z))
    throw new Error(`Y source-тайла вне диапазона для zoom ${id.z}.`);
  const x = normalizeSourceTileX(id.x, id.z);
  return {
    south: latitudeAtTileBoundary(id.y + 1, count),
    west: (x / count) * 360 - 180,
    north: latitudeAtTileBoundary(id.y, count),
    east: ((x + 1) / count) * 360 - 180,
  };
}
