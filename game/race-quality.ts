import { distance2, pathLengths, projectOnSegment } from './geo';
import type { Point, Route } from './types';

export const MIN_RACE_LENGTH = 2000;

export function raceGeometryValid(points: Point[], kind: Route['kind']) {
  if (
    points.length < 2 ||
    points.some((p) => ![p.x, p.y, p.z].every(Number.isFinite))
  )
    return false;
  const length = pathLengths(points).at(-1)!;
  if (length < MIN_RACE_LENGTH) return false;
  if (kind === 'circuit') {
    if (distance2(points[0], points.at(-1)!) > 0.1) return false;
    const area =
      Math.abs(
        points
          .slice(1)
          .reduce(
            (sum, p, i) => sum + points[i].x * p.z - p.x * points[i].z,
            0,
          ),
      ) / 2;
    if (area < length * length * 0.005) return false;
  }
  for (let i = 1; i < points.length; i++)
    for (let j = i + 2; j < points.length; j++) {
      if (kind === 'circuit' && i === 1 && j === points.length - 1) continue;
      const a = points[i - 1],
        b = points[i],
        c = points[j - 1],
        d = points[j];
      const ux = b.x - a.x,
        uz = b.z - a.z,
        vx = d.x - c.x,
        vz = d.z - c.z;
      const cross = ux * vz - uz * vx;
      if (Math.abs(cross) > 1e-7) {
        const t = ((c.x - a.x) * vz - (c.z - a.z) * vx) / cross;
        const u = ((c.x - a.x) * uz - (c.z - a.z) * ux) / cross;
        if (
          t >= -1e-6 &&
          t <= 1 + 1e-6 &&
          u >= -1e-6 &&
          u <= 1 + 1e-6 &&
          Math.abs(a.y + t * (b.y - a.y) - c.y - u * (d.y - c.y)) < 4
        )
          return false;
      } else if (ux * vx + uz * vz < 0) {
        const mid = {
          x: (c.x + d.x) / 2,
          y: (c.y + d.y) / 2,
          z: (c.z + d.z) / 2,
        };
        const projected = projectOnSegment(mid, a, b);
        if (
          projected.distance < 16 &&
          Math.abs(projected.point.y - mid.y) < 4 &&
          distance2(c, d) > 35
        )
          return false;
      }
    }
  return true;
}
