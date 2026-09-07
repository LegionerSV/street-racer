import type { Center, ElevationGrid, Point } from './types';
export const REGION_SIZE = 5000;
export const CHUNK_SIZE = 250;
const METERS = 111320;
export const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const smooth = (t: number) => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
// Нулевые первая и вторая производные на концах: мягкий вход и выход из уклона.
export const smoother = (t: number) => { t = clamp(t, 0, 1); return t * t * t * (t * (t * 6 - 15) + 10); };
export const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
export const distance2 = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.z - b.z);
export const mixPoint = (a: Point, b: Point, t: number): Point => ({ x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t), z: lerp(a.z, b.z, t) });
export function toLocal(lat: number, lon: number, center: Center): Point {
  const dl = ((lon - center.lon + 540) % 360) - 180;
  return { x: dl * METERS * Math.cos(center.lat * Math.PI / 180), y: 0, z: (lat - center.lat) * METERS };
}
export function toGeo(p: Point, center: Center): Center { return { lat: center.lat + p.z / METERS, lon: ((center.lon + p.x / (METERS * Math.cos(center.lat * Math.PI / 180)) + 540) % 360) - 180 }; }
export function bounds(center: Center, half = 2800) {
  const sw = toGeo({ x: -half, y: 0, z: -half }, center), ne = toGeo({ x: half, y: 0, z: half }, center);
  return { south: sw.lat, west: sw.lon, north: ne.lat, east: ne.lon };
}
export function sampleElevation(grid: ElevationGrid, x: number, z: number): number {
  const gx = clamp((x / grid.size + .5) * (grid.width - 1), 0, grid.width - 1), gz = clamp((z / grid.size + .5) * (grid.width - 1), 0, grid.width - 1);
  const ix = Math.min(grid.width - 2, Math.floor(gx)), iz = Math.min(grid.width - 2, Math.floor(gz));
  const tx = gx - ix, tz = gz - iz, a = iz * grid.width + ix;
  return lerp(lerp(grid.values[a], grid.values[a + 1], tx), lerp(grid.values[a + grid.width], grid.values[a + grid.width + 1], tx), tz);
}
export function smoothElevation(grid: ElevationGrid): ElevationGrid {
  // DEM содержит локальные пики, которые не должны становиться трамплинами.
  const { width, size } = grid;
  if (width < 3) return { ...grid, values: grid.values.slice() };
  const radius = Math.max(1, Math.min(5, Math.round(65 / (size / (width - 1)))));
  // Медиана удаляет одиночные выбросы до размытия: иначе пик превращается в широкий холм.
  // Симметричное окно сохраняет высоты плоскости и масштаб протяжённых склонов.
  let values = new Float32Array(grid.values.length);
  for (let z = 0; z < width; z++) for (let x = 0; x < width; x++) {
    const neighbours: number[] = [];
    for (let dz = -radius; dz <= radius; dz++) for (let dx = -radius; dx <= radius; dx++) neighbours.push(grid.values[clamp(z + dz, 0, width - 1) * width + clamp(x + dx, 0, width - 1)]);
    neighbours.sort((a, b) => a - b);
    values[z * width + x] = neighbours[Math.floor(neighbours.length / 2)];
  }
  for (let pass = 0; pass < 2; pass++) for (const axis of [0, 1]) {
    const next = new Float32Array(values.length);
    for (let z = 0; z < width; z++) for (let x = 0; x < width; x++) {
      let sum = 0, weight = 0;
      for (let d = -radius; d <= radius; d++) { const xx = clamp(x + (axis ? 0 : d), 0, width - 1), zz = clamp(z + (axis ? d : 0), 0, width - 1), w = radius + 1 - Math.abs(d); sum += values[zz * width + xx] * w; weight += w; }
      next[z * width + x] = sum / weight;
    }
    values = next;
  }
  return { ...grid, values };
}
export const decodeTerrarium = (r: number, g: number, b: number) => r * 256 + g + b / 256 - 32768;
// Монотонная кубическая интерполяция сглаживает переломы между ячейками DEM без новых пиков.
export function sampleRoadElevation(grid: ElevationGrid, x: number, z: number): number {
  const gx = clamp((x / grid.size + .5) * (grid.width - 1), 0, grid.width - 1), gz = clamp((z / grid.size + .5) * (grid.width - 1), 0, grid.width - 1);
  const ix = Math.min(grid.width - 2, Math.floor(gx)), iz = Math.min(grid.width - 2, Math.floor(gz));
  const cubic = (a: number, b: number, c: number, d: number, t: number) => {
    const slope = (u: number, v: number) => u * v <= 0 ? 0 : 2 * u * v / (u + v);
    const m = slope(b - a, c - b), n = slope(c - b, d - c), t2 = t * t, t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * b + (t3 - 2 * t2 + t) * m + (-2 * t3 + 3 * t2) * c + (t3 - t2) * n;
  };
  const rows: number[] = [];
  for (let dz = -1; dz <= 2; dz++) {
    const row = clamp(iz + dz, 0, grid.width - 1) * grid.width;
    rows.push(cubic(...[-1, 0, 1, 2].map(dx => grid.values[row + clamp(ix + dx, 0, grid.width - 1)]) as [number, number, number, number], gx - ix));
  }
  return cubic(rows[0], rows[1], rows[2], rows[3], gz - iz);
}
export const tileKey = (x: number, z: number) => `${Math.floor(x / CHUNK_SIZE)},${Math.floor(z / CHUNK_SIZE)}`;
export function projectOnSegment(p: Point, a: Point, b: Point) {
  const dx = b.x - a.x, dz = b.z - a.z;
  const t = clamp(((p.x - a.x) * dx + (p.z - a.z) * dz) / (dx * dx + dz * dz || 1), 0, 1);
  const point = mixPoint(a, b, t);
  return { t, point, distance: distance2(p, point) };
}
export function resample(points: Point[], step = 12): Point[] {
  if (!points.length) return [];
  const out = [points[0]];
  for (let i = 1; i < points.length; i++) {
    const n = Math.max(1, Math.ceil(distance2(points[i - 1], points[i]) / step));
    for (let j = 1; j <= n; j++) out.push(mixPoint(points[i - 1], points[i], j / n));
  }
  return out;
}
export function pathLengths(points: Point[]) { const lengths = [0]; for (let i = 1; i < points.length; i++) lengths.push(lengths[i - 1] + distance(points[i - 1], points[i])); return lengths; }
export function pointAt(points: Point[], lengths: number[], d: number) {
  let lo = 0, hi = points.length - 1;
  d = clamp(d, 0, lengths[hi]);
  while (lo + 1 < hi) { const mid = (lo + hi) >> 1; if (lengths[mid] <= d) lo = mid; else hi = mid; }
  const t = clamp((d - lengths[lo]) / (lengths[hi] - lengths[lo] || 1), 0, 1);
  return { point: mixPoint(points[lo], points[hi], t), heading: Math.atan2(points[hi].x - points[lo].x, points[hi].z - points[lo].z), segment: lo };
}
export function seeded(id: number) { let n = Math.imul(id ^ (id >>> 16), 0x45d9f3b); n = Math.imul(n ^ (n >>> 16), 0x45d9f3b); return ((n ^ (n >>> 16)) >>> 0) / 4294967296; }
export function polygonContains(p: Point, points: Point[]) { let inside = false; for (let i = 0, j = points.length - 1; i < points.length; j = i++) { const a = points[i], b = points[j]; if ((a.z > p.z) !== (b.z > p.z) && p.x < (b.x - a.x) * (p.z - a.z) / (b.z - a.z) + a.x) inside = !inside; } return inside; }
