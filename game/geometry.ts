import type { Point } from './types';
export type Bounds = { minX: number; maxX: number; minZ: number; maxZ: number };
export const boundsOf = (points: Point[], extra = 0): Bounds => ({
  minX: Math.min(...points.map((p) => p.x)) - extra,
  maxX: Math.max(...points.map((p) => p.x)) + extra,
  minZ: Math.min(...points.map((p) => p.z)) - extra,
  maxZ: Math.max(...points.map((p) => p.z)) + extra,
});
export const overlaps = (a: Bounds, b: Bounds) =>
  a.minX <= b.maxX && a.maxX >= b.minX && a.minZ <= b.maxZ && a.maxZ >= b.minZ;
export class SpatialGrid<T> {
  private cells = new Map<string, { item: T; bounds: Bounds }[]>();
  constructor(private size = 32) {}
  private keys(b: Bounds) {
    const keys: string[] = [];
    for (
      let x = Math.floor(b.minX / this.size);
      x <= Math.floor(b.maxX / this.size);
      x++
    )
      for (
        let z = Math.floor(b.minZ / this.size);
        z <= Math.floor(b.maxZ / this.size);
        z++
      )
        keys.push(`${x},${z}`);
    return keys;
  }
  add(item: T, bounds: Bounds) {
    const entry = { item, bounds };
    for (const key of this.keys(bounds)) {
      const list = this.cells.get(key) || [];
      list.push(entry);
      this.cells.set(key, list);
    }
  }
  query(bounds: Bounds) {
    const found = new Set<T>();
    for (const key of this.keys(bounds))
      for (const entry of this.cells.get(key) || [])
        if (overlaps(bounds, entry.bounds)) found.add(entry.item);
    return [...found];
  }
}
export type Plane = { x: number; y: number; z: number; w: number };
export type Prism = { bounds: Bounds; planes: Plane[] };
export type UVPoint = Point & { u?: number; v?: number };
const evaluate = (p: Point, plane: Plane) =>
  p.x * plane.x + p.y * plane.y + p.z * plane.z + plane.w;
const lerp = (a: UVPoint, b: UVPoint, t: number): UVPoint => ({
  x: a.x + (b.x - a.x) * t,
  y: a.y + (b.y - a.y) * t,
  z: a.z + (b.z - a.z) * t,
  ...(a.u !== undefined
    ? { u: a.u + (b.u! - a.u) * t, v: a.v! + (b.v! - a.v!) * t }
    : {}),
});
export function footprintPrism(
  points: Point[],
  height: Plane,
  below: number,
  above: number,
): Prism {
  const area = points.reduce(
      (s, p, i) =>
        s +
        p.x * points[(i + 1) % points.length].z -
        points[(i + 1) % points.length].x * p.z,
      0,
    ),
    sign = area >= 0 ? 1 : -1;
  const planes = points.map((p, i) => {
    const q = points[(i + 1) % points.length],
      dx = q.x - p.x,
      dz = q.z - p.z;
    return {
      x: -dz * sign,
      y: 0,
      z: dx * sign,
      w: (dz * p.x - dx * p.z) * sign,
    };
  });
  planes.push(
    { ...height, w: height.w + below },
    { x: -height.x, y: -height.y, z: -height.z, w: -height.w + above },
  );
  return { bounds: boundsOf(points), planes };
}
export function roadPrism(
  a: Point,
  b: Point,
  width: number,
  below: number,
  above: number,
): Prism {
  const dx = b.x - a.x,
    dz = b.z - a.z,
    length = Math.hypot(dx, dz) || 1,
    nx = dz / length,
    nz = -dx / length,
    w = width / 2;
  const slope = (b.y - a.y) / (length * length),
    height = {
      x: -dx * slope,
      y: 1,
      z: -dz * slope,
      w: -a.y + (a.x * dx + a.z * dz) * slope,
    };
  return footprintPrism(
    [
      { ...a, x: a.x + nx * w, z: a.z + nz * w },
      { ...b, x: b.x + nx * w, z: b.z + nz * w },
      { ...b, x: b.x - nx * w, z: b.z - nz * w },
      { ...a, x: a.x - nx * w, z: a.z - nz * w },
    ],
    height,
    below,
    above,
  );
}
export function subtractPrism(polygons: UVPoint[][], mask: Prism): UVPoint[][] {
  const output: UVPoint[][] = [];
  for (const polygon of polygons) {
    if (
      !overlaps(boundsOf(polygon), mask.bounds) ||
      mask.planes.some((plane) =>
        polygon.every((p) => evaluate(p, plane) < -1e-7),
      )
    ) {
      output.push(polygon);
      continue;
    }
    let inside = polygon;
    for (const plane of mask.planes) {
      const kept: UVPoint[] = [],
        outside: UVPoint[] = [];
      for (let i = 0; i < inside.length; i++) {
        const p = inside[i],
          q = inside[(i + 1) % inside.length],
          dp = evaluate(p, plane),
          dq = evaluate(q, plane);
        (dp >= -1e-8 ? kept : outside).push(p);
        if (dp >= -1e-8 !== dq >= -1e-8) {
          const cut = lerp(p, q, dp / (dp - dq));
          kept.push(cut);
          outside.push(cut);
        }
      }
      if (outside.length >= 3) output.push(outside);
      inside = kept;
      if (!inside.length) break;
    }
  }
  return output;
}
export function subtractPrisms(polygon: UVPoint[], masks: Prism[]) {
  let pieces = [polygon];
  for (const mask of masks) {
    pieces = subtractPrism(pieces, mask);
    if (!pieces.length) break;
  }
  return pieces;
}
